# Windows 微信桥接协议

本协议用于连接客服平台和后续独立的 Windows 微信发送程序。桥接程序只能读取 outbox 文件并写入 ack 回执；不能直接改数据库，也不能绕过客服平台的发送守卫。

## 基本原则

- 只处理客服平台 API 返回的 `pending` outbox。
- 单个微信账号同一时间只允许一个发送任务持锁执行。
- 发送前桥接程序必须再次确认微信账号、当前聊天对象、最近客户标识。
- 发送成功回执必须带完整身份信息和协议版本。
- 不确定是否发给正确客户时，必须写 `failed` 回执或不回执，不能写 `sent`。

## Outbox

来源：

```http
GET /api/wechat/bridge/outbox
```

桥接程序只处理 `pending` 数组。每条 `pending` 必须满足：

- `preview.protocolVersion` = `wechat_bridge_outbox_v1`
- `taskId` 存在
- `attemptId` 存在
- `wechatAccountId` 存在
- `conversationId` 存在
- `fileName` 存在
- `preview.outboxFileName` 与 `fileName` 一致
- `preview.attemptId` 与 `attemptId` 一致
- `preview.wechatAccountId` 与 `wechatAccountId` 一致
- `preview.conversationId` 与 `conversationId` 一致

任一条件不满足，桥接程序必须跳过或失败，不得生成成功回执。

## Ack 回执

推荐写入 inbox 文件，然后调用扫描接口：

```http
POST /api/wechat/bridge/inbox/scan
```

也可以直接调用：

```http
POST /api/wechat/send-tasks/:id/bridge-ack
```

成功回执必须包含：

```json
{
  "version": "wechat_bridge_ack_v1",
  "ackToken": "64-character-token-from-outbox-file",
  "taskId": "send_xxx",
  "attemptId": "attempt_xxx",
  "wechatAccountId": "wechat_demo_1",
  "conversationId": "conversation_demo_1",
  "outboxFileName": "1780000000000-send_xxx.json",
  "status": "sent",
  "sentAt": "2026-06-27T00:00:00.000Z",
  "metadata": {
    "source": "windows-wechat-bridge",
    "operator": "local-bridge"
  }
}
```

失败回执可以不带完整发送身份，用于超时或内部失败兜底：

```json
{
  "version": "wechat_bridge_ack_v1",
  "taskId": "send_xxx",
  "attemptId": "attempt_xxx",
  "status": "failed",
  "errorMessage": "当前微信窗口不是目标客户，已停止发送"
}
```

## 平台端校验

客服平台收到 `sent` 回执后会校验：

- 发送任务仍处于 `sending`
- attempt 属于该发送任务
- attempt adapter 是 `windows_bridge`
- attempt 仍为 `started`
- ack 协议版本是 `wechat_bridge_ack_v1`
- ack 微信账号匹配发送任务
- ack 会话匹配发送任务
- ack outbox 文件匹配 attempt 记录

校验失败时不会标记已发送，会进入失败处理或人工检查。

## Worker 默认模式

`tools/wechat-bridge-worker.js` 默认是 `noop`，只观察 outbox，不回写发送结果。

测试模式：

```powershell
$env:BRIDGE_MODE="simulate_sent"
$env:BRIDGE_ACK_TRANSPORT="file_scan"
node tools/wechat-bridge-worker.js --once
```

## Outbox file body validation

Bridge worker and backend `bridge-ack` must validate the API `pending` item and the local outbox JSON file body before any `sent` ack is accepted.

Required checks:
- `filePath` basename must equal `fileName`.
- `filePath` must be a direct child of `outboxDir`.
- JSON root must be an object.
- `version` must equal `wechat_bridge_outbox_v1`.
- `ackToken` must be a 64-character hex token in the outbox file, and a `sent` ack must echo the same top-level `ackToken`.
- `taskId`, `wechatAccountId`, and `conversationId` must match the API pending item.
- `target.wechatAccountId` and `target.conversationId` must match the API pending item.
- `sendPlan.target.wechatAccountId` and `sendPlan.target.conversationId` must match the API pending item.
- `sendPlan.actions` must be a non-empty array, and `sendPlan.actionCount` must equal its length.
- `sendPlan.constraints.singleAccountLock`, `requireActiveWindowMatch`, `requireRecentCustomerMatch`, and `doNotMarkSentWithoutAck` must all be `true`.
- `guardSnapshot` or `context.guardStatus` must show the send guard passed.

If any check fails, the bridge worker must not generate a `sent` ack.

`GET /api/wechat/bridge/status` and `POST /api/wechat/bridge/inbox/scan` return sanitized ack summaries only. They may show `hasAckToken: true`, but must not return the token value or the raw ack `data` object.

真实桥接程序接入前，不应在生产环境开启 `simulate_sent`。
