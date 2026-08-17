import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appConfig } from "../../shared/app-config";

type JsonRecord = Record<string, unknown>;

export type ZhenxiMcpGenerateInput = {
  prompt: string;
  count: number;
  size: string;
  ratio: string;
  referencePaths: string[];
  requestId: string;
  cardType?: string;
  templateGroupKey?: string;
  copyModule?: "poster_copy" | "xiaohongshu" | "detail_page";
};

export type ZhenxiMcpCopyInput = {
  brief: string;
  count?: number;
  requestId: string;
  module?: "poster_copy" | "xiaohongshu" | "detail_page" | "video_script";
  ratio?: string;
  cardType?: string;
  templateGroupKey?: string;
};

export class ZhenxiMcpToolError extends Error {
  readonly code: string;
  readonly status: number;
  readonly outcomeUnknown: boolean;

  constructor(message: string, options: { code?: string; status?: number; outcomeUnknown?: boolean } = {}) {
    super(message);
    this.name = "ZhenxiMcpToolError";
    this.code = String(options.code || "ZHENXI_MCP_TOOL_FAILED");
    this.status = Number(options.status || 0);
    this.outcomeUnknown = Boolean(options.outcomeUnknown);
  }
}

@Injectable()
export class ZhenxiMcpClientService implements OnModuleDestroy {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connectionKey = "";
  private connecting: Promise<Client> | null = null;

  enabled() {
    return appConfig.designPlatformAdapter === "zhenxi_external" && process.env.ZHENXI_MCP_ENABLED !== "0";
  }

  async health(): Promise<JsonRecord> {
    return this.callTool("zhenxi_health", {}, Math.min(appConfig.designPlatformTimeoutMs, 15_000));
  }

  async generateImages(input: ZhenxiMcpGenerateInput): Promise<JsonRecord> {
    return this.callTool(
      "zhenxi_generate_images",
      {
        prompt: input.prompt,
        count: input.count,
        size: input.size,
        ratio: input.ratio,
        reference_paths: input.referencePaths,
        request_id: input.requestId,
        card_type: input.cardType || "空白模板",
        template_group_key: input.templateGroupKey || "blank",
      },
      appConfig.designPlatformTimeoutMs,
    );
  }

  async generateCopy(input: ZhenxiMcpCopyInput): Promise<JsonRecord> {
    return this.callTool(
      "zhenxi_generate_copy",
      {
        brief: input.brief,
        count: input.count || 1,
        request_id: input.requestId,
        module: input.module || "poster_copy",
        ratio: input.ratio || "1:1",
        card_type: input.cardType || "空白模板",
        template_group_key: input.templateGroupKey || "blank",
      },
      appConfig.designPlatformTimeoutMs,
    );
  }

  async generateDesign(input: ZhenxiMcpGenerateInput): Promise<JsonRecord> {
    return this.callTool(
      "zhenxi_generate_design",
      {
        brief: input.prompt,
        count: input.count,
        size: input.size,
        ratio: input.ratio,
        reference_paths: input.referencePaths,
        request_id: input.requestId,
        copy_module: input.copyModule || "poster_copy",
        card_type: input.cardType || "空白模板",
        template_group_key: input.templateGroupKey || "blank",
      },
      appConfig.designPlatformTimeoutMs,
    );
  }

