export type AiProviderProtocol = "openai_chat" | "openai_responses" | "anthropic_messages";

export type AiProviderPreset = {
  id: string;
  label: string;
  vendor: string;
  description: string;
  protocol: AiProviderProtocol;
  defaultBaseUrl: string;
  defaultModel: string;
  modelSuggestions: string[];
  apiKeyRequired: boolean;
  isLocal: boolean;
};

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "geeknow",
    label: "GeekNow 聚合接口",
    vendor: "GeekNow",
    description: "沿用项目已有聚合模型配置，支持 OpenAI Chat Completions 协议。",
    protocol: "openai_chat",
    defaultBaseUrl: "https://www.geeknow.top/v1",
    defaultModel: "gpt-5",
    modelSuggestions: ["gpt-5", "gpt-4.1", "claude-sonnet-4-5", "gemini-2.5-flash"],
    apiKeyRequired: true,
    isLocal: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    vendor: "OpenAI",
    description: "OpenAI 官方 Responses API。",
    protocol: "openai_responses",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.6-luna",
    modelSuggestions: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
    apiKeyRequired: true,
    isLocal: false,
  },
  {
    id: "anthropic",
    label: "Claude",
    vendor: "Anthropic",
    description: "Anthropic 官方 Messages API。",
    protocol: "anthropic_messages",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-5",
    modelSuggestions: ["claude-sonnet-5", "claude-opus-4-8", "claude-opus-4-7"],
    apiKeyRequired: true,
    isLocal: false,
  },
  {
    id: "gemini",
    label: "Gemini",
    vendor: "Google",
    description: "Google Gemini 的 OpenAI 兼容接口。",
    protocol: "openai_chat",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-3.5-flash",
    modelSuggestions: ["gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3-flash-preview"],
    apiKeyRequired: true,
    isLocal: false,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    vendor: "深度求索",
    description: "DeepSeek 官方 OpenAI 兼容接口。",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    modelSuggestions: ["deepseek-v4-flash", "deepseek-v4-pro"],
    apiKeyRequired: true,
    isLocal: false,
  },
  {
    id: "qwen",
    label: "通义千问",
    vendor: "阿里云百炼",
    description: "阿里云百炼 OpenAI 兼容接口。",
    protocol: "openai_chat",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.7-plus",
    modelSuggestions: ["qwen3.7-plus", "qwen3.7-max", "qwen3.6-flash"],
    apiKeyRequired: true,
    isLocal: false,
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    vendor: "智谱 AI",
    description: "智谱 BigModel 的 OpenAI 兼容接口。",
    protocol: "openai_chat",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-5.2",
    modelSuggestions: ["glm-5.2", "glm-5", "glm-4.7"],
    apiKeyRequired: true,
    isLocal: false,
  },
  {
    id: "moonshot",
    label: "Kimi",
    vendor: "Moonshot AI",
    description: "Moonshot/Kimi 官方 OpenAI 兼容接口。",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.6",
    modelSuggestions: ["kimi-k2.6", "kimi-k2.5", "moonshot-v1-32k"],
    apiKeyRequired: true,
    isLocal: false,
  },
  {
    id: "doubao",
    label: "豆包",
    vendor: "火山方舟",
    description: "火山方舟 Responses API；也可填写控制台创建的推理接入点 ID。",
    protocol: "openai_responses",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-seed-2-0-lite-260215",
    modelSuggestions: ["doubao-seed-2-0-lite-260215", "doubao-seed-1-6-250615"],
    apiKeyRequired: true,
    isLocal: false,
  },
  {
    id: "minimax",
    label: "MiniMax",
    vendor: "MiniMax",
    description: "MiniMax 官方 OpenAI 兼容接口。",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.minimaxi.com/v1",
    defaultModel: "MiniMax-M2.7",
    modelSuggestions: ["MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1"],
    apiKeyRequired: true,
    isLocal: false,
  },
  {
    id: "hunyuan",
    label: "腾讯混元",
    vendor: "腾讯云",
    description: "腾讯混元 OpenAI 兼容接口。",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    defaultModel: "hunyuan-turbos-latest",
    modelSuggestions: ["hunyuan-turbos-latest", "hunyuan-lite"],
    apiKeyRequired: true,
    isLocal: false,
  },
  {
    id: "siliconflow",
    label: "硅基流动",
    vendor: "SiliconFlow",
    description: "硅基流动模型聚合平台的 OpenAI 兼容接口。",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "Pro/zai-org/GLM-4.7",
    modelSuggestions: ["Pro/zai-org/GLM-4.7", "deepseek-ai/DeepSeek-V3.2", "Qwen/Qwen3-30B-A3B-Instruct-2507"],
    apiKeyRequired: true,
    isLocal: false,
  },
  {
    id: "ollama",
    label: "Ollama 本地模型",
    vendor: "Ollama",
    description: "在本机运行，无需外网 API Key。",
    protocol: "openai_chat",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "qwen3:8b",
    modelSuggestions: ["qwen3:8b", "deepseek-r1:8b", "llama3.2:3b"],
    apiKeyRequired: false,
    isLocal: true,
  },
  {
    id: "custom",
    label: "自定义兼容接口",
    vendor: "Custom",
    description: "接入其他 OpenAI Chat、OpenAI Responses 或 Anthropic Messages 兼容服务。",
    protocol: "openai_chat",
    defaultBaseUrl: "",
    defaultModel: "",
    modelSuggestions: [],
    apiKeyRequired: true,
    isLocal: false,
  },
];

export const AI_PROVIDER_PRESET_MAP = new Map(AI_PROVIDER_PRESETS.map((preset) => [preset.id, preset]));

export function defaultEndpoint(protocol: AiProviderProtocol) {
  if (protocol === "openai_responses") return "/responses";
  if (protocol === "anthropic_messages") return "/v1/messages";
  return "/chat/completions";
}
