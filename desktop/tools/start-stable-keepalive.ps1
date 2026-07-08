$ErrorActionPreference = "Stop"

$Root = "D:\zhinengkefu\desktop"
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
$SupervisorMode = $env:STABLE_KEEPALIVE_SUPERVISOR -eq "1"

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

function Find-KeepAliveProcess {
  try {
    Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
      Where-Object { ($_.CommandLine -match [regex]::Escape($StableRuntimeLauncherScript)) -or ($_.CommandLine -like "*stable-runtime-launcher.js*") } |
      Sort-Object ProcessId -Descending |
      Select-Object -First 1
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
  $webReady = Test-StableHttp "http://127.0.0.1:3100/"
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
& "$PSCommandPath"
"@
  return Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -PassThru
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

try {
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  try {
    Remove-Item -Force -ErrorAction Stop -Path $StopRequestFile
  } catch [System.Management.Automation.ItemNotFoundException] {
  } catch {
    Write-Warning "stable stop request cleanup unavailable: $($_.Exception.Message)"
  }
  Write-StableStartingLock

  if ($SupervisorMode) {
    Invoke-StableSupervisorLoop
    exit 0
  }

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
