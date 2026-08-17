# 臻希 AI 授权诊断与正式出图前置验收

本说明用于臻希智能客服调用臻希 AI 出图前的授权验收。客服项目只把臻希 AI 作为图片生成后端；本诊断流程只读检查，不自动调用正式生成接口。

## 2026-07-30 联调结论

当前两套软件的基础链路已经连上，真正阻塞点不是域名备案，也不是客服误连服务器地址，而是臻希 AI 的本机授权链路尚未完成。

- 臻希 AI 源码目录：`E:\art image-new\web`，当前 `package.json` 版本为 `0.1.30`。
- 当前实际可达端口：`http://127.0.0.1:3000`，进程来源是 `E:\art image-new\web\node_modules\next\dist\server\lib\start-server.js`。
- 客服 Web/API：`http://127.0.0.1:3100/`、`http://127.0.0.1:3200/api/health`。
- 客服设计适配器：`art_image_local`，当前指向 `http://127.0.0.1:3000`。
- 桌面打包版臻希 AI 的候选端口是 `31870-31879`，本次探针全部 `ECONNREFUSED`，说明当前没有运行打包桌面端服务。
- 本次 `npm.cmd run zhenxi:connection -- --json` 结果是 `CONNECTED_BLOCKED`：健康检查通过，但缺少客服运行时绑定的 `deviceId`，设备未激活，账号未登录。

因此下一步不是改端口，也不是新造接口，而是完成：

1. 在客服 `/design/settings` 选择或确认 `http://127.0.0.1:3000`。
2. 在客服 `/design/activation` 生成或填写同一台机器的设备 ID。
3. 到臻希 AI 管理员后台生成激活码，然后回到客服 `/design/activation` 激活设备。
4. 在客服 `/design/account` 登录臻希 AI 账号。
5. 重新运行 `npm.cmd run zhenxi:connection -- --json`，直到 `readyForFormalGeneration=true`。
6. 通过客服里的设计任务正式触发出图，不能通过诊断工具直接触发出图。

## 本轮新增：候选端口自动探测

客服 API 新增受操作员权限保护的 `GET /integrations/design-platform/candidates`，用于探测臻希 AI 本地候选端口。它只读取客服运行时配置里的 `zhenxiAi.localCandidateBaseUrls`，不接受前端传入任意 `baseUrl`。

- 只探测显式本机回环地址，例如 `http://127.0.0.1:31870` 到 `http://127.0.0.1:31879`、`http://127.0.0.1:3000`、`http://127.0.0.1:3001`。
- 每个候选只调用 `GET /api/health`，不会调用 `POST /api/local-generate`，不会消耗额度。
- 探测请求不携带 `Authorization`、Cookie、`x-art-device-id` 等臻希 AI 凭据。
- `/design/settings` 会显示每个候选端口的在线/未启动/当前状态；点击候选端口只填入配置表单，仍需要人工确认保存。
- 端口在线只代表服务可达；如果仍显示 401/403，下一步优先检查设备激活、账号登录、模板权限和额度，而不是继续换端口。

## 接入方案取舍

短期上线方案使用客服项目现有的 `art_image_local` 适配器：

- 上传本地商品图/素材到臻希 AI：`POST /api/local-assets`。
- 正式出图：`POST /api/local-generate`。
- 由客服的 `DesignPlatformExecutionService` 做持久化执行、结果验收、退款/未知结果保护、重启恢复。
- 适合当前同一台电脑同时运行“臻希智能客服”和“臻希 AI 开发版/桌面端”的场景。

长期可扩展方案是新增第二个适配器使用臻希 AI 外部接口：

- 正式外部接口：`POST /api/external/v1/images/generate`。
- 优点是契约更像独立软件之间的 API：Bearer key、multipart 文件、强制 `requestId` 幂等、项目/素材/输出持久化。
- 代价是必须配置 `ART_EXTERNAL_API_KEY`，并且臻希 AI 桌面端要先登录并写入 active external user；同时还要通过 Supabase 账号、设备激活、模板权限、积分校验。
- 这个方案适合以后做更标准的跨软件接口，不适合作为今天修 401/403 的最短路径。

当前产品落地策略：先把 `art_image_local` 跑通到真实设计任务出图；备案和企业微信正式接入完成后，再评估是否把 `/api/external/v1/images/generate` 做成可切换的生产适配器。

