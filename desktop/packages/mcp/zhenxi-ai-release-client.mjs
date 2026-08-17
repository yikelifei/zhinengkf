import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
const READ_REQUEST_TIMEOUT_MS = 10 * 1000;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_REFERENCE_COUNT = 10;
const MAX_IMAGE_COUNT = 6;
const MAX_COPY_COUNT = 6;
const RELEASE_PORT_MIN = 31870;
const RELEASE_PORT_MAX = 31879;
const ACTIVE_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_SESSION_BYTES = 64 * 1024;

export class ZhenxiReleaseError extends Error {
  constructor(message, { code = "ZHENXI_RELEASE_REQUEST_FAILED", status = 0, outcomeUnknown = false } = {}) {
    super(message);
    this.name = "ZhenxiReleaseError";
    this.code = code;
    this.status = status;
    this.outcomeUnknown = outcomeUnknown;
  }
}

export class ZhenxiReleaseClient {
  constructor(env = process.env) {
    this.baseUrl = validatedReleaseBaseUrl(env.ZHENXI_BASE_URL, env.ZHENXI_MCP_ALLOW_TEST_PORT);
    this.apiKey = String(env.ZHENXI_API_KEY || "").trim();
    this.activeUserFile = resolveActiveUserFile(env);
    this.requestTimeoutMs = boundedInteger(
      env.ZHENXI_REQUEST_TIMEOUT_MS,
      1_000,
      DEFAULT_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
    );
  }

  async generateCopy(input) {
    const brief = String(input.brief || input.prompt || "").trim();
    if (brief.length < 4 || brief.length > 8_000) {
      throw new ZhenxiReleaseError("文案需求长度必须在 4 到 8000 个字符之间。", {
        code: "ZHENXI_COPY_BRIEF_INVALID",
      });
    }
    const count = boundedInteger(input.count, 1, MAX_COPY_COUNT, 0);
    if (!count) {
      throw new ZhenxiReleaseError(`文案数量必须是 1 到 ${MAX_COPY_COUNT} 的整数。`, {
        code: "ZHENXI_COPY_COUNT_INVALID",
      });
    }
    const requestId = validateRequestId(input.requestId) || `smart-kefu-copy:${randomUUID()}`;
    const session = await readActiveUserSession(this.activeUserFile);
    const moduleName = normalizeCopyModule(input.module);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
    };
    if (session.deviceId) headers["x-art-device-id"] = session.deviceId;

