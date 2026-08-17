import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Injectable, Optional } from "@nestjs/common";
import { appConfig } from "../shared/app-config";
import { WechatWorkApiClient, WechatWorkApiError } from "../wechat-work/wechat-work-api.client";
import { resolveWechatWorkImageFile, resolveWechatWorkMaterialFile } from "../wechat-work/wechat-work-media";

type AdapterStatus = "started" | "dry_run" | "sent" | "failed";

type AdapterContext = {
  guardStatus: string;
  windowSnapshotId?: string | null;
  payloadSummary: Record<string, unknown>;
  attemptId?: string;
};

type AdapterResult = {
  adapter: string;
  status: AdapterStatus;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
};

export class WechatWorkKfDeliveryError extends Error {
  readonly retrySafe: boolean;
  readonly deliveryState: "failed" | "unknown" | "partial";
  readonly stage: string;
  readonly acceptedMessageIds: string[];
  readonly uploadedMediaIds: string[];

  constructor(
    message: string,
    details: {
      retrySafe: boolean;
      deliveryState: "failed" | "unknown" | "partial";
      stage: string;
      acceptedMessageIds: string[];
      uploadedMediaIds: string[];
    },
  ) {
    super(message);
    this.name = "WechatWorkKfDeliveryError";
    this.retrySafe = details.retrySafe;
    this.deliveryState = details.deliveryState;
    this.stage = details.stage;
    this.acceptedMessageIds = [...details.acceptedMessageIds];
    this.uploadedMediaIds = [...details.uploadedMediaIds];
  }
}

export class WechatBridgeOutboxError extends Error {
  readonly deliveryState: "failed" | "unknown";
  readonly retrySafe: boolean;
  readonly stage: string;
  readonly outboxFile: string;

  constructor(
    message: string,
    details: {
      deliveryState: "failed" | "unknown";
      retrySafe: boolean;
      stage: string;
      outboxFile?: string;
    },
  ) {
    super(message);
    this.name = "WechatBridgeOutboxError";
    this.deliveryState = details.deliveryState;
    this.retrySafe = details.retrySafe;
    this.stage = details.stage;
    this.outboxFile = details.outboxFile || "";
  }
}

type BridgeFileEntry = {
  fileName: string;
  filePath: string;
  taskId?: string;
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
  payloadKind?: string;
  actionCount?: number;
  createdAt?: string;
  modifiedAt: string;
  ageSeconds: number;
  data?: Record<string, unknown>;
  errorMessage?: string;
};

type BridgeLockEntry = {
  fileName: string;
  filePath: string;
  accountId?: string;
  pid?: number;
  createdAt?: string;
  modifiedAt: string;
  ageSeconds: number;
  stale: boolean;
  errorMessage?: string;
};

const adapters = {
  dry_run: {
    name: "dry_run",
    label: "干跑适配器",
    realSend: false,
    description: "只做安全校验和审计记录，不会操作微信。",
  },
  windows_bridge: {
    name: "windows_bridge",
    label: "Windows 微信桥接适配器",
    realSend: true,
    description: "预留给后续合规 Windows 桥接程序；未接桥接程序前只生成 outbox 文件，不会伪装发送成功。",
  },
  wechat_work_kf: {
    name: "wechat_work_kf",
    label: "企业微信官方客服 API",
    realSend: true,
    description: "通过企业微信微信客服素材上传与 kf/send_msg 顺序发送文本和图片，并以 SendAttempt 和异步失败事件记录最终结果。",
  },
};

@Injectable()
export class WechatSendAdapterService {
  constructor(@Optional() private readonly wechatWorkApi?: WechatWorkApiClient) {}

  describe(adapterName?: string) {
    const adapter = this.resolve(adapterName);
    const supportsImageActions = adapter.name === "dry_run" || adapter.name === "windows_bridge" || adapter.name === "wechat_work_kf";
    return {
      ...adapter,
      configuredName: appConfig.wechatSendAdapter,
      capabilities: {
        text: true,
        images: supportsImageActions,
        files: adapter.name === "wechat_work_kf",
        quote: true,
        requiresWindowGuard: adapter.name !== "wechat_work_kf",
        writesOutbox: adapter.name === "windows_bridge",
      },
    };
  }

  execute(task: any, context: AdapterContext, adapterName?: string): AdapterResult {
    const adapter = this.resolve(adapterName);
    if (adapter.name === "windows_bridge") return this.executeWindowsBridge(task, context);
    if (adapter.name === "wechat_work_kf") return this.startWechatWorkKf(task, context);
    return this.executeDryRun(task, context);
  }

