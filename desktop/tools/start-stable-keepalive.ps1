$ErrorActionPreference = "Stop"

$Root = "D:\zhinengkefu\desktop"
$KeepAliveScript = Join-Path $Root "keepalive-stable-desktop.cmd"

try {
  $command = "start `"SmartKefu Stable Runtime`" /min cmd.exe /k `"$KeepAliveScript`""
  $process = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/c", $command) -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  Write-Output "[stable] keepalive started in minimized CMD via Start-Process pid=$($process.Id)"
  exit 0
} catch {
  Write-Warning "minimized CMD launch failed: $($_.Exception.Message)"
}

try {
  $process = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/k", $KeepAliveScript) -WorkingDirectory $Root -WindowStyle Minimized -PassThru
  Write-Output "[stable] keepalive started by fallback minimized cmd pid=$($process.Id)"
  exit 0
} catch {
  Write-Error "failed to start stable keepalive: $($_.Exception.Message)"
  exit 1
}
