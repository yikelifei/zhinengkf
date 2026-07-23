param(
  [Parameter(Mandatory = $true)]
  [int]$ProcessId,
  [Parameter(Mandatory = $true)]
  [long]$WindowHandle,
  [string]$ExpectedExecutable = "D:\weixin\Weixin.exe",
  [int]$ExpectedSessionId = 2,
  [int]$ExcludedProcessId = 89672
)

$ErrorActionPreference = "Stop"
$registryPath = "HKCU:\Software\Microsoft\Narrator\NoRoam"
$registryValue = "RunningState"
$originalExists = $false
$originalValue = 0
$accessibilityChanged = $false

function Get-MainWeixinProcesses {
  @(Get-Process -Name Weixin -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq "微信"
  })
}

$target = Get-Process -Id $ProcessId -ErrorAction Stop
try {
  if ($target.ProcessName -ne "Weixin") {
    throw "target process name mismatch: $($target.ProcessName)"
  }
  if ($target.SessionId -ne $ExpectedSessionId) {
    throw "target Windows session mismatch: $($target.SessionId)"
  }
  if ($target.MainWindowHandle.ToInt64() -ne $WindowHandle) {
    throw "target window handle mismatch: $($target.MainWindowHandle.ToInt64())"
  }
  if (-not [string]::Equals($target.Path, $ExpectedExecutable, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "target executable mismatch: $($target.Path)"
  }

  $excluded = Get-Process -Id $ExcludedProcessId -ErrorAction Stop
  try {
    if ($excluded.ProcessName -ne "Weixin" -or $excluded.MainWindowHandle -eq 0) {
      throw "excluded WeChat account process is not a live main window"
    }
  } finally {
    $excluded.Dispose()
  }

  $baselineMainProcessIds = @(Get-MainWeixinProcesses | ForEach-Object { $_.Id })
  $original = Get-ItemProperty -LiteralPath $registryPath -Name $registryValue -ErrorAction SilentlyContinue
  if ($null -ne $original) {
    $originalExists = $true
    $originalValue = [int]$original.$registryValue
  }
  if (-not (Test-Path -LiteralPath $registryPath)) {
    New-Item -Path $registryPath -Force | Out-Null
  }
  Set-ItemProperty -LiteralPath $registryPath -Name $registryValue -Type DWord -Value 1
  $accessibilityChanged = $true

  if (-not $target.CloseMainWindow()) {
    throw "target process refused graceful window close; no force-stop was attempted"
  }
  if (-not $target.WaitForExit(15000)) {
    throw "target process did not exit gracefully within 15 seconds; no force-stop was attempted"
  }

  $launcher = Start-Process -FilePath $ExpectedExecutable -ArgumentList "-autorun" -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  $restarted = $null
  while ([DateTime]::UtcNow -lt $deadline -and $null -eq $restarted) {
    Start-Sleep -Milliseconds 500
    $restarted = Get-MainWeixinProcesses | Where-Object {
      $_.Id -notin $baselineMainProcessIds -and $_.Id -ne $ExcludedProcessId
    } | Select-Object -First 1
  }
  if ($null -eq $restarted) {
    throw "no new WeChat main window appeared within 30 seconds"
  }

  Start-Sleep -Seconds 2
  $excludedAfter = Get-Process -Id $ExcludedProcessId -ErrorAction Stop
  try {
    if ($excludedAfter.MainWindowHandle -eq 0) {
      throw "excluded WeChat account window is no longer available"
    }
  } finally {
    $excludedAfter.Dispose()
  }

  [pscustomobject]@{
    ok = $true
    oldProcessId = $ProcessId
    newProcessId = $restarted.Id
    newWindowHandle = $restarted.MainWindowHandle.ToInt64()
    windowsSessionId = $restarted.SessionId
    executablePath = $restarted.Path
    excludedProcessId = $ExcludedProcessId
    excludedProcessPreserved = $true
    launcherProcessId = $launcher.Id
  } | ConvertTo-Json -Compress
} finally {
  $target.Dispose()
  if ($accessibilityChanged) {
    if ($originalExists) {
      Set-ItemProperty -LiteralPath $registryPath -Name $registryValue -Type DWord -Value $originalValue
    } else {
      Remove-ItemProperty -LiteralPath $registryPath -Name $registryValue -ErrorAction SilentlyContinue
    }
  }
}
