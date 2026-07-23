param(
  [string]$AccountNickname = "",
  [string]$OwnerWxId = ""
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($AccountNickname)) {
  $AccountNickname = [string]::Concat([char]0x8BBE, [char]0x8BA1, '3', [char]0x53F7, 'ai', [char]0x51FA, [char]0x56FE)
}
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$desktopRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$toolchainRoot = Join-Path $workspaceRoot ".runtime\toolchains"
$dotnetRoot = Join-Path $toolchainRoot "dotnet-complete"
$dotnet = Join-Path $dotnetRoot "dotnet.exe"
$installer = Join-Path $toolchainRoot "dotnet-install.ps1"
$vendorRoot = Join-Path $workspaceRoot ".runtime\vendor\WeChatAuto.SDK"
$runtimeRoot = Join-Path $desktopRoot ".runtime"
$rpaConfigPath = Join-Path $runtimeRoot "personal-wechat-rpa.json"
$accountsConfigPath = Join-Path $runtimeRoot "personal-wechat-accounts.json"
$sdkRevision = "7596cce0615ffc383c238564545d4847f3ab5ee6"
$sdkRepository = "https://github.com/scottfly189/WeChatAuto.SDK.git"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

New-Item -ItemType Directory -Force -Path $toolchainRoot, $runtimeRoot | Out-Null

$buildTask = Join-Path $dotnetRoot "sdk\10.0.302\Sdks\Microsoft.NET.Sdk\tools\net10.0\Microsoft.NET.Build.Tasks.dll"
if (-not (Test-Path -LiteralPath $dotnet -PathType Leaf) -or -not (Test-Path -LiteralPath $buildTask -PathType Leaf)) {
  if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    Invoke-WebRequest -UseBasicParsing "https://dot.net/v1/dotnet-install.ps1" -OutFile $installer
  }
  & $installer -Channel 10.0 -InstallDir $dotnetRoot -NoPath
}
if (-not (Test-Path -LiteralPath $dotnet -PathType Leaf)) {
  throw "local .NET SDK install did not produce dotnet.exe"
}

if (-not (Test-Path -LiteralPath (Join-Path $vendorRoot ".git") -PathType Container)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $vendorRoot -Parent) | Out-Null
  git clone --filter=blob:none --no-checkout $sdkRepository $vendorRoot
  git -C $vendorRoot sparse-checkout init --cone
  git -C $vendorRoot sparse-checkout set WeAutoCommon Images WeChatAuto4_X/WeChatAuto WeChatAuto4_X/WebSocketServer/Server/models
  git -C $vendorRoot checkout $sdkRevision
}
$actualRevision = (git -C $vendorRoot rev-parse HEAD).Trim()
if ($actualRevision -ne $sdkRevision) {
  throw "unexpected WeChatAuto SDK revision: $actualRevision"
}

& (Join-Path $PSScriptRoot "personal-wechat-rpa-host\patch-wechat-auto-sdk.ps1") -SdkRoot $vendorRoot

