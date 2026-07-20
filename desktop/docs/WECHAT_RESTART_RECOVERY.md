# 微信桥接异常恢复与幂等手册

本手册只覆盖现有 `windows_bridge`、dispatch worker、个人微信本地桥接和文件 ACK 链路。核心原则是：无法证明“发送前失败”时，一律按投递结果未知处理，不自动重试、不把任务改成 `failed`、不手工伪造 `sent`。

## 1. 状态和目录含义

| 位置或状态 | 含义 | 是否可自动重试 |
| --- | --- | --- |
| `wechat-outbox` 根目录 | 后端已建立发送 attempt，等待桥接 | 否，由平台队列决定 |
| `wechat-dispatch` 根目录 | 尚未被个人微信桥接认领 | 仅桥接正常认领 |
| `wechat-dispatch/processing` | 已认领，可能已接近或越过发送边界 | 否 |
| `wechat-dispatch/processed` | 已生成成功 ACK 的终态证据 | 否 |
| `wechat-dispatch/failed` | 已证明发送前失败并生成失败 ACK | 否，先由后端处理 ACK |
| `wechat-dispatch/uncertain` | UI 中断或人工粘贴，是否发送无法确认 | 绝对禁止 |
| `wechat-inbox/*.ack.json` | 尚未被后端扫描的持久回执 | 不发送，只重扫 ACK |
| 任务 `sending` 且 `deliveryState=unknown` | ACK 超时、outbox 异常或 dispatch 过期，投递结果未知 | 绝对禁止 |

目录可由环境变量改写；现场应以已登录工作台显示的 bridge 状态和进程实际配置为准，不要假定默认路径。`GET /api/wechat/bridge/status` 不再接受匿名本机请求：工作台走操作员会话，bridge 进程走专用服务凭据。

## 2. 通用停机检查

在移动或隔离任何运行时文件前，先停止安全 worker：

```powershell
npm.cmd run wechat:safe:status
npm.cmd run wechat:safe:stop
```

随后保留以下证据：任务 ID、attempt ID、微信账号 ID、会话 ID、客户 ID、outbox/dispatch/ACK 文件名、文件时间、worker 状态文件，以及微信客户端中该会话的实际消息记录。不要在报告或工单中复制 `ackToken`、Cookie、Authorization 或客户聊天正文。

## 3. ACK 丢失或 ACK 扫描失败

1. 查看 `.runtime/wechat-inbox` 或配置的 inbox 中是否仍有对应 `.ack.json`。
2. 有 ACK 时只重扫回执，不重新发送。优先恢复并运行正常 bridge worker，让它用启动器管理的 `WECHAT_BRIDGE_SERVICE_TOKEN_FILE` 自动鉴权。只有受控排障脚本才应读取该文件并发送 `x-wechat-bridge-token`，不要把 token 粘贴进命令历史、报告或日志。

```powershell
npm.cmd run wechat:bridge:once
```

3. 网络响应丢失导致同一 ACK 再次提交是安全的；只有任务、attempt、账号、会话、客户、outbox 文件和 token 哈希全部一致才会按幂等重放接受。
4. ACK 不存在但微信窗口可能已执行过动作时，保持任务为 `sending`。不得把 outbox 或 dispatch 文件放回待处理根目录。

## 4. 进程重启、发送中断和 `processing` 遗留

- 正常重启会先扫描遗留 ACK，再读取 dispatch 根目录；`processed`、`failed`、`uncertain` 不会再次执行。
- 旧版本带时间戳前缀的终态 dispatch 也会按原始任务/attempt 文件名识别，不会因升级被重建。
- `processing` 文件表示已认领但没有可靠终态。即使现场认为进程“刚启动就崩了”，也不要将它移回根目录；先核对微信客户端真实记录。
- `uncertain` 表示 UI 自动化可能越过发送边界。它不会产生失败 ACK，也不能重发。
- 只有桥接器在触碰 UI 之前明确失败并生成受信 `failed` ACK，后端完成扫描后，原任务才进入可人工处置的失败状态。

如果现场确认消息已经发送，但没有受信 ACK，当前系统没有人工“标记成功”接口。应保留任务为 `sending`，恢复原始可信桥接证据后重扫 ACK；不能手工拼接 ACK。若现场确认消息未发送，应先通过现有取消流程关闭旧 attempt，再重新创建发送任务，不能直接重排结果未知的旧任务。

## 5. ACK 超时、outbox 缺失或 dispatch 过期

运行现有异常扫描：

```powershell
curl.exe -X POST http://127.0.0.1:3200/api/wechat/send-tasks/scan-ops
```

这些情况会写入：

- `status = sending`
- `guardSnapshot.deliveryState = unknown`
- `guardSnapshot.deliveryUnknownReason`
- `guardSnapshot.automaticRetryBlocked = true`
- 最新 `windows_bridge` attempt 继续为 `started`

这是保护状态，不是程序卡死。处理人必须先核对微信真实消息，再决定保留、取消或通过原始 ACK 恢复；不得直接调用重排接口。

