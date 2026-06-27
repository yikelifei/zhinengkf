import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { appConfig } from "../shared/app-config";

type AdapterStatus = "started" | "dry_run" | "sent" | "failed";

type AdapterContext = {
  guardStatus: string;
  windowSnapshotId?: string | null;
  payloadSummary: Record<string, unknown>;
};

type AdapterResult = {
  adapter: string;
  status: AdapterStatus;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
};

type BridgeFileEntry = {
  fileName: string;
  filePath: string;
  taskId?: string;
  wechatAccountId?: string;
  conversationId?: string;
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
};

@Injectable()
export class WechatSendAdapterService {
  describe(adapterName?: string) {
    const adapter = this.resolve(adapterName);
    return {
      ...adapter,
      configuredName: appConfig.wechatSendAdapter,
      capabilities: {
        text: true,
        images: adapter.name === "dry_run",
        quote: true,
        requiresWindowGuard: true,
        writesOutbox: adapter.name === "windows_bridge",
      },
    };
  }

  execute(task: any, context: AdapterContext, adapterName?: string): AdapterResult {
    const adapter = this.resolve(adapterName);
    if (adapter.name === "windows_bridge") return this.executeWindowsBridge(task, context);
    return this.executeDryRun(task, context);
  }

  listBridgeOutbox(): BridgeFileEntry[] {
    return this.listBridgeFiles(appConfig.wechatBridgeOutboxDir);
  }

  listBridgeInbox(): BridgeFileEntry[] {
    return this.listBridgeFiles(appConfig.wechatBridgeInboxDir);
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
    const resolved = path.resolve(filePath);
    const inboxRoot = path.resolve(appConfig.wechatBridgeInboxDir);
    const relative = path.relative(inboxRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("bridge inbox file is outside inbox directory");
    }
    if (!fs.existsSync(resolved)) return null;
    const targetDir = path.join(inboxRoot, outcome);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, `${Date.now()}-${path.basename(resolved)}`);
    fs.renameSync(resolved, targetPath);
    return targetPath;
  }

  moveBridgeOutboxFile(filePath: string, outcome: "processed" | "failed" | "cancelled") {
    const resolved = path.resolve(filePath);
    const outboxRoot = path.resolve(appConfig.wechatBridgeOutboxDir);
    const relative = path.relative(outboxRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("bridge outbox file is outside outbox directory");
    }
    if (!fs.existsSync(resolved)) return null;
    const targetDir = path.join(outboxRoot, outcome);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, `${Date.now()}-${path.basename(resolved)}`);
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

  private writeBridgeOutbox(task: any, context: AdapterContext) {
    fs.mkdirSync(appConfig.wechatBridgeOutboxDir, { recursive: true });
    const safeId = String(task?.id || "send").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = path.join(appConfig.wechatBridgeOutboxDir, `${Date.now()}-${safeId}.json`);
    const target = this.buildBridgeTarget(task, context);
    fs.writeFileSync(
      filePath,
      `${JSON.stringify(
        {
          version: "wechat_bridge_outbox_v1",
          ackToken: randomBytes(32).toString("hex"),
          taskId: task?.id,
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
      )}\n`,
      "utf8",
    );
    return filePath;
  }

  private buildBridgeTarget(task: any, context: AdapterContext) {
    return {
      wechatAccountId: task?.wechatAccountId || "",
      accountDisplayName: task?.wechatAccount?.displayName || "",
      conversationId: task?.conversationId || "",
      conversationTitle: task?.conversation?.title || "",
      customerId: task?.conversation?.customerId || "",
      customerName: task?.conversation?.customer?.name || "",
      windowSnapshotId: context.windowSnapshotId || null,
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
    return adapters.dry_run;
  }
}
