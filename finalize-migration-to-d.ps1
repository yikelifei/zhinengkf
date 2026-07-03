$ErrorActionPreference = "Stop"

$oldPath = "C:\Users\27808\Desktop\zhinengkefu"
$newPath = "D:\zhinengkefu"
$desktopPath = Join-Path $newPath "desktop"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runOnceKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce"

function Get-FileBytes {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return 0
  }

  $files = Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction SilentlyContinue |
    Where-Object { -not $_.PSIsContainer }
  $bytes = ($files | Measure-Object Length -Sum).Sum
  if ($null -eq $bytes) {
    return 0
  }
  return $bytes
}

function Remove-DirectoryTree {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue

  if (Test-Path -LiteralPath $Path) {
    Get-ChildItem -LiteralPath $Path -Force -Recurse -Directory -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending |
      ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
      }
  }

  if (Test-Path -LiteralPath $Path) {
    cmd.exe /c rmdir "$Path" 2>$null
  }
}

function Stop-OldPathProcesses {
  param([string]$Path)

  $currentPid = $PID
  $candidates = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and
      $_.ProcessId -ne $currentPid -and
      (
        $_.CommandLine.Contains($Path) -or
        $_.CommandLine.Contains((Join-Path $Path ".runtime-stable")) -or
        $_.CommandLine.Contains((Join-Path $Path "start-stable-desktop.cmd")) -or
        $_.CommandLine.Contains((Join-Path $Path "desktop"))
      )
    } |
    Where-Object {
      $_.Name -in @("node.exe", "cmd.exe", "powershell.exe", "conhost.exe")
    }

  foreach ($process in $candidates) {
    Write-Host "[stop-old] pid=$($process.ProcessId) name=$($process.Name)"
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Remove-AutorunEntries {
  Remove-ItemProperty -LiteralPath $runKey -Name "FinalizeZhinengkefuMigration" -ErrorAction SilentlyContinue
  Remove-ItemProperty -LiteralPath $runOnceKey -Name "FinalizeZhinengkefuMigrationOnce" -ErrorAction SilentlyContinue
}

Write-Host "[check] target: $newPath"
if (-not (Test-Path -LiteralPath $newPath)) {
  throw "Target path does not exist: $newPath"
}

if (-not (Test-Path -LiteralPath $desktopPath)) {
  throw "Desktop app path does not exist: $desktopPath"
}

Write-Host "[stop] D drive dev services"
Push-Location $desktopPath
try {
  npm.cmd run ports:stop
} finally {
  Pop-Location
}

Write-Host "[stop] old C drive project processes"
Stop-OldPathProcesses -Path $oldPath

Write-Host "[remove] old C drive path: $oldPath"
if (Test-Path -LiteralPath $oldPath) {
  Remove-DirectoryTree -Path $oldPath
}

if (Test-Path -LiteralPath $oldPath) {
  $bytes = Get-FileBytes -Path $oldPath
  throw "Old path is still present and could not be removed. Remaining file bytes: $bytes"
}

Write-Host "[link] $oldPath -> $newPath"
cmd.exe /c mklink /J "$oldPath" "$newPath"

$item = Get-Item -LiteralPath $oldPath -Force
if ($item.LinkType -ne "Junction") {
  throw "Expected a Junction at $oldPath, got LinkType=$($item.LinkType)"
}

Write-Host "[ok] migration link created"
Get-Item -LiteralPath $oldPath -Force | Format-List FullName,Attributes,LinkType,Target

Write-Host "[cleanup] autorun entries"
Remove-AutorunEntries