  async deliverWechatWorkKf(
    task: any,
    binding: { openKfid: string; externalUserId: string },
    msgid: string,
  ) {
    if (!this.wechatWorkApi) throw new Error("wechat work api client is unavailable");
    const text = String(task?.payload?.textBeforeImages || task?.payload?.textBeforeFiles || task?.payload?.text || "").trim();
    const rawImagePaths = Array.isArray(task?.payload?.imagePaths) ? task.payload.imagePaths : [];
    const images = rawImagePaths.map((filePath: unknown) => resolveWechatWorkImageFile(filePath));
    const rawFilePaths = Array.isArray(task?.payload?.filePaths) ? task.payload.filePaths : [];
    const files = rawFilePaths.map((filePath: unknown) => resolveWechatWorkMaterialFile(filePath));
    const actionCount = (text ? 1 : 0) + images.length + files.length;
    if (!actionCount) throw new Error("wechat work customer-service send requires text, image, or material file");
    if (actionCount > 5) throw new Error("wechat work customer-service send exceeds the 5-message limit");
    if (text && Buffer.byteLength(text, "utf8") > 2048) {
      throw new Error("wechat work customer-service text exceeds 2048 bytes");
    }

    const acceptedMessageIds: string[] = [];
    const uploadedMediaIds: string[] = [];
    const messages: Array<Record<string, unknown>> = [];
    const actionMsgId = (index: number) => actionCount === 1 ? msgid : `${msgid}_${index + 1}`;
    let actionIndex = 0;

    if (text) {
      const outboundMsgId = actionMsgId(actionIndex++);
      try {
        const response = await this.wechatWorkApi.sendText({
          externalUserId: binding.externalUserId,
          openKfid: binding.openKfid,
          text,
          msgid: outboundMsgId,
        });
        const apiMsgId = response.msgid || outboundMsgId;
        acceptedMessageIds.push(apiMsgId);
        messages.push({ type: "text", msgid: apiMsgId });
      } catch (error) {
        throw buildWechatWorkDeliveryError(error, "send_text", acceptedMessageIds, uploadedMediaIds);
      }
    }

    for (const image of images) {
      let mediaId: string;
      try {
        const upload = await this.wechatWorkApi.uploadImage({ filePath: image.filePath });
        mediaId = upload.media_id;
        uploadedMediaIds.push(mediaId);
      } catch (error) {
        throw buildWechatWorkDeliveryError(error, "upload_image", acceptedMessageIds, uploadedMediaIds);
      }
      const outboundMsgId = actionMsgId(actionIndex++);
      try {
        const response = await this.wechatWorkApi.sendImage({
          externalUserId: binding.externalUserId,
          openKfid: binding.openKfid,
          mediaId,
          msgid: outboundMsgId,
        });
        const apiMsgId = response.msgid || outboundMsgId;
        acceptedMessageIds.push(apiMsgId);
        messages.push({ type: "image", msgid: apiMsgId, mediaId, fileName: image.fileName });
      } catch (error) {
        throw buildWechatWorkDeliveryError(error, "send_image", acceptedMessageIds, uploadedMediaIds);
      }
    }

    for (const file of files) {
      let mediaId: string;
      try {
        const upload = await this.wechatWorkApi.uploadFile({ filePath: file.filePath });
        mediaId = upload.media_id;
        uploadedMediaIds.push(mediaId);
      } catch (error) {
        throw buildWechatWorkDeliveryError(error, "upload_file", acceptedMessageIds, uploadedMediaIds);
      }
      const outboundMsgId = actionMsgId(actionIndex++);
      try {
        const response = await this.wechatWorkApi.sendFile({
          externalUserId: binding.externalUserId,
          openKfid: binding.openKfid,
          mediaId,
          msgid: outboundMsgId,
        });
        const apiMsgId = response.msgid || outboundMsgId;
        acceptedMessageIds.push(apiMsgId);
        messages.push({ type: "file", msgid: apiMsgId, mediaId, fileName: file.fileName });
      } catch (error) {
        throw buildWechatWorkDeliveryError(error, "send_file", acceptedMessageIds, uploadedMediaIds);
      }
    }

    return {
      errcode: 0,
      errmsg: "ok",
      msgid: acceptedMessageIds.at(-1) || msgid,
      messages,
      apiMsgIds: acceptedMessageIds,
      uploadedMediaIds,
    };
  }

  listBridgeOutbox(): BridgeFileEntry[] {
    return this.listBridgeFiles(appConfig.wechatBridgeOutboxDir);
  }