    const data = await this.#requestJson(
      "api/local-generate",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          requestId,
          type: "prompt",
          stream: false,
          module: moduleName,
          prompt: brief,
          promptInputs: Array.from({ length: count }, () => brief),
          count,
          cardType: String(input.cardType || "空白模板"),
          ratio: validateImageRatio(input.ratio || "1:1"),
          category: String(input.category || "image"),
          templateGroupKey: String(input.templateGroupKey || "blank"),
          concurrency: count,
        }),
      },
      this.requestTimeoutMs,
      false,
      true,
    );

    const prompts = Array.isArray(data.prompts)
      ? data.prompts.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const fallbackCount = nonNegativeInteger(data.fallbackCount);
    const failedCount = nonNegativeInteger(data.failedCount);
    if (!prompts.length) {
      throw new ZhenxiReleaseError(
        `臻希 AI 成品软件没有返回可用文案（requestId=${requestId}）。禁止继续生成图片。`,
        { code: "ZHENXI_COPY_EMPTY", outcomeUnknown: false },
      );
    }
    if (fallbackCount > 0 || String(data.mode || "").toLowerCase() === "fallback") {
      throw new ZhenxiReleaseError(
        `臻希 AI 文案模型未返回真实结果（requestId=${requestId}），成品软件只返回了兜底文案。禁止继续生成图片。`,
        { code: "ZHENXI_COPY_FALLBACK", outcomeUnknown: false },
      );
    }
    return {
      requestId,
      requestedCount: count,
      prompts,
      selectedPrompt: prompts[0],
      mode: stringOrNull(data.mode),
      failedCount,
      fallbackCount,
      refund: sanitizeRefund(data.refund),
    };
  }

  async generateDesign(input) {
    const rootRequestId = validateRequestId(input.requestId) || `smart-kefu:${randomUUID()}`;
    const copy = await this.generateCopy({
      brief: input.prompt,
      count: 1,
      requestId: stageRequestId(rootRequestId, "copy"),
      module: input.copyModule,
      ratio: input.ratio,
      cardType: input.cardType,
      category: input.category,
      templateGroupKey: input.templateGroupKey,
    });
    const image = await this.generateImages({
      ...input,
      prompt: copy.selectedPrompt,
      requestId: stageRequestId(rootRequestId, "image"),
    });
    return {
      ...image,
      requestId: rootRequestId,
      copyRequestId: copy.requestId,
      imageRequestId: image.requestId,
      generatedCopy: copy.selectedPrompt,
      copy,
    };
  }

  async health() {
    const data = await this.#requestJson("api/health", { method: "GET" }, READ_REQUEST_TIMEOUT_MS, false);
    const ai = record(data.ai);
    const runtime = record(data.runtime);
    const localDemo = record(data.localDemo);
    return {
      reachable: true,
      target: "installed_release",
      baseUrl: this.baseUrl.origin,
      releasePort: Number(this.baseUrl.port),
      status: stringOrNull(data.status),
      service: stringOrNull(data.service),
      version: stringOrNull(data.version),
      runtime: {
        channel: stringOrNull(runtime.channel),
        generationBackend: stringOrNull(runtime.generationBackend),
        localWorkspace: booleanOrNull(runtime.localWorkspace),
      },
      ai: {
        provider: stringOrNull(ai.provider),
        label: stringOrNull(ai.label),
        imageModel: stringOrNull(ai.imageModel),
        imageApiType: stringOrNull(ai.imageApiType),
        imageConfigured: booleanOrNull(ai.imageConfigured),
        gptImageModel: isGptImageModel(ai.imageModel),
      },
      externalGenerateAvailable: localDemo.externalGenerateEnabled !== false,
      apiKeyConfigured: Boolean(this.apiKey),
    };
  }

  async generateImages(input) {
    const prompt = String(input.prompt || "").trim();
    if (prompt.length < 4 || prompt.length > 8_000) {
      throw new ZhenxiReleaseError("提示词长度必须在 4 到 8000 个字符之间。", {
        code: "ZHENXI_PROMPT_INVALID",
      });
    }
    const count = boundedInteger(input.count, 1, MAX_IMAGE_COUNT, 0);
    if (!count) {
      throw new ZhenxiReleaseError(`出图数量必须是 1 到 ${MAX_IMAGE_COUNT} 的整数。`, {
        code: "ZHENXI_COUNT_INVALID",
      });
    }
    const size = validateImageSize(input.size || "1024x1024");
    const ratio = validateImageRatio(input.ratio || "1:1");
    const requestId = validateRequestId(input.requestId) || `smart-kefu:${randomUUID()}`;
    const referencePaths = uniqueStrings(input.referencePaths || []);
    if (!referencePaths.length || referencePaths.length > MAX_REFERENCE_COUNT) {
      throw new ZhenxiReleaseError(`成品软件出图需要 1 到 ${MAX_REFERENCE_COUNT} 张本地参考图。`, {
        code: "ZHENXI_REFERENCE_COUNT_INVALID",
      });
    }

    await this.health();
    const session = await readActiveUserSession(this.activeUserFile);
    const sessionHeaders = {
      Authorization: `Bearer ${session.accessToken}`,
      ...(session.deviceId ? { "x-art-device-id": session.deviceId } : {}),
    };
    const uploadedReferenceUrls = [];
    for (const filePath of referencePaths) {
      const file = await prepareReferenceFile(filePath);
      const form = new FormData();
      form.append("file", new Blob([file.buffer], { type: file.mimeType }), file.fileName);
      const saved = await this.#requestJson(
        "api/local-assets",
        { method: "POST", headers: sessionHeaders, body: form },
        Math.min(this.requestTimeoutMs, 60_000),
        false,
        false,
      );
      const uploadedUrl = String(saved.url || "").trim();
      if (!uploadedUrl) {
        throw new ZhenxiReleaseError("臻希 AI 成品软件没有返回参考图地址。", {
          code: "ZHENXI_REFERENCE_UPLOAD_INVALID",
        });
      }
      uploadedReferenceUrls.push(uploadedUrl);
    }

    let data;
    try {
      data = await this.#requestNdjson(
        "api/local-generate",
        {
          method: "POST",
          headers: { ...sessionHeaders, "Content-Type": "application/json", "x-art-image-delivery": "provider_url" },
          body: JSON.stringify({
            requestId,
            type: "image",
            stream: true,
            prompt,
            prompts: Array.from({ length: count }, () => prompt),
            count,
            size,
            ratio,
            cardType: String(input.cardType || "空白模板"),
            category: String(input.category || "image"),
            templateGroupKey: String(input.templateGroupKey || "blank"),
            styleRefs: [],
            objectRefs: uploadedReferenceUrls,
            concurrency: count,
          }),
        },
        this.requestTimeoutMs,
        false,
        true,
      );
    } catch (error) {
      if (error instanceof ZhenxiReleaseError && (error.outcomeUnknown || error.status >= 500)) {
        throw new ZhenxiReleaseError(
          `臻希 AI 成品软件出图结果未知（requestId=${requestId}）。禁止自动重试，请先核对任务与扣费状态。`,
          { code: error.code, status: error.status, outcomeUnknown: true },
        );
      }
      throw error;
    }

    const rawResults = Array.isArray(data.results) ? data.results : [];
    if (!rawResults.length) {
      throw new ZhenxiReleaseError(
        `臻希 AI 成品软件返回了异常成功响应（requestId=${requestId}）。禁止自动重试。`,
        { code: "ZHENXI_MALFORMED_SUCCESS_RESPONSE", outcomeUnknown: true },
      );
    }
    const images = rawResults.map((value, index) => {
      const item = record(value);
      const rawUrl = String(item.url || item.providerUrl || "").trim();
      return {
        index: index + 1,
        status: item.status === "success" && rawUrl ? "success" : "failed",
        url: rawUrl ? absoluteResultUrl(rawUrl, this.baseUrl) : null,
        error: stringOrNull(item.error),
        warning: stringOrNull(item.warning),
      };
    });
    const successCount = images.filter((item) => item.status === "success").length;
    return {
      requestId,
      requestedCount: count,
      successCount,
      failedCount: images.length - successCount,
      status: successCount === count ? "completed" : successCount ? "partial" : "failed",
      images,
      refund: sanitizeRefund(data.refund),
    };
  }

  async generateImagesLegacyExternal(input) {
    const prompt = String(input.prompt || "").trim();
    if (prompt.length < 4 || prompt.length > 8_000) {
      throw new ZhenxiReleaseError("提示词长度必须在 4 到 8000 个字符之间。", {
        code: "ZHENXI_PROMPT_INVALID",
      });
    }

    const count = boundedInteger(input.count, 1, MAX_IMAGE_COUNT, 0);
    if (!count) {
      throw new ZhenxiReleaseError(`出图数量必须是 1 到 ${MAX_IMAGE_COUNT} 的整数。`, {
        code: "ZHENXI_COUNT_INVALID",
      });
    }
    if (!this.apiKey) {
      throw new ZhenxiReleaseError("智能客服尚未配置臻希 AI 成品软件的 API Key。", {
        code: "ZHENXI_API_KEY_REQUIRED",
      });
    }

    const size = validateImageSize(input.size || "1024x1024");
    const ratio = validateImageRatio(input.ratio || "1:1");
    const requestId = validateRequestId(input.requestId) || `smart-kefu:${randomUUID()}`;
    const referencePaths = uniqueStrings(input.referencePaths || []);
    if (!referencePaths.length || referencePaths.length > MAX_REFERENCE_COUNT) {
      throw new ZhenxiReleaseError(`成品软件出图需要 1 到 ${MAX_REFERENCE_COUNT} 张本地参考图。`, {
        code: "ZHENXI_REFERENCE_COUNT_INVALID",
      });
    }

    // Customer releases proxy generation to the authenticated cloud runtime. The
    // loopback health payload intentionally does not expose that remote model
    // configuration, so reachability is the only safe preflight available here.
    await this.health();

    const preparedFiles = [];
    for (const filePath of referencePaths) preparedFiles.push(await prepareReferenceFile(filePath));

    const form = new FormData();
    form.append("requestId", requestId);
    form.append("prompt", prompt);
    form.append("count", String(count));
    form.append("size", size);
    form.append("ratio", ratio);
    form.append("cardType", String(input.cardType || "空白模板"));
    form.append("templateGroupKey", String(input.templateGroupKey || "blank"));
    for (const file of preparedFiles) {
      form.append("files", new Blob([file.buffer], { type: file.mimeType }), file.fileName);
    }

    let data;
    try {
      data = await this.#requestJson(
        "api/external/v1/images/generate",
        { method: "POST", body: form },
        this.requestTimeoutMs,
        true,
        true,
      );
    } catch (error) {
      if (error instanceof ZhenxiReleaseError && (error.outcomeUnknown || error.status >= 500)) {
        throw new ZhenxiReleaseError(
          `臻希 AI 成品软件出图结果未知（requestId=${requestId}）。禁止自动重试，请先核对任务与扣费状态。`,
          { code: error.code, status: error.status, outcomeUnknown: true },
        );
      }
      throw error;
    }

    if (!Array.isArray(data.images)) {
      throw new ZhenxiReleaseError(
        `臻希 AI 成品软件返回了异常成功响应（requestId=${requestId}）。禁止自动重试。`,
        { code: "ZHENXI_MALFORMED_SUCCESS_RESPONSE", outcomeUnknown: true },
      );
    }

    const images = data.images.map((value, index) => {
      const item = record(value);
      const rawUrl = String(item.url || item.providerUrl || "").trim();
      return {
        index: index + 1,
        status: item.status === "success" && rawUrl ? "success" : "failed",
        url: rawUrl ? absoluteResultUrl(rawUrl, this.baseUrl) : null,
        error: stringOrNull(item.error),
        warning: stringOrNull(item.warning),
      };
    });
    const successCount = images.filter((item) => item.status === "success").length;
    return {
      requestId,
      requestedCount: count,
      successCount,
      failedCount: images.length - successCount,
      status: successCount === count ? "completed" : successCount ? "partial" : "failed",
      images,
      refund: sanitizeRefund(data.refund),
    };
  }

  async #requestJson(relativePath, init, timeoutMs, authenticated, outcomeUnknownOnTransportFailure = false) {
    const url = new URL(relativePath, this.baseUrl);
    const headers = new Headers(init.headers || {});
    headers.set("Accept", "application/json");
    headers.set("x-art-client", "smart-kefu-mcp");
    // Match the installed desktop application's same-origin request context.
    // The server still independently verifies the Host and loopback address.
    headers.set("Origin", this.baseUrl.origin);
    headers.set("Referer", `${this.baseUrl.origin}/`);
    headers.set("Sec-Fetch-Site", "same-origin");
    if (authenticated && this.apiKey) headers.set("Authorization", `Bearer ${this.apiKey}`);

    let response;
    try {
      response = await fetch(url, {
        ...init,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new ZhenxiReleaseError(timeout ? "臻希 AI 成品软件请求超时。" : "无法连接臻希 AI 成品软件。", {
        code: timeout ? "ZHENXI_TIMEOUT" : "ZHENXI_UNREACHABLE",
        outcomeUnknown: outcomeUnknownOnTransportFailure,
      });
    }

    const payload = await readJsonResponse(response);
    const data = unwrapApiData(payload);
    if (!response.ok) {
      const errorData = record(payload.error);
      const message = String(errorData.message || payload.message || `臻希 AI 请求失败（HTTP ${response.status}）。`);
      const code = String(errorData.code || payload.code || `ZHENXI_HTTP_${response.status}`);
      throw new ZhenxiReleaseError(message.slice(0, 500), {
        code,
        status: response.status,
        outcomeUnknown: outcomeUnknownOnTransportFailure && response.status >= 500,
      });
    }
    return record(data);
  }

  async #requestNdjson(relativePath, init, timeoutMs) {
    const url = new URL(relativePath, this.baseUrl);
    const headers = new Headers(init.headers || {});
    headers.set("Accept", "application/x-ndjson");
    headers.set("x-art-client", "smart-kefu-mcp");
    headers.set("Origin", this.baseUrl.origin);
    headers.set("Referer", `${this.baseUrl.origin}/`);
    headers.set("Sec-Fetch-Site", "same-origin");

    let response;
    try {
      response = await fetch(url, {
        ...init,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new ZhenxiReleaseError(timeout ? "臻希 AI 成品软件流式请求超时。" : "无法连接臻希 AI 成品软件。", {
        code: timeout ? "ZHENXI_TIMEOUT" : "ZHENXI_UNREACHABLE",
        outcomeUnknown: true,
      });
    }

    if (!response.ok) {
      const text = await response.text();
      let payload = {};
      try {
        payload = JSON.parse(text);
      } catch {
        // Keep the status-derived error below; never expose an HTML gateway body.
      }
      const value = record(payload);
      const errorData = record(value.error);
      throw new ZhenxiReleaseError(
        String(errorData.message || value.message || `臻希 AI 请求失败（HTTP ${response.status}）。`).slice(0, 500),
        {
          code: String(errorData.code || value.code || `ZHENXI_HTTP_${response.status}`),
          status: response.status,
          outcomeUnknown: response.status >= 500,
        },
      );
    }
    if (!response.body) {
      throw new ZhenxiReleaseError("臻希 AI 流式响应没有内容。", {
        code: "ZHENXI_STREAM_EMPTY",
        outcomeUnknown: true,
      });
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    const results = [];
    let buffer = "";
    let doneEvent = null;
    const acceptLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        throw new ZhenxiReleaseError("臻希 AI 返回了无法解析的流事件。", {
          code: "ZHENXI_STREAM_INVALID",
          outcomeUnknown: true,
        });
      }
      const value = record(event);
      const index = nonNegativeInteger(value.index);
      if (value.type === "image") {
        results[index] = record(value.result);
      } else if (value.type === "error") {
        const result = record(value.result);
        results[index] = Object.keys(result).length
          ? result
          : { status: "failed", url: null, error: String(value.error || "Image generation failed.") };
      } else if (value.type === "fatal") {
        const code = String(value.code || "ZHENXI_STREAM_FATAL");
        throw new ZhenxiReleaseError(String(value.error || "臻希 AI 流式生成失败。").slice(0, 500), {
          code,
          outcomeUnknown: /REFUND_FAILED|UNKNOWN/i.test(code),
        });
      } else if (value.type === "done") {
        doneEvent = value;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          acceptLine(line);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) acceptLine(buffer);
    } catch (error) {
      if (error instanceof ZhenxiReleaseError) throw error;
      throw new ZhenxiReleaseError("臻希 AI 流式连接在完成前中断。", {
        code: "ZHENXI_STREAM_INTERRUPTED",
        outcomeUnknown: true,
      });
    } finally {
      reader.releaseLock();
    }

    if (!doneEvent) {
      throw new ZhenxiReleaseError("臻希 AI 流式响应没有完成事件。", {
        code: "ZHENXI_STREAM_INCOMPLETE",
        outcomeUnknown: true,
      });
    }
    return {
      results: results.filter(Boolean),
      refund: doneEvent.refund,
      credits: doneEvent.credits,
      successCount: nonNegativeInteger(doneEvent.successCount),
      failedCount: nonNegativeInteger(doneEvent.failedCount),
    };
  }
}

