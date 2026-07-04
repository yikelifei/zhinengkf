$ErrorActionPreference = "Stop"

$Root = "D:\zhinengkefu\desktop"
$RuntimeDir = if ($env:DESKTOP_RUNTIME_DIR) { $env:DESKTOP_RUNTIME_DIR } else { Join-Path $Root ".runtime-stable" }
$LogDir = Join-Path $RuntimeDir "logs"
$KeepAliveScript = Join-Path $Root "keepalive-stable-desktop.cmd"
$TaskName = "zhinengkefu_stable_runtime"
$SystemRoot = if ($env:SystemRoot) { $env:SystemRoot } else { "C:\Windows" }
$Schtasks = Join-Path $SystemRoot "System32\schtasks.exe"
$StartLog = Join-Path $RuntimeDir "stable-start.log"

function Write-StableStartLog($Message) {
  try {
    Add-Content -Path $StartLog -Value "[$((Get-Date).ToString("o"))] $Message" -ErrorAction Stop
  } catch {
    Write-Warning "stable start log unavailable: $($_.Exception.Message)"
  }
}

try {
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

  & node (Join-Path $Root "tools\stable-start-needed.js") | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-StableStartLog "stable services already healthy; watchdog start skipped"
    Write-Output "[stable] services already healthy"
    exit 0
  }

  $WatchdogRun = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"`"$PSCommandPath`"`""
  Write-StableStartLog "creating scheduled watchdog $TaskName every 1 minute"
  & $Schtasks /Create /TN $TaskName /SC MINUTE /MO 1 /TR $WatchdogRun /F 2>&1 | ForEach-Object { Write-StableStartLog "schtasks-create-watchdog: $_" }

  $CreateResult = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "cmd.exe /d /k `"`"$KeepAliveScript`"`""
    CurrentDirectory = $Root
  }
  if ($CreateResult.ReturnValue -eq 0 -and $CreateResult.ProcessId) {
    Write-StableStartLog "CIM keepalive pid=$($CreateResult.ProcessId)"
    Write-Output "[stable] keepalive started pid=$($CreateResult.ProcessId)"
    exit 0
  }
  Write-Warning "CIM keepalive start failed with code $($CreateResult.ReturnValue)"
} catch {
  Write-StableStartLog "CIM keepalive start failed: $($_.Exception.Message)"
  Write-Warning "CIM keepalive start failed: $($_.Exception.Message)"
}

try {
  Write-StableStartLog "running scheduled watchdog $TaskName"
  & $Schtasks /Run /TN $TaskName 2>&1 | ForEach-Object { Write-StableStartLog "schtasks-run: $_" }
  if ($LASTEXITCODE -ne 0) {
    throw "schtasks /Run failed with exit code $LASTEXITCODE"
  }
  Start-Sleep -Milliseconds 1000
  $process = Get-CimInstance Win32_Process -Filter "name = 'cmd.exe'" |
    Where-Object { $_.CommandLine -match [regex]::Escape($KeepAliveScript) } |
    Sort-Object ProcessId -Descending |
    Select-Object -First 1
  if ($process) {
    Write-StableStartLog "scheduled task keepalive pid=$($process.ProcessId)"
    Write-Output "[stable] keepalive started by scheduled task pid=$($process.ProcessId)"
    exit 0
  }
  Write-Warning "scheduled task started but keepalive process was not found"
} catch {
  Write-StableStartLog "scheduled watchdog start failed: $($_.Exception.Message)"
  Write-Warning "scheduled watchdog start failed: $($_.Exception.Message)"
}

try {
  $WindowTitle = "SmartKefu Stable Runtime"
  $StartCommand = "start `"$WindowTitle`" /min cmd.exe /d /k `"`"$KeepAliveScript`"`""
  & cmd.exe /d /c $StartCommand
  Start-Sleep -Milliseconds 500
  $process = Get-CimInstance Win32_Process -Filter "name = 'cmd.exe'" |
    Where-Object { $_.CommandLine -match [regex]::Escape($KeepAliveScript) } |
    Sort-Object ProcessId -Descending |
    Select-Object -First 1
  if ($process) {
    Write-Output "[stable] keepalive started pid=$($process.ProcessId)"
    exit 0
  }
  Write-Warning "keepalive start command returned but process was not found"
} catch {
  Write-Warning "detached keepalive start failed: $($_.Exception.Message)"
}

try {
  $process = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/k", "`"$KeepAliveScript`"") -WorkingDirectory $Root -WindowStyle Minimized -PassThru
  Write-Output "[stable] keepalive started pid=$($process.Id)"
  exit 0
} catch {
  Write-Warning "keepalive start failed: $($_.Exception.Message)"
}

try {
  $process = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-Command", "& `"$KeepAliveScript`"") -WorkingDirectory $Root -WindowStyle Minimized -PassThru
  Write-Output "[stable] keepalive started by fallback powershell pid=$($process.Id)"
  exit 0
} catch {
  Write-Error "failed to start stable keepalive: $($_.Exception.Message)"
  exit 1
}
