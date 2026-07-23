param(
  [int[]]$CurrentRootProcessIds = @(),
  [string]$ExpectedExecutable = "D:\weixin\Weixin.exe",
  [int]$ExpectedSessionId = -1
)

$ErrorActionPreference = "Stop"
if ($ExpectedSessionId -lt 0) {
  $ExpectedSessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
}
$registryPath = "HKCU:\Software\Microsoft\Narrator\NoRoam"
$registryValue = "RunningState"
$originalExists = $false
$originalValue = 0
$accessibilityChanged = $false

if (-not ("DualWeixinProcessStarter" -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Threading;

public static class DualWeixinProcessStarter
{
    public static int[] Start(string executablePath)
    {
        var gate = new ManualResetEventSlim(false);
        var processes = new Process[2];
        Exception firstError = null;
        Exception secondError = null;
        var first = new Thread(() =>
        {
            try
            {
                gate.Wait();
                processes[0] = Process.Start(new ProcessStartInfo(executablePath, "-autorun") { UseShellExecute = true });
            }
            catch (Exception error) { firstError = error; }
        });
        var second = new Thread(() =>
        {
            try
            {
                gate.Wait();
                processes[1] = Process.Start(new ProcessStartInfo(executablePath) { UseShellExecute = true });
            }
            catch (Exception error) { secondError = error; }
        });
        first.Start();
        second.Start();
        gate.Set();
        first.Join();
        second.Join();
        gate.Dispose();
        if (firstError != null) throw new InvalidOperationException("autorun launch failed", firstError);
        if (secondError != null) throw new InvalidOperationException("normal launch failed", secondError);
        return new[] { processes[0].Id, processes[1].Id };
    }
}
'@
}

$allWeixin = @(Get-CimInstance Win32_Process -Filter "name = 'Weixin.exe'")
if ($CurrentRootProcessIds.Count -eq 0) {
  $CurrentRootProcessIds = @($allWeixin | Where-Object {
    $_.CommandLine -notmatch '--type='
  } | ForEach-Object { [int]$_.ProcessId })
}
if ($CurrentRootProcessIds.Count -lt 1 -or $CurrentRootProcessIds.Count -gt 2) {
  throw "expected one or two current WeChat root processes, found $($CurrentRootProcessIds.Count)"
}
foreach ($rootProcessId in $CurrentRootProcessIds) {
  $root = Get-Process -Id $rootProcessId -ErrorAction Stop
  try {
    if ($root.ProcessName -ne "Weixin") {
      throw "current root process name mismatch: $rootProcessId"
    }
    if ($root.SessionId -ne $ExpectedSessionId) {
      throw "current root Windows session mismatch: $($root.SessionId)"
    }
    if (-not [string]::Equals($root.Path, $ExpectedExecutable, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "current root executable mismatch: $($root.Path)"
    }
  } finally {
    $root.Dispose()
  }
}
$targetProcessIds = @($allWeixin | Where-Object {
  $_.ProcessId -in $CurrentRootProcessIds -or $_.ParentProcessId -in $CurrentRootProcessIds
} | ForEach-Object { [int]$_.ProcessId })
if ($targetProcessIds.Count -eq 0) {
  throw "no verified WeChat process group found"
}

$original = Get-ItemProperty -LiteralPath $registryPath -Name $registryValue -ErrorAction SilentlyContinue
if ($null -ne $original) {
  $originalExists = $true
  $originalValue = [int]$original.$registryValue
}

try {
  if (-not (Test-Path -LiteralPath $registryPath)) {
    New-Item -Path $registryPath -Force | Out-Null
  }
  Set-ItemProperty -LiteralPath $registryPath -Name $registryValue -Type DWord -Value 1
  $accessibilityChanged = $true

  Stop-Process -Id $targetProcessIds -Force -ErrorAction Stop
  $stopDeadline = [DateTime]::UtcNow.AddSeconds(10)
  while ([DateTime]::UtcNow -lt $stopDeadline -and (Get-Process -Id $CurrentRootProcessIds -ErrorAction SilentlyContinue)) {
    Start-Sleep -Milliseconds 250
  }
  if (Get-Process -Id $CurrentRootProcessIds -ErrorAction SilentlyContinue) {
    throw "one or more current WeChat root processes did not stop"
  }

  $launcherProcessIds = [DualWeixinProcessStarter]::Start($ExpectedExecutable)

  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  $startedRoots = @()
  while ([DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $startedRoots = @(Get-CimInstance Win32_Process -Filter "name = 'Weixin.exe'" | Where-Object {
      $_.SessionId -eq $ExpectedSessionId -and $_.CommandLine -notmatch '--type='
    } | Sort-Object ProcessId)
    if ($startedRoots.Count -eq 2) { break }
  }
  if ($startedRoots.Count -ne 2) {
    throw "expected exactly two WeChat root processes, found $($startedRoots.Count)"
  }
  foreach ($startedProcess in $startedRoots) {
    if (-not [string]::Equals($startedProcess.ExecutablePath, $ExpectedExecutable, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "new WeChat executable mismatch: $($startedProcess.ExecutablePath)"
    }
  }

  Start-Sleep -Seconds 60
  [pscustomobject]@{
    ok = $true
    stoppedProcessIds = $targetProcessIds
    instances = @($startedRoots | ForEach-Object {
      [pscustomobject]@{
        processId = $_.ProcessId
        parentProcessId = $_.ParentProcessId
        windowsSessionId = $_.SessionId
        executablePath = $_.ExecutablePath
        commandLine = $_.CommandLine
      }
    })
    launcherProcessIds = $launcherProcessIds
  } | ConvertTo-Json -Depth 5 -Compress
} finally {
  if ($accessibilityChanged) {
    if ($originalExists) {
      Set-ItemProperty -LiteralPath $registryPath -Name $registryValue -Type DWord -Value $originalValue
    } else {
      Remove-ItemProperty -LiteralPath $registryPath -Name $registryValue -ErrorAction SilentlyContinue
    }
  }
}
