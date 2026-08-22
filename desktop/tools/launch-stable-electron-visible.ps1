param(
  [string]$WebUrl = "http://127.0.0.1:3100/overview",
  [string]$RequestId = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = if ($env:DESKTOP_RUNTIME_DIR) { [IO.Path]::GetFullPath($env:DESKTOP_RUNTIME_DIR) } else { Join-Path $Root ".runtime-stable" }
$Electron = Join-Path $Root "node_modules\electron\dist\electron.exe"
$Entry = Join-Path $Root "apps\electron\main.js"
$LogFile = Join-Path $RuntimeDir "electron-visible-launch.log"
$StdoutLog = Join-Path $RuntimeDir "electron-visible.out.log"
$StderrLog = Join-Path $RuntimeDir "electron-visible.err.log"
$InstanceId = if ($env:DESKTOP_INSTANCE_ID -and $env:DESKTOP_INSTANCE_ID -match '^[a-z0-9][a-z0-9-]{0,31}$') { $env:DESKTOP_INSTANCE_ID } else { "default" }
$ProfileDir = Join-Path $RuntimeDir "electron-user-data\$InstanceId-v2"
$InstanceStatusFile = Join-Path $RuntimeDir "electron-$InstanceId.status.json"
$InstanceRequestFile = Join-Path $RuntimeDir "electron-$InstanceId.request.json"
$EffectiveRequestId = if ($RequestId -match '^[a-f0-9]{16,64}$') { $RequestId } else { [Guid]::NewGuid().ToString("N") }
$StatusFile = if ($RequestId -match '^[a-f0-9]{16,64}$') { Join-Path $RuntimeDir "electron-visible-$RequestId.json" } else { "" }

function Write-LaunchStatus([bool]$Ok, [int]$ProcessId, [string]$Message) {
  if (-not $StatusFile) { return }
  $Status = @{ ok = $Ok; pid = $ProcessId; message = $Message; updatedAt = [DateTime]::UtcNow.ToString("o") } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($StatusFile, $Status, [Text.UTF8Encoding]::new($false))
}

function Get-RunningInstanceStatus {
  if (-not (Test-Path -LiteralPath $InstanceStatusFile -PathType Leaf)) { return $null }
  try {
    $Status = Get-Content -LiteralPath $InstanceStatusFile -Raw | ConvertFrom-Json
    $ProcessId = [int]$Status.pid
    $UpdatedAt = if ($Status.updatedAt -is [DateTime]) {
      ([DateTime]$Status.updatedAt).ToUniversalTime()
    } else {
      [DateTimeOffset]::Parse([string]$Status.updatedAt).UtcDateTime
    }
    if ($ProcessId -le 0 -or -not [bool]$Status.visible) { return $null }
    if (([DateTime]::UtcNow - $UpdatedAt).TotalSeconds -gt 5) { return $null }
    $Owner = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $Owner) { return $null }
    try {
      if ($Owner.Path -ne $Electron) { return $null }
    } catch {
      return $null
    }
    return $Status
  } catch {
    return $null
  }
}

function Get-ReadyInstanceStatus([Uri]$TargetUri, [string]$ExpectedRequestId) {
  $Status = Get-RunningInstanceStatus
  if (-not $Status) { return $null }
  try {
    $CurrentUrl = [Uri][string]$Status.currentUrl
    if ($CurrentUrl.AbsoluteUri -ne $TargetUri.AbsoluteUri) { return $null }
    if ([string]$Status.handledRequestId -ne $ExpectedRequestId) { return $null }
    return $Status
  } catch {
    return $null
  }
}

try {
  $Target = [Uri]$WebUrl
  $AllowedHost = $Target.Host -in @("127.0.0.1", "localhost", "::1")
  if ($Target.Scheme -ne "http" -or -not $AllowedHost -or $Target.Port -ne 3100) {
    throw "Only the local Smart Kefu web origin is allowed."
  }
  if (-not (Test-Path -LiteralPath $Electron -PathType Leaf)) { throw "Electron runtime was not found: $Electron" }
  if (-not (Test-Path -LiteralPath $Entry -PathType Leaf)) { throw "Electron entry was not found: $Entry" }

  New-Item -ItemType Directory -Force -Path $RuntimeDir, $ProfileDir | Out-Null
  $RunningStatus = Get-RunningInstanceStatus
  $RequestPayload = @{ requestId = $EffectiveRequestId; webUrl = $Target.AbsoluteUri; updatedAt = [DateTime]::UtcNow.ToString("o") } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($InstanceRequestFile, $RequestPayload, [Text.UTF8Encoding]::new($false))
  $Arguments = @(
    "--no-sandbox",
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-gpu-sandbox",
    "--disable-accelerated-2d-canvas",
    "--disable-accelerated-video-decode",
    "--disable-zero-copy",
    "--in-process-gpu",
    "--disable-crash-reporter",
    "--user-data-dir=$ProfileDir",
    $Entry,
    "--smart-kefu-web-url=$($Target.AbsoluteUri)"
  )
  $Process = $null
  if (-not $RunningStatus) {
    $Process = Start-Process -FilePath $Electron -ArgumentList $Arguments -WorkingDirectory $Root -WindowStyle Normal -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru
  }
  $Deadline = [DateTime]::UtcNow.AddSeconds(10)
  $ReadyStatus = $null
  do {
    $ReadyStatus = Get-ReadyInstanceStatus -TargetUri $Target -ExpectedRequestId $EffectiveRequestId
    if ($ReadyStatus) { break }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $Deadline)

  if (-not $ReadyStatus) {
    if ($Process -and -not $Process.HasExited) {
      & "$env:SystemRoot\System32\taskkill.exe" /PID $Process.Id /T /F 2>$null | Out-Null
    }
    throw "Electron did not confirm a visible desktop window at the requested route."
  }

  $VisiblePid = [int]$ReadyStatus.pid
  Add-Content -LiteralPath $LogFile -Value "[$([DateTime]::UtcNow.ToString('o'))] visible Electron ready pid=$VisiblePid url=$($Target.AbsoluteUri)" -Encoding UTF8
  Write-Output "[desktop] visible Electron ready pid=$VisiblePid"
  Write-LaunchStatus -Ok $true -ProcessId $VisiblePid -Message "ready"
  exit 0
} catch {
  try {
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    Add-Content -LiteralPath $LogFile -Value "[$([DateTime]::UtcNow.ToString('o'))] visible Electron failed: $($_.Exception.Message)" -Encoding UTF8
  } catch {}
  Write-LaunchStatus -Ok $false -ProcessId 0 -Message $_.Exception.Message
  Write-Error "failed to launch visible Electron: $($_.Exception.Message)"
  exit 1
}
