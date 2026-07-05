$ErrorActionPreference = "Stop"

$Root = "D:\zhinengkefu\desktop"
$RuntimeDir = if ($env:DESKTOP_RUNTIME_DIR) { $env:DESKTOP_RUNTIME_DIR } else { Join-Path $Root ".runtime-stable" }
$LogDir = Join-Path $RuntimeDir "logs"
$KeepAliveScript = Join-Path $Root "keepalive-stable-desktop.cmd"
$NodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$StartDevPortsScript = Join-Path $Root "tools\start-dev-ports.js"
$StartLog = Join-Path $RuntimeDir "stable-start.log"
$KeepAliveOutLog = Join-Path $LogDir "stable-start-dev-ports.out.log"
$KeepAliveErrLog = Join-Path $LogDir "stable-start-dev-ports.err.log"
$StableStartingLock = Join-Path $RuntimeDir "stable-starting.lock"
$StopRequestFile = Join-Path $RuntimeDir "stable-runtime-stop-request"

function Write-StableStartLog($Message) {
  try {
    Add-Content -Path $StartLog -Value "[$((Get-Date).ToString("o"))] $Message" -ErrorAction Stop
  } catch {
    Write-Warning "stable start log unavailable: $($_.Exception.Message)"
  }
}

function Find-KeepAliveProcess {
  Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object {
      $_.CommandLine -match [regex]::Escape($StartDevPortsScript) -and
      $_.CommandLine -match "--mock-design" -and
      $_.CommandLine -match "--keep-alive"
    } |
    Sort-Object ProcessId -Descending |
    Select-Object -First 1
}

try {
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  Remove-Item -Force -ErrorAction SilentlyContinue -Path $StopRequestFile
  Set-Content -Path $StableStartingLock -Value (Get-Date).ToString("o") -Encoding UTF8

  & node (Join-Path $Root "tools\stable-start-needed.js") | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-StableStartLog "stable services already healthy; keepalive start skipped"
    Write-Output "[stable] services already healthy"
    exit 0
  }

  $existing = Find-KeepAliveProcess
  if ($existing) {
    Write-StableStartLog "keepalive already running pid=$($existing.ProcessId)"
    Write-Output "[stable] keepalive already running pid=$($existing.ProcessId)"
    exit 0
  }

  Write-StableStartLog "starting detached start-dev-ports keepalive"
  $env:DESKTOP_RUNTIME_DIR = $RuntimeDir
  $env:SKIP_EXISTING_API_BUILD = "1"
  $env:SKIP_EXISTING_WEB_BUILD = "1"
  $env:FORCE_PORTS_SWEEP = "1"
  $process = Start-Process `
    -FilePath $NodeExe `
    -ArgumentList @($StartDevPortsScript, "--mock-design", "--keep-alive") `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $KeepAliveOutLog `
    -RedirectStandardError $KeepAliveErrLog `
    -PassThru
  Start-Sleep -Milliseconds 1500
  $running = Find-KeepAliveProcess
  if ($running) {
    Write-StableStartLog "detached keepalive pid=$($running.ProcessId) startProcessPid=$($process.Id)"
    Write-Output "[stable] keepalive started pid=$($running.ProcessId)"
    exit 0
  }

  throw "Start-Process returned pid=$($process.Id) but keepalive process was not found"
} catch {
  Write-StableStartLog "detached keepalive start failed: $($_.Exception.Message)"
  Write-Error "failed to start stable keepalive: $($_.Exception.Message)"
  exit 1
}
