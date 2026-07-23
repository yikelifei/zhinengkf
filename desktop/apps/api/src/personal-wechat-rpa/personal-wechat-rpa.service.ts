import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LocalStoreService } from "../local-store/local-store.service";
import { WechatDispatchService } from "../wechat/wechat-dispatch.service";

const EVENT_VERSION = "personal_wechat_rpa_event_v1";
const REGISTRY_VERSION = "personal_wechat_rpa_registry_v1";

export type PersonalWechatRpaInboundPayload = {
  version?: string;
  accountNickname?: string;
  ownerWxId?: string;
  chatTitle?: string;
  conversationType?: string;
  senderName?: string;
  message?: string;
  messageType?: string;
  externalId?: string;
  createdAt?: string;
  attachments?: Array<Record<string, unknown>>;
};

export type PersonalWechatRpaInstanceInput = {
  wechatAccountId?: string;
  endpoint?: string;
  token?: string;
  accountNickname?: string;
  enabled?: boolean;
};

type StoredRpaInstance = {
  wechatAccountId: string;
  endpoint: string;
  token: string;
  accountNickname: string;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type RpaRegistryDocument = Record<string, unknown> & {
  instances?: unknown;
  disabledInstances?: unknown;
};

@Injectable()
export class PersonalWechatRpaService {
  constructor(
    private readonly localStore: LocalStoreService,
    private readonly wechatDispatch: WechatDispatchService,
  ) {}

  getStatus(token?: string) {
    const identity = this.assertToken(token);
    const bindings = this.localStore.listPersonalWechatRpaBindings();
    const registry = this.getRegistry();
    return {
      ok: registry.ready,
      version: EVENT_VERSION,
      enabled: registry.ready,
      expectedAccountNickname: identity.accountNickname || null,
      bindingCount: bindings.length,
      bindings,
      recentAudit: this.localStore.listPersonalWechatRpaAuditLogs(20),
      registry,
    };
  }

  getRegistry() {
    return buildRegistryReadiness(this.readRegistryState());
  }

  validateInstance(payload: PersonalWechatRpaInstanceInput) {
    const state = this.readRegistryState();
    if (state.readError) {
      return {
        ok: false,
        operation: "blocked",
        errors: [state.readError],
        instance: null,
        registry: buildRegistryReadiness(state),
      };
    }
    const parsed = parseRegistryDocument(state.document);
    const accountId = String(payload?.wechatAccountId || "").trim();
    const existing = findLogicalInstance(parsed, accountId);
    const validation = normalizeInstanceInput(payload, existing?.instance);
    const errors = [...parsed.errors, ...validation.errors];
    return {
      ok: errors.length === 0,
      operation: existing ? "update" : "create",
      errors,
      instance: validation.instance ? redactInstance(validation.instance) : null,
      registry: buildRegistryReadiness(state),
    };
  }

  upsertInstance(payload: PersonalWechatRpaInstanceInput) {
    const state = this.requireWritableRegistryState();
    const parsed = parseRegistryDocument(state.document);
    if (parsed.errors.length > 0) {
      throw new BadRequestException(`RPA registry must be repaired before update: ${parsed.errors.join("; ")}`);
    }
    const accountId = String(payload?.wechatAccountId || "").trim();
    const existing = findLogicalInstance(parsed, accountId);
    const validation = normalizeInstanceInput(payload, existing?.instance);
    if (!validation.instance || validation.errors.length > 0) {
      throw new BadRequestException(validation.errors.join("; ") || "invalid RPA instance");
    }

    const now = new Date().toISOString();
    const instance: StoredRpaInstance = {
      ...validation.instance,
      createdAt: existing?.instance.createdAt || now,
      updatedAt: now,
    };
    const active = parsed.active.filter((item) => item.wechatAccountId !== instance.wechatAccountId);
    const disabled = parsed.disabled.filter((item) => item.wechatAccountId !== instance.wechatAccountId);
    if (instance.enabled) active.push(instance);
    else disabled.push(instance);
    const nextDocument = writeLogicalRegistry(state.document, active, disabled);
    this.writeRegistryDocument(state.filePath, nextDocument);
    const nextState = { filePath: state.filePath, document: nextDocument, readError: "" };
    return {
      ok: true,
      operation: existing ? "updated" : "created",
      instance: redactInstance(instance),
      registry: buildRegistryReadiness(nextState),
    };
  }

  disableInstance(wechatAccountId: string) {
    const accountId = String(wechatAccountId || "").trim();
    if (!accountId) throw new BadRequestException("wechatAccountId is required");
    const state = this.requireWritableRegistryState();
    const parsed = parseRegistryDocument(state.document);
    if (parsed.errors.length > 0) {
      throw new BadRequestException(`RPA registry must be repaired before disable: ${parsed.errors.join("; ")}`);
    }
    const existing = findLogicalInstance(parsed, accountId);
    if (!existing) throw new NotFoundException(`RPA instance ${accountId} was not found`);
    const disabledInstance: StoredRpaInstance = {
      ...existing.instance,
      enabled: false,
      updatedAt: new Date().toISOString(),
    };
    const active = parsed.active.filter((item) => item.wechatAccountId !== accountId);
    const disabled = parsed.disabled.filter((item) => item.wechatAccountId !== accountId);
    disabled.push(disabledInstance);
    const nextDocument = writeLogicalRegistry(state.document, active, disabled);
    this.writeRegistryDocument(state.filePath, nextDocument);
    const nextState = { filePath: state.filePath, document: nextDocument, readError: "" };
    return {
      ok: true,
      operation: existing.enabled ? "disabled" : "unchanged",
      instance: redactInstance(disabledInstance),
      registry: buildRegistryReadiness(nextState),
    };
  }

  async processInbound(payload: PersonalWechatRpaInboundPayload, token?: string) {
    const identity = this.assertToken(token, payload?.accountNickname);
    const normalized = this.validateInbound(payload, identity.accountNickname);
    if (normalized.ignored) {
      const audit = this.localStore.recordPersonalWechatRpaAudit({
        direction: "inbound",
        status: "ignored",
        reason: normalized.reason,
        accountNickname: normalized.accountNickname,
        ownerWxId: normalized.ownerWxId,
        chatTitle: normalized.chatTitle,
        externalId: normalized.externalId,
      });
      return { ok: true, ignored: true, reason: normalized.reason, audit };
    }

    const binding = this.localStore.upsertPersonalWechatRpaBinding({
      accountNickname: normalized.accountNickname,
      ownerWxId: normalized.ownerWxId,
      chatTitle: normalized.chatTitle,
      conversationType: normalized.conversationType,
      senderName: normalized.senderName,
      receivedAt: normalized.createdAt,
    });
    const existing = this.localStore.findMessageByExternalId(binding.conversationId, normalized.externalId);
    if (existing) {
      const audit = this.localStore.recordPersonalWechatRpaAudit({
        direction: "inbound",
        status: "duplicate",
        accountNickname: normalized.accountNickname,
        ownerWxId: normalized.ownerWxId,
        chatTitle: normalized.chatTitle,
        externalId: normalized.externalId,
        wechatAccountId: binding.wechatAccountId,
        conversationId: binding.conversationId,
        customerId: binding.customerId,
        messageId: existing.id,
      });
      return { ok: true, duplicate: true, binding, message: existing, audit };
    }

    try {
      const result = await this.wechatDispatch.processInboundMessage({
        wechatAccountId: binding.wechatAccountId,
        conversationId: binding.conversationId,
        customerId: binding.customerId,
        text: normalized.message,
        externalId: normalized.externalId,
        attachments: normalized.attachments,
        createdAt: normalized.createdAt,
      });
      const audit = this.localStore.recordPersonalWechatRpaAudit({
        direction: "inbound",
        status: "processed",
        accountNickname: normalized.accountNickname,
        ownerWxId: normalized.ownerWxId,
        chatTitle: normalized.chatTitle,
        externalId: normalized.externalId,
        wechatAccountId: binding.wechatAccountId,
        conversationId: binding.conversationId,
        customerId: binding.customerId,
        messageId: result?.message?.id || null,
        sendTaskId: result?.sendTask?.id || null,
      });
      return { ok: true, duplicate: false, binding, result, audit };
    } catch (error) {
      this.localStore.recordPersonalWechatRpaAudit({
        direction: "inbound",
        status: "failed",
        accountNickname: normalized.accountNickname,
        ownerWxId: normalized.ownerWxId,
        chatTitle: normalized.chatTitle,
        externalId: normalized.externalId,
        wechatAccountId: binding.wechatAccountId,
        conversationId: binding.conversationId,
        customerId: binding.customerId,
        errorMessage: error instanceof Error ? error.message : "unknown error",
      });
      throw error;
    }
  }

  private validateInbound(payload: PersonalWechatRpaInboundPayload, expectedNickname: string) {
    if (!payload || typeof payload !== "object") throw new BadRequestException("payload must be an object");
    if (payload.version !== EVENT_VERSION) throw new BadRequestException(`version must be ${EVENT_VERSION}`);
    const accountNickname = String(payload.accountNickname || "").trim();
    const ownerWxId = String(payload.ownerWxId || "").trim();
    const chatTitle = String(payload.chatTitle || "").trim();
    const senderName = String(payload.senderName || "").trim();
    const message = String(payload.message || "").trim();
    const messageType = String(payload.messageType || "text").trim().toLowerCase();
    const externalId = String(payload.externalId || "").trim();
    const conversationType = String(payload.conversationType || "direct").trim().toLowerCase();
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const createdAt = String(payload.createdAt || "").trim() || new Date().toISOString();

    if (!expectedNickname) throw new BadRequestException("personal WeChat RPA account nickname is not configured");
    if (accountNickname !== expectedNickname) {
      throw new BadRequestException("RPA event account nickname does not match the dedicated configured account");
    }
    if (!ownerWxId || !chatTitle || !senderName || !externalId) {
      throw new BadRequestException("ownerWxId, chatTitle, senderName and externalId are required");
    }
    if (!message && attachments.length === 0) throw new BadRequestException("message or attachments are required");
    if (!Number.isFinite(Date.parse(createdAt))) throw new BadRequestException("createdAt must be an ISO date");
    if (!new Set(["direct", "group", "enterprise", "unknown"]).has(conversationType)) {
      throw new BadRequestException("unsupported conversationType");
    }
    if (!new Set(["text", "image", "file", "video", "voice", "link", "unknown"]).has(messageType)) {
      throw new BadRequestException("unsupported messageType");
    }

    const ignored = senderName === "我" || senderName === accountNickname || senderName === "系统";
    return {
      accountNickname,
      ownerWxId,
      chatTitle,
      conversationType,
      senderName,
      message,
      messageType,
      externalId,
      createdAt,
      attachments,
      ignored,
      reason: ignored ? "self_or_system_message" : null,
    };
  }

  private assertToken(received?: string, accountNickname?: string) {
    const actual = String(received || "").trim();
    const expectedNickname = String(accountNickname || "").trim();
    const candidates = authenticationCandidates(this.readRegistryState());
    const tokenMatches = candidates.filter((candidate) => safeTokenEqual(candidate.token, actual));
    const identity = expectedNickname
      ? tokenMatches.find((candidate) => candidate.accountNickname === expectedNickname) || tokenMatches[0]
      : tokenMatches[0];
    if (!identity) throw new UnauthorizedException("invalid personal WeChat RPA token");
    return identity;
  }

  private readRegistryState() {
    const filePath = path.resolve(
      process.env.PERSONAL_WECHAT_RPA_CONFIG_FILE ||
        path.join(process.env.DESKTOP_RUNTIME_DIR || path.resolve(process.cwd(), ".runtime"), "personal-wechat-rpa.json"),
    );
    if (!fs.existsSync(filePath)) return { filePath, document: {} as RpaRegistryDocument, readError: "" };
    try {
      const document = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
      if (!isPlainObject(document)) return { filePath, document: {} as RpaRegistryDocument, readError: "RPA config root must be an object" };
      return { filePath, document: document as RpaRegistryDocument, readError: "" };
    } catch {
      return {
        filePath,
        document: {} as RpaRegistryDocument,
        readError: "RPA config is not valid JSON",
      };
    }
  }

  private requireWritableRegistryState() {
    const state = this.readRegistryState();
    if (state.readError) throw new BadRequestException(state.readError);
    return state;
  }

  private writeRegistryDocument(filePath: string, document: RpaRegistryDocument) {
    atomicWriteJson(filePath, document);
  }
}

type RegistryState = {
  filePath: string;
  document: RpaRegistryDocument;
  readError: string;
};

type ParsedRegistry = {
  active: StoredRpaInstance[];
  disabled: StoredRpaInstance[];
  tombstoneIds: Set<string>;
  errors: string[];
  registryMode: boolean;
};

function parseRegistryDocument(document: RpaRegistryDocument): ParsedRegistry {
  const errors: string[] = [];
  const active: StoredRpaInstance[] = [];
  const disabled: StoredRpaInstance[] = [];
  const tombstoneIds = new Set<string>();
  const rawInstances = document.instances;
  const rawDisabled = document.disabledInstances;

  if (rawInstances !== undefined && !Array.isArray(rawInstances)) errors.push("instances must be an array");
  if (rawDisabled !== undefined && !Array.isArray(rawDisabled)) errors.push("disabledInstances must be an array");

  for (const [index, raw] of (Array.isArray(rawInstances) ? rawInstances : []).entries()) {
    if (!isPlainObject(raw)) {
      errors.push(`instances[${index}] must be an object`);
      continue;
    }
    if (raw.enabled === false || raw.tombstone === true) {
      const accountId = String(raw.wechatAccountId || "").trim();
      const nickname = String(raw.accountNickname || "").trim();
      if (!accountId || !nickname || raw.tombstone !== true || String(raw.endpoint || "").trim() || String(raw.token || "").trim()) {
        errors.push(`instances[${index}] disabled entry must be a credential-free tombstone with wechatAccountId and accountNickname`);
        continue;
      }
      if (tombstoneIds.has(accountId)) errors.push(`wechatAccountId ${accountId} has duplicate disabled tombstones`);
      tombstoneIds.add(accountId);
      continue;
    }
    const normalized = normalizeStoredInstance(raw, true);
    if (!normalized.instance || normalized.errors.length > 0) {
      errors.push(...normalized.errors.map((message) => `instances[${index}] ${message}`));
      continue;
    }
    active.push(normalized.instance);
  }

  for (const [index, raw] of (Array.isArray(rawDisabled) ? rawDisabled : []).entries()) {
    if (!isPlainObject(raw)) {
      errors.push(`disabledInstances[${index}] must be an object`);
      continue;
    }
    const normalized = normalizeStoredInstance(raw, false);
    if (!normalized.instance || normalized.errors.length > 0) {
      errors.push(...normalized.errors.map((message) => `disabledInstances[${index}] ${message}`));
      continue;
    }
    disabled.push(normalized.instance);
  }

  const logicalIds = new Set<string>();
  for (const instance of [...active, ...disabled]) {
    if (logicalIds.has(instance.wechatAccountId)) errors.push(`wechatAccountId ${instance.wechatAccountId} must be unique`);
    logicalIds.add(instance.wechatAccountId);
  }
  for (const instance of disabled) {
    if (!tombstoneIds.has(instance.wechatAccountId)) {
      errors.push(`disabled RPA instance ${instance.wechatAccountId} requires a fail-closed tombstone`);
    }
  }
  for (const accountId of tombstoneIds) {
    if (!disabled.some((instance) => instance.wechatAccountId === accountId)) {
      errors.push(`disabled tombstone ${accountId} has no retained disabled instance`);
    }
  }

  return {
    active,
    disabled,
    tombstoneIds,
    errors: [...new Set(errors)],
    registryMode: Array.isArray(rawInstances) && rawInstances.length > 0,
  };
}

function normalizeStoredInstance(raw: Record<string, unknown>, enabled: boolean) {
  const normalized = normalizeInstanceInput({
    wechatAccountId: String(raw.wechatAccountId || ""),
    endpoint: String(raw.endpoint || ""),
    token: String(raw.token || ""),
    accountNickname: String(raw.accountNickname || ""),
    enabled,
  });
  if (normalized.instance) {
    normalized.instance.createdAt = optionalIsoDate(raw.createdAt);
    normalized.instance.updatedAt = optionalIsoDate(raw.updatedAt);
  }
  return normalized;
}

function normalizeInstanceInput(input: PersonalWechatRpaInstanceInput, existing?: StoredRpaInstance) {
  const errors: string[] = [];
  if (!isPlainObject(input)) return { instance: null, errors: ["payload must be an object"] };
  const has = (key: keyof PersonalWechatRpaInstanceInput) => Object.prototype.hasOwnProperty.call(input, key);
  const wechatAccountId = String(has("wechatAccountId") ? input.wechatAccountId || "" : existing?.wechatAccountId || "").trim();
  const accountNickname = String(has("accountNickname") ? input.accountNickname || "" : existing?.accountNickname || "").trim();
  const token = String(has("token") ? input.token || "" : existing?.token || "").trim();
  const rawEndpoint = String(has("endpoint") ? input.endpoint || "" : existing?.endpoint || "").trim();
  const enabledValue = has("enabled") ? input.enabled : existing?.enabled ?? true;

  if (!wechatAccountId) errors.push("wechatAccountId is required");
  if (!accountNickname) errors.push("accountNickname is required");
  if (!token) errors.push("token is required when creating an instance or replacing its token");
  if (typeof enabledValue !== "boolean") errors.push("enabled must be a boolean");
  const endpoint = normalizeLoopbackEndpoint(rawEndpoint, true);
  if (!endpoint.ok) errors.push(endpoint.error);

  const instance = wechatAccountId
    ? {
        wechatAccountId,
        endpoint: endpoint.ok ? endpoint.endpoint : "",
        token,
        accountNickname,
        enabled: typeof enabledValue === "boolean" ? enabledValue : true,
      } as StoredRpaInstance
    : null;
  return { instance, errors: [...new Set(errors)] };
}

function normalizeLoopbackEndpoint(value: unknown, requireExplicitPort: boolean) {
  const raw = String(value || "").trim();
  if (!raw) return { ok: false as const, error: "endpoint is required" };
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const loopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
    if (
      url.protocol !== "http:" ||
      !loopback ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname && url.pathname !== "/")
    ) {
      return { ok: false as const, error: "endpoint must be a loopback-only HTTP origin" };
    }
    const portText = explicitPort(raw);
    if (requireExplicitPort && !portText) {
      return { ok: false as const, error: "endpoint must include an explicit port" };
    }
    const port = Number(portText || (url.protocol === "http:" ? 80 : 0));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false as const, error: "endpoint port must be between 1 and 65535" };
    }
    const host = hostname === "[::1]" ? "[::1]" : hostname;
    return {
      ok: true as const,
      endpoint: portText ? `http://${host}:${port}` : `http://${host}`,
      port,
    };
  } catch {
    return { ok: false as const, error: "endpoint must be a loopback-only HTTP origin" };
  }
}

