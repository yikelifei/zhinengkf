import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BadRequestException, Injectable } from "@nestjs/common";
import {
  AiProviderConfig,
  AiProviderRuntimeConfig,
  AiRoutingTier,
  loadAiProviderRuntime,
} from "./ai-provider-config";
import { getAiProviderPreset, providerBaseUrlEnv } from "./ai-provider-presets";
import { rules } from "../shared/rules";

const { xiaoshiPromptGuidance } = rules;

type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
  | { type: "input_audio"; input_audio: { data: string; format: "wav" } };
type ChatMessage = { role: "system" | "user" | "assistant"; content: string | OpenAiContentPart[] };

export type AiVisionInput = {
  images: Array<{ bytes: Buffer; mimeType: "image/jpeg" | "image/png" }>;
  prompt: string;
};

export type AiTranscriptionInput = {
  bytes: Buffer;
  mimeType: string;
  fileName?: string;
  prompt?: string;
};

export type AiSuggestionInput = {
  customerMessage: string;
  ruleSuggestion: string;
  agentKey?: string;
  scene?: string;
  nextAction?: string;
  knowledgeMatches?: Array<{ title?: string; excerpt?: string }>;
  conversationHistory?: Array<{ role: "customer" | "assistant"; content: string }>;
  requiredTerms?: string[];
  requireNaturalRewrite?: boolean;
  routingHint?: AiRoutingTier;
  latencyBudgetMs?: number;
  allowRepair?: boolean;
  dialoguePlan?: {
    intent?: string;
    objective?: string;
    knownFacts?: string[];
    prohibitedQuestions?: string[];
  };
  styleProfile?: {
    id?: string;
    name?: string;
    evidence?: string;
    preserveHumanVerbatim?: boolean;
  };
};

export type AiCompletionResult = {
  text: string;
  provider: string;
  model: string;
  attempts: number;
  qualityRepairs?: number;
  requestedTier?: AiRoutingTier;
  resolvedTier?: AiRoutingTier;
  complexityScore?: number;
  complexityReasons?: string[];
  qualityEscalated?: boolean;
};

export type AiProviderServerEnvBundle = {
  generated: true;
  generatedAt: string;
  filePath: string;
  fileName: string;
  envText: string;
  providerCount: number;
  configuredProviderCount: number;
  missingProviders: Array<{
    name: string;
    label: string;
    apiKeyEnv: string;
    enabledEnv: string;
    modelEnv: string;
    baseUrlEnv: string;
  }>;
  includedProviders: Array<{
    name: string;
    label: string;
    enabled: boolean;
    apiKeyConfigured: boolean;
    apiKeyEnv: string;
    modelEnv: string;
    baseUrlEnv: string;
  }>;
  copyHint: string;
};

export type AiProviderBalanceResult = {
  checked: boolean;
  supported: boolean;
  metric: "balance" | "cost";
  status: "available" | "insufficient" | "unsupported" | "error";
  display: string;
  amount: number | null;
  currency: string | null;
  endpoint: string;
  checkedAt: string | null;
  details: Array<{ label: string; value: string }>;
  error?: string;
};

export type AiProviderResponseTestResult = {
  tested: true;
  testedAt: string;
  provider: string;
  label: string;
  model: string;
  enabled: boolean;
  configured: boolean;
  testUrl: string;
  requestKind: "chat_completion";
  expectedReply: string;
  available: boolean;
  latencyMs: number;
  outputCharacters: number;
  charactersPerSecond: number;
  responsePreview: string;
  replyMatched: boolean;
  balance: AiProviderBalanceResult;
  checks: Array<{
    key: "configuration" | "connection" | "response" | "speed";
    label: string;
    ok: boolean;
    detail: string;
  }>;
  error?: string;
};

type AiProviderObservations = {
  schema: "smart_kefu_ai_provider_observations_v1";
  updatedAt: string | null;
  tests: Record<string, AiProviderResponseTestResult>;
  balances: Record<string, AiProviderBalanceResult>;
};

export type AiProviderModelSyncResult = {
  synced: true;
  provider: string;
  label: string;
  source: "upstream";
  endpoint: string;
  fetchedAt: string;
  models: Array<{ id: string; label: string }>;
};

type RouterOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  performanceTracker?: AiProviderPerformanceTracker;
  now?: () => number;
};

type CompletionOptions = {
  providerOrder?: string[];
  priorityProviderOrder?: string[];
  deadlineAt?: number;
  maxRetries?: number;
};

export type AiProviderCircuitState = "unmeasured" | "closed" | "open" | "half_open";

export type AiProviderPerformanceSnapshot = {
  sampleCount: number;
  successCount: number;
  failureCount: number;
  successRate: number | null;
  averageLatencyMs: number | null;
  lastLatencyMs: number | null;
  consecutiveFailures: number;
  circuitState: AiProviderCircuitState;
  cooldownRemainingMs: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
};

type AiProviderPerformanceRecord = {
  sampleCount: number;
  successCount: number;
  failureCount: number;
  averageLatencyMs: number | null;
  lastLatencyMs: number | null;
  consecutiveFailures: number;
  cooldownUntil: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
};

const PROVIDER_FAILURE_THRESHOLD = 2;
const PROVIDER_BASE_COOLDOWN_MS = 15_000;
const PROVIDER_MAX_COOLDOWN_MS = 120_000;
const MAX_DEADLINE_PROVIDER_CANDIDATES = 3;
const MAX_STANDARD_PROVIDER_CANDIDATES = 4;
const HIGH_COST_FALLBACK_PROVIDERS = new Set(["openai"]);
const HIGH_COST_FALLBACK_SCORE_PENALTY = 1_000_000;
const CUSTOMER_SERVICE_REPLY_PRIORITY_PROVIDERS = ["zhipu", "dashscope", "deepseek"] as const;

export class AiProviderPerformanceTracker {
  private readonly records = new Map<string, AiProviderPerformanceRecord>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  recordSuccess(providerName: string, latencyMs: number) {
    const record = this.record(providerName);
    const normalizedLatency = Math.max(1, Math.round(Number(latencyMs) || 1));
    record.sampleCount += 1;
    record.successCount += 1;
    record.averageLatencyMs = record.averageLatencyMs === null
      ? normalizedLatency
      : Math.round(record.averageLatencyMs * 0.65 + normalizedLatency * 0.35);
    record.lastLatencyMs = normalizedLatency;
    record.consecutiveFailures = 0;
    record.cooldownUntil = 0;
    record.lastSuccessAt = this.now();
  }

  recordFailure(providerName: string, latencyMs: number) {
    const record = this.record(providerName);
    record.sampleCount += 1;
    record.failureCount += 1;
    record.lastLatencyMs = Math.max(1, Math.round(Number(latencyMs) || 1));
    record.consecutiveFailures += 1;
    record.lastFailureAt = this.now();
    if (record.consecutiveFailures >= PROVIDER_FAILURE_THRESHOLD) {
      const multiplier = 2 ** Math.min(3, record.consecutiveFailures - PROVIDER_FAILURE_THRESHOLD);
      record.cooldownUntil = this.now() + Math.min(PROVIDER_MAX_COOLDOWN_MS, PROVIDER_BASE_COOLDOWN_MS * multiplier);
    }
  }

  snapshot(providerName: string): AiProviderPerformanceSnapshot {
    const record = this.records.get(providerName);
    if (!record) return emptyProviderPerformance();
    const now = this.now();
    const cooldownRemainingMs = Math.max(0, record.cooldownUntil - now);
    const circuitState: AiProviderCircuitState = cooldownRemainingMs > 0
      ? "open"
      : record.consecutiveFailures >= PROVIDER_FAILURE_THRESHOLD
        ? "half_open"
        : "closed";
    return {
      sampleCount: record.sampleCount,
      successCount: record.successCount,
      failureCount: record.failureCount,
      successRate: record.sampleCount ? Number((record.successCount / record.sampleCount).toFixed(3)) : null,
      averageLatencyMs: record.averageLatencyMs,
      lastLatencyMs: record.lastLatencyMs,
      consecutiveFailures: record.consecutiveFailures,
      circuitState,
      cooldownRemainingMs,
      lastSuccessAt: isoTimestamp(record.lastSuccessAt),
      lastFailureAt: isoTimestamp(record.lastFailureAt),
    };
  }

  order(runtime: AiProviderRuntimeConfig, providerNames: string[]) {
    const configured = new Map(runtime.providers.filter((provider) => provider.configured).map((provider) => [provider.name, provider]));
    const candidates = uniqueStrings(providerNames)
      .map((name, index) => ({ provider: configured.get(name), index }))
      .filter((item): item is { provider: AiProviderConfig; index: number } => Boolean(item.provider));
    if (!candidates.length) return [];
    const preferredTier = candidates[0].provider.routingTier;
    const ranked = candidates
      .map((item) => ({
        ...item,
        performance: this.snapshot(item.provider.name),
        score: this.score(item.provider, item.index, preferredTier),
      }))
      .sort((left, right) => left.score - right.score || left.index - right.index);
    const available = ranked.filter((item) => item.performance.circuitState !== "open");
    if (available.length) return available.map((item) => item.provider.name);
    return ranked
      .sort((left, right) => left.performance.cooldownRemainingMs - right.performance.cooldownRemainingMs)
      .slice(0, 1)
      .map((item) => item.provider.name);
  }

  private score(provider: AiProviderConfig, chainIndex: number, preferredTier: AiRoutingTier) {
    const performance = this.snapshot(provider.name);
    const baseline = provider.routingTier === "economy" ? 1_200 : 2_200;
    const latency = performance.averageLatencyMs ?? baseline;
    const failureRate = performance.successRate === null ? 0 : 1 - performance.successRate;
    const tierPenalty = provider.routingTier === preferredTier ? 0 : 5_000;
    const circuitPenalty = performance.circuitState === "half_open" ? 750 : performance.circuitState === "open" ? 100_000 : 0;
    const highCostFallbackPenalty = HIGH_COST_FALLBACK_PROVIDERS.has(provider.name)
      ? HIGH_COST_FALLBACK_SCORE_PENALTY
      : 0;
    return tierPenalty
      + circuitPenalty
      + highCostFallbackPenalty
      + latency
      + failureRate * 2_000
      + performance.consecutiveFailures * 1_000
      + chainIndex * 25;
  }

  private record(providerName: string) {
    const existing = this.records.get(providerName);
    if (existing) return existing;
    const created: AiProviderPerformanceRecord = {
      sampleCount: 0,
      successCount: 0,
      failureCount: 0,
      averageLatencyMs: null,
      lastLatencyMs: null,
      consecutiveFailures: 0,
      cooldownUntil: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
    };
    this.records.set(providerName, created);
    return created;
  }
}

@Injectable()
export class AiProviderService {
  private readonly performanceTracker = new AiProviderPerformanceTracker();

  async generateInboundSuggestion(input: AiSuggestionInput): Promise<AiCompletionResult> {
    const runtime = loadAiProviderRuntime();
    const router = new OpenAiCompatibleRouter(runtime, { performanceTracker: this.performanceTracker });
    const complexity = classifySuggestionComplexity(input, runtime.routing.complexityThreshold);
    const requestedTier = runtime.routing.enabled ? complexity.tier : undefined;
    const priorityProviderOrder = customerServiceReplyPriorityProviders(runtime);
    const providerOrder = requestedTier
      ? providerOrderForTier(runtime, requestedTier)
      : uniqueStrings([...priorityProviderOrder, runtime.primary, ...runtime.fallbackChain]);
    const latencyBudgetMs = normalizedLatencyBudget(input.latencyBudgetMs);
    const messages = requestedTier === "economy" && latencyBudgetMs
      ? buildFastSuggestionMessages(input)
      : buildSuggestionMessages(input);
    const completionOptions: CompletionOptions = {
      providerOrder,
      priorityProviderOrder,
      ...(latencyBudgetMs ? { deadlineAt: Date.now() + latencyBudgetMs, maxRetries: 0 } : {}),
    };
    const result = await router.complete(messages, completionOptions);
    const firstValidation = validateSuggestion(result.text, input);
    if (firstValidation.ok) {
      return withRoutingMetadata(
        { ...result, text: firstValidation.text, qualityRepairs: 0 },
        runtime,
        complexity,
        requestedTier,
      );
    }

    if (input.allowRepair === false) {
      throw new Error(`AI suggestion failed safety or naturalness validation: ${firstValidation.reason}`);
    }
    const repairTier = requestedTier === "economy" ? "quality" : requestedTier;
    const repaired = await router.complete(
      buildSuggestionRepairMessages(input, result.text, firstValidation.reason),
      {
        providerOrder: repairTier ? providerOrderForTier(runtime, repairTier) : providerOrder,
        priorityProviderOrder,
        ...(latencyBudgetMs ? { deadlineAt: Date.now() + latencyBudgetMs, maxRetries: 0 } : {}),
      },
    );
    const repairedValidation = validateSuggestion(repaired.text, input);
    if (!repairedValidation.ok) {
      throw new Error(`AI suggestion failed safety or naturalness validation: ${repairedValidation.reason}`);
    }
    return withRoutingMetadata({
      ...repaired,
      text: repairedValidation.text,
      attempts: result.attempts + repaired.attempts,
      qualityRepairs: 1,
      qualityEscalated: requestedTier === "economy" && repairTier === "quality",
    }, runtime, complexity, requestedTier);
  }

