param(
  [ValidateSet("mock", "real")]
  [string]$Mode = "mock"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ProjectRoot = Split-Path -Parent $Root
$RuntimeDir = Join-Path $Root ".runtime"
$LogsDir = Join-Path $RuntimeDir "logs"
$MockModeLockFile = Join-Path $RuntimeDir "mock-mode.lock"
$RealModeLockFile = Join-Path $RuntimeDir "real-mode.lock"
$DesignPlatformConfigFile = Join-Path $RuntimeDir "design-platform-config.json"
$IsReal = $Mode -eq "real"
$ModeArg = if ($IsReal) { "--real-design" } else { "--mock-design" }
$ConflictMode = if ($IsReal) { "mock" } else { "real" }
$LauncherLog = Join-Path $LogsDir ($(if ($IsReal) { "launcher-real.log" } else { "launcher-mock.log" }))
$LauncherCmd = Join-Path $RuntimeDir ($(if ($IsReal) { "supervise-real.cmd" } else { "supervise-mock.cmd" }))
$ConflictingLauncherCmd = Join-Path $RuntimeDir ($(if ($IsReal) { "supervise-mock.cmd" } else { "supervise-real.cmd" }))
$LegacyConflictingLauncherCmd = Join-Path $RuntimeDir ($(if ($IsReal) { "launch-mock.cmd" } else { "launch-real.cmd" }))
$StableConflictingLauncherCmd = Join-Path $RuntimeDir ($(if ($IsReal) { "stable-supervise-mock.cmd" } else { "stable-supervise-real.cmd" }))

function ConvertTo-NormalizedPathText {
  param([string]$Value)
  return ($Value -replace "\\", "/").ToLowerInvariant()
}

function ConvertTo-CmdQuoted {
  param([string]$Value)
  return '"' + ($Value -replace '"', '""') + '"'
}

function ConvertTo-CmdEnvLine {
  param([string]$Key, [string]$Value)
  $safeKey = $Key -replace '"', ''
  $safeValue = ($Value -replace "`r?`n", " ") -replace '"', '""'
  return "set ""$safeKey=$safeValue"""
}

function Add-LauncherLog {
  param([string]$Value)
  try {
    Add-Content -Path $LauncherLog -Value $Value -Encoding UTF8 -ErrorAction Stop
  } catch {
    return
  }
}

function Find-ConflictingDesignLaunchers {
  param([ValidateSet("mock", "real")][string]$TargetMode)

  $targetModeArg = if ($TargetMode -eq "real") { "--real-design" } else { "--mock-design" }
  $targetSupervisorCmd = if ($TargetMode -eq "real") { "supervise-real.cmd" } else { "supervise-mock.cmd" }
  $targetStableSupervisorCmd = if ($TargetMode -eq "real") { "stable-supervise-real.cmd" } else { "stable-supervise-mock.cmd" }
  $targetLegacyCmd = if ($TargetMode -eq "real") { "launch-real.cmd" } else { "launch-mock.cmd" }
  $targetBat = if ($TargetMode -eq "real") { "run_desktop_real_design.bat" } else { "run_desktop.bat" }
  $normalizedRoot = ConvertTo-NormalizedPathText $Root
  $normalizedProjectRoot = ConvertTo-NormalizedPathText $ProjectRoot
  $selfPid = $PID

  try {
    $items = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
      if ($_.ProcessId -eq $selfPid -or -not $_.CommandLine) { return $false }
      $cmd = ($_.CommandLine -replace "\\", "/").ToLowerInvariant()
      if (-not ($cmd.Contains($normalizedRoot) -or $cmd.Contains($normalizedProjectRoot))) { return $false }
      return (
        ($cmd.Contains("start-dev-ports.js") -and $cmd.Contains($targetModeArg)) -or
        $cmd.Contains($targetSupervisorCmd) -or
        $cmd.Contains($targetStableSupervisorCmd) -or
        $cmd.Contains($targetLegacyCmd) -or
        $cmd.Contains($targetBat) -or
        ($cmd.Contains("desktop-service-supervisor.ps1") -and $cmd.Contains("-mode $TargetMode")) -or
        ($cmd.Contains("desktop-service-supervisor.js") -and $cmd.Contains($targetModeArg))
      )
    } | Select-Object -First 8 ProcessId, CommandLine
  } catch {
    Add-LauncherLog "[supervisor] process scan skipped: $($_.Exception.Message)"
    return @()
  }

  return @($items)
}

