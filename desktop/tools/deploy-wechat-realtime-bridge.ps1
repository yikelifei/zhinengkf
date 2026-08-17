param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Remote = "lighthouse@118.89.91.230"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Stage = "/home/lighthouse/smart-kefu-wechat-realtime-$Timestamp"
$RemoteUrl = "https://kefu.zhenxiliye.cn/api/wechat-work/events/stream"
$EnvFile = Join-Path $Root ".env"
$EnvBackup = "$EnvFile.pre-wechat-realtime-$Timestamp"
$Key = Join-Path $Root ".runtime\server-access\lighthouse_codex_20260811"
$Token = $null

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
  $expected = (Join-Path $Root "dist\apps\api\main.js")
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

function Get-DesktopEventStatus {
  $sessionPath = Join-Path $Root ".runtime-stable\desktop-web-session.json"
  $session = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
  $proof = if ($session.proof) { $session.proof } elseif ($session.sessionProof) { $session.sessionProof } elseif ($session.value) { $session.value } else { "" }
  if (-not $proof) { throw "desktop web session proof is unavailable" }
  return Invoke-RestMethod -Uri "http://127.0.0.1:3100/api/wechat-work/events/status" `
    -Headers @{ Cookie = "smart_kefu_desktop_session=$proof" } `
    -TimeoutSec 10
}

try {
  if (-not $Key) { throw "deployment SSH key is unavailable" }
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
    @{ Local = Join-Path $Root "apps\api\src\wechat-work\wechat-work-callback-events.ts"; Remote = "wechat-work-callback-events.ts" },
    @{ Local = Join-Path $Root "apps\api\src\wechat-work\wechat-work-callback-event-client.service.ts"; Remote = "wechat-work-callback-event-client.service.ts" },
    @{ Local = Join-Path $PSScriptRoot "server-deploy-wechat-realtime-bridge.sh"; Remote = "server-deploy-wechat-realtime-bridge.sh" }
  )) {
    Invoke-Checked {
      scp.exe -i $script:Key -o IdentitiesOnly=yes -o BatchMode=yes $Item.Local "${script:Remote}:$script:Stage/$($Item.Remote)"
    } "stage $($Item.Remote)"
  }

  $EncodedToken = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Token))
  $DeploymentOutput = $EncodedToken | ssh.exe -i $script:Key -o IdentitiesOnly=yes -o BatchMode=yes $script:Remote "sudo -n bash '$script:Stage/server-deploy-wechat-realtime-bridge.sh' '$script:Stage'"
  $EncodedToken = $null
  if ($LASTEXITCODE -ne 0) { throw "server deployment failed with exit code $LASTEXITCODE" }

  $Original = [IO.File]::ReadAllText($EnvFile, [Text.Encoding]::UTF8)
  $Updated = Set-EnvValue $Original "WECHAT_WORK_REMOTE_EVENT_URL" $RemoteUrl
  $Updated = Set-EnvValue $Updated "WECHAT_WORK_REMOTE_EVENT_TOKEN" $Token
  $TempEnv = "$EnvFile.wechat-realtime-$Timestamp.tmp"
  [IO.File]::WriteAllText($TempEnv, $Updated, (New-Object Text.UTF8Encoding($false)))
  [IO.File]::Replace($TempEnv, $EnvFile, $EnvBackup, $true)

  $NewPid = Restart-StableApi
  $deadline = (Get-Date).AddSeconds(30)
  $Status = $null
  do {
    Start-Sleep -Seconds 1
    try { $Status = Get-DesktopEventStatus } catch { $Status = $null }
    if ($Status -and $Status.configured -eq $true -and $Status.connected -eq $true) { break }
  } while ((Get-Date) -lt $deadline)
  if (-not $Status -or $Status.configured -ne $true -or $Status.connected -ne $true) {
    throw "desktop realtime event stream did not connect"
  }

  $Sha256 = [Security.Cryptography.SHA256]::Create()
  try { $TokenRefBytes = $Sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($Token)) } finally { $Sha256.Dispose() }
  $TokenRef = (([BitConverter]::ToString($TokenRefBytes) -replace "-", "").ToLowerInvariant()).Substring(0, 12)
  $DeploymentOutput | ForEach-Object { Write-Output $_ }
  Write-Output "DESKTOP_ENV_BACKUP=$EnvBackup"
  Write-Output "DESKTOP_API_PID=$NewPid"
  Write-Output "DESKTOP_TOKEN_REF=$TokenRef"
  Write-Output "DESKTOP_STREAM_CONNECTED=true"
} catch {
  if (Test-Path -LiteralPath $EnvBackup -PathType Leaf) {
    Copy-Item -LiteralPath $EnvBackup -Destination $EnvFile -Force
    try { Restart-StableApi | Out-Null } catch {}
  }
  throw
} finally {
  $Token = $null
}
