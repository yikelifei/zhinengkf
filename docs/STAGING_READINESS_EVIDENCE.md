# 预发布就绪与证据检查

`staging:readiness` 把生产发布门禁中的外部 `BLOCKED` 项转换为可重复、可审计的预发布检查。它复用现有配置 doctor、Prisma CLI 以及 API 已有的健康、企业微信、个人微信桥和设计平台只读接口，不建立第二套业务状态。

## 安全边界

默认命令只读取本地 `.env`、`desktop/.env`、设计平台运行时配置和 `config/settings.yaml`，不会访问网络：

```powershell
cd desktop
npm.cmd run staging:readiness
```

只有显式加入 `--execute` 才会访问预发布环境：

```powershell
$env:STAGING_API_BASE="https://staging-api.your-domain.cn/api"
npm.cmd run staging:readiness -- --execute
```

也可以直接指定 API：

```powershell
npm.cmd run staging:readiness -- --execute --api-base https://staging-api.your-domain.cn/api
```

`--execute` 固定只允许以下操作：

- `prisma migrate status --schema prisma/schema.prisma`，只读迁移状态，不执行 `migrate deploy`。
- 对现有 API 发出固定的 `GET` 请求：`/health`、`/wechat-work/status`、`/wechat-work/kf/audit`、`/integrations/design-platform/readiness`、`/wechat/channels/status`、`/wechat/bridge/status`、`/automation/status` 和 `/automation/readiness`。
- 汇总布尔值、数量和状态，不保存响应正文，不输出 Token、Cookie、数据库口令或 API Key。

它不会调用 `sync_msg`、`send_msg`、发送队列处理、设计任务提交、付款确认、数据库迁移部署或任何 `POST` 请求。读取受保护 API 时复用 `INTERNAL_API_TOKEN`，报告只记录“是否配置”。

## 运行前条件

预发布环境应通过密钥管理能力注入真实配置，不要把真实值写入仓库：

- `NODE_ENV=staging` 或 `production`，并显式设置 `USE_LOCAL_STORE=false`。
- PostgreSQL `DATABASE_URL` 使用独立应用账号；远程连接明确配置 `sslmode=require` 或更强校验。
- `INTERNAL_API_TOKEN` 已配置；非回环 API Base 必须使用 HTTPS。
- 企业微信 Corp ID、微信客服 Secret、Token、EncodingAESKey、`WECHAT_SEND_ADAPTER=wechat_work_kf` 和公网 HTTPS 回调地址完整。
- 真实设计平台使用 `art_image_local`，配置登录凭据、设备 ID；非回环 Base URL 必须使用 HTTPS。
- 个人微信账号绑定文件存在；RPA 端点只能是本机回环地址。检查本身不要求打开真实发送开关。
- AI provider 继续由现有 `config-readiness-doctor` 和 `core.api_config` 规则校验。
- 低价值自动化显式启用 `LOW_VALUE_AUTOMATION_ENABLED=1` 和 `LOW_VALUE_AUTOMATION_MODE=durable`，Redis URL 由密钥管理能力注入；报告只记录“是否配置”，不会记录 URL、账号或密码。

## 证据判定

- `PASS`：静态配置符合安全策略，或现有只读接口已经提供可重复证据。
- `BLOCKED`：缺少密钥注入、数据库连通/迁移状态、账号映射、历史回调/入站/受控队列审计，或渠道运行状态。
- `FAIL`：显式使用开发环境、本地 JSON 持久化、默认数据库管理员口令、不安全 URL、远程 RPA 端点，或检查工具本身故障。

企业微信 `PASS` 需要只读确认：API 配置就绪、Prisma 持久化、至少一个正式身份映射，以及历史的回调、入站和受控发送队列审计。检查不会为补证据而主动触发同步或发送。

个人微信 `PASS` 需要账号绑定、桥接 worker 就绪，且没有未审阅的 ignored/uncertain outbox、过期 dispatch 或过期锁。设计平台 `PASS` 需要现有 readiness 接口报告 `art_image_local` 且可正式生成，但不会提交设计任务。

BullMQ/Redis `PASS` 同时要求：配置 doctor 确认自动化已启用并请求 durable 模式；只读接口报告 `evidenceSource=bullmq_redis`；固定 queue 与 scheduler ID 正确；Redis 已配置且连接；scheduler 与 Worker 在线；本地及全局并发为 `1`；job template 为 `attempts=1`、`maxStalledCount=0`；持久 scheduler 存在且 Worker 数至少为 `1`。报告只保留这些固定标识、布尔值以及 waiting/active/delayed/completed/failed 五类计数，不保留 Redis URL、错误原文、最近任务 ID/result 或业务 payload。

## 报告与审计

报告固定写入已被 Git 忽略的目录：

```text
desktop/.runtime/staging-readiness-evidence/latest.json
desktop/.runtime/staging-readiness-evidence/latest.md
desktop/.runtime/staging-readiness-evidence/runs/<run-id>/report.json
desktop/.runtime/staging-readiness-evidence/runs/<run-id>/report.zh-CN.md
```

每次运行保留独立 run 目录，并包含执行模式、固定只读接口、状态、缺失证据和零外部写入声明。退出码与生产门禁一致：`PASS=0`、`FAIL=1`、`BLOCKED=2`。

报告 schema 为 `smart_kefu_staging_readiness_v2`，JSON 和 Markdown 都记录生成报告时的完整 Git `repositoryRevision`。无法取得合法的当前 `HEAD` 时失败关闭，不生成无来源的可用证据。外部证据包校验只接受与当前 `HEAD` 完全一致且 24 小时内生成的 `PASS` 执行报告；默认离线 inventory 仍为 `BLOCKED`。

建议顺序：先运行 `npm.cmd run release:gate` 清除代码与构建问题，再在隔离预发布环境执行本检查；两者都无 `FAIL` 且预发布报告无 `BLOCKED` 后，才进入人工发布评审。数据库备份/恢复演练、企业微信后台登记和授权操作员确认仍需作为变更单附件留存。
