param(
  [ValidateSet("probe", "send")]
  [string]$Mode = "send"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PersonalWechatNative {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
}
"@

function Stop-Unsafe([string]$Code, [string]$Message) {
  [pscustomobject]@{ ok = $false; code = $Code; errorMessage = $Message } | ConvertTo-Json -Compress -Depth 8
  exit 2
}

function Normalize-Text([object]$Value) {
  return ([string]$Value).Trim() -replace '\s+', ' '
}

function Parse-WindowHandle([object]$Value) {
  $raw = ([string]$Value).Trim()
  if ($raw.StartsWith("0x", [System.StringComparison]::OrdinalIgnoreCase)) {
    return [Convert]::ToInt64($raw.Substring(2), 16)
  }
  return [Convert]::ToInt64($raw, 10)
}

function Find-ByAutomationId([System.Windows.Automation.AutomationElement]$Root, [string]$AutomationId) {
  if (-not $AutomationId) { return $null }
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
    $AutomationId
  )
  return $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Element-Name([System.Windows.Automation.AutomationElement]$Element) {
  if (-not $Element) { return "" }
  try { return Normalize-Text $Element.Current.Name } catch { return "" }
}

function RuntimeId-Key([System.Windows.Automation.AutomationElement]$Element) {
  if (-not $Element) { return "" }
  try { return [string]::Join(".", $Element.GetRuntimeId()) } catch { return "" }
}

function Element-Texts([System.Windows.Automation.AutomationElement]$Root) {
  $values = New-Object System.Collections.Generic.List[string]
  if (-not $Root) { return @() }
  $rootName = Element-Name $Root
  if ($rootName) { $values.Add($rootName) }
  $elements = $Root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($element in $elements) {
    $name = Element-Name $element
    if ($name) { $values.Add($name) }
  }
  return @($values)
}

function Texts-Match([string[]]$Texts, [string]$Expected, [string]$MatchMode = "exact") {
  $needle = Normalize-Text $Expected
  if (-not $needle) { return $false }
  foreach ($text in $Texts) {
    $candidate = Normalize-Text $text
    if ($MatchMode -eq "contains") {
      if ($candidate.IndexOf($needle, [System.StringComparison]::Ordinal) -ge 0) { return $true }
    } elseif ($candidate -eq $needle) {
      return $true
    }
  }
  return $false
}

function Assert-Identity($Root, $Payload) {
  $accountElement = Find-ByAutomationId $Root ([string]$Payload.ui.accountAutomationId)
  if (-not $accountElement) { Stop-Unsafe "account_element_missing" "configured account identity element was not found" }
  if ((Element-Name $accountElement) -ne (Normalize-Text $Payload.expected.accountText)) {
    Stop-Unsafe "account_identity_mismatch" "configured account identity text did not match the bound window"
  }

  $chatElement = Find-ByAutomationId $Root ([string]$Payload.ui.chatTitleAutomationId)
  if (-not $chatElement) { Stop-Unsafe "chat_element_missing" "configured chat title element was not found" }
  if ((Element-Name $chatElement) -ne (Normalize-Text $Payload.expected.chatTitle)) {
    Stop-Unsafe "chat_identity_mismatch" "active chat title did not match the bound conversation"
  }

  $messageList = Find-ByAutomationId $Root ([string]$Payload.ui.messageListAutomationId)
  if (-not $messageList) { Stop-Unsafe "message_list_missing" "configured message list element was not found" }
  $messageTexts = Element-Texts $messageList
  $recentMode = if ($Payload.ui.recentMessageMatch -eq "contains") { "contains" } else { "exact" }
  if (-not (Texts-Match $messageTexts ([string]$Payload.expected.recentMessageText) $recentMode)) {
    Stop-Unsafe "recent_message_mismatch" "latest customer message evidence was not found in the bound conversation"
  }

  return [pscustomobject]@{
    accountElement = $accountElement
    chatElement = $chatElement
    messageList = $messageList
    messageTexts = $messageTexts
  }
}

function Get-ProbeElements([System.Windows.Automation.AutomationElement]$Root) {
  $items = New-Object System.Collections.Generic.List[object]
  $elements = $Root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($element in $elements) {
    try {
      $automationId = [string]$element.Current.AutomationId
      $name = Element-Name $element
      if (-not $automationId -and -not $name) { continue }
      $items.Add([pscustomobject]@{
        automationId = $automationId
        name = $name
        controlType = [string]$element.Current.ControlType.ProgrammaticName
      })
      if ($items.Count -ge 500) { break }
    } catch {
      continue
    }
  }
  return @($items)
}

try {
  $rawPayload = [string]$env:PERSONAL_WECHAT_OPERATION_JSON
  if (-not $rawPayload) { Stop-Unsafe "payload_missing" "PERSONAL_WECHAT_OPERATION_JSON is required" }
  $payload = $rawPayload | ConvertFrom-Json

  $processId = [int]$payload.binding.processId
  $windowValue = Parse-WindowHandle $payload.binding.windowHandle
  $windowHandle = [IntPtr]$windowValue
  if (-not [PersonalWechatNative]::IsWindow($windowHandle)) {
    Stop-Unsafe "window_missing" "configured window handle is not valid"
  }

  [uint32]$ownerProcessId = 0
  [void][PersonalWechatNative]::GetWindowThreadProcessId($windowHandle, [ref]$ownerProcessId)
  if ($ownerProcessId -ne $processId) {
    Stop-Unsafe "window_process_mismatch" "configured window is not owned by the configured process"
  }

  $process = Get-Process -Id $processId -ErrorAction Stop
  if ($process.SessionId -ne [int]$payload.binding.windowsSessionId) {
    Stop-Unsafe "windows_session_mismatch" "configured process is not in the configured Windows session"
  }
  if ((Normalize-Text $process.ProcessName).ToLowerInvariant() -ne (Normalize-Text $payload.binding.processName).ToLowerInvariant()) {
    Stop-Unsafe "process_name_mismatch" "configured process name did not match"
  }
  if ($payload.binding.executablePath) {
    $actualPath = [System.IO.Path]::GetFullPath([string]$process.Path)
    $expectedPath = [System.IO.Path]::GetFullPath([string]$payload.binding.executablePath)
    if (-not $actualPath.Equals($expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) {
      Stop-Unsafe "process_path_mismatch" "configured executable path did not match"
    }
  }

  $root = [System.Windows.Automation.AutomationElement]::FromHandle($windowHandle)
  if (-not $root) { Stop-Unsafe "uia_root_missing" "UI Automation could not open the configured window" }

  if ($Mode -eq "probe") {
    [pscustomobject]@{
      ok = $true
      processId = $processId
      windowHandle = [string]$windowValue
      windowsSessionId = $process.SessionId
      elements = Get-ProbeElements $root
    } | ConvertTo-Json -Compress -Depth 8
    exit 0
  }

  $identity = Assert-Identity $root $payload
  $inputElement = Find-ByAutomationId $root ([string]$payload.ui.inputAutomationId)
  if (-not $inputElement) { Stop-Unsafe "input_element_missing" "configured chat input element was not found" }

  [void][PersonalWechatNative]::ShowWindowAsync($windowHandle, 9)
  if (-not [PersonalWechatNative]::SetForegroundWindow($windowHandle)) {
    Stop-Unsafe "foreground_failed" "could not activate the specifically bound WeChat window"
  }
  Start-Sleep -Milliseconds 250
  if ([PersonalWechatNative]::GetForegroundWindow() -ne $windowHandle) {
    Stop-Unsafe "foreground_mismatch" "the specifically bound WeChat window did not become foreground"
  }

  $sentCount = 0
  foreach ($action in @($payload.actions)) {
    $identity = Assert-Identity $root $payload
    $beforeTexts = Element-Texts $identity.messageList
    $beforeFingerprint = [string]::Join("`n", $beforeTexts)

    $inputElement.SetFocus()
    Start-Sleep -Milliseconds 100
    $focusedElement = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ((RuntimeId-Key $focusedElement) -ne (RuntimeId-Key $inputElement)) {
      Stop-Unsafe "input_focus_mismatch" "keyboard focus is not on the configured chat input"
    }
    if ([PersonalWechatNative]::GetForegroundWindow() -ne $windowHandle) {
      Stop-Unsafe "foreground_changed_before_paste" "foreground window changed before paste"
    }
    if ($action.type -eq "text") {
      [System.Windows.Forms.Clipboard]::SetText([string]$action.text)
    } elseif ($action.type -eq "image") {
      $files = New-Object System.Collections.Specialized.StringCollection
      [void]$files.Add([string]$action.filePath)
      [System.Windows.Forms.Clipboard]::SetFileDropList($files)
    } else {
      Stop-Unsafe "unsupported_action" "unsupported personal WeChat action"
    }

    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Start-Sleep -Milliseconds ([int]$payload.timing.pasteDelayMs)
    if ([PersonalWechatNative]::GetForegroundWindow() -ne $windowHandle) {
      Stop-Unsafe "foreground_changed_before_enter" "foreground window changed after paste and before send"
    }
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Start-Sleep -Milliseconds ([int]$payload.timing.confirmDelayMs)

    if ([PersonalWechatNative]::GetForegroundWindow() -ne $windowHandle) {
      Stop-Unsafe "window_changed_after_send" "foreground window changed while sending"
    }
    $identityAfter = Assert-Identity $root $payload
    $afterTexts = Element-Texts $identityAfter.messageList
    $afterFingerprint = [string]::Join("`n", $afterTexts)
    if ($afterFingerprint -eq $beforeFingerprint) {
      Stop-Unsafe "send_not_observed" "message list did not change after the send action"
    }
    if ($action.type -eq "text") {
      $sentMode = if ($payload.ui.sentTextMatch -eq "contains") { "contains" } else { "exact" }
      if (-not (Texts-Match $afterTexts ([string]$action.text) $sentMode)) {
        Stop-Unsafe "sent_text_not_observed" "sent text was not observed in the bound message list"
      }
    }
    $sentCount += 1
  }

  [pscustomobject]@{
    ok = $true
    actionCount = $sentCount
    processId = $processId
    windowHandle = [string]$windowValue
    windowsSessionId = $process.SessionId
    accountVerified = $true
    chatVerified = $true
    recentMessageVerified = $true
    operationVerified = $true
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  Stop-Unsafe "operation_error" $_.Exception.Message
}
