# Desktop 大模型供应商接入

新版 Nest API 直接复用仓库根部 `config/settings.yaml` 的 `ai_engine` 配置，以及仓库根部 `.env` 中被 `${ENV_NAME}` 引用的密钥。desktop 不保存第二份 provider 密钥。

## 配置语义

- `ai_engine.enabled`：总开关。
- `ai_engine.primary`：主供应商。
- `ai_engine.fallback_chain`：按顺序降级的备用供应商。
- `ai_engine.timeout_seconds`：每次 HTTP 请求超时，范围 1–120 秒。
- `ai_engine.max_retries`：单个供应商失败后的额外重试次数，范围 0–5。
- `providers.*`：沿用 `enabled`、`api_key`、`base_url`、`model`、`request_format`、`temperature`、`max_tokens` 和可选 `api_endpoint`。Nest 链路只启用 `request_format: openai`，请求地址默认为 `{base_url}/chat/completions`。

运行时环境变量优先于根部 `.env`。如确需从其他位置启动，可用非敏感变量 `AI_ENGINE_SETTINGS_PATH` 指向同结构的 settings 文件；它不存储密钥。

## 状态检查

仅查看配置状态，不发模型请求：

```text
GET http://127.0.0.1:3200/api/ai/providers/status
```

逐个探测已配置模型：

```text
GET http://127.0.0.1:3200/api/ai/providers/status?probe=1
```

响应不会返回 API Key。实时探测会产生少量模型调用费用，并受同一超时设置约束。

该接口按桌面本机运维接口设计。若把 Enterprise WeChat callback 通过公网反向代理暴露，只应转发 `/api/wechat-work/callback`，不要把整个 `3200` 端口或模型状态接口公开。

## 入站回复安全边界

1. 现有场景规则、风险识别、人工锁和身份绑定先执行。
2. 高价值、投诉/法律等高风险消息强制转人工，不调用大模型，也不自动排队回复。
3. 缺少必要信息时继续使用规则生成的精确追问，不调用大模型。
4. 只有规则判定为 `auto_agent` 的消息才让模型润色建议；输入仅含当前客户消息、规则基准回复和已按账号/会话/客户过滤的知识命中。
5. 模型不得新增数字或退款、赔偿、报价等承诺；安全校验失败、超时或所有供应商不可用时，自动回退到原规则草稿，入站处理不中断。
