import { Injectable } from "@nestjs/common";
import {
  AiProviderConfig,
  AiProviderRuntimeConfig,
  AiProviderSettingsPatch,
  loadAiProviderRuntime,
  saveAiProviderRuntimePatch,
  toAiProviderSettingsResponse,
} from "./ai-provider-config";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type AiSuggestionInput = {
  customerMessage: string;
  ruleSuggestion: string;
  agentKey?: string;
  scene?: string;
  nextAction?: string;
  knowledgeMatches?: Array<{ title?: string; excerpt?: string }>;
};

export type AiCompletionResult = {
  text: string;
  provider: string;
  model: string;
  attempts: number;
};

type RouterOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

@Injectable()
export class AiProviderService {
  getConfig() {
    return toAiProviderSettingsResponse(loadAiProviderRuntime());
  }

  updateConfig(patch: AiProviderSettingsPatch) {
    return toAiProviderSettingsResponse(saveAiProviderRuntimePatch(patch));
  }

  async testProvider(providerId: string) {
    const runtime = loadAiProviderRuntime();
    const router = new MultiProviderAiRouter(runtime);
    const startedAt = Date.now();
    const result = await router.completeWithProvider(
      providerId,
      [
        { role: "system", content: "你是连通性测试助手。" },
        { role: "user", content: "只回复：连接成功" },
      ],
      0,
    );
    return {
      ok: true,
      provider: result.provider,
      model: result.model,
      attempts: result.attempts,
      latencyMs: Date.now() - startedAt,
    };
  }

  async generateInboundSuggestion(input: AiSuggestionInput): Promise<AiCompletionResult> {
    const runtime = loadAiProviderRuntime();
    const messages = buildSuggestionMessages(input);
    const result = await new MultiProviderAiRouter(runtime).complete(messages);
    const text = validateSuggestion(result.text, input);
    if (!text) throw new Error("AI suggestion failed safety validation");
    return { ...result, text };
  }

  async getStatus(probe = false) {
    const runtime = loadAiProviderRuntime();
    const router = new MultiProviderAiRouter(runtime);
    const providers = await Promise.all(
      runtime.providers.map(async (provider) => {
        let live: Record<string, unknown> = { available: null };
        if (probe && provider.configured) {
          const startedAt = Date.now();
          try {
            await router.completeWithProvider(provider.id, [{ role: "user", content: "只回复 pong" }], 0);
            live = { available: true, latencyMs: Date.now() - startedAt };
          } catch (error) {
            live = { available: false, latencyMs: Date.now() - startedAt, error: publicError(error) };
          }
        }
        return {
          id: provider.id,
          enabled: provider.enabled,
          configured: provider.configured,
          issues: provider.issues,
          protocol: provider.protocol,
          model: provider.model,
          isPrimary: provider.id === runtime.primary,
          inFallbackChain: runtime.fallbackChain.includes(provider.id),
          ...live,
        };
      }),
    );
    return {
      enabled: runtime.enabled,
      primary: runtime.primary,
      fallbackChain: runtime.fallbackChain,
      timeoutSeconds: runtime.timeoutSeconds,
      maxRetries: runtime.maxRetries,
      probe,
      providers,
    };
  }
}

export class MultiProviderAiRouter {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly runtime: AiProviderRuntimeConfig, options: RouterOptions = {}) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async complete(messages: ChatMessage[]): Promise<AiCompletionResult> {
    if (!this.runtime.enabled) throw new Error("AI engine is disabled");
    const configured = new Map(
      this.runtime.providers.filter((provider) => provider.configured).map((provider) => [provider.id, provider]),
    );
    const ordered = uniqueStrings([this.runtime.primary, ...this.runtime.fallbackChain]).filter((id) => configured.has(id));
    const providerIds = ordered.length ? ordered : [...configured.keys()];
    if (!providerIds.length) throw new Error("No configured AI provider");
    const failures: string[] = [];
    for (const providerId of providerIds) {
      try {
        return await this.completeWithProvider(providerId, messages, this.runtime.maxRetries);
      } catch (error) {
        failures.push(`${providerId}: ${publicError(error)}`);
      }
    }
    throw new Error(`All AI providers failed: ${failures.join("; ")}`);
  }

  async completeWithProvider(providerId: string, messages: ChatMessage[], maxRetries = this.runtime.maxRetries) {
    const provider = this.runtime.providers.find((item) => item.id === providerId);
    if (!provider?.configured) throw new Error(`Provider is not configured: ${providerId}`);
    let attempts = 0;
    let lastError: unknown;
    for (let retry = 0; retry <= maxRetries; retry += 1) {
      attempts += 1;
      try {
        const text = await this.request(provider, messages);
        return { text, provider: provider.id, model: provider.model, attempts };
      } catch (error) {
        lastError = error;
        if (retry >= maxRetries || !isRetryable(error)) break;
        await this.sleep(Math.min(1000, 250 * 2 ** retry));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("AI provider request failed");
  }

  private async request(provider: AiProviderConfig, messages: ChatMessage[]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.runtime.timeoutSeconds * 1000);
    try {
      const endpoint = provider.apiEndpoint.startsWith("/") ? provider.apiEndpoint : `/${provider.apiEndpoint}`;
      const response = await this.fetchImpl(`${provider.baseUrl}${endpoint}`, {
        method: "POST",
        headers: buildHeaders(provider),
        body: JSON.stringify(buildRequestBody(provider, messages)),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = cleanErrorText(await response.text());
        throw new AiRequestError(response.status, detail || response.statusText);
      }
      const data = (await response.json()) as any;
      const cleaned = cleanModelText(extractResponseText(provider, data));
      if (!cleaned) throw new Error("AI provider returned an empty completion");
      return cleaned;
    } catch (error) {
      if (controller.signal.aborted) throw new AiRequestError(408, "request timeout");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

class AiRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(`HTTP ${status}: ${message}`);
  }
}

function buildHeaders(provider: AiProviderConfig): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.protocol === "anthropic_messages") {
    headers["anthropic-version"] = "2023-06-01";
    if (provider.apiKey) headers["x-api-key"] = provider.apiKey;
    return headers;
  }
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  else if (provider.id === "ollama") headers.authorization = "Bearer ollama";
  return headers;
}

