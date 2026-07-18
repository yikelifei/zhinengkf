param(
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

$excluded = Get-Process -Id $ExcludedProcessId -ErrorAction Stop
try {
  if ($excluded.ProcessName -ne "Weixin") {
    throw "excluded WeChat account process name mismatch"
  }
  if ($excluded.SessionId -ne $ExpectedSessionId) {
    throw "excluded WeChat Windows session mismatch: $($excluded.SessionId)"
  }
  if (-not [string]::Equals($excluded.Path, $ExpectedExecutable, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "excluded WeChat executable mismatch: $($excluded.Path)"
  }
} finally {
  $excluded.Dispose()
}

$baselineProcessIds = @(Get-Process -Name Weixin -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
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

  $launcher = Start-Process -FilePath $ExpectedExecutable -ArgumentList "-autorun" -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  $started = $null
  while ([DateTime]::UtcNow -lt $deadline -and $null -eq $started) {
    Start-Sleep -Milliseconds 500
    $started = Get-MainWeixinProcesses | Where-Object {
      $_.Id -notin $baselineProcessIds -and $_.Id -ne $ExcludedProcessId
    } | Select-Object -First 1
  }
  if ($null -eq $started) {
    throw "no new WeChat main window appeared within 30 seconds"
  }
  if ($started.SessionId -ne $ExpectedSessionId) {
    throw "new WeChat Windows session mismatch: $($started.SessionId)"
  }
  if (-not [string]::Equals($started.Path, $ExpectedExecutable, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "new WeChat executable mismatch: $($started.Path)"
  }

  Start-Sleep -Seconds 3
  $excludedAfter = Get-Process -Id $ExcludedProcessId -ErrorAction Stop
  try {
    if ($excludedAfter.ProcessName -ne "Weixin") {
      throw "excluded WeChat account process is no longer available"
    }
  } finally {
    $excludedAfter.Dispose()
  }

  [pscustomobject]@{
    ok = $true
    processId = $started.Id
    windowHandle = $started.MainWindowHandle.ToInt64()
    windowsSessionId = $started.SessionId
    executablePath = $started.Path
    excludedProcessId = $ExcludedProcessId
    excludedProcessPreserved = $true
    launcherProcessId = $launcher.Id
  } | ConvertTo-Json -Compress
} finally {
  if ($accessibilityChanged) {
    if ($originalExists) {
      Set-ItemProperty -LiteralPath $registryPath -Name $registryValue -Type DWord -Value $originalValue
    } else {
      Remove-ItemProperty -LiteralPath $registryPath -Name $registryValue -ErrorAction SilentlyContinue
    }
  }
}
