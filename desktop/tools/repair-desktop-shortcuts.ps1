param(
  [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

$DesktopRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LaunchScript = Join-Path $DesktopRoot "launch-isolated-modular-desktop.cmd"

function Join-Codepoints {
  param([int[]]$Values)
  return (($Values | ForEach-Object { [char]$_ }) -join "")
}

$PrimaryShortcutName = (Join-Codepoints @(0x6253, 0x5f00, 0x81fb, 0x5e0c, 0x667a, 0x80fd, 0x5ba2, 0x670d, 0xff08, 0x6b63, 0x786e, 0x754c, 0x9762, 0xff09)) + ".lnk"
$LegacyShortcutName = (Join-Codepoints @(0x6253, 0x5f00, 0x81fb, 0x5e0c, 0x667a, 0x80fd, 0x5ba2, 0x670d)) + ".lnk"
$ChineseNameFragment = Join-Codepoints @(0x667a, 0x80fd, 0x5ba2, 0x670d)
$ShortcutNames = @(
  $PrimaryShortcutName,
  $LegacyShortcutName,
  "Smart Kefu.lnk"
)
$StalePathFragments = @(
  "E:\zhinengkefu-ui-versions\modular",
  "C:\Users\27808\Desktop\zhinengkefu_restore_work",
  "C:\Users\27808\Desktop\zhinengkefu"
)

function Get-KnownShortcutDirectories {
  @(
    [Environment]::GetFolderPath("Desktop"),
    [Environment]::GetFolderPath("Startup"),
    (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\Startup")
  ) | Where-Object { $_ -and (Test-Path $_) }
}

function Test-ShortcutMatchesProject {
  param($Shortcut, [string]$Path)

  $name = Split-Path -Leaf $Path
  $haystack = @(
    $Path,
    $Shortcut.TargetPath,
    $Shortcut.Arguments,
    $Shortcut.WorkingDirectory,
    $Shortcut.Description
  ) -join "`n"

  if ($ShortcutNames -contains $name) { return $true }
  if ($name -like "*$ChineseNameFragment*" -or $name -like "*Smart Kefu*") { return $true }
  if ($haystack -like "*launch-isolated-modular-desktop.cmd*") { return $true }
  foreach ($fragment in $StalePathFragments) {
    if ($haystack -like "*$fragment*") { return $true }
  }
  return $false
}

function Test-ShortcutNeedsRepair {
  param($Shortcut, [string]$Path)

  if (-not (Test-ShortcutMatchesProject $Shortcut $Path)) { return $false }
  $haystack = @($Shortcut.TargetPath, $Shortcut.Arguments, $Shortcut.WorkingDirectory) -join "`n"
  foreach ($fragment in $StalePathFragments) {
    if ($haystack -like "*$fragment*") { return $true }
  }
  if ($Shortcut.TargetPath -ne "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe") { return $true }
  if ($Shortcut.Arguments -notlike "*$LaunchScript*") { return $true }
  if ($Shortcut.Arguments -notlike "*-WindowStyle Hidden*") { return $true }
  return $false
}

function Repair-Shortcut {
  param($Shortcut, [string]$Path)

  $powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command ""Start-Process -FilePath '$LaunchScript' -WorkingDirectory '$DesktopRoot' -WindowStyle Hidden"""
  if ($WhatIf) {
    Write-Output "[shortcut] would repair $Path"
    return
  }

  $Shortcut.TargetPath = $powershell
  $Shortcut.Arguments = $arguments
  $Shortcut.WorkingDirectory = $DesktopRoot
  $Shortcut.Description = "Launch Smart Kefu from $DesktopRoot with hidden service windows"
  $Shortcut.Save()
  Write-Output "[shortcut] repaired $Path"
}

if (-not (Test-Path $LaunchScript)) {
  throw "Launch script not found: $LaunchScript"
}

$shell = New-Object -ComObject WScript.Shell
$repaired = 0
foreach ($directory in Get-KnownShortcutDirectories) {
  foreach ($file in Get-ChildItem -LiteralPath $directory -Filter *.lnk -ErrorAction SilentlyContinue) {
    $shortcut = $shell.CreateShortcut($file.FullName)
    if (-not (Test-ShortcutNeedsRepair $shortcut $file.FullName)) { continue }
    Repair-Shortcut $shortcut $file.FullName
    $repaired += 1
  }
}

$desktop = [Environment]::GetFolderPath("Desktop")
$primaryShortcut = Join-Path $desktop $ShortcutNames[0]
if (-not (Test-Path $primaryShortcut)) {
  $shortcut = $shell.CreateShortcut($primaryShortcut)
  Repair-Shortcut $shortcut $primaryShortcut
  $repaired += 1
}

Write-Output "[shortcut] checked=$repaired"