function Stop-ConflictingDesktopServices {
  $conflicts = @(Find-ConflictingDesignLaunchers -TargetMode $ConflictMode)
  if ($conflicts.Count -eq 0) { return }

  Write-Output "[supervisor] found stale $ConflictMode design launcher; stopping managed desktop services first."
  $node = (Get-Command node.exe).Source
  $oldStarterPid = $env:PORTS_STACK_STARTER_PID
  $oldStarterParentPid = $env:PORTS_STACK_STARTER_PARENT_PID
  $oldStarterMode = $env:PORTS_STACK_STARTER_MODE
  $oldPreserveRealModeLock = $env:PRESERVE_REAL_MODE_LOCK
  try {
    $env:PORTS_STACK_STARTER_PID = [string]$PID
    $env:PORTS_STACK_STARTER_PARENT_PID = [string]$PID
    $env:PORTS_STACK_STARTER_MODE = $Mode
    if ($IsReal) {
      $env:PRESERVE_REAL_MODE_LOCK = "1"
    } else {
      Remove-Item Env:PRESERVE_REAL_MODE_LOCK -ErrorAction SilentlyContinue
    }
    $process = Start-Process -FilePath $node `
      -ArgumentList @("tools/stop-dev-ports.js") `
      -WorkingDirectory $Root `
      -WindowStyle Hidden `
      -Wait `
      -PassThru
  } finally {
    if ($null -eq $oldStarterPid) { Remove-Item Env:PORTS_STACK_STARTER_PID -ErrorAction SilentlyContinue } else { $env:PORTS_STACK_STARTER_PID = $oldStarterPid }
    if ($null -eq $oldStarterParentPid) { Remove-Item Env:PORTS_STACK_STARTER_PARENT_PID -ErrorAction SilentlyContinue } else { $env:PORTS_STACK_STARTER_PARENT_PID = $oldStarterParentPid }
    if ($null -eq $oldStarterMode) { Remove-Item Env:PORTS_STACK_STARTER_MODE -ErrorAction SilentlyContinue } else { $env:PORTS_STACK_STARTER_MODE = $oldStarterMode }
    if ($null -eq $oldPreserveRealModeLock) { Remove-Item Env:PRESERVE_REAL_MODE_LOCK -ErrorAction SilentlyContinue } else { $env:PRESERVE_REAL_MODE_LOCK = $oldPreserveRealModeLock }
  }
  if ($process.ExitCode -ne 0) {
    throw "failed to stop stale conflicting desktop services before launch"
  }
}

function Assert-ModeSwitchAllowed {
  if (-not $IsReal -and ((Test-Path $RealModeLockFile) -or @(Find-ConflictingDesignLaunchers -TargetMode "real").Count -gt 0 -or ((Test-RuntimeConfigRealMode) -and $env:ALLOW_MOCK_DESIGN_START -ne "1"))) {
    throw "Mock design launch is blocked because real mode is active. Run npm.cmd run ports:stop before switching to mock design mode."
  }

  if (-not $IsReal -or -not (Test-Path $MockModeLockFile)) { return }

  $mockConflicts = @(Find-ConflictingDesignLaunchers -TargetMode "mock")
  if ($mockConflicts.Count -gt 0) {
    throw "Real design launch is blocked because mock mode is still running. Run npm.cmd run ports:stop before switching to real design mode."
  }

  Remove-Item -LiteralPath $MockModeLockFile -Force -ErrorAction SilentlyContinue
  Write-Output "[supervisor] removed stale mock mode lock before real design launch."
}

function Test-RuntimeConfigRealMode {
  if (-not (Test-Path $DesignPlatformConfigFile)) { return $false }
  try {
    $config = Get-Content -LiteralPath $DesignPlatformConfigFile -Raw | ConvertFrom-Json
    return $config.designPlatformAdapter -eq "art_image_local"
  } catch {
    return $false
  }
}

function Update-MockModeLock {
  if ($IsReal) { return }
  Set-Content -Path $MockModeLockFile -Value ([DateTime]::UtcNow.ToString("o")) -Encoding UTF8
}

function Update-RealModeLock {
  if (-not $IsReal) { return }
  Set-Content -Path $RealModeLockFile -Value ([DateTime]::UtcNow.ToString("o")) -Encoding UTF8
}

function Disable-ConflictingLaunchers {
  $conflictLog = Join-Path $LogsDir "launcher-$ConflictMode.log"
  $blocked = @(
    "@echo off",
    "setlocal",
    "cd /d ""$Root""",
    "echo [%date% %time%] blocked stale $ConflictMode-design launcher while $Mode mode is active >> ""$conflictLog""",
    "exit /b 0"
  ) -join "`r`n"
  Set-Content -Path $ConflictingLauncherCmd -Value ($blocked + "`r`n") -Encoding ASCII
  Set-Content -Path $LegacyConflictingLauncherCmd -Value ($blocked + "`r`n") -Encoding ASCII
  Set-Content -Path $StableConflictingLauncherCmd -Value ($blocked + "`r`n") -Encoding ASCII
}

function Get-LauncherEnvLines {
  $lines = @()
  if ($IsReal) {
    $lines += ConvertTo-CmdEnvLine "ALLOW_REAL_DESIGN_START" "1"
  } else {
    $lines += ConvertTo-CmdEnvLine "DESIGN_PLATFORM_ADAPTER" "standard_v1"
    $lines += ConvertTo-CmdEnvLine "DESIGN_PLATFORM_BASE_URL" "http://127.0.0.1:3700"
  }

  $keys = @(
    "NEXT_TELEMETRY_DISABLED",
    "USE_LOCAL_STORE",
    "WEB_PORT",
    "API_PORT",
    "MOCK_DESIGN_PLATFORM_PORT",
    "START_MOCK_DESIGN_PLATFORM",
    "DESIGN_PLATFORM_RUNTIME_CONFIG"
  )
  if ($IsReal) {
    $keys += "DESIGN_PLATFORM_ADAPTER"
    $keys += "DESIGN_PLATFORM_BASE_URL"
  }

  foreach ($key in $keys) {
    $value = [Environment]::GetEnvironmentVariable($key)
    if ($null -ne $value) {
      $lines += ConvertTo-CmdEnvLine $key $value
    }
  }
  return $lines
}

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
Assert-ModeSwitchAllowed
Stop-ConflictingDesktopServices
Update-MockModeLock
Update-RealModeLock
Disable-ConflictingLaunchers
Remove-Item -LiteralPath $LauncherLog -Force -ErrorAction SilentlyContinue

$Node = (Get-Command node.exe).Source
$nodeLine = "$(ConvertTo-CmdQuoted $Node) ""tools/start-dev-ports.js"" ""$ModeArg"" ""--keep-alive"" >> ""$LauncherLog"" 2>>&1"
$cmdLines = @(
  "@echo off",
  "setlocal",
  "cd /d ""$Root"""
) + (Get-LauncherEnvLines) + @(
  ":restart",
  $nodeLine,
  "echo [%date% %time%] start-dev-ports exited with %ERRORLEVEL%, restarting >> ""$LauncherLog""",
  "timeout /t 2 /nobreak >nul",
  "goto restart"
)
Set-Content -Path $LauncherCmd -Value (($cmdLines -join "`r`n") + "`r`n") -Encoding ASCII

$commandLine = "cmd.exe /d /c " + (ConvertTo-CmdQuoted $LauncherCmd)
try {
  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $commandLine
    CurrentDirectory = $Root
  } -ErrorAction Stop
  if ($result.ReturnValue -ne 0) {
    throw "Win32_Process.Create failed: $($result.ReturnValue)"
  }
  Write-Output "[supervisor] node tools/start-dev-ports.js $ModeArg --keep-alive pid=$($result.ProcessId)"
} catch {
  Add-LauncherLog "[supervisor] Win32_Process.Create skipped: $($_.Exception.Message)"
  $process = Start-Process -FilePath $LauncherCmd -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  Write-Output "[supervisor] node tools/start-dev-ports.js $ModeArg --keep-alive pid=$($process.Id)"
}
