# Windows WeChat Bridge Protocol

This protocol connects the customer-service platform to a separate local Windows WeChat bridge program.

The bridge program may read outbox files and write acknowledgement files. It must not modify the database directly, skip platform-side send guards, or mark a task as sent without a validated acknowledgement.

## Principles

- Only process `pending` entries returned by `GET /api/wechat/bridge/outbox`.
- Hold one local lock per WeChat account, so one account only handles one send task at a time.
- Before sending, re-check the WeChat account, current chat target, and latest customer identifier.
- A `sent` acknowledgement must include protocol version, task identity, account identity, conversation identity, outbox file identity, and the one-time `ackToken`.
- An external `failed` acknowledgement must include the same identity and `ackToken` proof as `sent`.
- Simplified failed acknowledgements are only allowed for platform-internal timeout handling.

## Outbox

Source:

```http
GET /api/wechat/bridge/outbox
```

The bridge program must only process `pending` entries. A pending entry must include:

- `preview.protocolVersion = wechat_bridge_outbox_v1`
- `taskId`
- `attemptId`
- `wechatAccountId`
- `conversationId`
- `fileName`
- `preview.outboxFileName` matching `fileName`
- `preview.attemptId` matching `attemptId`
- `preview.wechatAccountId` matching `wechatAccountId`
- `preview.conversationId` matching `conversationId`

The outbox response includes `outboxDir` plus each entry `fileName`, so a local bridge worker can read the matching JSON file without exposing per-entry absolute `filePath`. The outbox list only exposes a sanitized `preview`. The raw payload, `ackToken`, message text, customer display name, WeChat display name, chat title, and local image file names are not returned by the status/list API.

## Outbox File Validation

Both the worker and backend must validate the API pending item and local outbox JSON file before accepting any external `sent` or `failed` acknowledgement.

Required checks:

- The outbox file basename equals `fileName`.
- The outbox file is a direct child of `outboxDir`.
- The outbox file must be a real regular file whose resolved path stays inside `outboxDir`; symlink-style escapes are rejected.
- JSON root is an object.
- `version = wechat_bridge_outbox_v1`.
- `ackToken` is a 64-character hex token.
- External `sent` and `failed` acknowledgements echo the same top-level `ackToken`.
- `taskId`, `wechatAccountId`, and `conversationId` match the API pending item.
- `target.wechatAccountId` and `target.conversationId` match the API pending item.
- `sendPlan.target.wechatAccountId` and `sendPlan.target.conversationId` match the API pending item.
- `sendPlan.actions` is non-empty, and `sendPlan.actionCount` equals its length.
- `sendPlan.constraints.singleAccountLock`, `requireActiveWindowMatch`, `requireRecentCustomerMatch`, and `doNotMarkSentWithoutAck` are all `true`.
- `guardSnapshot` or `context.guardStatus` shows the send guard passed.

Valid send actions:

- `text`: must include non-empty `text`.
- `image`: must point to an existing local file under `LOCAL_STORAGE_ROOT` or the default `storage` directory.
- Remote URLs, empty text, unsupported action types, missing files, symlinks, and paths outside local storage must not be acknowledged as sent or externally failed.

## Acknowledgements

Preferred transport:

```http
POST /api/wechat/bridge/inbox/scan
```

The bridge program writes ack JSON files into `.runtime/wechat-inbox`; the platform scans and archives them into `processed` or `failed`.

Ack `metadata` is optional and should stay operational only, such as bridge implementation name, mode, and local worker id. Do not put `ackToken`, API keys, cookies, authorization headers, customer chat titles, or WeChat display names into `metadata`; the backend redacts common secret fields before persistence.

Direct transport is also supported for bridge programs:

```http
POST /api/wechat/send-tasks/:id/bridge-ack
```

Successful ack example:

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

External failed ack example:

```json
{
  "version": "wechat_bridge_ack_v1",
  "ackToken": "64-character-token-from-outbox-file",
  "taskId": "send_xxx",
  "attemptId": "attempt_xxx",
  "wechatAccountId": "wechat_demo_1",
  "conversationId": "conversation_demo_1",
  "outboxFileName": "1780000000000-send_xxx.json",
  "status": "failed",
  "errorMessage": "bridge stopped before sending"
}
```

## Backend Checks

For external acknowledgements, the platform checks:

- Send task still has status `sending`.
- Attempt belongs to the send task.
- Attempt adapter is `windows_bridge`.
- Attempt status is still `started`.
- Ack protocol version is `wechat_bridge_ack_v1`.
- Ack account matches the send task.
- Ack conversation matches the send task.
- Ack outbox file matches the pending attempt.
- Ack token matches the local outbox file.
- Local outbox body passes the validation rules above.

If any check fails, the task is not marked `sent` or externally `failed`. The ack file is archived to `failed` and the task remains protected for manual handling.

## Worker Modes

`tools/wechat-bridge-worker.js` defaults to `noop`: it only reads pending outbox tasks and does not write send results.

To start the safe-send helper processes explicitly:

```powershell
npm.cmd run ports:start:mock
npm.cmd run wechat:safe:start
npm.cmd run wechat:safe:status
```

This starts the window observer and bridge worker after the API is reachable. It does not enable real sending by default because `BRIDGE_MODE` remains `noop`.

Test modes:

```powershell
$env:BRIDGE_MODE="simulate_sent"
$env:BRIDGE_ACK_TRANSPORT="file_scan"
node tools/wechat-bridge-worker.js --once
```

Configuration:

- `BRIDGE_API_BASE`: default `http://127.0.0.1:3200/api`
- `BRIDGE_MODE`: `noop`, `simulate_sent`, `simulate_failed`
- `BRIDGE_ACK_TRANSPORT`: `file_scan`, `file`, `api`
- `WECHAT_BRIDGE_INBOX_DIR`: default `.runtime/wechat-inbox`
- `WECHAT_BRIDGE_LOCK_DIR`: default `.runtime/wechat-bridge-locks`
- `WECHAT_BRIDGE_WORKER_STATUS_FILE`: default `.runtime/wechat-bridge-worker-status.json`
- `BRIDGE_LIMIT`: max outbox tasks per run

Do not enable `simulate_sent` in production. A real bridge must keep the current account lock, account identity, conversation identity, window snapshot, and ack-token validation flow intact.
