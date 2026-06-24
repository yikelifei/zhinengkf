param(
    [string]$InstallDir = "C:\Program Files\SmartBot",
    [switch]$Quiet
)

if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force
}

$shortcutPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Smart Bot.lnk"
if (Test-Path $shortcutPath) { Remove-Item $shortcutPath -Force }

if (-not $Quiet) { Write-Output "Uninstalled Smart Bot from $InstallDir" }
