# 产品级端到端验收矩阵

本验收入口复用现有 NestJS API、Next.js Web、本地 JSON 数据层、模拟设计平台、微信发送队列、个人微信桥接、企业微信回调、自动化服务和 CRM 测试，不创建平行接口。

## 一键执行

在仓库根目录运行：

```bat
tools\quality\run_product_acceptance.bat
```

也可在 `desktop` 目录运行：

```bat
npm.cmd run acceptance:e2e
```

默认模式是 `local-safe`。每次运行使用独立的端口、local-store、runtime、微信桥接目录和设计平台配置，不覆盖开发数据。JSON 与中文 Markdown 报告会写入 `desktop/.runtime/acceptance/<run-id>/`。

## 三种模式

| 模式 | 覆盖范围 | 外部副作用 |
| --- | --- | --- |
| `mock` | API/Web/模拟设计平台启动、身份隔离、入站、设计任务、自动化规则、390px 布局 | 无 |
| `local-safe` | 包含 `mock`，并增加人工安全入队、企微本地 AES 回调、个人微信 dispatch/no-send、CRM 与合同回归 | 无 |
| `real-external` | 只读探测真实设计平台、企微配置、个人微信桥接就绪度 | 必须显式授权；仍不发送、不付款 |

指定模式：

```bat
npm.cmd run acceptance:e2e -- --mode mock
npm.cmd run acceptance:e2e -- --mode real-external --allow-external-readiness --api-base http://127.0.0.1:3200/api
```

`real-external` 不负责启动生产配置服务，要求操作者先在本机启动目标 API，并只调用健康或状态类只读接口。未传 `--allow-external-readiness` 时会以“阻塞”退出。

## 安全边界

运行器固定使用 loopback 地址，并强制：

- `PERSONAL_WECHAT_SEND=0`
- `PERSONAL_WECHAT_BRIDGE_AUTO_ENTER=0`
- `BRIDGE_MODE=noop`
- `LOW_VALUE_AUTOMATION_PROCESS_SEND_QUEUE=false`

运行期间禁止调用企业微信发信、bridge ack/mark-sent、付款确认和旧版直接操作微信的 `/api/chat/send`。HTTP 请求保护层遇到这些路径会立即失败并记入机器报告。个人微信只验证 outbox → dispatch → observe-and-skip，无 ack、无 sent。

当前人工自由文本的安全入队验收复用现有 `/api/wechat/send-tasks/demo` 夹具。旧版 `/api/chat/send` 带有直接操作微信的行为，因此不会被默认验收调用。企业微信合法回调使用运行时测试密钥构造 AES 消息，并复用现有入站分发；外部用户到正式客户/会话的映射仍属于真实接入依赖。

## 报告与退出码

- `product-acceptance-report.json`：机器可读报告，包含矩阵版本、环境、安全策略、每个场景状态、证据、阻塞项和产物路径。
- `product-acceptance-report.zh-CN.md`：中文摘要。
- `layout-390.json`、`layout-390.png`：390px Chromium 渲染断言与截图。
- `logs/*.log`：API、Web 和模拟设计平台日志。

严格模式退出码：`0` 表示所选场景全部通过，`1` 表示失败，`2` 表示存在未满足的真实依赖或主动跳过项。可用 `--no-strict` 让“阻塞”不改变退出码，但报告仍保留阻塞状态。

矩阵源文件是 `desktop/config/product-acceptance-matrix.json`。新增产品能力时，应先扩展矩阵和现有服务合同测试，再增加运行器处理器；不得为验收另造业务接口。
