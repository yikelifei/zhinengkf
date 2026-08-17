param(
  [ValidateSet("open", "repair")]
  [string]$Mode = "open"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = if ($env:DESKTOP_RUNTIME_DIR) { [IO.Path]::GetFullPath($env:DESKTOP_RUNTIME_DIR) } else { Join-Path $Root ".runtime-stable" }
$LogFile = Join-Path $RuntimeDir "stable-app-launch.log"

try {
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  $Node = (Get-Command node.exe -ErrorAction Stop).Source
  $Argument = if ($Mode -eq "repair") { "--repair" } else { "--open" }
  $Process = Start-Process `
    -FilePath $Node `
    -ArgumentList @("tools\stable-app-launcher.js", $Argument) `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -PassThru
  Add-Content -LiteralPath $LogFile -Value "[$([DateTime]::UtcNow.ToString("o"))] hidden handoff mode=$Mode pid=$($Process.Id)" -Encoding UTF8
  exit 0
} catch {
  try {
    Add-Content -LiteralPath $LogFile -Value "[$([DateTime]::UtcNow.ToString("o"))] hidden handoff failed: $($_.Exception.Message)" -Encoding UTF8
  } catch {}
  Write-Error "failed to hand off stable desktop startup: $($_.Exception.Message)"
  exit 1
}
