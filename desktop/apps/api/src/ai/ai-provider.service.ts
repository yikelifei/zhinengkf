import { Injectable } from "@nestjs/common";
import { AiProviderConfig, AiProviderRuntimeConfig, loadAiProviderRuntime } from "./ai-provider-config";

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
  async generateInboundSuggestion(input: AiSuggestionInput): Promise<AiCompletionResult> {
    const runtime = loadAiProviderRuntime();
    const messages = buildSuggestionMessages(input);
    const result = await new OpenAiCompatibleRouter(runtime).complete(messages);
    const text = validateSuggestion(result.text, input);
    if (!text) throw new Error("AI suggestion failed safety validation");
    return { ...result, text };
  }

  async getStatus(probe = false) {
    const runtime = loadAiProviderRuntime();
    const router = new OpenAiCompatibleRouter(runtime);
    const providers = [];
    for (const provider of runtime.providers) {
      let live: Record<string, unknown> = { available: null };
      if (probe && provider.configured) {
        const startedAt = Date.now();
        try {
          await router.completeWithProvider(provider.name, [{ role: "user", content: "Reply only with pong." }], 0);
          live = { available: true, latencyMs: Date.now() - startedAt };
        } catch (error) {
          live = { available: false, latencyMs: Date.now() - startedAt, error: publicError(error) };
        }
      }
      providers.push({
        name: provider.name,
        enabled: provider.enabled,
        configured: provider.configured,
        issues: provider.issues,
        requestFormat: provider.requestFormat,
        model: provider.model,
        isPrimary: provider.name === runtime.primary,
        inFallbackChain: runtime.fallbackChain.includes(provider.name),
        ...live,
      });
    }
    return {
      enabled: runtime.enabled,
      primary: runtime.primary,
      fallbackChain: runtime.fallbackChain,
      timeoutSeconds: runtime.timeoutSeconds,
      maxRetries: runtime.maxRetries,
      promptKey: runtime.promptKey,
      probe,
      providers,
    };
  }
}

export class OpenAiCompatibleRouter {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly runtime: AiProviderRuntimeConfig, options: RouterOptions = {}) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async complete(messages: ChatMessage[]): Promise<AiCompletionResult> {
    if (!this.runtime.enabled) throw new Error("AI engine is disabled");
    const configured = new Map(this.runtime.providers.filter((provider) => provider.configured).map((provider) => [provider.name, provider]));
    const order = uniqueStrings([this.runtime.primary, ...this.runtime.fallbackChain]).filter((name) => configured.has(name));
    const providers = order.length ? order : [...configured.keys()];
    if (!providers.length) throw new Error("No configured OpenAI-compatible provider");
    const failures: string[] = [];
    for (const providerName of providers) {
      try {
        return await this.completeWithProvider(providerName, messages, this.runtime.maxRetries);
      } catch (error) {
        failures.push(`${providerName}: ${publicError(error)}`);
      }
    }
    throw new Error(`All AI providers failed: ${failures.join("; ")}`);
  }

  async completeWithProvider(providerName: string, messages: ChatMessage[], maxRetries = this.runtime.maxRetries) {
    const provider = this.runtime.providers.find((item) => item.name === providerName);
    if (!provider?.configured) throw new Error(`Provider is not configured: ${providerName}`);
    let attempts = 0;
    let lastError: unknown;
    for (let retry = 0; retry <= maxRetries; retry += 1) {
      attempts += 1;
      try {
        const text = await this.request(provider, messages);
        return { text, provider: provider.name, model: provider.model, attempts };
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
        headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: provider.model,
          messages,
          temperature: provider.temperature,
          max_tokens: provider.maxTokens,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = cleanErrorText(await response.text());
        throw new AiRequestError(response.status, detail || response.statusText);
      }
      const data = (await response.json()) as any;
      const content = data?.choices?.[0]?.message?.content;
      const text = Array.isArray(content)
        ? content.map((item) => (typeof item === "string" ? item : item?.text || "")).join("")
        : String(content || "");
      const cleaned = cleanModelText(text);
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
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function validateSuggestion(value: string, input: AiSuggestionInput) {
  const cleaned = cleanModelText(value).replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 200 || /转人工|人工客服/.test(cleaned)) return "";
  const trusted = [input.customerMessage, input.ruleSuggestion, ...(input.knowledgeMatches || []).flatMap((item) => [item.title, item.excerpt])]
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
  return String(value || "").replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200);
}

function cleanErrorText(value: string) {
  return String(value || "").replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]").replace(/\s+/g, " ").slice(0, 240);
}

function publicError(error: unknown) {
  return cleanErrorText(error instanceof Error ? error.message : String(error || "unknown error"));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
