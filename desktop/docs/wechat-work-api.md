# 企业微信官方客服消息闭环

本模块接入的是企业微信“微信客服”官方 API，不是自建应用消息接口，也不操作 Windows 企业微信窗口。

消息链路：

1. 企业微信向 `GET/POST {CUSTOMER_SERVICE_PUBLIC_BASE_URL}/api/wechat-work/callback` 发起验证或事件回调。
2. 回调验签、解密并校验 CorpID 后立即返回纯文本 `success`；`kf_msg_or_event` 中的 `Token` 和 `OpenKfId` 用于后台调用 `kf/sync_msg`。
3. `sync_msg` 的每条客户消息按 `msgid` 幂等处理，并将 `open_kfid + external_userid` 持久映射到独立的微信账号、客户和会话。
4. 归一化消息继续复用现有 `WechatDispatchService.processInboundMessage`，进入路由、人工接管和安全发送队列。
5. 企业微信会话的文本发送任务通过既有安全校验后，由 `wechat_work_kf` 适配器调用 `kf/send_msg`。调用、失败、重试和异步失败均记录在 `WechatSendAttempt` 与企业微信审计日志中。

不会再使用默认客户或默认会话。没有入站映射的 `external_userid` 不能直接发送，必须先成功同步至少一条该客户的消息或事件。

持久化模式由 `USE_LOCAL_STORE` 控制：`true` 继续使用本地 JSON 演示数据；`false` 使用 PostgreSQL，并持久化企微身份映射、消息、发送任务、发送尝试及脱敏审计。切换到 PostgreSQL 前必须先部署 Prisma 迁移；迁移和导入方法见 `prisma/README.md`。两种模式复用同一身份校验和安全发送逻辑。

## 必需配置

在 `desktop/.env` 或启动 API 的运行环境中配置：

```text
CUSTOMER_SERVICE_PUBLIC_BASE_URL=https://your-public-domain.example.com
WECHAT_WORK_CORP_ID=your-corp-id
WECHAT_WORK_SECRET=your-wechat-customer-service-secret
WECHAT_WORK_TOKEN=the-token-set-in-wechat-work-admin
WECHAT_WORK_ENCODING_AES_KEY=the-43-character-encoding-aes-key
WECHAT_SEND_ADAPTER=wechat_work_kf
```

可选配置：

```text
WECHAT_WORK_OPEN_KFID=optional-default-open-kfid
WECHAT_WORK_API_BASE_URL=https://qyapi.weixin.qq.com
WECHAT_WORK_SEND_MAX_ATTEMPTS=3
WECHAT_WORK_SEND_RETRY_DELAY_SECONDS=30
```

`WECHAT_WORK_SECRET` 必须是“微信客服”Secret。企业微信后台还要把目标客服账号设置为允许 API 管理，并授予“管理帐号、分配会话和收发消息”权限。`CUSTOMER_SERVICE_PUBLIC_BASE_URL` 必须是企业微信可访问的公网 HTTPS 地址。

配置检查：

```text
GET http://127.0.0.1:3200/api/wechat-work/status
```

状态接口只返回布尔检查、适配器和统计信息，不返回 Secret、Token 或 EncodingAESKey。

## 运维接口

手工触发同步（通常由回调自动触发）：

```http
POST /api/wechat-work/kf/sync
Content-Type: application/json

{"token":"callback-token","openKfid":"wk..."}
```

安全入队文本（不会绕过队列直接发送）：

```http
POST /api/wechat-work/kf/send-text
Content-Type: application/json

{"openKfid":"wk...","externalUserId":"wm...","text":"您好"}
```

处理安全发送队列：

```http
POST /api/wechat/send-tasks/process-safe-queue
Content-Type: application/json

{"adapter":"wechat_work_kf","limit":20}
```

查看企业微信入站、发送、重试和失败审计：

```text
GET /api/wechat-work/kf/audit?limit=100
```

## 幂等、失败与重试

- `msgid` 是入站和事件的持久幂等键；重复回调、重复拉取或并发拉取不会重复创建本地消息。
- 客服人员在企业微信端发送、且带 `servicer_userid` 的同步记录不会再次作为客户入站触发自动回复。
- `kf/send_msg` 调用失败时，该次 `WechatSendAttempt` 记录为 `failed`；未达到上限时任务回到 `queued`，并记录下次重试时间。
- `kf/send_msg` 返回 `errcode=0` 只代表接口受理。后续 `sync_msg` 若出现 `msg_send_fail`，系统会按 `fail_msgid` 找回原发送尝试并把任务改为 `failed`。
- 官方限制仍然适用：客户主动发消息后的 48 小时内最多可下发 5 条；超过时限、会话关闭、用户拒收等会通过失败事件返回。

当前官方适配器只发送文本。包含图片路径的任务会在安全校验阶段被阻止，不能降级成伪成功；图片发送需要后续补充企业微信素材上传流程。

## 官方接口

- 读取消息：<https://open.work.weixin.qq.com/api/doc/90000/90135/94670>
- 发送消息：<https://open.work.weixin.qq.com/api/doc/90000/90135/94677>
