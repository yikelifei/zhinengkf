# 多个人微信账号安全桥接

`tools/personal-wechat-bridge.js` 是现有 `windows_bridge` 出站协议的真实 Windows 操作端。它不创建第二套发送任务或 ACK 接口，仍然只消费 `.runtime/wechat-dispatch`，成功后把 `wechat_bridge_ack_v1` 写到 `.runtime/wechat-inbox`，再调用现有 `/api/wechat/bridge/inbox/scan`。

## 安全边界

- 不再查找并激活“第一个 WeChat/Weixin 进程”。
- 不支持未验证窗口发送，也没有 `PERSONAL_WECHAT_ALLOW_UNVERIFIED_WINDOW` 逃生开关。
- 每个 `wechatAccountId` 必须唯一绑定一个进程 ID、窗口句柄、Windows 会话 ID 和本地逻辑 `sessionId`。
- 每个账号还必须配置账号身份、聊天标题、消息列表和输入框的 UI Automation ID。
- 发送前必须在绑定窗口内同时验证账号身份文本、聊天标题和 dispatch 中的最近客户消息文本。
- 同一账号使用独立文件锁并按 dispatch 顺序串行。处于不同 Windows 会话（独立桌面输入域）的账号可并行；同一 Windows 会话内即使账号不同也会共用输入锁并串行，避免全局剪贴板/键盘焦点互相串号。
- 只支持非空文本和 `LOCAL_STORAGE_ROOT` 内的真实本地图片。远程 URL、缺失文件、目录、符号链接和越界路径会阻断。
- 每个动作发送后都必须观察到绑定消息列表发生变化；文本动作还必须在该消息列表中观察到发送文本。
- 只有全部动作都返回真实 UI 成功证据后才写 `sent` ACK。无法验证或结果不确定时只写本地 blocked marker，不写 ACK，也不会自动重试。

## 1. 准备账号绑定文件

默认文件：

```text
.runtime/personal-wechat-accounts.json
```

格式：

```json
{
  "version": "personal_wechat_accounts_v1",
  "accounts": [
    {
      "wechatAccountId": "wechat_demo_1",
      "sessionId": "personal-service-1",
      "processId": 12345,
      "processName": "Weixin",
      "executablePath": "C:\\Program Files\\Tencent\\Weixin\\Weixin.exe",
      "windowHandle": "987654",
      "windowsSessionId": 1,
      "accountText": "客服微信 1",
      "ui": {
        "accountAutomationId": "AccountIdentity",
        "chatTitleAutomationId": "ChatTitle",
        "messageListAutomationId": "MessageList",
        "inputAutomationId": "ChatInput",
        "recentMessageMatch": "exact",
        "sentTextMatch": "exact"
      },
      "conversations": [
        {
          "conversationId": "conversation_demo_1",
          "customerId": "customer_demo_1",
          "chatTitle": "王总 端午礼盒"
        }
      ]
    }
  ]
}
```

必填绑定说明：

- `wechatAccountId`、`sessionId`、`processId + windowHandle` 在整个配置里都必须唯一。
- `windowsSessionId` 是 Windows 进程的真实 SessionId，不是自定义名字。
- `processName` 不带 `.exe`；配置 `executablePath` 后还会校验完整程序路径。
- `accountText` 必须等于 `accountAutomationId` 元素当前显示的账号身份文本。
- 会话绑定的 `conversationId`、`customerId`、`chatTitle` 必须和平台 dispatch 完全一致。
- `recentMessageMatch` 和 `sentTextMatch` 默认都是 `exact`；只有经过现场确认 UI Automation 会附加固定前后缀时才使用 `contains`。

## 2. 查询进程、窗口和会话 ID

在每个个人微信都已登录并打开主窗口后运行：

```powershell
Get-Process Weixin,WeChat -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object Id,ProcessName,SessionId,MainWindowHandle,Path
```

把对应账号的 `Id`、`MainWindowHandle`、`SessionId`、`ProcessName` 和 `Path` 写入配置。窗口重建、微信重启或进程 ID 改变后必须更新绑定；桥接不会自动猜测新窗口。

## 3. 查询 UI Automation ID

先把四个 `ui.*AutomationId` 临时填成任意非空占位值，然后只探测指定账号绑定：

```powershell
npm.cmd run wechat:personal:status
node tools/personal-wechat-bridge.js --probe-account wechat_demo_1
```

探测命令只读取配置所指向的进程和窗口，并返回最多 500 个带名称或 Automation ID 的子元素，不点击、不输入、不发送。根据输出确认：

- 哪个元素稳定展示当前登录账号身份；
- 哪个元素是当前聊天标题；
- 哪个元素只包含聊天消息列表；
- 哪个元素是当前会话输入框。