## 已核对的真实接口

源码只读参考位置：`E:\art image-new\web`。

- `GET /api/health`：检查臻希 AI 服务和运行状态。
- `GET /api/activation/status`：检查当前设备 ID 是否存在、是否已激活。
- `POST /api/activation/redeem`：使用激活码激活设备。
- `POST /api/auth/login`：使用已激活设备登录账号。
- `GET /api/auth/session`：检查当前 token/cookie 是否有效。
- `POST /api/local-generate`：正式出图入口；诊断工具严禁自动调用。
- `POST /api/external/v1/images/generate`：臻希 AI 对外图片生成接口；需要本机请求、Bearer key、已登录 active external user、设备激活、模板权限和积分。

## 诊断命令

在 `E:\zhinengkefu\desktop` 运行：

```powershell
npm.cmd run zhenxi:connection -- --json
```

如果需要只读复查某个设备 ID 的激活状态：

```powershell
npm.cmd run zhenxi:connection -- --device-id <设备ID> --json
```

`--device-id` 只影响本次只读检查，不会写入运行时配置。输出只展示设备后缀，不展示完整设备 ID、token、cookie 或密码。

## 状态解释

- `zhenxi.health=PASS`：端口和 `/api/health` 正常。
- `zhenxi.device_id=BLOCKED`：客服运行时还没有设备 ID，先去 `/design/activation` 或 `/design/settings` 绑定。
- `zhenxi.activation=BLOCKED`：设备未激活、激活过期、账号/设备绑定冲突，先去 `/design/activation` 处理。
- `zhenxi.auth=BLOCKED`：还没有登录，或登录凭证失效；设备激活后去 `/design/account` 登录。
- `zhenxi.generation=NOT_RUN`：诊断工具没有跑正式出图，这是正确行为。

整体状态含义：

- `FAILED`：端口或接口不可用，先修 `/design/settings` 的连接配置。
- `CONNECTED_BLOCKED`：臻希 AI 已连通，但授权、激活或登录还没完成。
- `READY`：健康、设备 ID、激活、登录都通过，可以进入人工批准的真实设计任务。

## 页面路径

- `/design/settings`：确认 `art_image_local`、`http://127.0.0.1:3000`、连接健康、运行时凭证摘要。
- `/design/activation`：生成/填写设备 ID，使用管理员激活码激活设备。
- `/design/account`：设备激活后登录臻希 AI 账号。

## 正式出图前置验收

允许提交真实出图前必须同时满足：

- `zhenxi.health=PASS`
- `zhenxi.device_id=PASS`
- `zhenxi.activation=PASS`
- `zhenxi.auth=PASS`
- 诊断报告中 `readyForFormalGeneration=true`
- 诊断报告中 `formalGenerationRun=false`

满足以上条件后，正式出图仍应通过客服系统里的设计任务和人工审核流程触发，不通过诊断工具触发。

## 仍需用户提供的外部条件

- 臻希 AI 可用账号和密码。
- 管理员生成的设备激活码。
- 当前机器稳定的设备 ID。
- 臻希 AI 本地开发版或桌面端已启动，并确认实际端口是 `3000` 或指定的可用端口。
## 本轮确认：Device ID propagation

客服端只复用臻希 AI 已确认的设备机制，不新增臆造接口：

- `/design/activation` 和 `/design/account` 刷新状态时，会把页面中已输入或本地记住的 `deviceId` 传给客服 API 的 `/integrations/design-platform/readiness?deviceId=...`。
- 客服 API 再把该值作为 `x-art-device-id` 传给臻希 AI 的 `GET /api/activation/status` 和 `GET /api/auth/session`。
- `POST /api/activation/redeem` 和 `POST /api/auth/login` 同时在请求体里传 `deviceId`，并设置同一个 `x-art-device-id` 请求头。
- 正式出图 `POST /api/local-generate` 不接收页面临时设备号，只使用运行时已绑定到当前臻希 AI baseUrl 的 `DESIGN_PLATFORM_DEVICE_ID` / runtime config；这样避免未激活设备绕过前置检查。
- 诊断和页面刷新均不调用 `/api/local-generate`，不会消耗额度。
