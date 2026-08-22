$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = if ($env:DESKTOP_RUNTIME_DIR) { $env:DESKTOP_RUNTIME_DIR } else { Join-Path $Root ".runtime-stable" }
$LogDir = Join-Path $RuntimeDir "logs"
$NodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$StableRuntimeLauncherScript = Join-Path $Root "tools\stable-runtime-launcher.js"
$StableRuntimeLauncherArgument = "tools\stable-runtime-launcher.js"
$StartLog = Join-Path $RuntimeDir "stable-start.log"
$KeepAliveOutLog = Join-Path $LogDir "stable-runtime-launcher.out.log"
$KeepAliveErrLog = Join-Path $LogDir "stable-runtime-launcher.err.log"
$StableStartingLock = Join-Path $RuntimeDir "stable-starting.lock"
$StopRequestFile = Join-Path $RuntimeDir "stable-runtime-stop-request"
$HeartbeatFile = Join-Path $RuntimeDir "keep-alive.json"
$SupervisorMode = $env:STABLE_KEEPALIVE_SUPERVISOR -eq "1"
$SupervisorMutex = $null
$SupervisorMutexHeld = $false
$env:STABLE_WECHAT_BRIDGE_MODE = "dispatch"
$env:STABLE_PERSONAL_WECHAT_SEND = "0"

function Write-StableStartLog($Message) {
  try {
    Add-Content -Path $StartLog -Value "[$((Get-Date).ToString("o"))] $Message" -ErrorAction Stop
  } catch {
    Write-Warning "stable start log unavailable: $($_.Exception.Message)"
  }
}

function Write-StableStartingLock {
  try {
    Set-Content -Path $StableStartingLock -Value (Get-Date).ToString("o") -Encoding UTF8 -ErrorAction Stop
  } catch {
    Write-Warning "stable starting lock unavailable: $($_.Exception.Message)"
  }
}

function Normalize-ProcessPathEnvironment {
  $environment = [Environment]::GetEnvironmentVariables()
  $pathKeys = @($environment.Keys | Where-Object {
    [string]::Equals([string]$_, "Path", [System.StringComparison]::OrdinalIgnoreCase)
  })
  if (-not $pathKeys.Count) {
    return
  }

  $pathValue = [string]$environment[$pathKeys[0]]
  foreach ($pathKey in $pathKeys) {
    [Environment]::SetEnvironmentVariable([string]$pathKey, $null, "Process")
  }
  [Environment]::SetEnvironmentVariable("Path", $pathValue, "Process")
}

function Find-KeepAliveProcess {
  try {
    if (-not (Test-Path $HeartbeatFile)) {
      return $null
    }
    $heartbeat = Get-Content -Raw -Path $HeartbeatFile | ConvertFrom-Json
    $processId = [int]$heartbeat.pid
    $updatedAt = [DateTimeOffset]::Parse([string]$heartbeat.updatedAt)
    $heartbeatIsFresh = ([DateTimeOffset]::UtcNow - $updatedAt.ToUniversalTime()).TotalSeconds -le 30
    $isStableLauncher = @($heartbeat.args) -contains "stable-runtime-launcher"
    if ($processId -le 0 -or -not $heartbeatIsFresh -or -not $isStableLauncher) {
      return $null
    }
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $process) {
      return $null
    }
    [pscustomobject]@{ ProcessId = $processId }
  } catch {
    Write-Warning "stable launcher process lookup unavailable: $($_.Exception.Message)"
    return $null
  }
}

function Test-StableHttp($Url) {
  try {
    $statusCodeText = & curl.exe -s -o NUL -w "%{http_code}" --max-time 3 $Url
    $statusCode = [int]$statusCodeText
    return $statusCode -ge 200 -and $statusCode -lt 500
  } catch {
    return $false
  }
}

function Test-StableRuntimeHealthy {
  $webReady = Test-StableHttp "http://127.0.0.1:3100/overview"
  $apiReady = Test-StableHttp "http://127.0.0.1:3200/api/health"
  $designReady = Test-StableHttp "http://127.0.0.1:3700/v1/health"
  return $webReady -and $apiReady -and $designReady
}

function Wait-StableRuntimeReady($ProcessId) {
  $deadline = (Get-Date).AddSeconds(180)
  $reportedProcessExit = $false
  while ((Get-Date) -lt $deadline) {
    if (Test-StableRuntimeHealthy) {
      return $true
    }

    $running = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $running -and -not $reportedProcessExit) {
      Write-StableStartLog "stable runtime launcher pid=$ProcessId exited before health check passed; continuing health wait"
      $reportedProcessExit = $true
    }

    Start-Sleep -Milliseconds 1000
  }

  return $false
}