function resolveActiveUserFile(env) {
  const configured = String(env.ZHENXI_ACTIVE_USER_FILE || "").trim();
  const appData = String(env.APPDATA || "").trim();
  const candidate = configured || (appData ? path.join(appData, "zhenxi-ai", "workspace-data", "external-active-user.json") : "");
  if (!candidate) return "";
  if (!path.isAbsolute(candidate) || path.basename(candidate).toLowerCase() !== "external-active-user.json") {
    throw new ZhenxiReleaseError("无法定位臻希 AI 成品软件的当前登录会话。", {
      code: "ZHENXI_ACTIVE_SESSION_PATH_INVALID",
    });
  }
  return path.resolve(candidate);
}

async function readActiveUserSession(filePath) {
  if (!filePath) {
    throw new ZhenxiReleaseError("臻希 AI 成品软件没有可用的当前登录会话，请先在臻希 AI 中登录。", {
      code: "ZHENXI_ACTIVE_SESSION_REQUIRED",
    });
  }
  let payload;
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > MAX_ACTIVE_SESSION_BYTES) throw new Error("invalid size");
    payload = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new ZhenxiReleaseError("臻希 AI 成品软件没有可用的当前登录会话，请先在臻希 AI 中登录。", {
      code: "ZHENXI_ACTIVE_SESSION_REQUIRED",
    });
  }
  const session = record(payload);
  const accessToken = String(session.accessToken || "").trim();
  const deviceId = String(session.deviceId || "").trim();
  const updatedAt = Date.parse(String(session.updatedAt || ""));
  if (!accessToken || accessToken.length > 16_000 || !Number.isFinite(updatedAt)) {
    throw new ZhenxiReleaseError("臻希 AI 成品软件的当前登录会话无效，请重新登录。", {
      code: "ZHENXI_ACTIVE_SESSION_INVALID",
    });
  }
  if (Date.now() - updatedAt > ACTIVE_SESSION_MAX_AGE_MS) {
    throw new ZhenxiReleaseError("臻希 AI 成品软件的当前登录会话已过期，请重新登录。", {
      code: "ZHENXI_ACTIVE_SESSION_EXPIRED",
    });
  }
  return { accessToken, deviceId: deviceId.slice(0, 200) };
}

