<#
Simple installer script for Smart Bot
- Run as Administrator
- It will extract the bundled ZIP to `C:\Program Files\SmartBot` by default
- Creates Start Menu shortcut
#>
param(
    [string]$ZipPath = "..\dist\smart_bot_installer.zip",
    [string]$InstallDir = "C:\Program Files\SmartBot",
    [switch]$Quiet
)

# Resolve relative ZipPath against the script directory so running from any CWD works
if (-not [System.IO.Path]::IsPathRooted($ZipPath)) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    $ZipPath = Join-Path $scriptDir $ZipPath
}

# Prepare simple install log (write UTF8 without BOM)
$logFile = Join-Path $env:TEMP "smart_bot_install.log"
function Log($m) {
    $entry = "$(Get-Date -Format o)`t$m`r`n"
    $enc = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::AppendAllText($logFile, $entry, $enc)
}

if (-not (Test-Path $ZipPath)) {
    Log "ERROR: Zip file not found: $ZipPath"
    Write-Error "Zip file not found: $ZipPath"
    exit 1
}

if (-not (Test-Path $InstallDir)) {
    try {
        New-Item -Path $InstallDir -ItemType Directory -Force | Out-Null
        Log "Created install dir: $InstallDir"
    } catch {
        Log "ERROR: Failed to create install dir $InstallDir - $_"
        Write-Error "Failed to create install dir: $_"
        exit 2
    }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
    Log "Extracting $ZipPath -> $InstallDir (entry-by-entry, overwrite=true)"
    $zipPathResolved = (Resolve-Path $ZipPath).ProviderPath
    $installRoot = [System.IO.Path]::GetFullPath($InstallDir)
    if (-not $installRoot.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $installRoot = $installRoot + [System.IO.Path]::DirectorySeparatorChar
    }
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPathResolved)
    foreach ($entry in $zip.Entries) {
        $dest = Join-Path $InstallDir $entry.FullName
        $destFull = [System.IO.Path]::GetFullPath($dest)
        if (-not $destFull.StartsWith($installRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            Log "WARNING: Skipping unsafe zip entry: $($entry.FullName)"
            continue
        }
        if ([string]::IsNullOrEmpty($entry.Name)) {
            if (-not (Test-Path $destFull)) { New-Item -Path $destFull -ItemType Directory -Force | Out-Null }
            continue
        }
        $destDir = Split-Path $dest -Parent
        if (-not (Test-Path $destDir)) { New-Item -Path $destDir -ItemType Directory -Force | Out-Null }
        try {
            # ExtractToFile has overwrite parameter in newer frameworks
            $entry.ExtractToFile($destFull, $true)
            Log "Extracted: $($entry.FullName)"
        } catch {
            Log "ERROR: Failed to extract $($entry.FullName) - $_"
        }
    }
    $zip.Dispose()
    Log "Extraction completed"
} catch {
    Log "ERROR: Extraction failed - $_"
    Write-Error "Extraction failed: $_"
    try {
        $installLog = Join-Path $InstallDir "install.log"
        $enc = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::AppendAllText($installLog, "$(Get-Date -Format o)`tExtraction failed: $_`r`n", $enc)
    } catch {}
    exit 3
}

# create start menu shortcut
try {
    Log "Creating shortcut to $InstallDir\smart_bot.exe"
    $WshShell = New-Object -ComObject WScript.Shell
    $shortcutPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Smart Bot.lnk"
    $target = Join-Path $InstallDir "smart_bot.exe"
    $shortcut = $WshShell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = $InstallDir
    $shortcut.IconLocation = $target
    $shortcut.Save()
    Log "Shortcut created: $shortcutPath"
} catch {
    Log "WARNING: Shortcut creation failed - $_"
}

if (-not $Quiet) { Write-Output "Installed to $InstallDir and shortcut created." }
# also write final status to install log
try { Log "Install finished. Installed to $InstallDir" } catch {}