function Start-StableRuntimeProcess {
  try {
    return Start-Process `
      -FilePath $NodeExe `
      -ArgumentList @($StableRuntimeLauncherArgument) `
      -WorkingDirectory $Root `
      -WindowStyle Hidden `
      -RedirectStandardOutput $KeepAliveOutLog `
      -RedirectStandardError $KeepAliveErrLog `
      -PassThru
  } catch {
    Write-StableStartLog "stable launcher process start failed: $($_.Exception.Message)"
    throw
  }
}

function Start-StableSupervisorProcess {
  $command = @"
`$env:DESKTOP_RUNTIME_DIR = "$RuntimeDir"
`$env:STABLE_KEEPALIVE_SUPERVISOR = "1"
`$env:STABLE_WECHAT_BRIDGE_MODE = "dispatch"
`$env:STABLE_PERSONAL_WECHAT_SEND = "0"
& "$PSCommandPath"
"@
  $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  $commandLine = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand $encodedCommand"
  try {
    # WMI owns this long-lived guard instead of the short-lived launcher process.
    # That prevents a terminal/app/job teardown from taking customer reply services down with it.
    $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
      CommandLine = $commandLine
      CurrentDirectory = $Root
    }
    if ($created.ReturnValue -ne 0 -or [int]$created.ProcessId -le 0) {
      throw "Win32_Process.Create failed returnValue=$($created.ReturnValue)"
    }
    return [pscustomobject]@{ Id = [int]$created.ProcessId; Durable = $true }
  } catch {
    Write-StableStartLog "durable supervisor handoff unavailable; using hidden process fallback: $($_.Exception.Message)"
    return Start-Process `
      -FilePath "powershell.exe" `
      -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encodedCommand) `
      -WorkingDirectory $Root `
      -WindowStyle Hidden `
      -PassThru
  }
}

function Invoke-StableSupervisorLoop {
  Write-StableStartLog "stable keepalive supervisor running pid=$PID"
  while ($true) {
    if (Test-Path $StopRequestFile) {
      Write-StableStartLog "stable keepalive supervisor stop request received pid=$PID"
      exit 0
    }

    Write-StableStartingLock
    $existing = Find-KeepAliveProcess
    if (-not $existing) {
      Write-StableStartLog "stable runtime launcher missing; restarting"
      $process = Start-StableRuntimeProcess
      Write-StableStartLog "stable runtime launcher restarted pid=$($process.Id)"
    }

    Start-Sleep -Seconds 5
  }
}

function Enter-StableSupervisorMutex {
  $normalizedRuntime = [IO.Path]::GetFullPath($RuntimeDir).TrimEnd('\').ToLowerInvariant()
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $hashBytes = $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($normalizedRuntime))
    $hash = ([BitConverter]::ToString($hashBytes)).Replace("-", "").Substring(0, 24)
  } finally {
    $sha256.Dispose()
  }
  $script:SupervisorMutex = [Threading.Mutex]::new($false, "Local\ZhinengKefuStableKeepalive-$hash")
  try {
    $script:SupervisorMutexHeld = $script:SupervisorMutex.WaitOne(0)
  } catch [Threading.AbandonedMutexException] {
    $script:SupervisorMutexHeld = $true
  }
  return $script:SupervisorMutexHeld
}

function Exit-StableSupervisorMutex {
  if ($script:SupervisorMutexHeld -and $script:SupervisorMutex) {
    try { $script:SupervisorMutex.ReleaseMutex() } catch {}
  }
  if ($script:SupervisorMutex) { $script:SupervisorMutex.Dispose() }
  $script:SupervisorMutexHeld = $false
  $script:SupervisorMutex = $null
}

try {
  Normalize-ProcessPathEnvironment
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

  if ($SupervisorMode) {
    if (Test-Path $StopRequestFile) {
      Write-StableStartLog "stable keepalive supervisor observed stop request before startup pid=$PID"
      exit 0
    }
    if (-not (Enter-StableSupervisorMutex)) {
      Write-StableStartLog "duplicate stable keepalive supervisor skipped pid=$PID"
      exit 0
    }
    try {
      Invoke-StableSupervisorLoop
    } finally {
      Exit-StableSupervisorMutex
    }
    exit 0
  }

  try {
    Remove-Item -Force -ErrorAction Stop -Path $StopRequestFile
  } catch [System.Management.Automation.ItemNotFoundException] {
  } catch {
    Write-Warning "stable stop request cleanup unavailable: $($_.Exception.Message)"
  }
  Write-StableStartingLock

  & node (Join-Path $Root "tools\stable-start-needed.js") | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-StableStartLog "stable services already healthy; keepalive start skipped"
    Write-Output "[stable] services already healthy"
    exit 0
  }

  $existing = Find-KeepAliveProcess
  if ($existing) {
    Write-StableStartLog "stable runtime launcher already running pid=$($existing.ProcessId)"
    Write-Output "[stable] stable runtime launcher already running pid=$($existing.ProcessId)"
    exit 0
  }

  Write-StableStartLog "starting hidden stable keepalive supervisor"
  $process = Start-StableSupervisorProcess
  if (Wait-StableRuntimeReady $process.Id) {
    Write-StableStartLog "stable keepalive supervisor ready pid=$($process.Id)"
    Write-Output "[stable] stable keepalive supervisor started pid=$($process.Id)"
    exit 0
  }

  throw "stable runtime did not become healthy supervisorPid=$($process.Id)"
} catch {
  Write-StableStartLog "stable runtime launcher start failed: $($_.Exception.Message)"
  Write-Error "failed to start stable runtime launcher: $($_.Exception.Message)"
  exit 1
}