进入该保护状态后，对应 outbox 会从 `bridge/outbox` 的 `pending` 列表移入 `ignored`（`delivery_unknown_retry_blocked`），根目录 dispatch 会隔离到 `uncertain`。因此重启普通 worker 不会重新领取；不要手工把这些文件放回根目录。

## 6. 状态文件半写和临时文件

状态、outbox、dispatch、ACK 和本地存储 JSON 采用“同目录临时文件写入，再原子重命名”。写入中断时，正式文件应保持上一代完整 JSON。形如 `.<原文件名>.<pid>.<uuid>.tmp` 的文件是未完成临时文件：

1. 先停止全部相关 worker。
2. 验证同名正式 JSON 可以完整解析。
3. 将孤立临时文件移到现场隔离目录，不要覆盖正式文件，也不要移入 outbox、dispatch 或 inbox 根目录。
4. 正式文件本身损坏时停止恢复，不要猜测缺失字段；从已验证备份或上游重新生成。

## 7. 队列头竞争和并发账号

- 同一微信账号一轮只处理队首一条任务；后续任务保持跳过。
- 不同账号可以并行，但各自持有独立锁。
- 锁文件过旧不等于可删除：活进程会持续心跳，只有锁所属进程已不存在时才会清理。
- 无法解析、缺少 PID 或缺少 owner token 的锁属于不确定状态，程序不会自动删除；必须先停 worker、核对进程和现场证据后再人工隔离。
- 不要为了“解卡”手动删除仍由活进程持有的锁。先用 `wechat:safe:status` 核对进程，再正常停止。

## 8. 验证命令

专项故障注入：

```powershell
$env:NODE_PATH='D:\zhinengkefu\desktop\node_modules'
node --test tests/wechat-restart-idempotency.test.js tests/personal-wechat-bridge.test.js tests/wechat-bridge-worker.test.js
```

全量测试和 API 构建仍应使用仓库既有命令；依赖安装完整的工作区可执行：

```powershell
npm.cmd test
npm.cmd run build:api
```

## 9. 故障注入证据矩阵

修复前首轮专项测试 12 项中仅 2 项通过、10 项失败；窗口身份绕过另以单项用例复现为 `pasteCalls: 1`，损坏过期锁另以单项用例复现为 `postCount: 1`。修复后的预期如下：

| 故障 | 修复前证据 | 加固后行为 |
| --- | --- | --- |
| 重复回调/msgid | 同一消息重复生成下游记录 | 账号内幂等；同 ID 内容冲突失败关闭 |
| 进程重启 | 同一 dispatch 再次执行 | 原子认领并终态归档，重启不重发 |
| 旧格式终态归档 | 时间戳前缀使重启查重漏判 | 同时识别精确名和旧前缀归档 |
| ACK 扫描失败 | dispatch 留在根目录并可重发 | ACK 持久保留，dispatch 终态归档，启动先重扫 ACK |
| 发送中断 | 生成 `failed` ACK，可再次入队 | 进入 `uncertain`，不写失败 ACK |
| 状态/存储半写 | 正式 JSON 被截断 | 临时写+原子重命名，保留上一代 |
| 队列锁竞争 | 仅按 mtime 可抢走活锁 | PID、token、心跳共同保护 |
| 损坏锁文件 | 无法解析的过期锁被删除并继续发送 | 锁状态不确定即保持占用，等待人工隔离 |
| 队列头竞争 | 同账号串行、不同账号并行原本正确 | 保持既有行为并加回归测试 |
| ACK 丢失/超时 | 任务转 `failed` 并可重排 | 保持 `sending/started`，标记 unknown 并禁止重排 |
| 重复 ACK | 首次成功后重放被拒绝 | 完全相同的受信 ACK 幂等返回 |
| ACK 提交中断 | 先归档证据，任务可能仍为 `sending` | 先写 ACK 提交意图和任务结果；同一 ACK 可续提完成 attempt 与归档 |
| 并发账号 msgid | 账号隔离原本正确 | 保持按账号隔离并加回归测试 |
| 窗口身份未知 | 遗留环境开关可绕过并触碰 UI | 遗留开关无效，三项身份不全匹配即失败关闭 |
| dispatch 已不在 API pending | 遗留指令仍会触碰 UI | 发送前复查六项身份；不匹配或 API 失败即 `uncertain` 且无失败 ACK |

## 10. 尚未满足的真实外部依赖

- 个人微信 PC 当前没有能返回账号、会话、客户三项受信实时身份的窗口验证器，因此生产真实粘贴发送保持关闭；仅靠人工提前打开聊天窗口不构成验证证据。
- 本地故障注入不能代替真实微信客户端的“发送动作已发生但进程立即崩溃”联调，需要真实桥接器提供可审计的发送边界与 ACK 持久化证据。
- PostgreSQL、Redis/BullMQ 的生产部署不在本地 JSON 故障注入覆盖内，仍需在真实部署环境做进程杀死、磁盘故障和并发恢复演练。
- 企业微信回调仍需要可公网访问的 HTTPS 地址和平台侧凭据/回调配置；本任务未触碰现有企业微信工作树改动。