  async understandImages(input: AiVisionInput): Promise<AiCompletionResult> {
    const runtime = loadAiProviderRuntime();
    if (!runtime.multimodal.enabled) throw new Error("Multimodal understanding is disabled");
    const router = new OpenAiCompatibleRouter(runtime, { performanceTracker: this.performanceTracker });
    return router.completeVision(input);
  }

  async transcribeAudio(input: AiTranscriptionInput): Promise<AiCompletionResult> {
    const runtime = loadAiProviderRuntime();
    if (!runtime.multimodal.enabled) throw new Error("Multimodal understanding is disabled");
    const router = new OpenAiCompatibleRouter(runtime, { performanceTracker: this.performanceTracker });
    return router.transcribe(input);
  }

  async getStatus(probe = false) {
    const runtime = loadAiProviderRuntime();
    const router = new OpenAiCompatibleRouter(runtime, { performanceTracker: this.performanceTracker });
    const observations = readProviderObservations(runtime);
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
        label: provider.label,
        description: provider.description,
        region: provider.region,
        enabled: provider.enabled,
        configured: provider.configured,
        apiKeyConfigured: Boolean(provider.apiKey && !provider.issues.includes("api_key_unset")),
        credentialSource: provider.credentialSource,
        sharedSourceConfigured: provider.sharedSourceConfigured,
        issues: provider.issues,
        requestFormat: provider.requestFormat,
        baseUrl: provider.baseUrl,
        apiEndpoint: provider.apiEndpoint,
        model: provider.model,
        visionEnabled: provider.visionEnabled,
        visionModel: provider.visionEnabled ? provider.visionModel : "",
        audioInputEnabled: provider.audioInputEnabled,
        audioInputModel: provider.audioInputEnabled ? provider.audioInputModel : "",
        transcriptionEnabled: Boolean(provider.transcriptionModel || provider.audioInputEnabled),
        transcriptionModel: provider.transcriptionModel || (provider.audioInputEnabled ? provider.audioInputModel : ""),
        routingTier: provider.routingTier,
        docsUrl: provider.docsUrl,
        keyOnlySetup: provider.keyOnlySetup,
        balanceProbeSupported: Boolean(providerBalanceProbe(provider, runtime)),
        balanceProbeLabel: providerBalanceProbeLabel(provider, runtime),
        ...providerBillingMetadata(provider, runtime),
        performance: this.performanceTracker.snapshot(provider.name),
        latestTest: observations.tests[provider.name] || null,
        latestBalance: observations.balances[provider.name] || null,
        isPrimary: provider.name === runtime.primary,
        inFallbackChain: runtime.fallbackChain.includes(provider.name),
        inEconomyChain: runtime.routing.economyChain.includes(provider.name),
        inQualityChain: runtime.routing.qualityChain.includes(provider.name),
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
      routing: runtime.routing,
      multimodal: {
        ...runtime.multimodal,
        configuredVisionProviders: runtime.providers
          .filter((provider) => provider.configured && provider.visionEnabled && provider.requestFormat === "openai")
          .map((provider) => provider.name),
        configuredTranscriptionProviders: runtime.providers
          .filter((provider) => provider.configured && Boolean(provider.transcriptionModel || provider.audioInputEnabled))
          .map((provider) => provider.name),
      },
      adaptiveRouting: {
        enabled: true,
        strategy: "latency_reliability_circuit_breaker",
        failureThreshold: PROVIDER_FAILURE_THRESHOLD,
        economyOrder: this.performanceTracker.order(runtime, providerOrderForTier(runtime, "economy")),
        qualityOrder: this.performanceTracker.order(runtime, providerOrderForTier(runtime, "quality")),
      },
      probe,
      providers,
    };
  }

  async saveProviderCredential(input: {
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    enabled?: boolean;
  }) {
    const preset = getAiProviderPreset(input.provider);
    if (!preset) throw new BadRequestException("不支持的模型供应商预设");
    const runtime = loadAiProviderRuntime();
    const current = runtime.providers.find((provider) => provider.name === preset.name);
    if (current?.credentialSource === "zhenxi_ai_shared") {
      if (input.apiKey !== undefined || input.baseUrl !== undefined || input.enabled !== undefined) {
        throw new BadRequestException("共享配置的密钥、API 地址和启用状态请在臻希 AI 中维护");
      }
      const model = cleanCredentialValue(input.model, "模型名称", 200, false);
      if (!model) throw new BadRequestException("请选择要设为当前的模型");
      if (!current.sharedSourceConfigured || !current.sharedEnvPath || !current.sharedModelEnv) {
        throw new BadRequestException("臻希 AI 共享模型配置不可写，请先检查共享配置文件");
      }
      persistPrivateEnvValues(current.sharedEnvPath, { [current.sharedModelEnv]: model });
      const status = await this.getStatus(false);
      return {
        saved: true,
        restartRequired: false,
        provider: status.providers.find((provider) => provider.name === preset.name),
        detail: `已将 ${model} 设为 ${preset.label} 当前模型；共享密钥和 API 地址未变更。`,
      };
    }
    const enabled = input.enabled !== false;
    const suppliedKey = cleanCredentialValue(input.apiKey, "API Key", 8_192, false);
    if (enabled && !suppliedKey && (!current || current.issues.includes("api_key_unset"))) {
      throw new BadRequestException("启用该供应商前请填写 API Key");
    }
    const model = input.model === undefined || input.model === null
      ? current?.model || preset.model
      : cleanCredentialValue(input.model, "模型名称", 200, false);
    const baseUrl = input.baseUrl === undefined || input.baseUrl === null
      ? current?.baseUrl || preset.baseUrl
      : cleanProviderBaseUrl(input.baseUrl);
    if (enabled && !model) throw new BadRequestException("启用该供应商前请填写模型名称");
    if (enabled && !baseUrl) throw new BadRequestException("启用该供应商前请填写 API 地址");
    const updates: Record<string, string> = {
      [preset.enabledEnv]: enabled ? "true" : "false",
      [preset.modelEnv]: model,
      [providerBaseUrlEnv(preset)]: baseUrl,
    };
    if (suppliedKey) updates[preset.apiKeyEnv] = suppliedKey;
    persistPrivateEnvValues(runtime.envPath, updates);
    for (const [key, value] of Object.entries(updates)) process.env[key] = value;
    const status = await this.getStatus(false);
    return {
      saved: true,
      restartRequired: false,
      provider: status.providers.find((provider) => provider.name === preset.name),
      detail: enabled
        ? `${preset.label} 已启用并加入${preset.routingTier === "economy" ? "快速" : "高质量"}模型路由。`
        : `${preset.label} 已停用，已保存的密钥不会显示或写入日志。`,
    };
  }

  async saveProviderBillingCredential(input: {
    provider?: string;
    accessKeyId?: string;
    accessKeySecret?: string;
    adminKey?: string;
  }) {
    const providerName = String(input.provider || "").trim();
    const runtime = loadAiProviderRuntime();
    const updates: Record<string, string> = {};
    let detail = "";
    if (providerName === "dashscope") {
      const accessKeyId = cleanCredentialValue(input.accessKeyId, "阿里云 AccessKey ID", 512, false);
      const accessKeySecret = cleanCredentialValue(input.accessKeySecret, "阿里云 AccessKey Secret", 2_048, false);
      if (!accessKeyId && !runtime.billingCredentials.alibabaCloudAccessKeyId) {
        throw new BadRequestException("请填写阿里云 RAM AccessKey ID");
      }
      if (!accessKeySecret && !runtime.billingCredentials.alibabaCloudAccessKeySecret) {
        throw new BadRequestException("请填写阿里云 RAM AccessKey Secret");
      }
      if (accessKeyId) updates.ALIBABA_CLOUD_ACCESS_KEY_ID = accessKeyId;
      if (accessKeySecret) updates.ALIBABA_CLOUD_ACCESS_KEY_SECRET = accessKeySecret;
      detail = "千问余额凭证已安全保存。余额查询将调用阿里云 BSS QueryAccountBalance，不会发送模型消息。";
    } else if (providerName === "openai") {
      const adminKey = cleanCredentialValue(input.adminKey, "OpenAI Admin Key", 8_192, false);
      if (!adminKey && !runtime.billingCredentials.openAiAdminKey) {
        throw new BadRequestException("请填写 OpenAI Admin Key；普通模型 API Key 不能查询组织费用");
      }
      if (adminKey) updates.OPENAI_ADMIN_KEY = adminKey;
      detail = "OpenAI 费用凭证已安全保存。官方接口只返回组织消费，不返回充值余额。";
    } else {
      throw new BadRequestException("该供应商没有可配置的官方余额或费用查询凭证");
    }
    persistPrivateEnvValues(runtime.envPath, updates);
    for (const [key, value] of Object.entries(updates)) process.env[key] = value;
    const status = await this.getStatus(false);
    return {
      saved: true,
      restartRequired: false,
      provider: status.providers.find((provider) => provider.name === providerName),
      detail,
    };
  }

  generateServerEnvFile(): AiProviderServerEnvBundle {
    const runtime = loadAiProviderRuntime();
    const bundle = buildServerEnvBundle(runtime);
    writePrivateTextFile(bundle.filePath, bundle.envText);
    return bundle;
  }

  async getProviderBalance(providerName: string): Promise<AiProviderBalanceResult> {
    const runtime = loadAiProviderRuntime();
    const provider = runtime.providers.find((item) => item.name === String(providerName || "").trim());
    if (!provider) throw new BadRequestException("不支持的模型供应商");
    const result = !runtime.enabled
      ? providerBalanceSkipped(provider, runtime, "AI 引擎未启用，未查询余额或费用。")
      : !provider.enabled
        ? providerBalanceSkipped(provider, runtime, "供应商已停用，未查询余额或费用。")
        : !provider.configured
          ? providerBalanceSkipped(provider, runtime, "供应商配置不完整，未查询余额或费用。")
          : await queryProviderBalance(provider, runtime, Math.min(runtime.timeoutSeconds * 1_000, 8_000));
    persistProviderObservation(runtime, provider.name, { balance: result });
    return result;
  }

  async syncProviderModels(providerName: string): Promise<AiProviderModelSyncResult> {
    const runtime = loadAiProviderRuntime();
    const provider = runtime.providers.find((item) => item.name === String(providerName || "").trim());
    if (!provider) throw new BadRequestException("不支持的模型供应商");
    if (!provider.apiKey || provider.issues.includes("api_key_unset")) {
      throw new BadRequestException("请先保存该供应商的 API Key，再获取模型列表");
    }
    if (!provider.baseUrl || provider.issues.includes("base_url_unset") || provider.issues.includes("base_url_invalid")) {
      throw new BadRequestException("请先填写有效的 API 地址，再获取模型列表");
    }

    const endpoint = providerBaseEndpoint(provider, "/models");
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "GET",
        headers: providerModelListHeaders(provider),
        signal: AbortSignal.timeout(Math.min(runtime.timeoutSeconds * 1_000, 8_000)),
      });
    } catch (error) {
      throw new BadRequestException(`模型列表读取失败：${publicError(error)}`);
    }

    const body = await response.text();
    if (body.length > 2_000_000) throw new BadRequestException("模型列表返回过大，已停止读取");
    const payload = parseJsonText(body);
    if (!response.ok) {
      const detail = extractProviderErrorMessage(payload) || `HTTP ${response.status}`;
      throw new BadRequestException(`模型列表读取失败：${cleanErrorText(detail)}`);
    }
    const models = extractProviderModels(payload);
    if (!models.length) throw new BadRequestException("供应商没有返回可用模型，请检查 API 地址是否包含正确的版本路径");
    return {
      synced: true,
      provider: provider.name,
      label: provider.label,
      source: "upstream",
      endpoint,
      fetchedAt: new Date().toISOString(),
      models,
    };
  }

  async testProviderResponse(providerName: string): Promise<AiProviderResponseTestResult> {
    const runtime = loadAiProviderRuntime();
    const provider = runtime.providers.find((item) => item.name === String(providerName || "").trim());
    if (!provider) throw new BadRequestException("不支持的模型供应商");
    const expectedReply = "客服连接测试通过";
    const base = {
      tested: true as const,
      testedAt: new Date().toISOString(),
      provider: provider.name,
      label: provider.label,
      model: provider.model,
      enabled: provider.enabled,
      configured: provider.configured,
      testUrl: `/api/ai/providers/${encodeURIComponent(provider.name)}/test`,
      requestKind: "chat_completion" as const,
      expectedReply,
    };
    const finish = (result: AiProviderResponseTestResult) => {
      persistProviderObservation(runtime, provider.name, { test: result, balance: result.balance });
      return result;
    };
    const configurationOk = runtime.enabled && provider.enabled && provider.configured;
    if (!configurationOk) {
      return finish(buildProviderResponseTestResult({
        ...base,
        available: false,
        latencyMs: 0,
        responseText: "",
        balance: providerBalanceSkipped(provider, runtime, !runtime.enabled ? "AI 引擎未启用，未查询余额或费用。" : "供应商配置不完整，未查询余额或费用。"),
        error: [
          !runtime.enabled ? "ai_engine_disabled" : "",
          ...provider.issues,
        ].filter(Boolean).join("; ") || "provider_not_configured",
      }));
    }

    const router = new OpenAiCompatibleRouter(runtime, { performanceTracker: this.performanceTracker });
    const startedAt = Date.now();
    try {
      const result = await router.completeWithProvider(
        provider.name,
        buildProviderResponseTestMessages(expectedReply),
        0,
        Math.min(runtime.timeoutSeconds * 1_000, 8_000),
      );
      const latencyMs = Date.now() - startedAt;
      const balance = await queryProviderBalance(provider, runtime, Math.min(runtime.timeoutSeconds * 1_000, 8_000));
      return finish(buildProviderResponseTestResult({
        ...base,
        available: true,
        latencyMs,
        responseText: result.text,
        balance,
      }));
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const balance = await queryProviderBalance(provider, runtime, Math.min(runtime.timeoutSeconds * 1_000, 8_000));
      return finish(buildProviderResponseTestResult({
        ...base,
        available: false,
        latencyMs,
        responseText: "",
        balance,
        error: publicError(error),
      }));
    }
  }
}