function explicitPort(value: string) {
  const authority = String(value || "").replace(/^http:\/\//i, "").split(/[/?#]/, 1)[0];
  const match = authority.startsWith("[") ? authority.match(/^\[[^\]]+\]:(\d+)$/) : authority.match(/^[^:]+:(\d+)$/);
  return match?.[1] || "";
}

function findLogicalInstance(parsed: ParsedRegistry, accountId: string) {
  const active = parsed.active.find((instance) => instance.wechatAccountId === accountId);
  if (active) return { instance: active, enabled: true };
  const disabled = parsed.disabled.find((instance) => instance.wechatAccountId === accountId);
  return disabled ? { instance: disabled, enabled: false } : null;
}

function writeLogicalRegistry(
  document: RpaRegistryDocument,
  activeInstances: StoredRpaInstance[],
  disabledInstances: StoredRpaInstance[],
): RpaRegistryDocument {
  const active = [...activeInstances]
    .map((instance) => ({ ...instance, enabled: true }))
    .sort((left, right) => left.wechatAccountId.localeCompare(right.wechatAccountId));
  const disabled = [...disabledInstances]
    .map((instance) => ({ ...instance, enabled: false }))
    .sort((left, right) => left.wechatAccountId.localeCompare(right.wechatAccountId));
  const tombstones = disabled.map((instance) => ({
    wechatAccountId: instance.wechatAccountId,
    endpoint: "",
    token: "",
    accountNickname: instance.accountNickname,
    enabled: false,
    tombstone: true,
    updatedAt: instance.updatedAt,
  }));
  return {
    ...document,
    registryVersion: REGISTRY_VERSION,
    instances: [...active, ...tombstones],
    disabledInstances: disabled,
  };
}