  listBridgeInbox(): BridgeFileEntry[] {
    return this.listBridgeFiles(appConfig.wechatBridgeInboxDir);
  }

  listBridgeDispatch(): BridgeFileEntry[] {
    return this.listBridgeFiles(appConfig.wechatBridgeDispatchDir);
  }

  getBridgeWorkerStatus() {
    const statusFile = appConfig.wechatBridgeWorkerStatusFile;
    if (!fs.existsSync(statusFile)) {
      return {
        ok: false,
        status: "not_started",
        statusFile,
        ageSeconds: null,
        message: "bridge worker has not written a status file yet",
      };
    }

    const stat = fs.statSync(statusFile);
    const ageSeconds = Math.max(0, Math.round((Date.now() - stat.mtime.getTime()) / 1000));
    try {
      const data = JSON.parse(fs.readFileSync(statusFile, "utf8"));
      return {
        ...data,
        statusFile,
        ageSeconds,
        modifiedAt: stat.mtime.toISOString(),
      };
    } catch (error) {
      return {
        ok: false,
        status: "invalid_status_file",
        statusFile,
        ageSeconds,
        modifiedAt: stat.mtime.toISOString(),
        errorMessage: error instanceof Error ? error.message : "invalid bridge worker status json",
      };
    }
  }

