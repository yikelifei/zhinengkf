$ErrorActionPreference = "Stop"

$Root = "D:\zhinengkefu\desktop"
$RuntimeDir = if ($env:DESKTOP_RUNTIME_DIR) { $env:DESKTOP_RUNTIME_DIR } else { Join-Path $Root ".runtime-stable" }
$LogDir = Join-Path $RuntimeDir "logs"
$LauncherScript = Join-Path $Root "tools\stable-runtime-launcher.js"
$KeepAliveScript = Join-Path $Root "keepalive-stable-desktop.cmd"

try {
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  $processInfo = New-Object System.Diagnostics.ProcessStartInfo
  $processInfo.FileName = "node.exe"
  $processInfo.Arguments = "`"$LauncherScript`""
  $processInfo.WorkingDirectory = $Root
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $processInfo
  $null = $process.Start()
  Write-Output "[stable] runtime launcher started pid=$($process.Id)"
  exit 0
} catch {
  Write-Warning "direct runtime launcher failed: $($_.Exception.Message)"
}

try {
  $process = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/k", $KeepAliveScript) -WorkingDirectory $Root -WindowStyle Minimized -PassThru
  Write-Output "[stable] keepalive started by fallback minimized cmd pid=$($process.Id)"
  exit 0
} catch {
  Write-Error "failed to start stable keepalive: $($_.Exception.Message)"
  exit 1
}