function normalizeCopyModule(value) {
  const normalized = String(value || "poster_copy").trim();
  return ["xiaohongshu", "detail_page", "video_script", "poster_copy"].includes(normalized)
    ? normalized
    : "poster_copy";
}

function stageRequestId(rootRequestId, stage) {
  const suffix = `:${stage}`;
  return `${rootRequestId.slice(0, 80 - suffix.length)}${suffix}`;
}

function validatedReleaseBaseUrl(value, allowTestPortValue) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new ZhenxiReleaseError("ZHENXI_BASE_URL 不是有效 URL。", { code: "ZHENXI_BASE_URL_INVALID" });
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new ZhenxiReleaseError("臻希 AI 成品软件 MCP 只允许连接 127.0.0.1 的 HTTP 服务。", {
      code: "ZHENXI_RELEASE_LOOPBACK_REQUIRED",
    });
  }
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new ZhenxiReleaseError("臻希 AI 成品软件地址不能包含凭据、路径、查询参数或片段。", {
      code: "ZHENXI_BASE_URL_INVALID",
    });
  }
  const port = Number(url.port || 80);
  const allowTestPort = /^(1|true)$/i.test(String(allowTestPortValue || ""));
  if (!allowTestPort && (port < RELEASE_PORT_MIN || port > RELEASE_PORT_MAX)) {
    throw new ZhenxiReleaseError(
      `臻希 AI 成品软件 MCP 只接受 ${RELEASE_PORT_MIN}–${RELEASE_PORT_MAX} 端口，已拒绝开发端口。`,
      { code: "ZHENXI_RELEASE_PORT_REQUIRED" },
    );
  }
  url.pathname = "/";
  return url;
}

