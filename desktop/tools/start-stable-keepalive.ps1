$ErrorActionPreference = "Stop"

$Root = "D:\zhinengkefu\desktop"
$RuntimeDir = if ($env:DESKTOP_RUNTIME_DIR) { $env:DESKTOP_RUNTIME_DIR } else { Join-Path $Root ".runtime-stable" }
$LogDir = Join-Path $RuntimeDir "logs"
$NodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$StableRuntimeLauncherScript = Join-Path $Root "tools\stable-runtime-launcher.js"
$StartLog = Join-Path $RuntimeDir "stable-start.log"
$KeepAliveOutLog = Join-Path $LogDir "stable-runtime-launcher.out.log"
$KeepAliveErrLog = Join-Path $LogDir "stable-runtime-launcher.err.log"
$StableStartingLock = Join-Path $RuntimeDir "stable-starting.lock"
$StopRequestFile = Join-Path $RuntimeDir "stable-runtime-stop-request"

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
  Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object { $_.CommandLine -match [regex]::Escape($StableRuntimeLauncherScript) } |
    Sort-Object ProcessId -Descending |
    Select-Object -First 1
}

function Test-StableHttp($Url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri $Url
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-StableRuntimeReady($ProcessId) {
  $deadline = (Get-Date).AddSeconds(35)
  while ((Get-Date) -lt $deadline) {
    $running = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $running) {
      return $false
    }

    $webReady = Test-StableHttp "http://127.0.0.1:3100/"
    $apiReady = Test-StableHttp "http://127.0.0.1:3200/api/health"
    $designReady = Test-StableHttp "http://127.0.0.1:3700/v1/health"
    if ($webReady -and $apiReady -and $designReady) {
      return $true
    }

    Start-Sleep -Milliseconds 1000
  }

  return $false
}

function Start-StableRuntimeProcess {
  try {
    return Start-Process `
      -FilePath $NodeExe `
      -ArgumentList @($StableRuntimeLauncherScript) `
      -WorkingDirectory $Root `
      -WindowStyle Hidden `
      -RedirectStandardOutput $KeepAliveOutLog `
      -RedirectStandardError $KeepAliveErrLog `
      -PassThru
  } catch {
    Write-StableStartLog "stable launcher log redirect failed: $($_.Exception.Message); retrying without redirected logs"
    Write-Warning "stable launcher log redirect failed: $($_.Exception.Message); retrying without redirected logs"
    return Start-Process `
      -FilePath $NodeExe `
      -ArgumentList @($StableRuntimeLauncherScript) `
      -WorkingDirectory $Root `
      -WindowStyle Hidden `
      -PassThru
  }
}

try {
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  Remove-Item -Force -ErrorAction SilentlyContinue -Path $StopRequestFile
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

  Write-StableStartLog "starting detached stable runtime launcher"
  $process = Start-StableRuntimeProcess
  if (Wait-StableRuntimeReady $process.Id) {
    Write-StableStartLog "stable runtime launcher ready pid=$($process.Id)"
    Write-Output "[stable] stable runtime launcher started pid=$($process.Id)"
    exit 0
  }

  throw "stable runtime did not become healthy pid=$($process.Id)"
} catch {
  Write-StableStartLog "stable runtime launcher start failed: $($_.Exception.Message)"
  Write-Error "failed to start stable runtime launcher: $($_.Exception.Message)"
  exit 1
}
