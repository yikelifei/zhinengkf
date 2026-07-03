$ErrorActionPreference = "Stop"

$Root = "D:\zhinengkefu\desktop"
$KeepAliveScript = Join-Path $Root "keepalive-stable-desktop.cmd"
$CommandLine = "cmd.exe /d /c `"$KeepAliveScript`""

try {
  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $CommandLine
    CurrentDirectory = $Root
  }
  if ($result.ReturnValue -eq 0) {
    Write-Output "[stable] keepalive started by Win32_Process pid=$($result.ProcessId)"
    exit 0
  }
  Write-Warning "Win32_Process.Create failed: $($result.ReturnValue)"
} catch {
  Write-Warning "Win32_Process.Create failed: $($_.Exception.Message)"
}

try {
  $process = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/c", $KeepAliveScript) -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  Write-Output "[stable] keepalive started by Start-Process pid=$($process.Id)"
  exit 0
} catch {
  Write-Error "failed to start stable keepalive: $($_.Exception.Message)"
  exit 1
}