async function prepareReferenceFile(filePath) {
  const requested = String(filePath || "").trim();
  if (!path.isAbsolute(requested)) {
    throw new ZhenxiReleaseError("参考图必须使用绝对文件路径。", { code: "ZHENXI_REFERENCE_PATH_INVALID" });
  }
  let resolved;
  let fileStat;
  try {
    resolved = await realpath(requested);
    fileStat = await stat(resolved);
  } catch {
    throw new ZhenxiReleaseError("参考图不存在或无法读取。", { code: "ZHENXI_REFERENCE_NOT_FOUND" });
  }
  if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > MAX_REFERENCE_BYTES) {
    throw new ZhenxiReleaseError("参考图必须是 0 到 20 MiB 之间的普通文件。", {
      code: "ZHENXI_REFERENCE_SIZE_INVALID",
    });
  }
  const buffer = await readFile(resolved);
  const mimeType = detectImageMime(buffer);
  if (!mimeType) {
    throw new ZhenxiReleaseError("参考图只支持真实的 PNG、JPEG 或 WebP 文件。", {
      code: "ZHENXI_REFERENCE_TYPE_INVALID",
    });
  }
  return {
    buffer,
    mimeType,
    fileName: path.basename(resolved).replace(/[\r\n"\\]/g, "_").slice(0, 180) || `${randomUUID()}.png`,
  };
}

function detectImageMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return "";
}

