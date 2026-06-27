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
