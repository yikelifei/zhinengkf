# 低价值自动化持久调度

低价值业务规则仍只有一个入口：`AutomationService.runOnce`。BullMQ 只负责持久地安排该入口运行，不复制设计、报价、订单或发送规则。

## 模式

- `LOW_VALUE_AUTOMATION_MODE=interval`：单进程本地开发模式，使用进程内定时器；进程退出后不保留调度。生产环境显式选择 interval 会被判为无效并拒绝启动。
- `LOW_VALUE_AUTOMATION_MODE=durable`：生产模式，必须配置 `LOW_VALUE_AUTOMATION_REDIS_URL`。`NODE_ENV=production` 未显式给出模式时默认选择 durable；Redis 缺失或不可连接会让 API 启动失败，禁止静默回退到 interval。
- `LOW_VALUE_AUTOMATION_ENABLED=0`：完全关闭自动化调度。

生产示例（真实 URL 由密钥管理服务注入，不写入仓库或报告）：

```text
NODE_ENV=production
LOW_VALUE_AUTOMATION_ENABLED=1
LOW_VALUE_AUTOMATION_MODE=durable
LOW_VALUE_AUTOMATION_REDIS_URL=redis://user:password@redis.internal:6379/0
LOW_VALUE_AUTOMATION_INTERVAL_MS=15000
```

## 并发、锁与发送边界

- 固定 scheduler ID，通过 BullMQ `upsertJobScheduler` 跨进程幂等创建/更新，不重复累积定时任务。
- Queue 全局并发与每个 Worker 的本地并发均固定为 `1`，由 Redis/BullMQ 锁保证同一队列跨进程只有一轮在执行。
- Worker 保持锁续租，`maxStalledCount=0`，job template 固定 `attempts=1`。队列不会自动重试发生异常或进程中断的自动化轮次。
- 微信/企微的未知或部分投递仍沿用现有发送任务状态机 fail-closed；BullMQ 不把业务动作拆成可独立重放的发送 job。
- Nest 关闭时先 `Worker.close()` 等待当前任务结束，再关闭 Queue；正常进程关闭不会删除全局 scheduler。只有操作员调用“停止自动化”接口才移除 scheduler。

## 状态与持久证据

`GET /api/automation/status` 在 durable 模式返回：

- 模式、是否配置（只返回布尔值）、连接/Worker/scheduler 状态；
- 固定 queue/scheduler 名、`attempts=1`、本地和全局并发；
- Redis 中的 waiting/active/delayed/completed/failed 数量；
- 最近完成或失败 job 的时间与精简结果。

URL、用户名、密码、错误原文和业务 payload 不进入状态响应。BullMQ job/result 是 durable 模式下跨进程保留的调度证据；本地 JSON 的 `recentRuns` 仅保留兼容展示，不是生产唯一证据，也不新增 Prisma schema。状态使用稳定字段 `evidenceSource=bullmq_redis` 标记生产证据；interval 模式则为 `local_store_interval`。

`POST /api/automation/run-once` 仍是操作员显式触发的直接执行入口，不进入 BullMQ，也不计作 durable queue 证据；状态响应用 `manualRunEvidence=direct_execution_not_bullmq_job` 明示这一边界。

`GET /api/automation/readiness` 会把 Redis 连接、Worker 和 scheduler 证据作为 error 级阻塞项。配置静态检查使用：

```bat
config-readiness-doctor.cmd --json
```

本地门禁会把真实 Redis 连通性保留为 `BLOCKED`。在隔离预发布环境核验 Redis ACL/持久化、唯一 scheduler、global concurrency=1、Worker count、故障告警和脱敏状态响应后，才能清零该项。
