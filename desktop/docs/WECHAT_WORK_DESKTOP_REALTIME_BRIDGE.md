# 企业微信客服桌面实时内置

目标是让企业微信的“微信客服”会话直接出现在臻希智能客服工作台，并在工作台内回复。现在桌面端保留两条互不混写的链路：

1. `/conversations` 使用企业微信官方回调、`sync_msg` 和 `send_msg`，负责客户身份、自动回复、发送审计和可持久化会话。
2. `/integrations/wechat-work/workspace` 把本机已登录的 `WXWork.exe` 原生主窗口可逆地承载在智能客服桌面壳内，负责原生消息实时直显。

原生窗口承载不抓取消息、不模拟键鼠、不读取登录凭据，也不能替代官方 API 同步。离开内置页面或退出智能客服时，桌面端恢复企业微信原来的父窗口、窗口样式、位置和显示状态。

## 数据流

1. 企业微信把 `kf_msg_or_event` 推送到 `https://kefu.zhenxiliye.cn/api/wechat-work/callback`。
2. 生产 API 完成签名校验和 AES 解密，并立即通过鉴权 SSE 发出“有新事件”提示。
3. 桌面 API 订阅提示，使用本地已有企业微信凭据和持久游标，经生产服务器固定出口调用官方 `sync_msg`；企业微信不再看到桌面动态公网 IP。
4. 会话和客户身份写入桌面本地存储，工作台现有 2 秒界面刷新负责显示；原生企业微信工作台不依赖该刷新周期。
5. 工作台回复继续通过同一固定出口调用 `kf/send_msg`；15 秒自动同步只作为断线兜底，也必须经过固定出口。

实时提示只包含 `eventId`、`openKfid` 和时间，不包含客户消息、回调 Token、AESKey、Secret 或 API access token。

## 生产服务器配置

生成一枚只用于事件流的独立 64 位十六进制令牌，不得复用 `INTERNAL_API_TOKEN`、企业微信回调 Token 或只读 readiness Token：

```text
WECHAT_WORK_EVENT_STREAM_EXPORT_TOKEN=<64 位十六进制随机值>
WECHAT_WORK_CALLBACK_PROCESSING_MODE=signal_only
```

生产 Nginx 还要提供仅转发到 `https://qyapi.weixin.qq.com` 的 `/wecom-api/` 固定出口，使用独立令牌鉴权，清除转发给上游的鉴权头，并关闭此路径访问日志，避免 `corpsecret` 或 `access_token` 出现在查询串日志里。`signal_only` 保证生产回调只发布事件提示，不再与桌面重复调用 `sync_msg`。

把生产服务器实际公网出口 IP（不是只看域名 A 记录）加入产生当前微信客服 Secret 的“企业可信 IP”。

## 桌面配置

在桌面运行环境配置同一枚事件流令牌：

```text
WECHAT_WORK_REMOTE_EVENT_URL=https://kefu.zhenxiliye.cn/api/wechat-work/events/stream
WECHAT_WORK_REMOTE_EVENT_TOKEN=<与服务器一致的 64 位十六进制随机值>
WECHAT_WORK_API_BASE_URL=https://kefu.zhenxiliye.cn/wecom-api
WECHAT_WORK_API_RELAY_TOKEN=<与生产 Nginx 一致的独立 64 位十六进制随机值>
WECHAT_WORK_CALLBACK_PROCESSING_MODE=process
```

令牌只注入桌面 API 进程，不能写入 Next.js 公共环境变量，也不能发送到浏览器。

## 验收

从标准桌面运行目录执行固定出口部署（脚本会创建服务器 release、环境和 Nginx 备份；匿名访问必须为 403）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\deploy-wechat-fixed-egress.ps1
```

如果输出 `FIXED_EGRESS_PREPARED=true` 和 `TRUSTED_IP_REQUIRED=<IP>`，先把该 IP 加到企业微信可信 IP，再重新执行同一命令。只有官方账号诊断成功后，脚本才把生产回调切为 `signal_only`，避免部署中途失去消息同步能力。

1. `GET /api/wechat-work/events/status` 显示 `configured=true`、`connected=true`。
2. 未带正确事件流令牌访问公网 SSE 路径返回 `403`。
3. 测试客户从微信端发送一条唯一文本。
4. 生产审计出现 `callback_accepted`；桌面审计出现 `remote_callback_signal_received`、`inbound_processed`。
5. 生产审计出现 `callback_sync_delegated`，且同一个回调不出现生产服务器和桌面各一次 `sync_msg`。
6. 企业微信错误日志里的 `from ip` 必须是已加入可信 IP 的生产服务器出口，不得再是桌面公网 IP。
7. 臻希工作台出现真实客户昵称、头像和刚发送的唯一文本，目标是 1 至 3 秒可见。
8. 从臻希工作台回复一条唯一文本，审计出现官方发送成功记录；只有手机微信端实际收到后，才算完整闭环通过。

原生内置另做桌面验收：打开 `/integrations/wechat-work/workspace` 后应检测到当前 `WXWork.exe`，企业微信窗口只出现在页面承载区；进入其他页面或退出智能客服后，企业微信应恢复为原来的独立窗口。该验收只证明原生窗口承载和实时直显，不证明 API 数据已经同步。

本地构建、自动化测试、端口健康或公网 SSE 可访问都不能替代第 3 至 6 步的真实验收。

## 回滚

1. 从桌面环境移除 `WECHAT_WORK_REMOTE_EVENT_URL` 和 `WECHAT_WORK_REMOTE_EVENT_TOKEN`，重启桌面 API；15 秒安全同步继续兜底。
2. 从生产环境移除 `WECHAT_WORK_EVENT_STREAM_EXPORT_TOKEN`，恢复 Nginx 备份，执行 `nginx -t` 后 reload。
3. 不删除任何客户、会话、游标、发送尝试或企业微信审计记录。
4. 原生窗口内置异常时，先离开内置页面或退出智能客服；宿主进程会在标准退出和输入管道断开时恢复企业微信窗口。