function buildRegistryReadiness(state: RegistryState) {
  const parsed = parseRegistryDocument(state.document);
  const legacy = legacyInstance(state.document);
  const errors = [...(state.readError ? [state.readError] : []), ...parsed.errors];
  const mode = parsed.registryMode ? "registry" : legacy.present ? "legacy_single" : "unconfigured";
  const ready = errors.length === 0 && (mode === "registry" ? parsed.active.length > 0 : legacy.ready);
  const instances = [...parsed.active, ...parsed.disabled]
    .sort((left, right) => left.wechatAccountId.localeCompare(right.wechatAccountId))
    .map(redactInstance);
  return {
    version: REGISTRY_VERSION,
    ready,
    mode,
    configPath: state.filePath,
    activeCount: parsed.active.length,
    disabledCount: parsed.disabled.length,
    instances,
    legacy: {
      present: legacy.present,
      used: mode === "legacy_single",
      ready: legacy.ready,
      endpoint: legacy.endpoint,
      port: legacy.port,
      accountNickname: legacy.accountNickname || null,
      tokenConfigured: Boolean(legacy.token),
    },
    checks: [
      { key: "configReadable", ok: !state.readError, detail: state.readError || "readable" },
      { key: "registryValid", ok: parsed.errors.length === 0, detail: parsed.errors.length ? parsed.errors.join("; ") : "valid" },
      {
        key: "activeRoute",
        ok: mode === "registry" ? parsed.active.length > 0 : legacy.ready,
        detail: mode === "registry" ? `${parsed.active.length} active instance(s)` : legacy.ready ? "legacy single instance" : "missing",
      },
    ],
    errors,
  };
}

