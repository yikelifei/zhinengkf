# 统一配置体检

`config-readiness-doctor` 是只读配置检查。它复用现有的 `config/settings.yaml`、根目录和 `desktop` 下的 `.env` / `.env.example`、Nest 默认值、设计平台运行时配置，以及微信桥、企微客服和 AI provider 的既有状态语义。

它不会创建新的密钥文件，不会把密钥复制到报告，也不会请求外部接口。报告中的敏感配置只显示“是否已配置”，缺项只显示配置项名称。

## 运行方式

项目根目录的 Windows 入口：

```bat
config-readiness-doctor.cmd
config-readiness-doctor.cmd --json
config-readiness-doctor.cmd --json --output reports\config-readiness.json
```

`desktop` npm 入口：

```bat
cd desktop
npm.cmd run config:doctor
npm.cmd run config:doctor -- --json
npm.cmd run config:doctor -- --json --output ..\reports\config-readiness.json
```

运行前应按仓库现有方式安装 `requirements.txt`；Windows 入口继续复用 `tools\_run_python_task.bat` 的 Python 选择逻辑。

退出码：全部组件配置就绪时为 `0`，存在 `blocked` 时为 `2`。`blocked` 是可用于 CI/交付门禁的真实结果，不会为了方便而返回成功。

## 报告范围

固定检查七个组件：

| 组件 | `ready` 条件 | 常见 `blocked` 原因 |
| --- | --- | --- |
| Nest API | `API_PORT` 可用；默认 `3200` | 端口格式或范围错误 |
| Next.js Web | `WEB_PORT` 可用且不和 API 重复；默认 `3100` | Web 端口无效、和 API 冲突、显式 `WEB_URL` 无效 |
| 数据库 | 默认 `USE_LOCAL_STORE=true` 的本地 JSON 模式直接可用；Prisma 模式要求 PostgreSQL `DATABASE_URL` | 关闭本地存储后没有 PostgreSQL 连接串 |
| 个人微信桥 | 沿用 `windows_bridge`、托管启动、真实发送、未验证窗口授权和自动回车开关 | 仍处于 `dry_run`，或任一显式安全开关未打开 |
| 企微客服 | 沿用 `/api/wechat-work/status` 的 corpId、agentId、secret、token、AES key、openKfid、默认会话语义 | 任一必需项缺失，或 AES key 不能解码为 32 字节 |
| 设计平台 | `standard_v1` 只要求合法 Base URL；`art_image_local` 还要求登录凭据和设备 ID | 适配器/Base URL 无效，或真实平台凭据/设备缺失 |
| 模型链路 | 沿用 `ai_engine.primary + fallback_chain` 和 `core.api_config.validate_provider_config`；至少一个实际尝试的 provider 可用 | AI 被关闭，provider 缺 API Key/Base URL/模型，或没有可执行 provider |

`ready` 只表示配置已具备启动条件，不表示外部服务当前在线。JSON 固定带有：

```json
{
  "scope": "configuration-only",
  "liveChecksPerformed": false
}
```

运行时连通性继续复用现有能力：API 用 `/api/health`，Web 访问 `http://127.0.0.1:3100/`，设计平台用 `/api/integrations/design-platform/readiness`，个人微信桥用 `npm.cmd run wechat:personal:status`，企微用 `/api/wechat-work/status`。模型 provider 的真实联网验证仍由现有 provider 测试/健康检查承担。

## 密钥边界

- 根目录 `.env` 继续承载 `settings.yaml` 中 AI provider 占位符对应的值。
- `desktop/.env` 或启动进程环境继续承载 Nest、数据库、微信/企微和设计平台配置。
- `desktop/.runtime/design-platform-config.json` 继续由现有设计平台登录/配置流程管理；doctor 只读取并输出存在性布尔值。
- `.env.example` 只保留占位值和安全开关示例，不能填写真实密钥。
- 即使 `settings.yaml` 或运行时 JSON 中存在直接写入的凭据，JSON 报告也不会回显这些值。

## 当前报告如何解读

如果本机尚未创建 `.env`，默认通常会得到：API、Web、本地 JSON 数据库、`standard_v1` 设计平台为 `ready`；个人微信真实发送、企微客服和 AI 模型链路为 `blocked`。这表示代码默认演示链路可启动，但真实渠道和模型所需的外部账号配置尚未补齐。