$token = $null
if (Test-Path -LiteralPath $rpaConfigPath -PathType Leaf) {
  $existingConfig = [System.IO.File]::ReadAllText($rpaConfigPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  if ($existingConfig.accountNickname -and $existingConfig.accountNickname -ne $AccountNickname) {
    throw "existing RPA config belongs to another account nickname; refusing automatic overwrite"
  }
  if ([string]::IsNullOrWhiteSpace($OwnerWxId)) {
    $OwnerWxId = [string]$existingConfig.ownerWxId
  } elseif ($existingConfig.ownerWxId -and $existingConfig.ownerWxId -ne $OwnerWxId) {
    throw "existing RPA config belongs to another owner wxid; refusing automatic overwrite"
  }
  $token = [string]$existingConfig.token
}
if ([string]::IsNullOrWhiteSpace($OwnerWxId)) {
  throw "OwnerWxId is required to lock the RPA host to one exact WeChat account"
}
if ([string]::IsNullOrWhiteSpace($token)) {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $token = ([BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
}

$config = [ordered]@{
  accountNickname = $AccountNickname
  ownerWxId = $OwnerWxId
  token = $token
  apiBase = "http://127.0.0.1:3200/api/"
  port = 3211
  enableOcr = $true
  listenIntervalSeconds = 5
  modelsPath = (Join-Path $vendorRoot "WeChatAuto4_X\WebSocketServer\Server\models")
  downloadPath = (Join-Path $runtimeRoot "personal-wechat-rpa\downloads")
  capturePath = (Join-Path $runtimeRoot "personal-wechat-rpa\captures")
  videoPath = (Join-Path $runtimeRoot "personal-wechat-rpa\videos")
  accountsConfigPath = $accountsConfigPath
  accessibilityStatePath = (Join-Path $runtimeRoot "personal-wechat-rpa-accessibility-state.json")
}
[System.IO.File]::WriteAllText($rpaConfigPath, (($config | ConvertTo-Json -Depth 5) + "`n"), $utf8NoBom)

function Set-DotEnvValue {
  param([string]$Path, [string]$Key, [string]$Value)
  $lines = New-Object 'System.Collections.Generic.List[string]'
  if (Test-Path -LiteralPath $Path) {
    $lines.AddRange([string[]][System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8))
  }
  $matched = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match ('^' + [regex]::Escape($Key) + '=')) {
      $lines[$index] = "$Key=$Value"
      $matched = $true
    }
  }
  if (-not $matched) { $lines.Add("$Key=$Value") }
  [System.IO.File]::WriteAllLines($Path, $lines, $utf8NoBom)
}

$envPath = Join-Path $desktopRoot ".env"
Set-DotEnvValue $envPath "PERSONAL_WECHAT_DRIVER" "wechatauto_rpa"
Set-DotEnvValue $envPath "PERSONAL_WECHAT_RPA_ACCOUNT_NICKNAME" $AccountNickname
Set-DotEnvValue $envPath "PERSONAL_WECHAT_RPA_TOKEN" $token
Set-DotEnvValue $envPath "PERSONAL_WECHAT_RPA_ENDPOINT" "http://127.0.0.1:3211"
Set-DotEnvValue $envPath "PERSONAL_WECHAT_RPA_CONFIG_FILE" $rpaConfigPath
Set-DotEnvValue $envPath "PERSONAL_WECHAT_ACCOUNTS_CONFIG_FILE" $accountsConfigPath
Set-DotEnvValue $envPath "WECHAT_SEND_ADAPTER" "windows_bridge"

$nugetHome = Join-Path $workspaceRoot ".runtime\nuget-home"
$nugetPackages = Join-Path $workspaceRoot ".runtime\nuget-packages"
New-Item -ItemType Directory -Force -Path $nugetHome, $nugetPackages | Out-Null
$previousAppData = $env:APPDATA
$previousPackages = $env:NUGET_PACKAGES
$previousTelemetry = $env:DOTNET_CLI_TELEMETRY_OPTOUT
try {
  $env:APPDATA = $nugetHome
  $env:NUGET_PACKAGES = $nugetPackages
  $env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
  & $dotnet build (Join-Path $PSScriptRoot "personal-wechat-rpa-host\PersonalWechatRpaHost.csproj") -c Release -p:WeChatAutoSdkRoot=$vendorRoot
  if ($LASTEXITCODE -ne 0) { throw "personal WeChat RPA host build failed" }
} finally {
  $env:APPDATA = $previousAppData
  $env:NUGET_PACKAGES = $previousPackages
  $env:DOTNET_CLI_TELEMETRY_OPTOUT = $previousTelemetry
}

Write-Output "Personal WeChat RPA setup completed for the dedicated account. Real sending remains disabled until PERSONAL_WECHAT_SEND=1."
