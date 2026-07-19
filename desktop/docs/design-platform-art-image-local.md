# 真实设计平台出图适配

默认仍然使用本项目自带的 `/v1` mock 设计平台，不影响本地演示。

如果要接入 `C:\Users\27808\Desktop\art image-new\web` 这个真实设计平台，先启动真实设计平台，再启动客服平台 API 时设置：

```bat
set DESIGN_PLATFORM_ADAPTER=art_image_local
set DESIGN_PLATFORM_BASE_URL=http://127.0.0.1:3000
```

也可以直接在项目根目录运行：

```bat
run_desktop_real_design.bat
```

这个脚本会把客服平台重启到真实设计平台适配模式，并让 API 指向 `http://127.0.0.1:3000`。如果真实设计平台不是 3000 端口，先在当前命令行设置 `DESIGN_PLATFORM_BASE_URL` 再运行脚本。

如果你的真实设计平台改过端口，就把 `DESIGN_PLATFORM_BASE_URL` 改成实际端口。

真实设计平台已有接口不是 `/v1/design-jobs`，而是：

- `GET /api/health`：检查真实设计平台和 AI 配置。
- `POST /api/local-assets`：客服平台把客户 Logo、参考图、SKU 图上传过去，换成真实设计平台自己的 `/local-assets/...` 地址。
- `POST /api/local-generate`：客服平台把礼盒组合、预算、场景、客户原话和素材地址翻译成真实产品摆拍出图请求。

如果真实设计平台要求登录/激活，`/api/local-generate` 会返回未登录或未激活错误。此时不要绕过它，应该在真实设计平台里登录账号，或后续给真实设计平台补一个正式的 API Key 服务接口。

可选配置：

- `DESIGN_PLATFORM_COOKIE`：把真实设计平台当前登录 cookie 传给客服平台，用于本机联调需要登录的 `/api/local-generate`。
- `DESIGN_PLATFORM_ACCESS_TOKEN`：如果不想传完整 cookie，可以传设计平台登录后的 access token，客服平台会用 `Authorization: Bearer ...` 调用设计平台。
- `DESIGN_PLATFORM_DEVICE_ID`：真实设计平台激活设备 ID。正式出图会先检查 `/api/activation/status`，缺少或未激活时不提交任务。
- `DESIGN_PLATFORM_TIMEOUT_MS`：单次真实出图请求等待时间，默认 30 分钟。
- `DESIGN_RESULT_POLL_INTERVAL_MS`：客服平台轮询出图结果间隔，默认 5 秒。
- `DESIGN_RESULT_POLL_MAX_MS`：客服平台轮询最长等待时间，默认 20 分钟。
- `DESIGN_PLATFORM_IMAGE_SIZE`：默认 `1024x1024`。
- `DESIGN_PLATFORM_IMAGE_RATIO`：默认 `1:1`。
- `DESIGN_PLATFORM_CARD_TYPE`：默认 `礼盒真实产品摆拍`。

客服平台内部仍然保存结构化需求、礼盒组合、候选图、客户选择、反馈和修改记录，不保存设计平台生成的提示词。

## 出图执行持久化与重启恢复

`art_image_local` 的 `/api/local-generate` 是一次可能持续很久的同步请求，而且远端会在生成前扣费。客服平台现在用独立的 `DesignPlatformExecution` 记录每一次尝试，不再把进程内 Map 当作状态事实源：

生产模式的执行事实只写入并读取 Prisma/PostgreSQL，事务和 CAS 覆盖 begin、outcome、恢复与验收提交；`LocalStore` 仅用于单进程本地演示/测试，不承诺跨进程锁语义，也不会作为生产失败时的回退。

- 每次尝试先原子写入 execution 与设计任务/改图任务的 `submitted` 状态，再依次 CAS 为 `dispatching`、`generating`，最后才允许 POST。
- `operationKey`、`externalJobId` 和远端 `requestId` 对同一次尝试稳定且唯一；重复提交只复用同一 execution，不会再发一次 POST。新的显式重试使用新的 `attemptNo` 和 requestId。
- execution 只保存图片元数据、退款摘要、错误分类和时间戳；不保存 prompt、customerText、Cookie、token、密码、Authorization 或图片二进制。
- timeout、`ECONNRESET`、HTTP 5xx、畸形 2xx，以及进程重启时仍处于 `dispatching/generating` 的旧执行，一律记为 `outcome_unknown` 并转人工，普通重试会被拒绝。
- 通用 20 分钟任务超时扫描不会覆盖仍处于 `prepared/dispatching/generating` 或本地验收中的 durable execution；是否超时及能否重试只由 execution 的 HTTP outcome、恢复租约和人工核销状态决定。
- 机器明确返回“全部失败”时使用 `explicit_failed`；只有退款状态为 `refunded`、`not_required` 或 `credit_bypass` 才保留原有“至多自动重试一次”策略。退款失败或未知必须人工处理。
- 已完成但 `acceptanceStatus=pending` 的执行会在重启后继续本地验收，不会重新调用生成接口。任务取消或旧 revision 的迟到结果会被拒收。
- API 生命周期会在启动后异步立即协调并按独立间隔持续恢复，不依赖低价值自动化、目录 readiness 或人工调用轮询；启动监听不会等待最长 30 分钟的远端同步请求。同一进程用 Promise 互斥，跨实例仍由 execution CAS 抢占。
- 取消进行中的执行先落 `cancel_requested`。远端同步请求无法真正中止时，迟到成功、失败或未知结果的图片、退款摘要和 HTTP 状态会继续白名单落到 execution，但一律 `acceptanceStatus=rejected`，业务任务保持 cancelled，不创建候选图、不自动重试；无迟到结果的旧取消执行在恢复租约后转为 rejected 的对账未知态。

未知结果人工核销使用 `POST /api/design-jobs/:id/executions/:executionId/resolve-unknown`。请求必须携带与设计任务一致的账号/客户/会话期望身份和精确的 `resolution=confirmed_not_generated_refunded`；reviewer 由通过鉴权的服务端操作员上下文提供。接口只在人工确认“没有生成且已退款”后解除 unknown 对后续显式重试的阻塞，并写审计和通知。

远端明确失败但退款状态为 `failed/unknown` 时，必须先核对退款实际到账，再调用 `POST /api/design-jobs/:id/executions/:executionId/resolve-refund`，携带相同的期望身份和 `resolution=confirmed_refunded`。该接口把退款事实更新为 `refunded` 并用可信操作员身份写审计；仅写 `resolvedAt` 不能解除阻塞。两类核销都不得通过普通“重试”按钮绕过，客服 UI 入口仍列入下一轮。

所有可能发起、恢复、取消真实生成或解除重试阻塞的 HTTP 路由都要求内部会话 token 和 `manage_design_executions` 能力；该能力仅授予 admin/supervisor。核销 reviewer 只取服务端 `TrustedOperator.id`，请求体中的同名字段会被丢弃。后台生命周期直接调用 service，不依赖 HTTP guard。
