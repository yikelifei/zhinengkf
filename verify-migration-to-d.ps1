$ErrorActionPreference = "Stop"

$oldPath = "C:\Users\27808\Desktop\zhinengkefu"
$newPath = "E:\zhinengkefu"
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

Write-Host "[check] E target"
if (-not (Test-Path -LiteralPath $newPath)) {
  throw "Missing E target: $newPath"
}
Get-Item -LiteralPath $newPath -Force | Format-List FullName,Attributes,LinkType,Target

Write-Host "[check] C entry"
if (-not (Test-Path -LiteralPath $oldPath)) {
  throw "Missing old C entry: $oldPath"
}

$oldItem = Get-Item -LiteralPath $oldPath -Force
$oldItem | Format-List FullName,Attributes,LinkType,Target

if ($oldItem.LinkType -eq "Junction") {
  $targetText = [string]::Join(";", $oldItem.Target)
  if (-not $targetText.Contains($newPath)) {
    throw "C entry is a Junction, but target is not $newPath"
  }
  Write-Host "[ok] C entry is linked to E target"
} else {
  $bytes = Get-FileBytes -Path $oldPath
  Write-Host "[pending] C entry is not a Junction yet; file bytes=$bytes"
}

Write-Host "[check] autorun cleanup"
$runValue = Get-ItemProperty -LiteralPath $runKey -Name "FinalizeZhinengkefuMigration" -ErrorAction SilentlyContinue
$runOnceValue = Get-ItemProperty -LiteralPath $runOnceKey -Name "FinalizeZhinengkefuMigrationOnce" -ErrorAction SilentlyContinue

if ($runValue) {
  Write-Host "[pending] Run entry still exists"
}
if ($runOnceValue) {
  Write-Host "[pending] RunOnce entry still exists"
}
if (-not $runValue -and -not $runOnceValue) {
  Write-Host "[ok] autorun entries are absent"
}

Write-Host "[check] E drive scripts"
$oldRefs = Get-ChildItem -LiteralPath $desktopPath -Filter "*.cmd" -File -ErrorAction SilentlyContinue |
  Select-String -SimpleMatch $oldPath -ErrorAction SilentlyContinue

if ($oldRefs) {
  $oldRefs | ForEach-Object {
    Write-Host "[error] old C path reference: $($_.Path):$($_.LineNumber): $($_.Line)"
  }
  throw "E drive scripts still reference the old C drive path"
}

Write-Host "[ok] E drive scripts do not reference the old C drive path"

Write-Host "[check] stable runtime location"
$stableRuntime = Join-Path $desktopPath ".runtime-stable"
$stableBytes = Get-FileBytes -Path $stableRuntime
Write-Host "[ok] E stable runtime bytes=$stableBytes path=$stableRuntime"

Write-Host "[done] verification complete"