  async generateNativeImages(input: Omit<ZhenxiMcpGenerateInput, "referencePaths">): Promise<JsonRecord> {
    const health = await this.health();
    if (health.reachable !== true) {
      throw new ZhenxiMcpToolError("臻希 AI 当前不可用，已停止出图。", { code: "ZHENXI_HEALTH_NOT_READY" });
    }
    const capabilities = await this.callNativeTool("zhenxi_capabilities", {}, 15_000, false);
    if (String(capabilities.imageProviderPolicy || "") !== "GPT image models only") {
      throw new ZhenxiMcpToolError("臻希 AI 未确认使用 GPT 图片模型，已停止出图。", {
        code: "ZHENXI_GPT_IMAGE_POLICY_REQUIRED",
      });
    }
    return this.callNativeTool(
      "zhenxi_generate",
      {
        module: "image",
        prompt: input.prompt,
        count: input.count,
        requestId: input.requestId,
        size: input.size,
        ratio: input.ratio,
        cardType: input.cardType || "空白模板",
        templateGroupKey: input.templateGroupKey || "blank",
      },
      appConfig.designPlatformTimeoutMs,
      true,
    );
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async callTool(name: string, args: JsonRecord, timeout: number): Promise<JsonRecord> {
    if (!this.enabled()) {
      throw new ZhenxiMcpToolError("臻希 AI 成品软件 MCP 当前未启用。", { code: "ZHENXI_MCP_DISABLED" });
    }
    const client = await this.connect();
    let response: Awaited<ReturnType<Client["callTool"]>>;
    try {
      response = await client.callTool({ name, arguments: args }, undefined, { timeout });
    } catch (error) {
      await this.disconnect();
      throw new ZhenxiMcpToolError(
        error instanceof Error ? `臻希 AI MCP 调用失败：${error.message}` : "臻希 AI MCP 调用失败。",
        { code: "ZHENXI_MCP_TRANSPORT_FAILED", outcomeUnknown: isGenerationTool(name) },
      );
    }

    const structured = isRecord(response.structuredContent) ? response.structuredContent : {};
    const result = isRecord(structured.result) ? structured.result : {};
    if (response.isError) {
      const error = isRecord(result.error) ? result.error : {};
      const fallbackText = Array.isArray(response.content)
        ? response.content.find((item) => item.type === "text")?.text
        : "";
      throw new ZhenxiMcpToolError(
        stringValue(error.message) || fallbackText || "臻希 AI MCP 工具执行失败。",
        {
          code: stringValue(error.code) || "ZHENXI_MCP_TOOL_FAILED",
          status: numberValue(error.status),
          outcomeUnknown: Boolean(error.outcomeUnknown),
        },
      );
    }
    if (!Object.keys(result).length) {
      throw new ZhenxiMcpToolError("臻希 AI MCP 没有返回结构化结果。", {
        code: "ZHENXI_MCP_RESULT_INVALID",
        outcomeUnknown: isGenerationTool(name),
      });
    }
    return result;
  }

  private async callNativeTool(name: string, args: JsonRecord, timeout: number, generation: boolean): Promise<JsonRecord> {
    if (!this.enabled()) {
      throw new ZhenxiMcpToolError("臻希 AI MCP 当前未启用。", { code: "ZHENXI_MCP_DISABLED" });
    }
    const apiKey = String(appConfig.designPlatformApiKey || appConfig.designPlatformAccessToken || "").trim();
    if (!apiKey) {
      throw new ZhenxiMcpToolError("臻希 AI 原生 MCP 缺少集成 API Key。", { code: "ZHENXI_API_KEY_REQUIRED" });
    }
    const endpoint = new URL("/api/mcp", String(appConfig.designPlatformBaseUrl || ""));
    const client = new Client({ name: "smart-kefu-native", version: "0.1.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
      reconnectionOptions: {
        maxReconnectionDelay: 1_000,
        initialReconnectionDelay: 250,
        reconnectionDelayGrowFactor: 1,
        maxRetries: 0,
      },
    });
    try {
      await client.connect(transport);
      const response = await client.callTool({ name, arguments: args }, undefined, { timeout });
      const structured = isRecord(response.structuredContent) ? response.structuredContent : {};
      if (response.isError) {
        const fallbackText = Array.isArray(response.content)
          ? response.content.find((item) => item.type === "text")?.text
          : "";
        throw new ZhenxiMcpToolError(
          stringValue(structured.error) || fallbackText || "臻希 AI 原生 MCP 工具执行失败。",
          {
            code: "ZHENXI_NATIVE_MCP_TOOL_FAILED",
            status: numberValue(structured.status),
            outcomeUnknown: generation,
          },
        );
      }
      if (!Object.keys(structured).length) {
        throw new ZhenxiMcpToolError("臻希 AI 原生 MCP 没有返回结构化结果。", {
          code: "ZHENXI_NATIVE_MCP_RESULT_INVALID",
          outcomeUnknown: generation,
        });
      }
      return structured;
    } catch (error) {
      if (error instanceof ZhenxiMcpToolError) throw error;
      throw new ZhenxiMcpToolError(
        error instanceof Error ? `臻希 AI 原生 MCP 调用失败：${error.message}` : "臻希 AI 原生 MCP 调用失败。",
        { code: "ZHENXI_NATIVE_MCP_TRANSPORT_FAILED", outcomeUnknown: generation },
      );
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private async connect(): Promise<Client> {
    const settings = this.connectionSettings();
    if (this.client && this.connectionKey === settings.key) return this.client;
    if (this.connecting && this.connectionKey === settings.key) return this.connecting;
    await this.disconnect();
    this.connectionKey = settings.key;
    this.connecting = this.createConnection(settings);
    try {
      this.client = await this.connecting;
      return this.client;
    } finally {
      this.connecting = null;
    }
  }

  private async createConnection(settings: ReturnType<ZhenxiMcpClientService["connectionSettings"]>) {
    const client = new Client({ name: "smart-kefu-api", version: "0.1.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [settings.serverPath],
      cwd: path.dirname(settings.serverPath),
      stderr: "pipe",
      env: settings.env,
      maxBufferSize: 20 * 1024 * 1024,
    });
    transport.stderr?.on("data", (chunk) => {
      const message = String(chunk || "").replace(/[\r\n]+/g, " ").trim().slice(0, 500);
      if (message) console.error(`[zhenxi-mcp] ${message}`);
    });
    transport.onclose = () => {
      if (this.transport === transport) {
        this.client = null;
        this.transport = null;
        this.connectionKey = "";
      }
    };
    this.transport = transport;
    try {
      await client.connect(transport);
      return client;
    } catch (error) {
      await transport.close().catch(() => undefined);
      if (this.transport === transport) this.transport = null;
      this.connectionKey = "";
      throw error;
    }
  }

  private connectionSettings() {
    const serverPath = resolveZhenxiMcpServerPath();
    const apiKey = String(appConfig.designPlatformApiKey || appConfig.designPlatformAccessToken || "").trim();
    const baseUrl = String(appConfig.designPlatformBaseUrl || "").trim();
    const keyDigest = createHash("sha256").update(apiKey).digest("hex");
    const env = compactEnvironment({
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      ComSpec: process.env.ComSpec,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      NODE_PATH: process.env.NODE_PATH,
      ELECTRON_RUN_AS_NODE: process.versions.electron ? "1" : undefined,
      ZHENXI_BASE_URL: baseUrl,
      ZHENXI_API_KEY: apiKey,
      ZHENXI_REQUEST_TIMEOUT_MS: String(appConfig.designPlatformTimeoutMs),
    });
    return {
      serverPath,
      env,
      key: `${serverPath}|${baseUrl}|${keyDigest}|${appConfig.designPlatformTimeoutMs}`,
    };
  }

  private async disconnect() {
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    this.connecting = null;
    this.connectionKey = "";
    if (client) await client.close().catch(() => undefined);
    else if (transport) await transport.close().catch(() => undefined);
  }
}

export function resolveZhenxiMcpServerPath() {
  const configured = String(process.env.ZHENXI_MCP_SERVER_PATH || "").trim();
  const candidates = [
    configured,
    path.resolve(process.cwd(), "packages", "mcp", "zhenxi-ai-server.mjs"),
    path.resolve(process.cwd(), "services", "runtime-root", "packages", "mcp", "zhenxi-ai-server.mjs"),
    path.resolve(__dirname, "../../../../../packages/mcp/zhenxi-ai-server.mjs"),
    path.resolve(__dirname, "../../../runtime-root/packages/mcp/zhenxi-ai-server.mjs"),
  ].filter(Boolean);
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!resolved) {
    throw new ZhenxiMcpToolError("智能客服安装包缺少臻希 AI MCP 服务文件。", {
      code: "ZHENXI_MCP_SERVER_MISSING",
    });
  }
  return resolved;
}

function compactEnvironment(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isGenerationTool(name: string) {
  return ["zhenxi_generate_copy", "zhenxi_generate_images", "zhenxi_generate_design"].includes(name);
}
