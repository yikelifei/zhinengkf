param(
  [Parameter(Mandatory = $true)]
  [string]$SdkRoot
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Set-ExactReplacement {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Original,
    [Parameter(Mandatory = $true)][string]$Replacement
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "SDK source file not found: $fullPath"
  }
  $content = [System.IO.File]::ReadAllText($fullPath)
  if ($content.Contains($Replacement)) { return }
  if (-not $content.Contains($Original)) {
    throw "SDK source contract changed; refusing fuzzy patch: $fullPath"
  }
  [System.IO.File]::WriteAllText($fullPath, $content.Replace($Original, $Replacement), $utf8NoBom)
}

$messageContext = Join-Path $SdkRoot "WeChatAuto4_X\WeChatAuto\Models\MessageContext.cs"
$messageMonitor = Join-Path $SdkRoot "WeChatAuto4_X\WeChatAuto\Components\MessageMonitor.cs"

Set-ExactReplacement $messageContext `
  'public MessageContext(List<SimpleMessageBubble> newMessages, List<SimpleMessageBubble> historyMessages, Sender sender, WeChatClient ownerClient, WeChatClientFactory systemClientFactory, IServiceProvider serviceProvider, string ownerNickName)' `
  'public MessageContext(List<SimpleMessageBubble> newMessages, List<SimpleMessageBubble> historyMessages, Sender sender, WeChatClient ownerClient, WeChatClientFactory systemClientFactory, IServiceProvider serviceProvider, string ownerNickName, string conversationTitle, string conversationType)'
Set-ExactReplacement $messageContext `
  '            OwnerNickName = ownerNickName;' `
  "            OwnerNickName = ownerNickName;`r`n            ConversationTitle = conversationTitle;`r`n            ConversationType = conversationType;"
Set-ExactReplacement $messageContext `
  '        public string OwnerNickName { get; set; }' `
  "        public string OwnerNickName { get; set; }`r`n        public string ConversationTitle { get; set; }`r`n        public string ConversationType { get; set; }"

Set-ExactReplacement $messageMonitor `
  '_DoCallBackAction(title.Title, totalSessionNewMessages, callBack);' `
  '_DoCallBackAction(title, totalSessionNewMessages, callBack);'
Set-ExactReplacement $messageMonitor `
  'private void _DoCallBackAction(string title, List<SimpleMessageBubble> newMessages, Action<MessageContext> callBack)' `
  'private void _DoCallBackAction(HeaderInfo title, List<SimpleMessageBubble> newMessages, Action<MessageContext> callBack)'
Set-ExactReplacement $messageMonitor `
  'MessageCacheHelper.GetTodayLastMessages(title, WeAutomation.Config.MaxHistoryMessageFetchNumber)' `
  'MessageCacheHelper.GetTodayLastMessages(title.Title, WeAutomation.Config.MaxHistoryMessageFetchNumber)'
Set-ExactReplacement $messageMonitor `
  'WeAutomation.currentContext.Send((state) => this.UIInvoker.Invoke(state.ToString()), this._Client.NickName, title.Title, title.HeaderType.ToString());' `
  'WeAutomation.currentContext.Send((state) => this.UIInvoker.Invoke(state.ToString()), this._Client.NickName);'
Set-ExactReplacement $messageMonitor `
  'MessageContext context = new MessageContext(newMessages, historyList, this._Client.ChatContent.Sender, this._Client, this._Client.Factory, this.serviceProvider, this._Client.NickName);' `
  'MessageContext context = new MessageContext(newMessages, historyList, this._Client.ChatContent.Sender, this._Client, this._Client.Factory, this.serviceProvider, this._Client.NickName, title.Title, title.HeaderType.ToString());'

Write-Output "WeChatAuto SDK message context patch is ready."