  listBridgeLocks(): BridgeLockEntry[] {
    const lockDir = appConfig.wechatBridgeLockDir;
    fs.mkdirSync(lockDir, { recursive: true });
    const now = Date.now();
    return fs
      .readdirSync(lockDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".lock"))
      .map((entry) => this.readBridgeLock(path.join(lockDir, entry.name), now))
      .sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  moveBridgeInboxFile(filePath: string, outcome: "processed" | "failed") {
    const checked = resolveBridgeChildFile(filePath, appConfig.wechatBridgeInboxDir, "bridge inbox");
    if (!checked) return null;
    const { resolved, root: inboxRoot } = checked;
    const targetDir = path.join(inboxRoot, outcome);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, `${Date.now()}-${path.basename(resolved)}`);
    fs.renameSync(resolved, targetPath);
    return targetPath;
  }

  moveBridgeOutboxFile(filePath: string, outcome: "processed" | "failed" | "cancelled") {
    const checked = resolveBridgeChildFile(filePath, appConfig.wechatBridgeOutboxDir, "bridge outbox");
    if (!checked) return null;
    const { resolved, root: outboxRoot } = checked;
    const targetDir = path.join(outboxRoot, outcome);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, `${Date.now()}-${path.basename(resolved)}`);
    fs.renameSync(resolved, targetPath);
    return targetPath;
  }

  moveBridgeDispatchFile(filePath: string, outcome: "processed" | "failed" | "cancelled" | "uncertain") {
    const checked = resolveBridgeChildFile(filePath, appConfig.wechatBridgeDispatchDir, "bridge dispatch");
    if (!checked) return null;
    const { resolved, root: dispatchRoot } = checked;
    const targetDir = path.join(dispatchRoot, outcome);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, path.basename(resolved));
    if (fs.existsSync(targetPath)) return targetPath;
    fs.renameSync(resolved, targetPath);
    return targetPath;
  }

  private executeDryRun(task: any, context: AdapterContext): AdapterResult {
    return {
      adapter: "dry_run",
      status: "dry_run",
      metadata: {
        note: "dry_run only; no message was sent to WeChat",
        payloadKind: task?.payload?.kind || "unknown",
        guardStatus: context.guardStatus,
        windowSnapshotId: context.windowSnapshotId || null,
      },
    };
  }

  private executeWindowsBridge(task: any, context: AdapterContext): AdapterResult {
    const outboxFile = this.writeBridgeOutbox(task, context);
    return {
      adapter: "windows_bridge",
      status: "started",
      metadata: {
        outboxFile,
        requiresBridge: true,
        bridgeState: "waiting_for_ack",
        payloadKind: task?.payload?.kind || "unknown",
      },
    };
  }

  private startWechatWorkKf(task: any, context: AdapterContext): AdapterResult {
    return {
      adapter: "wechat_work_kf",
      status: "started",
      metadata: {
        bridgeState: "calling_wechat_work_api",
        payloadKind: task?.payload?.kind || "unknown",
        guardStatus: context.guardStatus,
      },
    };
  }

  private writeBridgeOutbox(task: any, context: AdapterContext) {
    try {
      fs.mkdirSync(appConfig.wechatBridgeOutboxDir, { recursive: true });
    } catch (error) {
      throw bridgeOutboxError(error, {
        deliveryState: "failed",
        retrySafe: true,
        stage: "outbox_mkdir",
      });
    }
    const safeId = String(task?.id || "send").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = path.join(appConfig.wechatBridgeOutboxDir, `${Date.now()}-${safeId}.json`);
    let contents: string;
    try {
      const target = this.buildBridgeTarget(task, context);
      contents = `${JSON.stringify(
        {
          version: "wechat_bridge_outbox_v1",
          ackToken: randomBytes(32).toString("hex"),
          taskId: task?.id,
          attemptId: context.attemptId,
          wechatAccountId: task?.wechatAccountId,
          conversationId: task?.conversationId,
          target,
          sendPlan: this.buildBridgeSendPlan(task, target),
          payload: task?.payload || {},
          guardSnapshot: task?.guardSnapshot || {},
          context,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`;
    } catch (error) {
      throw bridgeOutboxError(error, {
        deliveryState: "failed",
        retrySafe: true,
        stage: "outbox_prepare",
        outboxFile: filePath,
      });
    }
    writeFileAtomic(filePath, contents);
    return filePath;
  }

  private buildBridgeTarget(task: any, context: AdapterContext) {
    const activeWindow = task?.guardSnapshot?.activeWindow || {};
    return {
      wechatAccountId: task?.wechatAccountId || "",
      accountDisplayName: task?.wechatAccount?.displayName || "",
      conversationId: task?.conversationId || "",
      conversationTitle: task?.conversation?.title || "",
      customerId: task?.conversation?.customerId || task?.customerId || task?.designJob?.customerId || task?.quoteDraft?.customerId || "",
      customerName: task?.conversation?.customer?.name || "",
      windowSnapshotId: context.windowSnapshotId || null,
      recentMessageText: activeWindow?.recentMessageText || "",
      windowCapturedAt: activeWindow?.capturedAt || activeWindow?.createdAt || "",
      requiredChecks: task?.guardSnapshot?.requiredChecks || ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
    };
  }

  private buildBridgeSendPlan(task: any, target: Record<string, unknown>) {
    const payload = task?.payload || {};
    const kind = String(payload.kind || "unknown");
    const actions: Array<Record<string, unknown>> = [];
    const text = String(payload.textBeforeImages || payload.text || "").trim();
    if (text) actions.push({ type: "text", text });

    const imagePaths = Array.isArray(payload.imagePaths)
      ? payload.imagePaths.map((item: unknown) => String(item || "").trim()).filter(Boolean)
      : [];
    for (const filePath of imagePaths) {
      actions.push({ type: "image", filePath });
    }

    return {
      kind,
      target,
      actionCount: actions.length,
      actions,
      constraints: {
        singleAccountLock: true,
        requireActiveWindowMatch: true,
        requireRecentCustomerMatch: true,
        doNotMarkSentWithoutAck: true,
      },
    };
  }

  private listBridgeFiles(directory: string): BridgeFileEntry[] {
    fs.mkdirSync(directory, { recursive: true });
    const now = Date.now();
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => this.readBridgeFile(path.join(directory, entry.name), now))
      .sort((a, b) => String(a.createdAt || a.modifiedAt).localeCompare(String(b.createdAt || b.modifiedAt)));
  }

  private readBridgeFile(filePath: string, now: number): BridgeFileEntry {
    const stat = fs.statSync(filePath);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return {
        fileName: path.basename(filePath),
        filePath,
        taskId: data.taskId || data.sendTaskId,
        wechatAccountId: data.wechatAccountId,
        conversationId: data.conversationId,
        customerId: data.target?.customerId || data.sendPlan?.target?.customerId || data.customerId,
        payloadKind: data.sendPlan?.kind || data.payload?.kind || data.payloadKind,
        actionCount: Number.isFinite(Number(data.sendPlan?.actionCount)) ? Number(data.sendPlan.actionCount) : undefined,
        createdAt: data.createdAt || data.completedAt || data.sentAt,
        modifiedAt: stat.mtime.toISOString(),
        ageSeconds: Math.max(0, Math.round((now - stat.mtime.getTime()) / 1000)),
        data,
      };
    } catch (error) {
      return {
        fileName: path.basename(filePath),
        filePath,
        modifiedAt: stat.mtime.toISOString(),
        ageSeconds: Math.max(0, Math.round((now - stat.mtime.getTime()) / 1000)),
        errorMessage: error instanceof Error ? error.message : "invalid bridge json",
      };
    }
  }

  private readBridgeLock(filePath: string, now: number): BridgeLockEntry {
    const stat = fs.statSync(filePath);
    const ageSeconds = Math.max(0, Math.round((now - stat.mtime.getTime()) / 1000));
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return {
        fileName: path.basename(filePath),
        filePath,
        accountId: data.accountId,
        pid: Number.isFinite(Number(data.pid)) ? Number(data.pid) : undefined,
        createdAt: data.createdAt,
        modifiedAt: stat.mtime.toISOString(),
        ageSeconds,
        stale: ageSeconds > appConfig.sendBridgeAckTimeoutMinutes * 60,
      };
    } catch (error) {
      return {
        fileName: path.basename(filePath),
        filePath,
        modifiedAt: stat.mtime.toISOString(),
        ageSeconds,
        stale: true,
        errorMessage: error instanceof Error ? error.message : "invalid bridge lock json",
      };
    }
  }

  private resolve(adapterName?: string) {
    const name = String(adapterName || appConfig.wechatSendAdapter || "dry_run").trim();
    if (name === "windows_bridge") return adapters.windows_bridge;
    if (name === "wechat_work_kf") return adapters.wechat_work_kf;
    return adapters.dry_run;
  }
}