export type AiComplexityDecision = {
  tier: AiRoutingTier;
  score: number;
  reasons: string[];
};

export function classifySuggestionComplexity(input: AiSuggestionInput, threshold = 4): AiComplexityDecision {
  const reasons: string[] = [];
  let score = 0;
  const customerMessage = String(input.customerMessage || "").trim();
  const ruleSuggestion = String(input.ruleSuggestion || "").trim();
  const scene = String(input.scene || "").trim();
  const nextAction = String(input.nextAction || "").trim();
  const historyTurns = (input.conversationHistory || []).length;
  const knowledgeMatches = (input.knowledgeMatches || []).length;
  const requiredTerms = uniqueStrings(input.requiredTerms || []).length;

  if (customerMessage.length > 80) {
    score += 2;
    reasons.push("long_customer_message");
  } else if (customerMessage.length > 36) {
    score += 1;
    reasons.push("medium_customer_message");
  }
  if (historyTurns >= 6) {
    score += 3;
    reasons.push("deep_multi_turn_context");
  } else if (historyTurns >= 3) {
    score += 2;
    reasons.push("multi_turn_context");
  }
  if (knowledgeMatches >= 2) {
    score += 2;
    reasons.push("multiple_knowledge_matches");
  } else if (knowledgeMatches === 1) {
    score += 1;
    reasons.push("knowledge_grounding");
  }
  if (requiredTerms >= 4) {
    score += 2;
    reasons.push("many_verified_facts");
  } else if (requiredTerms >= 2) {
    score += 1;
    reasons.push("verified_facts");
  }
  if (ruleSuggestion.length > 120) {
    score += 2;
    reasons.push("long_business_baseline");
  }
  if (/投诉|维权|退款|赔偿|售后|支付|付款|报价|订单|发票|合同|定制|异常|人工复核/.test(`${scene}\n${nextAction}`)) {
    score += 3;
    reasons.push("sensitive_business_scene");
  }
  if (/生气|愤怒|投诉|骗子|欺骗|太慢|差评|报警|律师|不满意|怎么还|为什么还/.test(customerMessage)) {
    score += 3;
    reasons.push("negative_or_urgent_tone");
  }
  if (/transaction|payment|order|quote|after_sales|complaint|refund/i.test(String(input.agentKey || ""))) {
    score += 2;
    reasons.push("transactional_agent");
  }

  const normalizedThreshold = Math.max(1, Math.min(20, Math.floor(Number(threshold) || 4)));
  const tier = input.routingHint || (score >= normalizedThreshold ? "quality" : "economy");
  if (input.routingHint) reasons.unshift(`explicit_${input.routingHint}_hint`);
  if (!reasons.length) reasons.push("short_low_risk_dialogue");
  return { tier, score, reasons };
}

export function providerOrderForTier(runtime: AiProviderRuntimeConfig, tier: AiRoutingTier) {
  if (!runtime.routing.enabled) return uniqueStrings([runtime.primary, ...runtime.fallbackChain]);
  const configuredEconomy = runtime.providers
    .filter((provider) => provider.configured && provider.routingTier === "economy")
    .map((provider) => provider.name);
  const configuredQuality = runtime.providers
    .filter((provider) => provider.configured && provider.routingTier === "quality")
    .map((provider) => provider.name);
  if (tier === "quality") {
    return uniqueStrings([
      ...runtime.routing.qualityChain,
      ...configuredQuality,
      ...runtime.routing.economyChain,
      ...configuredEconomy,
    ]);
  }
  // A simple request may safely upgrade when every economical provider is unavailable.
  return uniqueStrings([
    ...runtime.routing.economyChain,
    ...configuredEconomy,
    ...runtime.routing.qualityChain,
    ...configuredQuality,
  ]);
}

export function customerServiceReplyPriorityProviders(runtime: AiProviderRuntimeConfig) {
  return CUSTOMER_SERVICE_REPLY_PRIORITY_PROVIDERS.filter((name) =>
    runtime.providers.some((provider) => provider.name === name && provider.configured),
  );
}

function withRoutingMetadata(
  result: AiCompletionResult,
  runtime: AiProviderRuntimeConfig,
  complexity: AiComplexityDecision,
  requestedTier?: AiRoutingTier,
): AiCompletionResult {
  if (!requestedTier) return result;
  const resolvedTier = runtime.providers.find((provider) => provider.name === result.provider)?.routingTier
    || (runtime.routing.economyChain.includes(result.provider)
      ? "economy"
      : runtime.routing.qualityChain.includes(result.provider)
        ? "quality"
        : requestedTier);
  return {
    ...result,
    requestedTier,
    resolvedTier,
    complexityScore: complexity.score,
    complexityReasons: complexity.reasons,
  };
}

export class OpenAiCompatibleRouter {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly performanceTracker: AiProviderPerformanceTracker;
  private readonly now: () => number;

