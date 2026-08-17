import type { AiRoutingTier } from "./ai-provider-config";

export type AiProviderPreset = Readonly<{
  name: string;
  label: string;
  region: "china" | "global" | "aggregator";
  apiKeyEnv: string;
  enabledEnv: string;
  modelEnv: string;
  baseUrl: string;
  model: string;
  requestFormat: "openai" | "anthropic";
  apiEndpoint: string;
  routingTier: AiRoutingTier;
  temperature: number;
  maxTokens: number;
  visionEnabled?: boolean;
  visionModel?: string;
  audioInputEnabled?: boolean;
  audioInputModel?: string;
  transcriptionModel?: string;
  transcriptionEndpoint?: string;
  description: string;
  docsUrl: string;
}>;

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    name: "zhipu", label: "智谱 GLM", region: "china", apiKeyEnv: "ZHIPU_API_KEY",
    enabledEnv: "AI_PROVIDER_ZHIPU_ENABLED", modelEnv: "ZHIPU_MODEL",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "economy",
    temperature: 0.7, maxTokens: 500, description: "低延迟中文客服首选之一。",
    docsUrl: "https://open.bigmodel.cn/dev/api",
  },
  {
    name: "deepseek", label: "DeepSeek", region: "china", apiKeyEnv: "DEEPSEEK_API_KEY",
    enabledEnv: "AI_PROVIDER_DEEPSEEK_ENABLED", modelEnv: "DEEPSEEK_MODEL",
    baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "economy",
    temperature: 0.7, maxTokens: 500, description: "中文理解和复杂业务推理。",
    docsUrl: "https://api-docs.deepseek.com/",
  },
  {
    name: "dashscope", label: "阿里云百炼 Qwen", region: "china", apiKeyEnv: "DASHSCOPE_API_KEY",
    enabledEnv: "AI_PROVIDER_DASHSCOPE_ENABLED", modelEnv: "DASHSCOPE_MODEL",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3.5-flash",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "economy",
    temperature: 0.4, maxTokens: 500, description: "通义千问 OpenAI 兼容接口。",
    docsUrl: "https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope",
  },
  {
    name: "siliconflow", label: "硅基流动", region: "china", apiKeyEnv: "SILICONFLOW_API_KEY",
    enabledEnv: "AI_PROVIDER_SILICONFLOW_ENABLED", modelEnv: "SILICONFLOW_MODEL",
    baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen3-8B",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "economy",
    temperature: 0.4, maxTokens: 500, description: "多种开源模型的统一推理入口。",
    docsUrl: "https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions",
  },
  {
    name: "volcengine", label: "火山方舟 / 豆包", region: "china", apiKeyEnv: "VOLCENGINE_API_KEY",
    enabledEnv: "AI_PROVIDER_VOLCENGINE_ENABLED", modelEnv: "VOLCENGINE_MODEL",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-2-0-lite-260215",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "economy",
    temperature: 0.4, maxTokens: 500, description: "豆包低延迟文本模型。",
    docsUrl: "https://www.volcengine.com/docs/82379/1494384",
  },
  {
    name: "moonshot", label: "Moonshot / Kimi", region: "china", apiKeyEnv: "MOONSHOT_API_KEY",
    enabledEnv: "AI_PROVIDER_MOONSHOT_ENABLED", modelEnv: "MOONSHOT_MODEL",
    baseUrl: "https://api.moonshot.ai/v1", model: "kimi-k2.6",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "quality",
    temperature: 1, maxTokens: 1200, description: "长上下文与复杂业务沟通。",
    docsUrl: "https://platform.moonshot.cn/docs/api/chat",
  },
  {
    name: "qianfan", label: "百度千帆 / 文心", region: "china", apiKeyEnv: "QIANFAN_API_KEY",
    enabledEnv: "AI_PROVIDER_QIANFAN_ENABLED", modelEnv: "QIANFAN_MODEL",
    baseUrl: "https://qianfan.baidubce.com/v2", model: "ernie-4.0-turbo-8k",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "quality",
    temperature: 0.7, maxTokens: 800, description: "文心模型 OpenAI 兼容接口。",
    docsUrl: "https://cloud.baidu.com/doc/qianfan-docs/s/qm8qxemze",
  },
  {
    name: "hunyuan", label: "腾讯混元", region: "china", apiKeyEnv: "HUNYUAN_API_KEY",
    enabledEnv: "AI_PROVIDER_HUNYUAN_ENABLED", modelEnv: "HUNYUAN_MODEL",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1", model: "hunyuan-turbos-latest",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "quality",
    temperature: 0.7, maxTokens: 800, description: "腾讯混元 OpenAI 兼容接口。",
    docsUrl: "https://cloud.tencent.com/document/product/1729/111007",
  },
  {
    name: "minimax", label: "MiniMax", region: "china", apiKeyEnv: "MINIMAX_API_KEY",
    enabledEnv: "AI_PROVIDER_MINIMAX_ENABLED", modelEnv: "MINIMAX_MODEL",
    baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M2.7",
    requestFormat: "openai", apiEndpoint: "/text/chatcompletion_v2", routingTier: "quality",
    temperature: 0.8, maxTokens: 1200, description: "MiniMax 中文文本生成接口。",
    docsUrl: "https://platform.minimaxi.com/document/对话",
  },
  {
    name: "stepfun", label: "阶跃星辰 StepFun", region: "china", apiKeyEnv: "STEPFUN_API_KEY",
    enabledEnv: "AI_PROVIDER_STEPFUN_ENABLED", modelEnv: "STEPFUN_MODEL",
    baseUrl: "https://api.stepfun.com/step_plan/v1", model: "step-3.5-flash",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "economy",
    temperature: 0.4, maxTokens: 600, description: "阶跃快速推理模型。",
    docsUrl: "https://platform.stepfun.com/docs/zh/step-plan/integrations/reasoning-api",
  },
  {
    name: "openai", label: "OpenAI", region: "global", apiKeyEnv: "OPENAI_API_KEY",
    enabledEnv: "AI_PROVIDER_OPENAI_ENABLED", modelEnv: "OPENAI_MODEL",
    baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "quality",
    visionEnabled: true, visionModel: "gpt-4o-mini",
    transcriptionModel: "gpt-transcribe", transcriptionEndpoint: "/audio/transcriptions",
    temperature: 0.7, maxTokens: 500, description: "OpenAI 官方文本模型接口。",
    docsUrl: "https://platform.openai.com/docs/quickstart",
  },
  {
    name: "anthropic", label: "Anthropic Claude", region: "global", apiKeyEnv: "ANTHROPIC_API_KEY",
    enabledEnv: "AI_PROVIDER_ANTHROPIC_ENABLED", modelEnv: "ANTHROPIC_MODEL",
    baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-20250514",
    requestFormat: "anthropic", apiEndpoint: "/messages", routingTier: "quality",
    temperature: 0.7, maxTokens: 800, description: "Claude 原生 Messages API。",
    docsUrl: "https://docs.anthropic.com/en/api/messages",
  },
  {
    name: "gemini", label: "Google Gemini", region: "global", apiKeyEnv: "GEMINI_API_KEY",
    enabledEnv: "AI_PROVIDER_GEMINI_ENABLED", modelEnv: "GEMINI_MODEL",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.6-flash",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "economy",
    visionEnabled: true, visionModel: "gemini-3.6-flash",
    audioInputEnabled: true, audioInputModel: "gemini-3.6-flash",
    temperature: 0.4, maxTokens: 600, description: "Gemini 官方 OpenAI 兼容接口。",
    docsUrl: "https://ai.google.dev/gemini-api/docs/openai",
  },
  {
    name: "xai", label: "xAI Grok", region: "global", apiKeyEnv: "XAI_API_KEY",
    enabledEnv: "AI_PROVIDER_XAI_ENABLED", modelEnv: "XAI_MODEL",
    baseUrl: "https://api.x.ai/v1", model: "grok-4.5",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "quality",
    temperature: 0.7, maxTokens: 800, description: "Grok Chat Completions 接口。",
    docsUrl: "https://docs.x.ai/developers/rest-api-reference/inference/chat",
  },
  {
    name: "groq", label: "Groq", region: "global", apiKeyEnv: "GROQ_API_KEY",
    enabledEnv: "AI_PROVIDER_GROQ_ENABLED", modelEnv: "GROQ_MODEL",
    baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-20b",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "economy",
    temperature: 0.4, maxTokens: 500, description: "面向快速响应的 OpenAI 兼容推理。",
    docsUrl: "https://console.groq.com/docs/openai",
  },
  {
    name: "mistral", label: "Mistral AI", region: "global", apiKeyEnv: "MISTRAL_API_KEY",
    enabledEnv: "AI_PROVIDER_MISTRAL_ENABLED", modelEnv: "MISTRAL_MODEL",
    baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "economy",
    temperature: 0.4, maxTokens: 600, description: "Mistral OpenAI 兼容接口。",
    docsUrl: "https://docs.mistral.ai/resources/migration-guides",
  },
  {
    name: "together", label: "Together AI", region: "global", apiKeyEnv: "TOGETHER_API_KEY",
    enabledEnv: "AI_PROVIDER_TOGETHER_ENABLED", modelEnv: "TOGETHER_MODEL",
    baseUrl: "https://api.together.ai/v1", model: "Qwen/Qwen3.5-9B",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "economy",
    temperature: 0.4, maxTokens: 600, description: "多种开源模型的托管推理接口。",
    docsUrl: "https://docs.together.ai/docs/inference/openai-compatibility",
  },
  {
    name: "openrouter", label: "OpenRouter", region: "aggregator", apiKeyEnv: "OPENROUTER_API_KEY",
    enabledEnv: "AI_PROVIDER_OPENROUTER_ENABLED", modelEnv: "OPENROUTER_MODEL",
    baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto",
    requestFormat: "openai", apiEndpoint: "/chat/completions", routingTier: "quality",
    temperature: 0.7, maxTokens: 800, description: "一个密钥路由多个模型厂商。",
    docsUrl: "https://openrouter.ai/docs/quickstart",
  },
] as const;

const PRESET_BY_NAME = new Map(AI_PROVIDER_PRESETS.map((preset) => [preset.name, preset]));

export function getAiProviderPreset(name: unknown) {
  return PRESET_BY_NAME.get(String(name || "").trim());
}

export function presetAsRawConfig(preset: AiProviderPreset) {
  return {
    enabled: false,
    api_key: `\${${preset.apiKeyEnv}}`,
    base_url: preset.baseUrl,
    model: `\${${preset.modelEnv}:-${preset.model}}`,
    request_format: preset.requestFormat,
    api_endpoint: preset.apiEndpoint,
    routing_tier: preset.routingTier,
    temperature: preset.temperature,
    max_tokens: preset.maxTokens,
    ...(preset.visionEnabled ? { vision_enabled: true } : {}),
    ...(preset.visionModel ? { vision_model: preset.visionModel } : {}),
    ...(preset.audioInputEnabled ? { audio_input_enabled: true } : {}),
    ...(preset.audioInputModel ? { audio_input_model: preset.audioInputModel } : {}),
    ...(preset.transcriptionModel ? { transcription_model: preset.transcriptionModel } : {}),
    ...(preset.transcriptionEndpoint ? { transcription_endpoint: preset.transcriptionEndpoint } : {}),
  };
}
