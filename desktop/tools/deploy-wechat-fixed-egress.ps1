param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Remote = "lighthouse@118.89.91.230"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Stage = "/home/lighthouse/smart-kefu-wechat-egress-$Timestamp"
$RemoteBaseUrl = "https://kefu.zhenxiliye.cn/wecom-api"
$EnvFile = Join-Path $Root ".env"
$EnvBackup = "$EnvFile.pre-wechat-fixed-egress-$Timestamp"
$Key = Join-Path $Root ".runtime\server-access\lighthouse_codex_20260811"
$Token = $null
$LocalEnvChanged = $false

function Invoke-Checked([scriptblock]$Action, [string]$Label) {
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE" }
}

function Set-EnvValue([string]$Text, [string]$Name, [string]$Value) {
  $Pattern = "(?m)^$([Regex]::Escape($Name))=.*$"
  $Line = "$Name=$Value"
  if ([Regex]::IsMatch($Text, $Pattern)) { return [Regex]::Replace($Text, $Pattern, $Line) }
  $Suffix = if ($Text.EndsWith("`n")) { "" } else { "`r`n" }
  return "$Text$Suffix$Line`r`n"
}

function Restart-StableApi {
  $listener = Get-NetTCPConnection -State Listen -LocalPort 3200 -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) { throw "desktop API is not listening on port 3200" }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  $expected = Join-Path $Root "dist\apps\api\main.js"
  if (-not $process.CommandLine -or $process.CommandLine -notlike "*$expected*") {
    throw "refusing to restart an unexpected port 3200 process"
  }
  $oldPid = $listener.OwningProcess
  Stop-Process -Id $oldPid -Force
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 500
    $next = Get-NetTCPConnection -State Listen -LocalPort 3200 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($next -and $next.OwningProcess -ne $oldPid) { return $next.OwningProcess }
  } while ((Get-Date) -lt $deadline)
  throw "desktop API supervisor did not restore port 3200"
}

function Get-DesktopSessionProof {
  $sessionPath = Join-Path $Root ".runtime-stable\desktop-web-session.json"
  $session = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
  $proof = if ($session.proof) { $session.proof } elseif ($session.sessionProof) { $session.sessionProof } elseif ($session.value) { $session.value } else { "" }
  if (-not $proof) { throw "desktop web session proof is unavailable" }
  return $proof
}