  constructor(private readonly runtime: AiProviderRuntimeConfig, options: RouterOptions = {}) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.performanceTracker = options.performanceTracker || new AiProviderPerformanceTracker();
    this.now = options.now || (() => Date.now());
  }

  async complete(messages: ChatMessage[], options: CompletionOptions = {}): Promise<AiCompletionResult> {
    if (!this.runtime.enabled) throw new Error("AI engine is disabled");
    const configured = new Map(this.runtime.providers.filter((provider) => provider.configured).map((provider) => [provider.name, provider]));
    const requestedOrder = uniqueStrings(
      options.providerOrder !== undefined
        ? options.providerOrder
        : [this.runtime.primary, ...this.runtime.fallbackChain],
    );
    const eligibleProviders = requestedOrder.length
      ? requestedOrder.filter((name) => configured.has(name))
      : [...configured.keys()];
    const adaptiveOrder = this.prioritizedAdaptiveOrder(eligibleProviders, options.priorityProviderOrder);
    const providers = adaptiveOrder.slice(
      0,
      options.deadlineAt ? MAX_DEADLINE_PROVIDER_CANDIDATES : MAX_STANDARD_PROVIDER_CANDIDATES,
    );
    if (!providers.length) throw new Error("No configured AI provider");
    const failures: string[] = [];
    for (let index = 0; index < providers.length; index += 1) {
      const providerName = providers[index];
      const remainingMs = remainingDeadlineMs(options.deadlineAt);
      if (remainingMs !== null && remainingMs <= 0) break;
      const provider = configured.get(providerName);
      const fallbackCandidates = providers
        .slice(index + 1)
        .map((name) => configured.get(name))
        .filter((item): item is AiProviderConfig => Boolean(item));
      const timeoutMs = provider
        ? adaptiveProviderTimeoutMs(
          this.runtime,
          provider,
          this.performanceTracker.snapshot(providerName),
          remainingMs,
          fallbackCandidates.map((candidate) => ({
            provider: candidate,
            performance: this.performanceTracker.snapshot(candidate.name),
          })),
        )
        : remainingMs ?? undefined;
      try {
        return await this.completeWithProvider(
          providerName,
          messages,
          options.maxRetries ?? this.runtime.maxRetries,
          timeoutMs,
        );
      } catch (error) {
        failures.push(`${providerName}: ${publicError(error)}`);
      }
    }
    throw new Error(`All AI providers failed: ${failures.join("; ")}`);
  }

  async completeWithProvider(
    providerName: string,
    messages: ChatMessage[],
    maxRetries = this.runtime.maxRetries,
    timeoutMs?: number,
  ) {
    const provider = this.runtime.providers.find((item) => item.name === providerName);
    if (!provider?.configured) throw new Error(`Provider is not configured: ${providerName}`);
    let attempts = 0;
    let lastError: unknown;
    for (let retry = 0; retry <= maxRetries; retry += 1) {
      attempts += 1;
      const startedAt = this.now();
      try {
        const text = await this.request(provider, messages, timeoutMs);
        this.performanceTracker.recordSuccess(provider.name, this.now() - startedAt);
        return { text, provider: provider.name, model: provider.model, attempts };
      } catch (error) {
        this.performanceTracker.recordFailure(provider.name, this.now() - startedAt);
        lastError = error;
        if (retry >= maxRetries || !isRetryable(error)) break;
        await this.sleep(Math.min(1000, 250 * 2 ** retry));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("AI provider request failed");
  }

  private prioritizedAdaptiveOrder(eligibleProviders: string[], priorityProviderOrder?: string[]) {
    const eligible = uniqueStrings(eligibleProviders);
    const priority = uniqueStrings(priorityProviderOrder || []).filter((name) => eligible.includes(name));
    if (!priority.length) return this.performanceTracker.order(this.runtime, eligible);

    const priorityOrder = this.performanceTracker.order(this.runtime, priority);
    const priorityAvailable = priorityOrder.filter(
      (name) => this.performanceTracker.snapshot(name).circuitState !== "open",
    );
    const remaining = eligible.filter((name) => !priority.includes(name));
    const fallbackOrder = this.performanceTracker.order(this.runtime, remaining);
    const openPriority = priorityOrder.filter((name) =>
      !priorityAvailable.includes(name) && !fallbackOrder.includes(name),
    );
    return uniqueStrings([...priorityAvailable, ...fallbackOrder, ...openPriority]);
  }

  async completeVision(input: AiVisionInput): Promise<AiCompletionResult> {
    const images = Array.isArray(input.images) ? input.images.slice(0, 5) : [];
    if (!images.length) throw new Error("Vision input requires at least one image");
    for (const image of images) {
      if (!Buffer.isBuffer(image.bytes) || image.bytes.length === 0) throw new Error("Vision image is empty");
      if (!new Set(["image/jpeg", "image/png"]).has(image.mimeType)) throw new Error("Vision image type is unsupported");
    }
    const providers = this.multimodalProviders("vision");
    if (!providers.length) throw new Error("No configured vision provider");
    const failures: string[] = [];
    for (const provider of providers) {
      const startedAt = this.now();
      try {
        const text = await this.requestVision(provider, images, String(input.prompt || "").trim());
        this.performanceTracker.recordSuccess(provider.name, this.now() - startedAt);
        return { text, provider: provider.name, model: provider.visionModel, attempts: 1 };
      } catch (error) {
        this.performanceTracker.recordFailure(provider.name, this.now() - startedAt);
        failures.push(`${provider.name}: ${publicError(error)}`);
      }
    }
    throw new Error(`All vision providers failed: ${failures.join("; ")}`);
  }

  async transcribe(input: AiTranscriptionInput): Promise<AiCompletionResult> {
    if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) throw new Error("Audio transcription input is empty");
    const providers = this.multimodalProviders("transcription");
    if (!providers.length) throw new Error("No configured transcription provider");
    const failures: string[] = [];
    for (const provider of providers) {
      const startedAt = this.now();
      try {
        const text = await this.requestTranscription(provider, input);
        this.performanceTracker.recordSuccess(provider.name, this.now() - startedAt);
        return {
          text,
          provider: provider.name,
          model: provider.transcriptionModel || provider.audioInputModel,
          attempts: 1,
        };
      } catch (error) {
        this.performanceTracker.recordFailure(provider.name, this.now() - startedAt);
        failures.push(`${provider.name}: ${publicError(error)}`);
      }
    }
    throw new Error(`All transcription providers failed: ${failures.join("; ")}`);
  }

  private multimodalProviders(kind: "vision" | "transcription") {
    const eligible = this.runtime.providers.filter((provider) => (
      provider.configured
      && (kind === "vision"
        ? provider.visionEnabled && provider.requestFormat === "openai"
        : Boolean(provider.transcriptionModel || (provider.audioInputEnabled && provider.requestFormat === "openai")))
    ));
    const configured = new Map(eligible.map((provider) => [provider.name, provider]));
    const declared = kind === "vision"
      ? this.runtime.multimodal.visionChain
      : this.runtime.multimodal.transcriptionChain;
    const requested = uniqueStrings(declared.length
      ? declared
      : [this.runtime.primary, ...this.runtime.fallbackChain, ...eligible.map((provider) => provider.name)]);
    return this.performanceTracker.order(this.runtime, requested.filter((name) => configured.has(name)))
      .map((name) => configured.get(name))
      .filter((provider): provider is AiProviderConfig => Boolean(provider));
  }

  private async requestVision(
    provider: AiProviderConfig,
    images: AiVisionInput["images"],
    prompt: string,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.runtime.multimodal.visionTimeoutSeconds * 1000);
    try {
      const endpoint = provider.apiEndpoint.startsWith("/") ? provider.apiEndpoint : `/${provider.apiEndpoint}`;
      const content: OpenAiContentPart[] = [
        { type: "text", text: prompt || "请准确描述图片中与客户采购需求有关的内容。" },
        ...images.map((image) => ({
          type: "image_url" as const,
          image_url: {
            url: `data:${image.mimeType};base64,${image.bytes.toString("base64")}`,
            detail: "low" as const,
          },
        })),
      ];
      const response = await this.fetchImpl(`${provider.baseUrl}${endpoint}`, {
        method: "POST",
        headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: provider.visionModel,
          messages: [{ role: "user", content }],
          temperature: Math.min(0.3, provider.temperature),
          max_tokens: Math.min(800, provider.maxTokens),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = cleanErrorText(await response.text());
        throw new AiRequestError(response.status, detail || response.statusText);
      }
      const data = (await response.json()) as any;
      const raw = data?.choices?.[0]?.message?.content;
      const text = Array.isArray(raw)
        ? raw.map((item: any) => (typeof item === "string" ? item : item?.text || "")).join("")
        : String(raw || "");
      const cleaned = cleanModelText(text);
      if (!cleaned) throw new Error("Vision provider returned an empty completion");
      return cleaned;
    } catch (error) {
      if (controller.signal.aborted) throw new AiRequestError(408, "vision request timeout");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestTranscription(provider: AiProviderConfig, input: AiTranscriptionInput) {
    if (!provider.transcriptionModel && provider.audioInputEnabled) {
      return this.requestAudioInputTranscription(provider, input);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.runtime.multimodal.transcriptionTimeoutSeconds * 1000);
    try {
      const endpoint = provider.transcriptionEndpoint.startsWith("/")
        ? provider.transcriptionEndpoint
        : `/${provider.transcriptionEndpoint}`;
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType || "audio/wav" }), input.fileName || "customer-audio.wav");
      form.append("model", provider.transcriptionModel);
      form.append("language", "zh");
      if (String(input.prompt || "").trim()) form.append("prompt", String(input.prompt).trim().slice(0, 500));
      const response = await this.fetchImpl(`${provider.baseUrl}${endpoint}`, {
        method: "POST",
        headers: { authorization: `Bearer ${provider.apiKey}` },
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = cleanErrorText(await response.text());
        throw new AiRequestError(response.status, detail || response.statusText);
      }
      const data = (await response.json()) as any;
      const cleaned = cleanModelText(String(data?.text || ""));
      if (!cleaned) throw new Error("Transcription provider returned empty text");
      return cleaned;
    } catch (error) {
      if (controller.signal.aborted) throw new AiRequestError(408, "transcription request timeout");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestAudioInputTranscription(provider: AiProviderConfig, input: AiTranscriptionInput) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.runtime.multimodal.transcriptionTimeoutSeconds * 1000);
    try {
      const endpoint = provider.apiEndpoint.startsWith("/") ? provider.apiEndpoint : `/${provider.apiEndpoint}`;
      const prompt = [
        "请把客户语音逐字转写成简体中文。只输出转写正文，不要解释，不要猜测听不清的内容。",
        String(input.prompt || "").trim() ? `可能出现的伴手礼行业词：${String(input.prompt).trim().slice(0, 500)}` : "",
      ].filter(Boolean).join("\n");
      const content: OpenAiContentPart[] = [
        { type: "text", text: prompt },
        { type: "input_audio", input_audio: { data: input.bytes.toString("base64"), format: "wav" } },
      ];
      const response = await this.fetchImpl(`${provider.baseUrl}${endpoint}`, {
        method: "POST",
        headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: provider.audioInputModel,
          messages: [{ role: "user", content }],
          temperature: 0,
          max_tokens: Math.min(1_200, provider.maxTokens),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = cleanErrorText(await response.text());
        throw new AiRequestError(response.status, detail || response.statusText);
      }
      const data = (await response.json()) as any;
      const raw = data?.choices?.[0]?.message?.content;
      const text = Array.isArray(raw)
        ? raw.map((item: any) => (typeof item === "string" ? item : item?.text || "")).join("")
        : String(raw || "");
      const cleaned = cleanModelText(text);
      if (!cleaned) throw new Error("Audio input provider returned empty text");
      return cleaned;
    } catch (error) {
      if (controller.signal.aborted) throw new AiRequestError(408, "audio input request timeout");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request(provider: AiProviderConfig, messages: ChatMessage[], timeoutMs?: number) {
    if (!provider.visionEnabled && messages.some((message) => (
      Array.isArray(message.content) && message.content.some((part) => part.type === "image_url")
    ))) {
      throw new Error(`Provider does not support image input: ${provider.name}`);
    }
    const controller = new AbortController();
    const requestTimeoutMs = Math.max(
      25,
      Math.min(this.runtime.timeoutSeconds * 1000, Number(timeoutMs) || this.runtime.timeoutSeconds * 1000),
    );
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const endpoint = provider.apiEndpoint.startsWith("/") ? provider.apiEndpoint : `/${provider.apiEndpoint}`;
      const anthropic = provider.requestFormat === "anthropic";
      const response = await this.fetchImpl(`${provider.baseUrl}${endpoint}`, {
        method: "POST",
        headers: anthropic
          ? {
            "x-api-key": provider.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          }
          : { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(anthropic
          ? anthropicRequestBody(provider, messages)
          : openAiRequestBody(provider, messages)),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = cleanErrorText(await response.text());
        throw new AiRequestError(response.status, detail || response.statusText);
      }
      const data = (await response.json()) as any;
      const content = anthropic ? data?.content : data?.choices?.[0]?.message?.content;
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

function emptyProviderPerformance(): AiProviderPerformanceSnapshot {
  return {
    sampleCount: 0,
    successCount: 0,
    failureCount: 0,
    successRate: null,
    averageLatencyMs: null,
    lastLatencyMs: null,
    consecutiveFailures: 0,
    circuitState: "unmeasured",
    cooldownRemainingMs: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
  };
}

function isoTimestamp(value: number | null) {
  return value && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function adaptiveProviderTimeoutMs(
  runtime: AiProviderRuntimeConfig,
  provider: AiProviderConfig,
  performance: AiProviderPerformanceSnapshot,
  remainingMs: number | null,
  fallbackCandidates: Array<{ provider: AiProviderConfig; performance: AiProviderPerformanceSnapshot }>,
) {
  const configuredMaximum = runtime.timeoutSeconds * 1_000;
  const baseline = provider.routingTier === "economy" ? 4_000 : 6_500;
  const learnedTarget = performance.averageLatencyMs === null
    ? baseline
    : Math.round(performance.averageLatencyMs * 1.25 + 250);
  let timeoutMs = Math.max(500, Math.min(configuredMaximum, learnedTarget));
  if (remainingMs !== null) {
    const currentExpected = performance.averageLatencyMs ?? baseline;
    const fallbackExpected = fallbackCandidates.length
      ? Math.min(...fallbackCandidates.map(({ provider: candidate, performance: candidatePerformance }) => (
        candidatePerformance.averageLatencyMs ?? (candidate.routingTier === "economy" ? 4_000 : 6_500)
      )))
      : null;
    const fallbackCanFit = fallbackExpected !== null
      && currentExpected + fallbackExpected + 400 <= remainingMs;
    const currentIsMeasuredReliable = performance.averageLatencyMs !== null
      && performance.successRate !== null
      && performance.successRate > 0
      && performance.consecutiveFailures === 0;
    const reserveForFallback = fallbackExpected === null
      ? 0
      : fallbackCanFit
        ? Math.min(Math.round(fallbackExpected + 250), Math.floor(remainingMs * 0.45))
        : currentIsMeasuredReliable
          ? 300
          : Math.max(1_200, Math.floor(remainingMs * 0.45));
    timeoutMs = Math.min(timeoutMs, Math.max(300, remainingMs - reserveForFallback));
  }
  return Math.max(25, Math.round(timeoutMs));
}

export function buildSuggestionMessages(input: AiSuggestionInput): ChatMessage[] {
  const knowledge = (input.knowledgeMatches || [])
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${cleanPromptText(item.title)}：${cleanPromptText(item.excerpt)}`)
    .filter((item) => !item.endsWith("："));
  const history = (input.conversationHistory || [])
    .slice(-8)
    .map((item) => `${item.role === "assistant" ? "客服" : "客户"}：${cleanHistoryText(item.content)}`)
    .filter((item) => !item.endsWith("："));
  const requiredTerms = uniqueStrings(input.requiredTerms || []).slice(0, 30);
  const dialogueKnownFacts = uniqueStrings(input.dialoguePlan?.knownFacts || []).slice(0, 12);
  const prohibitedQuestions = uniqueStrings(input.dialoguePlan?.prohibitedQuestions || []).slice(0, 8);
  const styleGuidance = xiaoshiPromptGuidance(input.styleProfile || {});
  const recentOpenings = uniqueStrings(
    (input.conversationHistory || [])
      .filter((item) => item.role === "assistant")
      .slice(-4)
      .map((item) => replyOpening(item.content)),
  );
  const system = [
    "你是企业微信智能客服的回复生成层，只输出一条可直接发送的中文回复正文，不要解释过程。",
    "业务规则生成的基准回复和当前会话已匹配知识是唯一可信事实，优先级高于语言模型常识；基准回复是事实与动作底稿，不是让你照抄的文案模板。",
    "最近对话只用于理解指代、语气和上下文，不得用它覆盖业务规则，也不得把客户声称的内容当成已核验事实。",
    "不得新增价格、时效、库存、退款、赔偿、承诺或身份信息；不确定时保持基准回复。",
    "不得改变下一步动作，不得把可自动处理的会话擅自转人工。",
    "像有经验的真人客服一样按语境说话：短问短答，客户犹豫时给选择，客户着急时先回应关键风险，客户不满时郑重承接；不要每轮都机械套用“收到—说明—下一步”的固定结构。",
    "先在内部判断客户这句话是在询问、补充、纠正、拒绝还是催促，以及它承接上一轮的哪一点；只输出最终回复，不输出分析过程。",
    "回答不是把基准句换同义词：要结合最近对话决定本轮应该直接回答、给建议、确认理解，还是只问一个真正必要的问题。",
    "不要用“请稍等”“稍后给您推荐”“晚点回复”结束对话，除非基准回复明确允许并且系统确实安排了后续动作；当前能回答的内容必须当场回答。",
    "已匹配知识中标记为真人原话的内容是语气和接话顺序示例；其中“｜”表示客服原来分开发送的连续短消息，可以用换行保留这种短句节奏，不要改写成公文式长段落。",
    "客户只发问候时，只用一句短话自然应声，不自我介绍、不展示服务菜单，也不要让客户从礼盒、价格、订单、物流等选项里做选择。",
    "客户已经提出具体问题时，先给一个基于可信事实的判断或建议，再只推进当前最关键的一步；除非规则明确要求，不要一次罗列三四个问题让客户像填表。",
    "一轮通常 1 至 3 个短句，最长 200 个汉字；信息简单时一句说清，不为了显得热情而堆客套话。",
    "不要每次自我介绍，不要复述整段服务范围，不要连续使用相同开头或结尾，也不要把客户已经给出的信息再问一遍。",
    "新客默认称呼“您”，但不必每句都带称呼；不要默认叫“亲”或“姐”。客户指出回复机械、重复或答非所问时，先简短承认，再沿着当前对话继续。",
    ...styleGuidance,
    "禁止输出半句话、未结束的句子、占位符、标题、分析过程或“润色后”等标签。",
  ].join("\n");
  const user = [
    `客户消息：${cleanPromptText(input.customerMessage)}`,
    `业务场景：${cleanPromptText(input.scene) || "未标注"}`,
    `处理智能体：${cleanPromptText(input.agentKey) || "未标注"}`,
    `客服风格：${cleanPromptText(input.styleProfile?.name) || "通用真人客服"}`,
    `既定下一步：${cleanPromptText(input.nextAction) || "沿用基准回复"}`,
    `本轮对话意图：${cleanPromptText(input.dialoguePlan?.intent) || "按客户当前消息判断"}`,
    `本轮沟通目标：${cleanPromptText(input.dialoguePlan?.objective) || "先回答客户当前问题，再自然推进一小步"}`,
    dialogueKnownFacts.length ? `已经确认的信息（不得重复询问）：${dialogueKnownFacts.join("、")}` : "当前没有额外已确认字段。",
    prohibitedQuestions.length ? `本轮禁止再次追问：${prohibitedQuestions.join("、")}` : "本轮没有额外禁止追问项。",
    `客户表达特点：${customerToneGuidance(input.customerMessage)}`,
    history.length ? `最近对话（按时间顺序）：\n${history.join("\n")}` : "当前没有可用的历史对话。",
    recentOpenings.length ? `最近客服已经用过这些开头，本轮不要重复：${recentOpenings.join(" / ")}` : "没有需要避开的近期客服开头。",
    `规则基准回复：${cleanPromptText(input.ruleSuggestion)}`,
    knowledge.length ? `当前会话已匹配知识：\n${knowledge.join("\n")}` : "当前会话无知识命中。",
    requiredTerms.length ? `必须逐字保留的已核实信息：${requiredTerms.join("、")}` : "没有额外的逐字保留项。",
    "请结合最近对话重新组织语言，在不改变事实和动作的前提下生成自然完整的回复；不要只给基准回复加一个客套开头。",
  ].join("\n");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

export function buildFastSuggestionMessages(input: AiSuggestionInput): ChatMessage[] {
  const history = (input.conversationHistory || [])
    .slice(-6)
    .map((item) => `${item.role === "assistant" ? "客服" : "客户"}：${cleanHistoryText(item.content)}`)
    .filter((item) => !item.endsWith("："));
  const knowledge = (input.knowledgeMatches || [])
    .slice(0, 2)
    .map((item) => [cleanPromptText(item.title), cleanPromptText(item.excerpt)].filter(Boolean).join("："))
    .filter(Boolean);
  const requiredTerms = uniqueStrings(input.requiredTerms || []).slice(0, 20);
  const knownFacts = uniqueStrings(input.dialoguePlan?.knownFacts || []).slice(0, 10);
  const prohibitedQuestions = uniqueStrings(input.dialoguePlan?.prohibitedQuestions || []).slice(0, 6);
  const styleGuidance = xiaoshiPromptGuidance(input.styleProfile || {}).slice(0, 3);
  const system = [
    "你是伴手礼行业的企业微信真人客服，只输出一条可直接发送的中文回复。",
    "规则基准、已匹配知识和已确认信息是唯一可信事实；禁止编造价格、库存、交期、退款、承诺或身份。",
    "先直接回答客户这句话，再自然推进一个最关键的下一步；客户已给的信息不要再问。",
    "像微信聊天：通常1至3个短句，信息简单时一句说清，不自我介绍、不列服务菜单、不堆客套话。",
    "不要用请稍等、稍后回复或转人工结束，除非规则基准明确要求且已有真实后续动作。",
    "不要照抄固定模板；结合最近对话判断客户是在询问、补充、纠正、拒绝还是催促。",
    ...styleGuidance,
  ].join("\n");
  const user = [
    `客户：${cleanPromptText(input.customerMessage)}`,
    history.length ? `最近对话：\n${history.join("\n")}` : "最近对话：无",
    `规则基准：${cleanPromptText(input.ruleSuggestion)}`,
    knowledge.length ? `可用知识：${knowledge.join("；")}` : "可用知识：无",
    knownFacts.length ? `已确认且不得重复询问：${knownFacts.join("；")}` : "已确认信息：无",
    prohibitedQuestions.length ? `本轮禁止再问：${prohibitedQuestions.join("；")}` : "禁止再问：无额外项",
    requiredTerms.length ? `必须原样保留：${requiredTerms.join("；")}` : "必须保留：无额外项",
    `下一步：${cleanPromptText(input.nextAction) || "先回答当前问题，只推进一小步"}`,
  ].join("\n");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function openAiRequestBody(provider: AiProviderConfig, messages: ChatMessage[]) {
  return {
    model: provider.model,
    messages,
    temperature: provider.temperature,
    max_tokens: provider.maxTokens,
    ...(provider.name === "deepseek" && /^deepseek-v4-/i.test(provider.model)
      ? { thinking: { type: "disabled" } }
      : {}),
  };
}

function anthropicRequestBody(provider: AiProviderConfig, messages: ChatMessage[]) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => typeof message.content === "string"
      ? message.content
      : message.content.map((part) => part.type === "text" ? part.text : "").filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");
  return {
    model: provider.model,
    max_tokens: provider.maxTokens,
    temperature: provider.temperature,
    ...(system ? { system } : {}),
    messages: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role, content: message.content })),
  };
}

function cleanCredentialValue(value: unknown, label: string, maxLength: number, required: boolean) {
  const cleaned = String(value || "").trim();
  if (!cleaned && !required) return "";
  if (!cleaned) throw new BadRequestException(`${label}不能为空`);
  if (cleaned.length > maxLength) throw new BadRequestException(`${label}长度超过限制`);
  if (/\r|\n|\0/.test(cleaned)) throw new BadRequestException(`${label}不能包含换行或空字符`);
  return cleaned;
}

function cleanProviderBaseUrl(value: unknown) {
  const cleaned = cleanCredentialValue(value, "API 地址", 2_048, false);
  if (!cleaned) return "";
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new BadRequestException("API 地址必须是完整的 http 或 https 地址");
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new BadRequestException("API 地址只支持 http 或 https");
  if (parsed.username || parsed.password) throw new BadRequestException("API 地址不能包含账号或密码");
  if (parsed.search || parsed.hash) throw new BadRequestException("API 地址不能包含查询参数或锚点");
  return trimTrailingSlash(cleaned);
}

function persistPrivateEnvValues(envPath: string, updates: Record<string, string>) {
  const target = path.resolve(envPath);
  let current = "";
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new BadRequestException("模型密钥配置文件不是安全的普通文件");
    current = fs.readFileSync(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
  const names = Object.keys(updates);
  const matcher = new RegExp(`^\\s*(${names.map(escapeRegExp).join("|")})\\s*=`);
  const seen = new Set<string>();
  const lines = current.split(/\r?\n/).map((line) => {
    const match = line.match(matcher);
    if (!match) return line;
    const key = match[1];
    seen.add(key);
    return `${key}=${updates[key]}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporaryPath = `${target}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${lines.join("\n").replace(/\n+$/, "")}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, target);
    try { fs.chmodSync(target, 0o600); } catch {}
  } finally {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
  }
}

function buildServerEnvBundle(runtime: AiProviderRuntimeConfig): AiProviderServerEnvBundle {
  const generatedAt = new Date().toISOString();
  const providers = runtime.providers.filter(
    (provider) => provider.keyOnlySetup && provider.credentialSource === "environment" && provider.apiKeyEnv,
  );
  const missingProviders = providers
    .filter((provider) => !provider.apiKey || provider.issues.includes("api_key_unset"))
    .map((provider) => ({
      name: provider.name,
      label: provider.label,
      apiKeyEnv: provider.apiKeyEnv,
      enabledEnv: provider.enabledEnv,
      modelEnv: provider.modelEnv,
      baseUrlEnv: provider.baseUrlEnv,
    }));
  const includedProviders = providers.map((provider) => ({
    name: provider.name,
    label: provider.label,
    enabled: provider.enabled,
    apiKeyConfigured: Boolean(provider.apiKey && !provider.issues.includes("api_key_unset")),
    apiKeyEnv: provider.apiKeyEnv,
    modelEnv: provider.modelEnv,
    baseUrlEnv: provider.baseUrlEnv,
  }));
  const lines = [
    "# Smart Kefu server AI provider secrets",
    `# Generated by the local backend at ${generatedAt}.`,
    "# Copy this into the server runtime .env, keep it private, and never commit it.",
    "# Empty API keys are placeholders for providers that have not been saved locally yet.",
    "",
    "# Official balance/cost query credentials (separate from model API keys)",
    envLine("ALIBABA_CLOUD_ACCESS_KEY_ID", runtime.billingCredentials.alibabaCloudAccessKeyId),
    envLine("ALIBABA_CLOUD_ACCESS_KEY_SECRET", runtime.billingCredentials.alibabaCloudAccessKeySecret),
    envLine("OPENAI_ADMIN_KEY", runtime.billingCredentials.openAiAdminKey),
    "",
  ];
  for (const provider of providers) {
    lines.push(`# ${provider.label} (${provider.name})`);
    lines.push(envLine(provider.enabledEnv, provider.enabled ? "true" : "false"));
    lines.push(envLine(provider.baseUrlEnv, provider.baseUrl || ""));
    lines.push(envLine(provider.modelEnv, provider.model || ""));
    lines.push(envLine(provider.apiKeyEnv, provider.apiKey && !provider.issues.includes("api_key_unset") ? provider.apiKey : ""));
    lines.push("");
  }
  return {
    generated: true,
    generatedAt,
    filePath: resolveServerEnvExportPath(),
    fileName: path.basename(resolveServerEnvExportPath()),
    envText: `${lines.join("\n").replace(/\n+$/, "")}\n`,
    providerCount: providers.length,
    configuredProviderCount: includedProviders.filter((provider) => provider.apiKeyConfigured).length,
    missingProviders,
    includedProviders,
    copyHint: "复制 envText 到服务器 .env 或部署平台的环境变量配置中；空值代表该供应商还没有在本机保存密钥。",
  };
}

function emptyProviderObservations(): AiProviderObservations {
  return {
    schema: "smart_kefu_ai_provider_observations_v1",
    updatedAt: null,
    tests: {},
    balances: {},
  };
}

function resolveProviderObservationsPath(runtime: AiProviderRuntimeConfig) {
  const runtimeDir = process.env.DESKTOP_RUNTIME_DIR
    ? path.resolve(process.env.DESKTOP_RUNTIME_DIR)
    : path.join(path.dirname(runtime.envPath), ".runtime");
  return path.join(runtimeDir, "ai-provider-observations.json");
}

function readProviderObservations(runtime: AiProviderRuntimeConfig): AiProviderObservations {
  const fallback = emptyProviderObservations();
  const target = resolveProviderObservationsPath(runtime);
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1_000_000) return fallback;
    const parsed = asObjectRecord(parseJsonText(fs.readFileSync(target, "utf8")));
    if (parsed.schema !== fallback.schema) return fallback;
    const rawTests = asObjectRecord(parsed.tests);
    const rawBalances = asObjectRecord(parsed.balances);
    const tests: Record<string, AiProviderResponseTestResult> = {};
    const balances: Record<string, AiProviderBalanceResult> = {};
    for (const [provider, value] of Object.entries(rawTests)) {
      if (safeObservationProviderName(provider) && isStoredProviderTest(provider, value)) tests[provider] = value;
    }
    for (const [provider, value] of Object.entries(rawBalances)) {
      if (safeObservationProviderName(provider) && isStoredProviderBalance(value)) balances[provider] = value;
    }
    return {
      schema: fallback.schema,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      tests,
      balances,
    };
  } catch {
    return fallback;
  }
}

function persistProviderObservation(
  runtime: AiProviderRuntimeConfig,
  provider: string,
  update: { test?: AiProviderResponseTestResult; balance?: AiProviderBalanceResult },
) {
  if (!safeObservationProviderName(provider)) return;
  try {
    const current = readProviderObservations(runtime);
    const next: AiProviderObservations = {
      schema: current.schema,
      updatedAt: new Date().toISOString(),
      tests: { ...current.tests },
      balances: { ...current.balances },
    };
    if (update.test) next.tests[provider] = update.test;
    if (update.balance) next.balances[provider] = update.balance;
    writePrivateTextFile(resolveProviderObservationsPath(runtime), `${JSON.stringify(next, null, 2)}\n`);
  } catch {
    // The paid/read-only upstream result remains authoritative even if the local snapshot cannot be refreshed.
  }
}

function safeObservationProviderName(value: string) {
  return /^[a-z0-9][a-z0-9_.-]{0,79}$/.test(value);
}

function isStoredProviderTest(provider: string, value: unknown): value is AiProviderResponseTestResult {
  const record = asObjectRecord(value);
  return record.tested === true
    && record.provider === provider
    && typeof record.testedAt === "string"
    && typeof record.model === "string"
    && typeof record.available === "boolean"
    && Number.isFinite(record.latencyMs)
    && Number.isFinite(record.charactersPerSecond)
    && isStoredProviderBalance(record.balance);
}

function isStoredProviderBalance(value: unknown): value is AiProviderBalanceResult {
  const record = asObjectRecord(value);
  return typeof record.checked === "boolean"
    && typeof record.supported === "boolean"
    && (record.metric === "balance" || record.metric === "cost")
    && ["available", "insufficient", "unsupported", "error"].includes(String(record.status || ""))
    && typeof record.display === "string"
    && (record.amount === null || Number.isFinite(record.amount))
    && (record.checkedAt === null || typeof record.checkedAt === "string");
}

function asObjectRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function resolveServerEnvExportPath() {
  const runtimeDir = process.env.DESKTOP_RUNTIME_DIR
    ? path.resolve(process.env.DESKTOP_RUNTIME_DIR)
    : path.resolve(process.cwd(), ".runtime");
  return path.join(runtimeDir, "server-ai-provider.env");
}

function envLine(name: string, value: string) {
  return `${name}=${serializeEnvValue(value)}`;
}

function serializeEnvValue(value: string) {
  const textValue = String(value || "");
  if (!textValue) return "";
  if (/^[A-Za-z0-9_./:@+=,\-]+$/.test(textValue)) return textValue;
  return JSON.stringify(textValue);
}

function writePrivateTextFile(filePath: string, content: string) {
  const target = path.resolve(filePath);
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new BadRequestException("服务器密钥导出文件不是安全的普通文件");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporaryPath = `${target}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, target);
    try { fs.chmodSync(target, 0o600); } catch {}
  } finally {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
  }
}

function buildProviderResponseTestMessages(expectedReply: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: "你是客服系统连接测试器。只输出用户要求的固定中文短句，不要解释，不要加标点，不要输出多余文字。",
    },
    {
      role: "user",
      content: `回应连接测试：请只回复「${expectedReply}」。`,
    },
  ];
}

function buildProviderResponseTestResult(input: {
  tested: true;
  testedAt: string;
  provider: string;
  label: string;
  model: string;
  enabled: boolean;
  configured: boolean;
  testUrl: string;
  requestKind: "chat_completion";
  expectedReply: string;
  available: boolean;
  latencyMs: number;
  responseText: string;
  balance: AiProviderBalanceResult;
  error?: string;
}): AiProviderResponseTestResult {
  const responsePreview = cleanModelText(input.responseText).slice(0, 120);
  const normalizedExpected = input.expectedReply.replace(/\s+/g, "");
  const normalizedResponse = responsePreview.replace(/\s+/g, "");
  const outputCharacters = Array.from(responsePreview).length;
  const latencySeconds = Math.max(0.001, input.latencyMs / 1_000);
  const charactersPerSecond = input.available
    ? Math.round(outputCharacters / latencySeconds)
    : 0;
  const replyMatched = Boolean(input.available && normalizedResponse.includes(normalizedExpected));
  const speedOk = input.available;
  return {
    tested: true,
    testedAt: input.testedAt,
    provider: input.provider,
    label: input.label,
    model: input.model,
    enabled: input.enabled,
    configured: input.configured,
    testUrl: input.testUrl,
    requestKind: input.requestKind,
    expectedReply: input.expectedReply,
    available: input.available,
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    outputCharacters,
    charactersPerSecond,
    responsePreview,
    replyMatched,
    balance: input.balance,
    checks: [
      {
        key: "configuration",
        label: "配置检查",
        ok: input.enabled && input.configured,
        detail: input.enabled && input.configured ? "供应商已启用且密钥/模型完整" : "供应商未启用或配置不完整",
      },
      {
        key: "connection",
        label: "连接测试",
        ok: input.available,
        detail: input.available ? "上游接口已返回非空结果" : input.error || "上游接口未返回可用结果",
      },
      {
        key: "response",
        label: "回应测试",
        ok: replyMatched,
        detail: replyMatched ? `模型按要求返回「${input.expectedReply}」` : "模型返回内容与固定测试短句不一致",
      },
      {
        key: "speed",
        label: "速率测试",
        ok: speedOk,
        detail: speedOk ? `${Math.round(input.latencyMs)}ms，约 ${charactersPerSecond} 字/秒` : "未获得可计算的响应耗时",
      },
    ],
    ...(input.error ? { error: input.error } : {}),
  };
}

type ProviderBalanceProbe = {
  source: string;
  endpoint: string;
  metric: "balance" | "cost";
  request: () => { url: string; headers: Record<string, string> };
  parse: (data: unknown, endpoint: string, checkedAt: string) => AiProviderBalanceResult;
};

async function queryProviderBalance(
  provider: AiProviderConfig,
  runtime: AiProviderRuntimeConfig,
  timeoutMs: number,
): Promise<AiProviderBalanceResult> {
  const probe = providerBalanceProbe(provider, runtime);
  if (!probe) return providerBalanceUnsupported(provider, runtime);
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const requestTimeoutMs = Math.max(500, Math.min(Number(timeoutMs) || 3_000, 8_000));
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const request = probe.request();
    const response = await fetch(request.url, {
      method: "GET",
      headers: request.headers,
      signal: controller.signal,
    });
    const bodyText = await response.text();
    const data = parseJsonObject(bodyText);
    if (!response.ok) {
      const error = providerBalanceHttpError(provider, response.status, data, bodyText, response.statusText);
      return providerBalanceError(provider, probe.endpoint, checkedAt, error, probe.metric);
    }
    try {
      return probe.parse(data, probe.endpoint, checkedAt);
    } catch (error) {
      return providerBalanceError(provider, probe.endpoint, checkedAt, publicError(error || "余额或费用返回格式不符合预期"), probe.metric);
    }
  } catch (error) {
    const message = controller.signal.aborted ? "余额或费用查询超时" : publicError(error);
    return providerBalanceError(provider, probe.endpoint, checkedAt, message, probe.metric);
  } finally {
    clearTimeout(timeout);
  }
}

function providerBalanceProbe(provider: AiProviderConfig, runtime: AiProviderRuntimeConfig): ProviderBalanceProbe | null {
  const host = providerHost(provider.baseUrl);
  if (provider.name === "deepseek" || host.includes("deepseek.com")) {
    const endpoint = providerOriginEndpoint(provider, "/user/balance");
    return {
      source: "DeepSeek 余额接口",
      endpoint,
      metric: "balance",
      request: () => bearerBalanceRequest(endpoint, provider.apiKey),
      parse: parseDeepSeekBalance,
    };
  }
  if (provider.name === "siliconflow" || host.includes("siliconflow.")) {
    const endpoint = providerBaseEndpoint(provider, "/user/info");
    return {
      source: "硅基流动余额接口",
      endpoint,
      metric: "balance",
      request: () => bearerBalanceRequest(endpoint, provider.apiKey),
      parse: parseSiliconFlowBalance,
    };
  }
  if (provider.name === "moonshot" || host.includes("moonshot.")) {
    const endpoint = providerBaseEndpoint(provider, "/users/me/balance");
    return {
      source: "Kimi/Moonshot 余额接口",
      endpoint,
      metric: "balance",
      request: () => bearerBalanceRequest(endpoint, provider.apiKey),
      parse: parseMoonshotBalance,
    };
  }
  if (provider.name === "openrouter" || host.includes("openrouter.ai")) {
    const endpoint = providerBaseEndpoint(provider, "/credits");
    return {
      source: "OpenRouter Credits 接口",
      endpoint,
      metric: "balance",
      request: () => bearerBalanceRequest(endpoint, provider.apiKey),
      parse: parseOpenRouterCredits,
    };
  }
  if ((provider.name === "dashscope" || host.includes("dashscope.aliyuncs.com"))
    && runtime.billingCredentials.alibabaCloudAccessKeyId
    && runtime.billingCredentials.alibabaCloudAccessKeySecret) {
    const endpoint = "https://business.aliyuncs.com/";
    return {
      source: "阿里云 BSS QueryAccountBalance",
      endpoint,
      metric: "balance",
      request: () => ({
        url: buildAlibabaBssBalanceUrl(
          runtime.billingCredentials.alibabaCloudAccessKeyId,
          runtime.billingCredentials.alibabaCloudAccessKeySecret,
        ),
        headers: { Accept: "application/json" },
      }),
      parse: parseAlibabaBssBalance,
    };
  }
  if ((provider.name === "openai" || host.includes("api.openai.com")) && runtime.billingCredentials.openAiAdminKey) {
    const endpoint = "https://api.openai.com/v1/organization/costs";
    return {
      source: "OpenAI Organization Costs",
      endpoint,
      metric: "cost",
      request: () => bearerBalanceRequest(buildOpenAiCurrentMonthCostsUrl(), runtime.billingCredentials.openAiAdminKey),
      parse: parseOpenAiOrganizationCosts,
    };
  }
  return null;
}

function providerBalanceProbeLabel(provider: AiProviderConfig, runtime: AiProviderRuntimeConfig) {
  const probe = providerBalanceProbe(provider, runtime);
  if (probe) return `可通过${probe.source}查询`;
  return providerBalanceUnsupportedReason(provider, runtime);
}

function bearerBalanceRequest(url: string, apiKey: string) {
  return {
    url,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  };
}

function buildAlibabaBssBalanceUrl(
  accessKeyId: string,
  accessKeySecret: string,
  now = new Date(),
  nonce = crypto.randomUUID(),
) {
  const parameters: Record<string, string> = {
    AccessKeyId: accessKeyId,
    Action: "QueryAccountBalance",
    Format: "JSON",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: nonce,
    SignatureVersion: "1.0",
    Timestamp: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: "2017-12-14",
  };
  const canonical = Object.keys(parameters)
    .sort()
    .map((key) => `${aliRpcPercentEncode(key)}=${aliRpcPercentEncode(parameters[key])}`)
    .join("&");
  const stringToSign = `GET&${aliRpcPercentEncode("/")}&${aliRpcPercentEncode(canonical)}`;
  const signature = crypto.createHmac("sha1", `${accessKeySecret}&`).update(stringToSign, "utf8").digest("base64");
  return `https://business.aliyuncs.com/?${canonical}&Signature=${aliRpcPercentEncode(signature)}`;
}

function aliRpcPercentEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOpenAiCurrentMonthCostsUrl(now = new Date()) {
  const monthStart = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1_000);
  const endTime = Math.floor(now.getTime() / 1_000);
  const query = new URLSearchParams({
    start_time: String(monthStart),
    end_time: String(endTime),
    bucket_width: "1d",
    limit: "31",
  });
  return `https://api.openai.com/v1/organization/costs?${query.toString()}`;
}

function providerBillingMetadata(provider: AiProviderConfig, runtime: AiProviderRuntimeConfig) {
  const host = providerHost(provider.baseUrl);
  if (provider.name === "dashscope" || host.includes("dashscope.aliyuncs.com")) {
    return {
      billingCredentialKind: "alibaba_bss" as const,
      billingCredentialConfigured: Boolean(
        runtime.billingCredentials.alibabaCloudAccessKeyId
        && runtime.billingCredentials.alibabaCloudAccessKeySecret,
      ),
      billingQueryKind: "balance" as const,
      billingConsoleUrl: "https://usercenter2.aliyun.com/",
    };
  }
  if (provider.name === "openai" || host.includes("api.openai.com")) {
    return {
      billingCredentialKind: "openai_admin" as const,
      billingCredentialConfigured: Boolean(runtime.billingCredentials.openAiAdminKey),
      billingQueryKind: "cost" as const,
      billingConsoleUrl: "https://platform.openai.com/settings/organization/usage",
    };
  }
  if (provider.name === "zhipu" || host.includes("bigmodel.cn")) {
    return {
      billingCredentialKind: "console_only" as const,
      billingCredentialConfigured: false,
      billingQueryKind: "console_only" as const,
      billingConsoleUrl: "https://bigmodel.cn/finance/expensebill/list",
    };
  }
  return {
    billingCredentialKind: "provider_api_key" as const,
    billingCredentialConfigured: Boolean(providerBalanceProbeWithoutFinanceCredential(provider)),
    billingQueryKind: "balance" as const,
    billingConsoleUrl: provider.docsUrl || "",
  };
}

function providerBalanceProbeWithoutFinanceCredential(provider: AiProviderConfig) {
  const host = providerHost(provider.baseUrl);
  return provider.name === "deepseek" || host.includes("deepseek.com")
    || provider.name === "siliconflow" || host.includes("siliconflow.")
    || provider.name === "moonshot" || host.includes("moonshot.")
    || provider.name === "openrouter" || host.includes("openrouter.ai");
}

function parseDeepSeekBalance(data: unknown, endpoint: string, checkedAt: string): AiProviderBalanceResult {
  const payload = objectValue(data);
  const infos = Array.isArray(payload.balance_infos) ? payload.balance_infos.map(objectValue) : [];
  const primary = infos.find((item) => text(item.currency).toUpperCase() === "CNY")
    || infos.find((item) => text(item.currency).toUpperCase() === "USD")
    || infos[0];
  if (!primary) throw new Error("DeepSeek 余额返回中没有 balance_infos");
  const currency = normalizedCurrency(primary.currency) || "CNY";
  const amount = amountValue(primary.total_balance);
  if (amount === null) throw new Error("DeepSeek 余额金额无法解析");
  return buildBalanceAvailableResult({
    endpoint,
    checkedAt,
    amount,
    currency,
    available: payload.is_available !== false && amount > 0,
    displayLabel: "余额",
    details: [
      { label: "总余额", value: formatBalanceAmount(amount, currency) },
      { label: "赠金", value: formatBalanceAmount(amountValue(primary.granted_balance), currency) },
      { label: "充值余额", value: formatBalanceAmount(amountValue(primary.topped_up_balance), currency) },
    ],
  });
}

function parseSiliconFlowBalance(data: unknown, endpoint: string, checkedAt: string): AiProviderBalanceResult {
  const wrapper = objectValue(data);
  const payload = objectValue(wrapper.data || data);
  const amount = amountValue(payload.totalBalance ?? payload.balance);
  if (amount === null) throw new Error("硅基流动余额金额无法解析");
  return buildBalanceAvailableResult({
    endpoint,
    checkedAt,
    amount,
    currency: "CNY",
    available: amount > 0,
    displayLabel: "余额",
    details: [
      { label: "总余额", value: formatBalanceAmount(amount, "CNY") },
      { label: "赠送余额", value: formatBalanceAmount(amountValue(payload.balance), "CNY") },
      { label: "充值余额", value: formatBalanceAmount(amountValue(payload.chargeBalance), "CNY") },
      { label: "账号状态", value: text(payload.status) || "未知" },
    ],
  });
}

function parseMoonshotBalance(data: unknown, endpoint: string, checkedAt: string): AiProviderBalanceResult {
  const wrapper = objectValue(data);
  const payload = objectValue(wrapper.data);
  const amount = amountValue(payload.available_balance);
  if (amount === null) throw new Error("Kimi 余额金额无法解析");
  return buildBalanceAvailableResult({
    endpoint,
    checkedAt,
    amount,
    currency: "CNY",
    available: amount > 0,
    displayLabel: "可用余额",
    details: [
      { label: "可用余额", value: formatBalanceAmount(amount, "CNY") },
      { label: "代金券", value: formatBalanceAmount(amountValue(payload.voucher_balance), "CNY") },
      { label: "现金余额", value: formatBalanceAmount(amountValue(payload.cash_balance), "CNY") },
    ],
  });
}

function parseOpenRouterCredits(data: unknown, endpoint: string, checkedAt: string): AiProviderBalanceResult {
  const payload = objectValue(objectValue(data).data);
  const totalCredits = amountValue(payload.total_credits);
  const totalUsage = amountValue(payload.total_usage);
  if (totalCredits === null || totalUsage === null) throw new Error("OpenRouter 额度金额无法解析");
  const remaining = Math.max(0, totalCredits - totalUsage);
  return buildBalanceAvailableResult({
    endpoint,
    checkedAt,
    amount: remaining,
    currency: "USD",
    available: remaining > 0,
    displayLabel: "剩余额度",
    details: [
      { label: "剩余额度", value: formatBalanceAmount(remaining, "USD") },
      { label: "累计购买", value: formatBalanceAmount(totalCredits, "USD") },
      { label: "累计使用", value: formatBalanceAmount(totalUsage, "USD") },
    ],
  });
}

function parseAlibabaBssBalance(data: unknown, endpoint: string, checkedAt: string): AiProviderBalanceResult {
  const payload = objectValue(data);
  if (payload.Success !== true || (text(payload.Code) && text(payload.Code) !== "200")) {
    throw new Error(text(payload.Message) || text(payload.Code) || "阿里云 BSS 余额查询未成功");
  }
  const account = objectValue(payload.Data);
  const amount = amountValue(account.AvailableAmount);
  if (amount === null) throw new Error("阿里云 BSS 返回中没有可用额度");
  const currency = normalizedCurrency(account.Currency) || "CNY";
  return buildBalanceAvailableResult({
    endpoint,
    checkedAt,
    amount,
    currency,
    available: amount > 0,
    displayLabel: "可用额度",
    details: [
      { label: "可用额度", value: formatBalanceAmount(amount, currency) },
      { label: "现金余额", value: formatBalanceAmount(amountValue(account.AvailableCashAmount), currency) },
      { label: "信控额度", value: formatBalanceAmount(amountValue(account.CreditAmount), currency) },
      { label: "网商银行信用额度", value: formatBalanceAmount(amountValue(account.MybankCreditAmount), currency) },
    ],
  });
}

function parseOpenAiOrganizationCosts(data: unknown, endpoint: string, checkedAt: string): AiProviderBalanceResult {
  const payload = objectValue(data);
  const buckets = Array.isArray(payload.data) ? payload.data.map(objectValue) : [];
  const totals = new Map<string, number>();
  for (const bucket of buckets) {
    const results = Array.isArray(bucket.results) ? bucket.results.map(objectValue) : [];
    for (const result of results) {
      const amount = objectValue(result.amount);
      const value = amountValue(amount.value);
      if (value === null) continue;
      const currency = normalizedCurrency(amount.currency) || "USD";
      totals.set(currency, (totals.get(currency) || 0) + value);
    }
  }
  const primaryCurrency = totals.has("USD") ? "USD" : [...totals.keys()][0] || "USD";
  const total = totals.get(primaryCurrency) || 0;
  const month = new Date(checkedAt).toLocaleDateString("zh-CN", { year: "numeric", month: "long", timeZone: "UTC" });
  return buildBalanceAvailableResult({
    endpoint,
    checkedAt,
    amount: total,
    currency: primaryCurrency,
    available: true,
    displayLabel: "本月已消费",
    metric: "cost",
    details: [
      { label: "统计周期", value: `${month}至今` },
      { label: "费用合计", value: formatBalanceAmount(total, primaryCurrency) },
      { label: "说明", value: "OpenAI 官方接口不返回充值后的剩余余额" },
    ],
  });
}

function buildBalanceAvailableResult(input: {
  endpoint: string;
  checkedAt: string;
  amount: number;
  currency: string;
  available: boolean;
  displayLabel: string;
  metric?: "balance" | "cost";
  details: Array<{ label: string; value: string }>;
}): AiProviderBalanceResult {
  return {
    checked: true,
    supported: true,
    metric: input.metric || "balance",
    status: input.available ? "available" : "insufficient",
    display: `${input.displayLabel}：${formatBalanceAmount(input.amount, input.currency)}`,
    amount: input.amount,
    currency: input.currency,
    endpoint: input.endpoint,
    checkedAt: input.checkedAt,
    details: input.details.filter((item) => item.value && item.value !== "未知"),
  };
}

function providerBalanceSkipped(
  provider: AiProviderConfig,
  runtime: AiProviderRuntimeConfig,
  reason: string,
): AiProviderBalanceResult {
  const probe = providerBalanceProbe(provider, runtime);
  if (!probe) return providerBalanceUnsupported(provider, runtime);
  return {
    checked: false,
    supported: true,
    metric: probe.metric,
    status: "error",
    display: probe.metric === "cost" ? "费用：未查询" : "余额：未查询",
    amount: null,
    currency: null,
    endpoint: probe.endpoint,
    checkedAt: null,
    details: [{ label: "原因", value: reason }],
    error: reason,
  };
}

function providerBalanceUnsupported(provider: AiProviderConfig, runtime: AiProviderRuntimeConfig): AiProviderBalanceResult {
  const reason = providerBalanceUnsupportedReason(provider, runtime);
  const metric = providerBillingMetadata(provider, runtime).billingQueryKind === "cost" ? "cost" : "balance";
  return {
    checked: false,
    supported: false,
    metric,
    status: "unsupported",
    display: metric === "cost" ? "费用：需要单独接入" : "余额：该供应商未接入查询",
    amount: null,
    currency: null,
    endpoint: "",
    checkedAt: null,
    details: [{ label: "说明", value: reason }],
  };
}

function providerBalanceError(
  provider: AiProviderConfig,
  endpoint: string,
  checkedAt: string,
  error: string,
  metric: "balance" | "cost" = "balance",
): AiProviderBalanceResult {
  return {
    checked: true,
    supported: true,
    metric,
    status: "error",
    display: metric === "cost" ? "费用：查询失败" : "余额：查询失败",
    amount: null,
    currency: null,
    endpoint,
    checkedAt,
    details: [{ label: "错误", value: error || "余额或费用查询失败" }],
    error: error || "余额或费用查询失败",
  };
}

function providerBalanceHttpError(
  provider: AiProviderConfig,
  status: number,
  data: unknown,
  bodyText: string,
  statusText: string,
) {
  if (provider.name === "openrouter" && status === 403) {
    return "OpenRouter 余额查询需要 Management Key；当前 API Key 不能查询余额。";
  }
  if (provider.name === "openai" && (status === 401 || status === 403)) {
    return "OpenAI 组织费用查询未获授权；请确认填写的是组织 Admin Key，而不是普通项目 API Key。";
  }
  if (provider.name === "dashscope" && (status === 400 || status === 401 || status === 403)) {
    const detail = extractProviderErrorMessage(data);
    return cleanErrorText(`阿里云 BSS 查询未获授权；请确认 RAM AccessKey 具备 AliyunBSSReadOnlyAccess。${detail ? ` ${detail}` : ""}`);
  }
  const detail = extractProviderErrorMessage(data) || bodyText || statusText || `HTTP ${status}`;
  return cleanErrorText(`HTTP ${status}: ${detail}`);
}

function providerBaseEndpoint(provider: AiProviderConfig, endpoint: string) {
  return `${trimTrailingSlash(provider.baseUrl)}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

function providerModelListHeaders(provider: AiProviderConfig): Record<string, string> {
  if (provider.requestFormat === "anthropic") {
    return {
      accept: "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": provider.apiKey,
    };
  }
  return {
    accept: "application/json",
    authorization: `Bearer ${provider.apiKey}`,
  };
}

function parseJsonText(value: string): unknown {
  if (!String(value || "").trim()) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function extractProviderModels(value: unknown): Array<{ id: string; label: string }> {
  const payload = objectValue(value);
  const rawModels = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : Array.isArray(value)
        ? value
        : [];
  const byId = new Map<string, { id: string; label: string }>();
  for (const rawModel of rawModels.slice(0, 2_000)) {
    const record = objectValue(rawModel);
    const sourceId = typeof rawModel === "string"
      ? rawModel
      : text(record.id || record.name || record.model || record.model_id);
    const id = sourceId.replace(/^models\//i, "").trim();
    if (!id || id.length > 200 || /[\r\n\0]/.test(id)) continue;
    const displayName = text(record.display_name || record.displayName || record.label);
    const label = (displayName || id).slice(0, 200);
    if (!byId.has(id)) byId.set(id, { id, label });
  }
  return [...byId.values()]
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN", { numeric: true }))
    .slice(0, 500);
}

function providerOriginEndpoint(provider: AiProviderConfig, endpoint: string) {
  try {
    return `${new URL(provider.baseUrl).origin}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  } catch {
    return providerBaseEndpoint(provider, endpoint);
  }
}

function providerHost(baseUrl: string) {
  try {
    return new URL(baseUrl).host.toLowerCase();
  } catch {
    return String(baseUrl || "").toLowerCase();
  }
}

function providerBalanceUnsupportedReason(provider: AiProviderConfig, runtime: AiProviderRuntimeConfig) {
  const host = providerHost(provider.baseUrl);
  if (provider.name === "dashscope" || host.includes("dashscope.aliyuncs.com")) {
    return runtime.billingCredentials.alibabaCloudAccessKeyId || runtime.billingCredentials.alibabaCloudAccessKeySecret
      ? "千问余额凭证不完整：需要同时填写阿里云 RAM AccessKey ID 和 AccessKey Secret，并授予 BSS 只读权限。"
      : "千问模型 API Key 不能查余额；请另填阿里云 RAM AccessKey ID/Secret，并授予 AliyunBSSReadOnlyAccess。";
  }
  if (provider.name === "zhipu" || host.includes("bigmodel.cn")) {
    return "智谱官方 API 文档未提供账户余额查询接口，请到智谱财务控制台查看账单和资源包。";
  }
  if (provider.name === "openai" || host.includes("api.openai.com")) {
    return "OpenAI 普通模型 API Key 不能查询费用；另填组织 Admin Key 后可读取本月消费，但官方接口仍不返回充值后的剩余余额。";
  }
  if (provider.name === "gemini" || host.includes("generativelanguage.googleapis.com") || /^gemini/i.test(provider.model)) {
    return "Gemini API 未提供已接入的余额查询接口，请到 Google AI Studio Billing 或 Usage 页面查看。";
  }
  return `${provider.label || provider.name} 未提供已接入的余额查询接口，请到供应商控制台查看。`;
}

function extractProviderErrorMessage(data: unknown): string {
  const payload = objectValue(data);
  const error = objectValue(payload.error);
  return text(error.message) || text(error.type) || text(payload.message) || text(payload.error);
}

function parseJsonObject(value: string): unknown {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function objectValue(value: unknown): Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function trimTrailingSlash(value: string) {
  return String(value || "").replace(/\/+$/, "");
}

function amountValue(value: unknown): number | null {
  const cleaned = String(value ?? "").replace(/[,\s￥¥$]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedCurrency(value: unknown) {
  const currency = text(value).toUpperCase();
  return currency || null;
}

function formatBalanceAmount(amount: number | null, currency: string | null) {
  if (amount === null) return "未知";
  const formatted = amount.toFixed(2);
  if (currency === "CNY") return `${formatted} 元`;
  if (currency === "USD") return `$${formatted}`;
  return currency ? `${formatted} ${currency}` : formatted;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSuggestionRepairMessages(input: AiSuggestionInput, previous: string, reason: string): ChatMessage[] {
  return [
    ...buildSuggestionMessages(input),
    { role: "assistant", content: cleanPromptText(previous) },
    {
      role: "user",
      content: [
        `上一版未通过发送校验（${cleanPromptText(reason)}）。`,
        "请重新写一版完整自然的客服回复：不要照抄基准句式，不要遗漏必须保留的信息，不要新增任何业务事实。",
        "只输出最终回复正文。",
      ].join("\n"),
    },
  ];
}

export function validateSuggestion(value: string, input: AiSuggestionInput): { ok: true; text: string; reason: "passed" } | { ok: false; text: ""; reason: string } {
  const cleaned = cleanModelText(value).replace(/\s+/g, " ").trim();
  if (!cleaned) return invalidSuggestion("empty");
  if (cleaned.length > 200) return invalidSuggestion("too_long");
  if (looksIncompleteReply(cleaned)) return invalidSuggestion("incomplete_sentence");
  if (input.requireNaturalRewrite && looksScriptedServiceReply(cleaned)) {
    return invalidSuggestion("scripted_service_phrase");
  }
  if (isPureGreeting(input.customerMessage)) {
    if (Array.from(cleaned.replace(/\s+/g, "")).length > 18) return invalidSuggestion("greeting_too_long");
    if (/礼盒|价格|询价|订单|物流|服务范围|帮助|需求/.test(cleaned)) {
      return invalidSuggestion("greeting_service_menu");
    }
  }
  const manualHandoffAllowed = /转人工|人工客服|人工确认/.test(input.ruleSuggestion)
    || /handoff_to_human|转人工|人工确认/.test(String(input.nextAction || ""));
  if (/转人工|人工客服/.test(cleaned) && !manualHandoffAllowed) {
    return invalidSuggestion("invented_manual_handoff");
  }
  const trusted = [
    input.customerMessage,
    input.ruleSuggestion,
    ...(input.knowledgeMatches || []).flatMap((item) => [item.title, item.excerpt]),
    ...(input.conversationHistory || []).map((item) => item.content),
  ]
    .map((item) => String(item || ""))
    .join("\n");
  const trustedNumbers = new Set(trusted.match(/\d+(?:\.\d+)?/g) || []);
  if ((cleaned.match(/\d+(?:\.\d+)?/g) || []).some((number) => !trustedNumbers.has(number))) {
    return invalidSuggestion("invented_number");
  }
  const commitments = [
    "退款",
    "赔偿",
    "免费",
    "保证",
    "承诺",
    "到账",
    "付款链接",
    "支付链接",
    "报价",
    "马上",
    "立刻",
    "第一时间",
    "一定会",
    "一定能",
    "尽快",
    "加紧",
  ];
  if (commitments.some((term) => cleaned.includes(term) && !trusted.includes(term))) {
    return invalidSuggestion("invented_commitment");
  }
  const missingRequiredTerm = uniqueStrings(input.requiredTerms || []).find((term) => !cleaned.includes(term));
  if (missingRequiredTerm) return invalidSuggestion(`missing_required_term:${missingRequiredTerm}`);
  if (input.requireNaturalRewrite && textSimilarity(cleaned, input.ruleSuggestion) >= 0.96) {
    return invalidSuggestion("template_copy");
  }
  return { ok: true, text: cleaned, reason: "passed" };
}

function invalidSuggestion(reason: string) {
  return { ok: false as const, text: "" as const, reason };
}

function looksIncompleteReply(value: string) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (/[，、：:；;（(]$/.test(text)) return true;
  return /(为了|根据|以及|或者|同时|具体|相关|大概|提供|补充|选择|说明|告诉|确认下|更精准的|更合适的|更好的|您的|帮您|给您)$/.test(text);
}

function looksScriptedServiceReply(value: unknown) {
  const text = String(value || "").trim();
  return [
    /请问有什么可以帮助您的/,
    /我已经记下/,
    /再确认(?:一下)?(?:这|那)?(?:三|3)个信息/,
    /直接告诉我您的需求/,
    /正式报价.{0,20}(?:核对|确认)后.{0,12}回复/,
  ].some((pattern) => pattern.test(text));
}

function isPureGreeting(value: unknown) {
  return /^(你好|您好|在吗|哈[喽罗]|嗨|hello|hi)[!！?？。,.，\s]*$/i.test(String(value || "").trim());
}

function customerToneGuidance(value: unknown) {
  const text = String(value || "").trim();
  if (isPureGreeting(text)) return "客户只是在打招呼，用一句短话自然应声，不展开服务菜单";
  if (/投诉|报警|维权|太差|生气|不满意|怎么回事|一直没|还没|坏了|少了|错了/.test(text)) {
    return "客户有不满或焦虑，先郑重承接问题，避免卖萌和过度热情";
  }
  if (/急|马上|务必|今天|赶紧|来不及|什么时候到/.test(text)) {
    return "客户在意时间，先直接回应时间与核实动作，不绕弯";
  }
  if (text.length <= 12) return "客户表达简短，本轮也要短而直接，不复述问题";
  return "客户在正常咨询，语气自然温和，重点回答并推进一小步";
}

function replyOpening(value: unknown) {
  const text = cleanHistoryText(value);
  if (!text) return "";
  const clause = text.split(/[，。！？；,.!?;]/, 1)[0].trim();
  return clause.slice(0, 18);
}

function textSimilarity(left: unknown, right: unknown) {
  const a = comparableText(left);
  const b = comparableText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aPairs = textPairs(a);
  const bPairs = textPairs(b);
  if (!aPairs.length || !bPairs.length) return 0;
  const counts = new Map<string, number>();
  for (const pair of aPairs) counts.set(pair, (counts.get(pair) || 0) + 1);
  let overlap = 0;
  for (const pair of bPairs) {
    const count = counts.get(pair) || 0;
    if (!count) continue;
    overlap += 1;
    counts.set(pair, count - 1);
  }
  return (2 * overlap) / (aPairs.length + bPairs.length);
}

function comparableText(value: unknown) {
  return String(value || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function textPairs(value: string) {
  if (value.length < 2) return value ? [value] : [];
  const pairs = [];
  for (let index = 0; index < value.length - 1; index += 1) pairs.push(value.slice(index, index + 2));
  return pairs;
}

function normalizedLatencyBudget(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(500, Math.min(10_000, Math.round(parsed)));
}

function remainingDeadlineMs(deadlineAt: unknown) {
  const parsed = Number(deadlineAt);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(0, Math.round(parsed - Date.now()));
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

function cleanHistoryText(value: unknown) {
  return cleanPromptText(value).slice(0, 400);
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