function buildWechatWorkDeliveryError(
  error: unknown,
  stage: string,
  acceptedMessageIds: string[],
  uploadedMediaIds: string[],
) {
  const explicitApiFailure = error instanceof WechatWorkApiError && typeof error.errcode === "number";
  // 95001 means the active customer-service session has exhausted its send
  // count. Retrying the same payload cannot make progress until the customer
  // sends again, and can otherwise create a burst of duplicate attempts.
  // 95018 likewise describes a session state that cannot be repaired by an
  // immediate replay.
  const retryBlockedByApiCode = explicitApiFailure && [95001, 95018].includes(Number(error.errcode));
  const hasAcceptedMessages = acceptedMessageIds.length > 0;
  const deliveryState = hasAcceptedMessages ? "partial" : explicitApiFailure || stage === "upload_image" ? "failed" : "unknown";
  const retrySafe = !hasAcceptedMessages && !retryBlockedByApiCode && (stage === "upload_image" || explicitApiFailure);
  return new WechatWorkKfDeliveryError(
    error instanceof Error ? error.message : `wechat work ${stage} failed`,
    {
      retrySafe,
      deliveryState,
      stage,
      acceptedMessageIds,
      uploadedMediaIds,
    },
  );
}

function resolveBridgeChildFile(filePath: string, rootDir: string, label: string) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(rootDir);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || path.basename(resolved) !== relative) {
    throw new Error(`${label} file is outside ${label.includes("outbox") ? "outbox" : "inbox"} directory`);
  }
  if (!fs.existsSync(resolved)) return null;
  if (!fs.lstatSync(resolved).isFile()) {
    throw new Error(`${label} file must be a regular file`);
  }
  const realRoot = fs.realpathSync(root);
  const realResolved = fs.realpathSync(resolved);
  const realRelative = path.relative(realRoot, realResolved);
  if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error(`${label} file resolves outside ${label.includes("outbox") ? "outbox" : "inbox"} directory`);
  }
  return { resolved, root };
}

function writeFileAtomic(filePath: string, contents: string) {
  const resolved = path.resolve(filePath);
  const tempPath = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`);
  let stage = "outbox_temp_write";
  try {
    fs.writeFileSync(tempPath, contents, "utf8");
    stage = "outbox_temp_fsync";
    const fd = fs.openSync(tempPath, "r");
    try {
      bestEffortFsync(fd);
    } finally {
      fs.closeSync(fd);
    }
    stage = "outbox_publish_rename";
    fs.renameSync(tempPath, resolved);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    const published = fs.existsSync(resolved);
    throw bridgeOutboxError(error, {
      deliveryState: published ? "unknown" : "failed",
      retrySafe: !published,
      stage,
      outboxFile: resolved,
    });
  }
}

function bridgeOutboxError(
  error: unknown,
  details: {
    deliveryState: "failed" | "unknown";
    retrySafe: boolean;
    stage: string;
    outboxFile?: string;
  },
) {
  const message = error instanceof Error ? error.message : String(error || "bridge outbox write failed");
  return new WechatBridgeOutboxError(message, details);
}

function bestEffortFsync(fd: number) {
  try {
    fs.fsyncSync(fd);
  } catch (error: any) {
    if (!["EPERM", "EINVAL", "ENOTSUP"].includes(error?.code)) throw error;
  }
}