function Get-ConnectionDiagnosis {
  $proof = Get-DesktopSessionProof
  return Invoke-RestMethod -Method Post `
    -Uri "http://127.0.0.1:3100/api/wechat-work/kf/connection/diagnose" `
    -Headers @{ Cookie = "smart_kefu_desktop_session=$proof" } `
    -ContentType "application/json" `
    -Body "{}" `
    -TimeoutSec 30
}

try {
  if (-not (Test-Path -LiteralPath $Key -PathType Leaf)) { throw "deployment SSH key is unavailable" }
  if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { throw "desktop .env is unavailable" }

  $TokenBytes = New-Object byte[] 32
  $Rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $Rng.GetBytes($TokenBytes) } finally { $Rng.Dispose() }
  $Token = ([BitConverter]::ToString($TokenBytes) -replace "-", "").ToLowerInvariant()
  [Array]::Clear($TokenBytes, 0, $TokenBytes.Length)

  Invoke-Checked {
    ssh.exe -i $script:Key -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 $script:Remote "mkdir -p '$script:Stage' && chmod 700 '$script:Stage'"
  } "remote staging"
  foreach ($Item in @(
    @{ Local = Join-Path $PSScriptRoot "server-deploy-wechat-fixed-egress.sh"; Remote = "server-deploy-wechat-fixed-egress.sh" },
    @{ Local = Join-Path $PSScriptRoot "server-activate-wechat-signal-only.sh"; Remote = "server-activate-wechat-signal-only.sh" },
    @{ Local = Join-Path $Root "config\nginx\wecom-api-fixed-egress.location.conf.template"; Remote = "wecom-api-fixed-egress.location.conf.template" }
  )) {
    Invoke-Checked {
      scp.exe -i $script:Key -o IdentitiesOnly=yes -o BatchMode=yes $Item.Local "${script:Remote}:$script:Stage/$($Item.Remote)"
    } "stage $($Item.Remote)"
  }

  $EncodedToken = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Token))
  $DeploymentOutput = $EncodedToken | ssh.exe -i $Key -o IdentitiesOnly=yes -o BatchMode=yes $Remote "sudo -n bash '$Stage/server-deploy-wechat-fixed-egress.sh' '$Stage'"
  $EncodedToken = $null
  if ($LASTEXITCODE -ne 0) {
    $DeploymentOutput | ForEach-Object { Write-Output $_ }
    throw "server fixed-egress deployment failed with exit code $LASTEXITCODE"
  }

  $Original = [IO.File]::ReadAllText($EnvFile, [Text.Encoding]::UTF8)
  $Updated = Set-EnvValue $Original "WECHAT_WORK_API_BASE_URL" $RemoteBaseUrl
  $Updated = Set-EnvValue $Updated "WECHAT_WORK_API_RELAY_TOKEN" $Token
  $Updated = Set-EnvValue $Updated "WECHAT_WORK_CALLBACK_PROCESSING_MODE" "process"
  $TempEnv = "$EnvFile.wechat-fixed-egress-$Timestamp.tmp"
  [IO.File]::WriteAllText($TempEnv, $Updated, (New-Object Text.UTF8Encoding($false)))
  [IO.File]::Replace($TempEnv, $EnvFile, $EnvBackup, $true)
  $LocalEnvChanged = $true

  $NewPid = Restart-StableApi
  $Diagnosis = Get-ConnectionDiagnosis
  $OutboundLine = $DeploymentOutput | Where-Object { $_ -like "SERVER_OUTBOUND_IP=*" } | Select-Object -Last 1
  $OutboundIp = if ($OutboundLine) { ($OutboundLine -split "=", 2)[1] } else { "unverified" }

  if ($Diagnosis.apiReachable -ne $true) {
    $Detail = [string]$Diagnosis.detail
    if ($Detail -match "60020|not allow to access from your ip|不安全的访问 IP") {
      $DeploymentOutput | ForEach-Object { Write-Output $_ }
      Write-Output "DESKTOP_API_PID=$NewPid"
      Write-Output "DESKTOP_ENV_BACKUP=$EnvBackup"
      Write-Output "FIXED_EGRESS_PREPARED=true"
      Write-Output "TRUSTED_IP_REQUIRED=$OutboundIp"
      Write-Output "SIGNAL_ONLY_ACTIVE=false"
      Write-Output "NEXT_STEP=Add TRUSTED_IP_REQUIRED to the WeCom trusted IP list, then rerun this deployment."
      exit 0
    }
    throw "fixed-egress official API diagnosis failed: $Detail"
  }

  $ActivationOutput = ssh.exe -i $Key -o IdentitiesOnly=yes -o BatchMode=yes $Remote "sudo -n bash '$Stage/server-activate-wechat-signal-only.sh'"
  if ($LASTEXITCODE -ne 0) { throw "server signal-only activation failed with exit code $LASTEXITCODE" }

  $DeploymentOutput | ForEach-Object { Write-Output $_ }
  $ActivationOutput | ForEach-Object { Write-Output $_ }
  Write-Output "DESKTOP_API_PID=$NewPid"
  Write-Output "DESKTOP_ENV_BACKUP=$EnvBackup"
  Write-Output "FIXED_EGRESS_ACTIVE=true"
  Write-Output "OFFICIAL_API_REACHABLE=true"
  Write-Output "TRUSTED_SERVER_IP=$OutboundIp"
} catch {
  if ($LocalEnvChanged -and (Test-Path -LiteralPath $EnvBackup -PathType Leaf)) {
    Copy-Item -LiteralPath $EnvBackup -Destination $EnvFile -Force
    try { Restart-StableApi | Out-Null } catch {}
  }
  throw
} finally {
  $Token = $null
  $EncodedToken = $null
}