如果当前微信版本没有暴露这些可稳定定位的元素，必须停止启用真实发送。这是明确的外部依赖，不能用坐标点击或“激活第一个进程”降级绕过。

若需要不同账号真实并行，必须让它们运行在隔离的 Windows 交互会话中，并在各自会话里启动桥接实例；同一桌面会话的 `SendKeys`、焦点和剪贴板是共享资源，系统会主动串行化，不能为了并行度取消这层锁。

## 4. 启动顺序

先启动 API，并确认发送适配器为 `windows_bridge`：

```powershell
npm.cmd run ports:start:mock
```

观察模式，不触碰微信：

```powershell
$env:PERSONAL_WECHAT_SEND="0"
npm.cmd run wechat:safe:personal:start
npm.cmd run wechat:safe:status
```

现场核对所有账号绑定和 UI Automation 证据后，才启用真实发送：

```powershell
$env:PERSONAL_WECHAT_SEND="1"
$env:PERSONAL_WECHAT_ACCOUNTS_CONFIG_FILE="C:\absolute\path\personal-wechat-accounts.json"
npm.cmd run wechat:safe:personal:start
```

可调参数：

- `PERSONAL_WECHAT_SEND=1`：唯一的真实发送总开关。
- `PERSONAL_WECHAT_ACCOUNTS_CONFIG_FILE`：账号绑定文件路径。
- `PERSONAL_WECHAT_BLOCKED_DIR`：默认 `.runtime/personal-wechat-blocked`。
- `WECHAT_BRIDGE_LOCK_DIR`：默认 `.runtime/wechat-bridge-locks`，worker 和个人桥接共同使用。
- `LOCAL_STORAGE_ROOT`：允许发送图片的本地存储根目录。
- `PERSONAL_WECHAT_PASTE_DELAY_MS`：粘贴后等待时间，默认 500 ms。
- `PERSONAL_WECHAT_CONFIRM_DELAY_MS`：按 Enter 后等待 UI 结果时间，默认 1500 ms。
- `PERSONAL_WECHAT_SEND_TIMEOUT_MS`：单个 PowerShell UI 操作超时，默认 60000 ms。

不能为真实发送设置 `PERSONAL_WECHAT_DISABLE_ACK_SCAN=1`。桥接会主动阻断这种配置，避免已经发送但 ACK 未扫描时重复发送。

## 5. 阻断与恢复

阻断记录位于：

```text
.runtime/personal-wechat-blocked/*.blocked.json
```

记录只包含任务/attempt/账号/会话身份、错误码、错误摘要和时间，不包含消息正文或 `ackToken`。常见错误包括：

- 配置没有唯一账号/会话绑定；
- 进程、窗口句柄或 Windows SessionId 改变；
- 账号身份、聊天标题或最近消息不匹配；
- 输入框或消息列表 Automation ID 失效；
- 图片不在本地存储根目录；
- 发送后消息列表没有变化或没有观察到发送文本；
- dispatch 过期或源 outbox 已不存在。

恢复步骤：

1. 停止安全 worker：`npm.cmd run wechat:safe:stop`。
2. 查看 blocked marker 和 `personal-wechat-bridge-status.json`，修复真实原因。
3. 查询 `GET /api/wechat/bridge/status` 和 `GET /api/wechat/bridge/dispatch`，确认任务仍是待处理且 dispatch 未过期。
4. 只有确认该动作没有发生过，才删除对应 blocked marker 并重新启动。
5. 如果发送结果不确定、dispatch 已过期或任务需要重新生成，使用现有任务取消/人工重新排队流程；不要删除 marker 后盲目重发。

如果 ACK 已写入但 API 扫描暂时失败，桥接会识别 inbox 中已有的同一 `taskId + attemptId + wechatAccountId` 成功 ACK，只重试扫描，不会再次操作微信。

## 6. 图片动作

图片通过 Windows `FileDropList` 剪贴板粘贴到绑定输入框，再按 Enter。发送前 Node 层和既有 worker 会分别验证图片真实路径；发送后必须观察到绑定消息列表变化。当前 UI Automation 若不能可靠暴露图片消息节点变化，图片发送会阻断，不会写 ACK。

## 7. 真实外部依赖

- Windows 桌面交互会话必须处于解锁状态。
- 目标微信版本必须向 Windows UI Automation 暴露稳定的账号、聊天标题、消息列表和输入框元素。
- 每次微信升级、重启或窗口重建后，需要重新确认进程 ID、窗口句柄、SessionId 和 Automation ID。
- 本实现不负责微信登录、多开、绕过平台限制、验证码、风控或封号规避。