function legacyInstance(document: RpaRegistryDocument) {
  const portValue = Number(document.port);
  const port = Number.isInteger(portValue) && portValue >= 1 && portValue <= 65535 ? portValue : 3211;
  const rawEndpoint = String(
    process.env.PERSONAL_WECHAT_RPA_ENDPOINT || document.endpoint || `http://127.0.0.1:${port}`,
  ).trim();
  const normalized = normalizeLoopbackEndpoint(rawEndpoint, false);
  const token = String(process.env.PERSONAL_WECHAT_RPA_TOKEN || document.token || "").trim();
  const accountNickname = String(
    process.env.PERSONAL_WECHAT_RPA_ACCOUNT_NICKNAME || document.accountNickname || "",
  ).trim();
  const present = Boolean(token || accountNickname || document.endpoint || document.port);
  return {
    present,
    ready: Boolean(token && accountNickname && normalized.ok),
    endpoint: normalized.ok ? normalized.endpoint : "",
    port: normalized.ok ? normalized.port : null,
    token,
    accountNickname,
  };
}

function authenticationCandidates(state: RegistryState) {
  const parsed = parseRegistryDocument(state.document);
  if (parsed.registryMode) {
    if (parsed.errors.length > 0) return [];
    return parsed.active.map((instance) => ({
      wechatAccountId: instance.wechatAccountId,
      accountNickname: instance.accountNickname,
      token: instance.token,
    }));
  }
  const legacy = legacyInstance(state.document);
  return legacy.ready
    ? [{ wechatAccountId: "legacy", accountNickname: legacy.accountNickname, token: legacy.token }]
    : [];
}

function redactInstance(instance: StoredRpaInstance) {
  const endpoint = normalizeLoopbackEndpoint(instance.endpoint, true);
  return {
    wechatAccountId: instance.wechatAccountId,
    endpoint: endpoint.ok ? endpoint.endpoint : "",
    port: endpoint.ok ? endpoint.port : null,
    accountNickname: instance.accountNickname,
    enabled: instance.enabled,
    tokenConfigured: Boolean(String(instance.token || "").trim()),
    createdAt: instance.createdAt || null,
    updatedAt: instance.updatedAt || null,
  };
}

function safeTokenEqual(expected: string, actual: string) {
  const expectedBytes = Buffer.from(String(expected || ""), "utf8");
  const actualBytes = Buffer.from(String(actual || ""), "utf8");
  return expectedBytes.length > 0 && expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function atomicWriteJson(filePath: string, document: RpaRegistryDocument) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function optionalIsoDate(value: unknown) {
  const text = String(value || "").trim();
  return text && Number.isFinite(Date.parse(text)) ? text : undefined;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
