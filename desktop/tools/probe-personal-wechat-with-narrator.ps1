param(
  [string]$ConfigPath = "",
  [string]$DotnetPath = "",
  [string]$HostPath = ""
)

$ErrorActionPreference = "Stop"
$desktopRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $desktopRoot ".."))
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $desktopRoot ".runtime\personal-wechat-rpa.json"
}
if ([string]::IsNullOrWhiteSpace($DotnetPath)) {
  $DotnetPath = Join-Path $workspaceRoot ".runtime\toolchains\dotnet-complete\dotnet.exe"
}
if ([string]::IsNullOrWhiteSpace($HostPath)) {
  $HostPath = Join-Path $PSScriptRoot "personal-wechat-rpa-host\bin\Release\net10.0-windows\PersonalWechatRpaHost.dll"
}
$narratorPath = Join-Path $env:WINDIR "System32\Narrator.exe"
foreach ($requiredPath in @($ConfigPath, $DotnetPath, $HostPath, $narratorPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "required file not found: $requiredPath"
  }
}

$registryPath = "HKCU:\Software\Microsoft\Narrator\NoRoam"
$registryValue = "RunningState"
$original = Get-ItemProperty -LiteralPath $registryPath -Name $registryValue -ErrorAction SilentlyContinue
$originalExists = $null -ne $original
$originalValue = if ($originalExists) { [int]$original.$registryValue } else { 0 }
$baselineNarratorIds = @(Get-Process -Name "Narrator*" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$newNarratorIds = @()

try {
  $narrator = Start-Process -FilePath $narratorPath -ArgumentList "/start" -PassThru
  Start-Sleep -Seconds 10
  $newNarratorIds = @(Get-Process -Name "Narrator*" -ErrorAction SilentlyContinue | Where-Object {
    $_.Id -notin $baselineNarratorIds
  } | ForEach-Object { $_.Id })
  if ($newNarratorIds.Count -eq 0 -and $narrator.HasExited) {
    throw "Windows Narrator exited before the probe started"
  }

  & $DotnetPath $HostPath --probe --config $ConfigPath
  if ($LASTEXITCODE -ne 0) {
    throw "personal WeChat RPA probe failed with exit code $LASTEXITCODE"
  }
} finally {
  foreach ($narratorId in $newNarratorIds) {
    $process = Get-Process -Id $narratorId -ErrorAction SilentlyContinue
    if ($null -ne $process) {
      try {
        [void]$process.CloseMainWindow()
        if (-not $process.WaitForExit(3000)) {
          Stop-Process -Id $narratorId -Force -ErrorAction SilentlyContinue
        }
      } finally {
        $process.Dispose()
      }
    }
  }
  if ($originalExists) {
    if (-not (Test-Path -LiteralPath $registryPath)) {
      New-Item -Path $registryPath -Force | Out-Null
    }
    Set-ItemProperty -LiteralPath $registryPath -Name $registryValue -Type DWord -Value $originalValue
  } elseif (Test-Path -LiteralPath $registryPath) {
    Remove-ItemProperty -LiteralPath $registryPath -Name $registryValue -ErrorAction SilentlyContinue
  }
}