function isGptImageModel(value) {
  return /^gpt(?:[-_.a-z0-9]*?)image(?:[-_.a-z0-9]*)$/i.test(String(value || "").trim());
}

function validateImageSize(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{2,5}x\d{2,5}$/.test(normalized)) {
    throw new ZhenxiReleaseError("图片尺寸必须是 widthxheight，例如 1024x1024。", { code: "ZHENXI_SIZE_INVALID" });
  }
  return normalized;
}

function validateImageRatio(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{1,2}:\d{1,2}$/.test(normalized)) {
    throw new ZhenxiReleaseError("图片比例必须是 width:height，例如 1:1。", { code: "ZHENXI_RATIO_INVALID" });
  }
  return normalized;
}

function validateRequestId(value) {
  if (value === undefined || value === null || value === "") return "";
  const normalized = String(value).trim();
  if (!/^[A-Za-z0-9_.:-]{8,80}$/.test(normalized)) {
    throw new ZhenxiReleaseError("requestId 必须是 8 到 80 位安全字符。", { code: "ZHENXI_REQUEST_ID_INVALID" });
  }
  return normalized;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ZhenxiReleaseError(`臻希 AI 成品软件返回了非 JSON 响应（HTTP ${response.status}）。`, {
      code: "ZHENXI_RESPONSE_INVALID",
      status: response.status,
    });
  }
}

function unwrapApiData(payload) {
  const value = record(payload);
  return value.ok === true && value.data && typeof value.data === "object" ? value.data : value;
}

function sanitizeRefund(value) {
  const refund = record(value);
  return {
    status: stringOrNull(refund.status),
    reason: stringOrNull(refund.reason),
    requestedCredits: numberOrNull(refund.requestedCredits),
    refundedCredits: numberOrNull(refund.refundedCredits),
  };
}

function absoluteResultUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function boundedInteger(value, min, max, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < min || numberValue > max) return fallback;
  return numberValue;
}

function nonNegativeInteger(value) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function numberOrNull(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}
