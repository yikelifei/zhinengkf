# 产品级端到端验收矩阵

本验收入口复用现有 NestJS API、Next.js Web、本地 JSON 数据层、模拟设计平台、微信发送队列、企业微信回调、自动化服务和 CRM 测试，不创建平行接口。

## 一键执行

在仓库根目录运行：

```bat
tools\quality\run_product_acceptance.bat
```

也可在 `desktop` 目录运行：

```bat
npm.cmd run acceptance:e2e:local-safe
```

默认模式是 `local-safe`。每次运行使用独立的端口、local-store、runtime、企业微信回调/发送运行目录和设计平台配置，不覆盖开发数据。JSON 与中文 Markdown 报告会写入 `desktop/.runtime/acceptance/<run-id>/`。

生成上线交接包：

```bat
npm.cmd run delivery:windows-package-preflight
npm.cmd run delivery:handoff
```

交接包汇总最近一次产品验收、生产发布门禁和完成度审计，输出到 `desktop/.runtime/delivery-handoff/latest.zh-CN.md`。若本地实现已验证但缺少签名、预发布、真实企微/设计平台或数据库恢复证据，状态必须保持 `BLOCKED`，不能伪装成正式可发布。

## 本地交付判定

备案等待期间可以继续关闭本地交付证据，但不能伪造外部证据。判断顺序如下：

1. `npm.cmd run project:completion:audit` 必须保持 `FAIL=0`。如果状态是 `local_verified_external_blocked`，说明仓库内审计通过，剩余阻断来自真实签名、预发布、真实渠道或数据库恢复演练证据。
2. `npm.cmd run acceptance:e2e:local-safe` 必须生成最近一次 `local-safe` 报告，且 `failed=0`、`blocked=0`。`mock` 只能证明本地模拟链路，不能当成交付验收。
3. `npm.cmd run delivery:windows-package-preflight` 只能证明本地打包前置项，不等于正式签名安装包验收。
4. `npm.cmd run delivery:handoff` 会汇总本地证据、发布候选改动范围和外部阻断，输出 `localDeliveryVerdict`。`productionReleaseAllowed=false` 时不能发正式版本。
5. `npm.cmd run delivery:freeze-plan` 只生成分支冻结计划，不会 staging、不会签名、不会发消息、不会改数据库。

外部阻断只能用真实证据关闭：企业代码签名和目标 Windows 安装/卸载报告、ICP/HTTPS 预发布环境、企业微信真实回调与受控收发验收、臻希 AI 授权 readiness、隔离数据库恢复演练。缺这些证据时，报告保持 `BLOCKED` 是正确状态，不是残次品或代码缺口。

## 三种模式

| 模式 | 覆盖范围 | 外部副作用 |
| --- | --- | --- |
| `mock` | API/Web/模拟设计平台启动、身份隔离、入站、设计任务、自动化规则、390px 布局 | 无 |
| `local-safe` | 包含 `mock`，并增加人工安全入队、企微本地 AES 回调、CRM 与合同回归 | 无 |
| `real-external` | 只读探测真实设计平台和企微配置就绪度 | 必须显式授权；仍不发送、不付款 |

指定模式：

```bat
npm.cmd run acceptance:e2e:mock
npm.cmd run acceptance:e2e -- --mode real-external --allow-external-readiness --api-base http://127.0.0.1:3200/api
```

`real-external` 不负责启动生产配置服务，要求操作者先在本机启动目标 API，并只调用健康或状态类只读接口。未传 `--allow-external-readiness` 时会以“阻塞”退出。

## 安全边界

运行器固定使用 loopback 地址，并强制：

- `BRIDGE_MODE=noop`
- `LOW_VALUE_AUTOMATION_PROCESS_SEND_QUEUE=false`

运行期间禁止调用企业微信发信、bridge ack/mark-sent、付款确认和旧版直接操作微信的 `/api/chat/send`。HTTP 请求保护层遇到这些路径会立即失败并记入机器报告。

当前人工自由文本的安全入队验收调用真实会话人工回复接口 `/api/wechat/conversations/:id/manual-replies`，只验证 `manual_reply` 任务入队、三元身份绑定和零发送 attempt。旧版 `/api/chat/send` 带有直接操作微信的行为，因此不会被默认验收调用。企业微信合法回调使用运行时测试密钥构造 AES 消息，并复用现有入站分发；外部用户到正式客户/会话的映射仍属于真实接入依赖。

销售验收允许检查内部 `PaymentEvent` 台账字段、幂等键和页面输入合同；这只代表人工核验凭证被记录，不代表已接入真实支付渠道、银行到账、退款、结算或外部对账回调。

订单履约验收必须覆盖生产状态合法流转、发货事实和签收/交付事实；不能只把订单状态改成 `fulfilled` 就算完成。

数据库恢复演练上线前必须由数据库负责人提供外部证据：独立 rehearsal/sandbox PostgreSQL 目标库、源库与演练库不同身份、`pg_dump`/`pg_restore`/`prisma migrate status` 执行记录、恢复后表数量和已应用迁移数量一致的脱敏报告。离线计划或本地 mock 只能证明流程设计，不允许关闭生产发布阻塞。

## 报告与退出码

- `product-acceptance-report.json`：机器可读报告，包含矩阵版本、环境、安全策略、每个场景状态、证据、阻塞项和产物路径。
- `product-acceptance-report.zh-CN.md`：中文摘要。
- `layout-390.json`、`layout-390.png`：390px Chromium 渲染断言与截图。
- `logs/*.log`：API、Web 和模拟设计平台日志。

严格模式退出码：`0` 表示所选场景全部通过，`1` 表示失败，`2` 表示存在未满足的真实依赖或主动跳过项。可用 `--no-strict` 让“阻塞”不改变退出码，但报告仍保留阻塞状态。

矩阵源文件是 `desktop/config/product-acceptance-matrix.json`。新增产品能力时，应先扩展矩阵和现有服务合同测试，再增加运行器处理器；不得为验收另造业务接口。