function buildRequestBody(provider: AiProviderConfig, messages: ChatMessage[]) {
  if (provider.protocol === "anthropic_messages") {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    return {
      model: provider.model,
      ...(system ? { system } : {}),
      messages: messages
        .filter((message) => message.role !== "system")
        .map((message) => ({ role: message.role, content: message.content })),
      max_tokens: provider.maxTokens,
    };
  }
  if (provider.protocol === "openai_responses") {
    return {
      model: provider.model,
      input: messages,
      max_output_tokens: provider.maxTokens,
    };
  }
  return {
    model: provider.model,
    messages,
    temperature: provider.temperature,
    max_tokens: provider.maxTokens,
  };
}

function extractResponseText(provider: AiProviderConfig, data: any) {
  if (provider.protocol === "anthropic_messages") {
    return Array.isArray(data?.content)
      ? data.content.map((item: any) => (item?.type === "text" ? item.text || "" : "")).join("")
      : "";
  }
  if (provider.protocol === "openai_responses") {
    if (typeof data?.output_text === "string") return data.output_text;
    return Array.isArray(data?.output)
      ? data.output
          .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
          .map((item: any) => item?.text || item?.output_text || "")
          .join("")
      : "";
  }
  const content = data?.choices?.[0]?.message?.content;
  return Array.isArray(content)
    ? content.map((item: any) => (typeof item === "string" ? item : item?.text || "")).join("")
    : String(content || "");
}

function buildSuggestionMessages(input: AiSuggestionInput): ChatMessage[] {
  const knowledge = (input.knowledgeMatches || [])
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${cleanPromptText(item.title)}：${cleanPromptText(item.excerpt)}`)
    .filter((item) => !item.endsWith("："));
  const system = [
    "你是客服回复草稿助手，只输出一条可直接发送的中文回复正文，不要解释过程。",
    "业务规则生成的基准回复和当前会话已匹配知识是唯一可信事实，优先级高于语言模型常识。",
    "不得新增价格、时效、库存、退款、赔偿、承诺或身份信息；不确定时保持基准回复。",
    "不得改变下一步动作，不得把可自动处理的会话擅自转人工。",
    "语气自然、简洁，最长 200 个汉字。",
  ].join("\n");
  const user = [
    `客户消息：${cleanPromptText(input.customerMessage)}`,
    `业务场景：${cleanPromptText(input.scene) || "未标注"}`,
    `处理智能体：${cleanPromptText(input.agentKey) || "未标注"}`,
    `既定下一步：${cleanPromptText(input.nextAction) || "沿用基准回复"}`,
    `规则基准回复：${cleanPromptText(input.ruleSuggestion)}`,
    knowledge.length ? `当前会话已匹配知识：\n${knowledge.join("\n")}` : "当前会话无知识命中。",
    "请在不改变事实和动作的前提下润色基准回复。",
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function validateSuggestion(value: string, input: AiSuggestionInput) {
  const cleaned = cleanModelText(value).replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 200 || /转人工|人工客服/.test(cleaned)) return "";
  const trusted = [
    input.customerMessage,
    input.ruleSuggestion,
    ...(input.knowledgeMatches || []).flatMap((item) => [item.title, item.excerpt]),
  ]
    .map((item) => String(item || ""))
    .join("\n");
  const trustedNumbers = new Set(trusted.match(/\d+(?:\.\d+)?/g) || []);
  if ((cleaned.match(/\d+(?:\.\d+)?/g) || []).some((number) => !trustedNumbers.has(number))) return "";
  const commitments = ["退款", "赔偿", "免费", "保证", "承诺", "到账", "付款链接", "支付链接", "报价"];
  if (commitments.some((term) => cleaned.includes(term) && !trusted.includes(term))) return "";
  return cleaned;
}

function isRetryable(error: unknown) {
  if (error instanceof AiRequestError) return error.status === 408 || error.status === 429 || error.status >= 500;
  return error instanceof TypeError || (error instanceof Error && /fetch|network|socket|timeout/i.test(error.message));
}

function cleanModelText(value: string) {
  return String(value || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*/gi, "")
    .replace(/^```(?:text|markdown)?\s*|\s*```$/gi, "")
    .trim();
}

function cleanPromptText(value: unknown) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

function cleanErrorText(value: string) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(?:api[_-]?key|x-api-key)["'\s:=]+[A-Za-z0-9._-]+/gi, "api_key=[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

export function publicError(error: unknown) {
  return cleanErrorText(error instanceof Error ? error.message : String(error || "unknown error"));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
