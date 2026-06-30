import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { WechatDispatchService } from "./wechat-dispatch.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";

@Controller("wechat")
export class WechatController {
  constructor(private readonly wechat: WechatDispatchService) {}

  @Get("accounts")
  listAccounts() {
    return this.wechat.listAccounts();
  }

  @Get("conversations")
  listConversations(@Query("wechatAccountId") wechatAccountId?: string) {
    return this.wechat.listConversations(wechatAccountId);
  }

  @Post("conversations/:id/manual-lock")
  setConversationManualLock(
    @Param("id") id: string,
    @Body() payload: { locked?: boolean; reviewer?: string; reason?: string; note?: string } & ExpectedIdentityPayload,
  ) {
    return this.wechat.setConversationManualLock(id, payload || {});
  }

  @Post("inbound/messages")
  processInboundMessage(@Body() payload: {
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    text: string;
    externalId?: string;
    assetIds?: string[];
    attachments?: Array<Record<string, unknown>>;
  }) {
    return this.wechat.processInboundMessage(payload || { text: "" });
  }

  @Get("send-tasks")
  listSendTasks(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.wechat.listSendTasks({ wechatAccountId, conversationId, customerId });
  }

  @Get("send-attempts")
  listSendAttempts(
    @Query("sendTaskId") sendTaskId?: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.wechat.listSendAttempts({ sendTaskId, wechatAccountId, conversationId, customerId });
  }

  @Get("send-adapter")
  getSendAdapter(@Query("adapter") adapter?: string) {
    return this.wechat.getSendAdapter(adapter);
  }

  @Get("bridge/outbox")
  listBridgeOutbox(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.wechat.listBridgeOutbox({ wechatAccountId, conversationId, customerId });
  }

  @Get("bridge/status")
  getBridgeStatus(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.wechat.getBridgeStatus({ wechatAccountId, conversationId, customerId });
  }

  @Post("bridge/inbox/scan")
  scanBridgeInbox() {
    return this.wechat.scanBridgeInbox();
  }

  @Get("window-snapshots")
  listWindowSnapshots(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.wechat.listWindowSnapshots({ wechatAccountId, conversationId, customerId });
  }

  @Get("window-observer/status")
  getWindowObserverStatus() {
    return this.wechat.getWindowObserverStatus();
  }

  @Post("window-observer/capture-once")
  captureWindowObserverOnce() {
    return this.wechat.captureWindowObserverOnce();
  }

  @Post("window-snapshots")
  createWindowSnapshot(@Body() payload: Record<string, unknown>) {
    return this.wechat.createWindowSnapshot(payload || {});
  }

  @Post("window-snapshots/inbox/scan")
  scanWindowSnapshotInbox() {
    return this.wechat.scanWindowSnapshotInbox();
  }

  @Post("window-snapshots/demo")
  createDemoWindowSnapshot(
    @Body() payload: { mode?: "correct" | "wrong_chat" | "offline"; wechatAccountId?: string; conversationId?: string },
  ) {
    return this.wechat.createDemoWindowSnapshot(payload || {});
  }

  @Post("send-tasks/demo")
  createDemoSendTask(@Body() payload: { wechatAccountId?: string; conversationId?: string; text?: string }) {
    return this.wechat.createDemoSendTask(payload || {});
  }

  @Post("orders/:id/queue-confirmation")
  queueOrderConfirmation(
    @Param("id") id: string,
    @Body() payload: { owner?: string; note?: string } & ExpectedIdentityPayload,
  ) {
    return this.wechat.queueOrderConfirmation(id, payload || {});
  }

  @Post("orders/:id/queue-followup")
  queueOrderFollowup(
    @Param("id") id: string,
    @Body() payload: { type?: "production" | "delivery"; owner?: string } & ExpectedIdentityPayload,
  ) {
    return this.wechat.queueOrderFollowup(id, payload || {});
  }

  @Post("send-tasks/scan-ops")
  scanSendOperations() {
    return this.wechat.scanSendOperations();
  }

  @Post("send-tasks/process-safe-queue")
  processSafeSendQueue(@Body() payload: { adapter?: string; limit?: number }) {
    return this.wechat.processSafeSendQueue(payload || {});
  }

  @Post("send-tasks/:id/validate")
  validateSendTask(
    @Param("id") id: string,
    @Body() payload: { mode?: "correct" | "wrong_chat"; activeWindow?: Record<string, unknown> },
  ) {
    return this.wechat.validateSendTask(id, payload || {});
  }

  @Post("send-tasks/:id/validate-current-window")
  validateWithCurrentWindow(@Param("id") id: string) {
    return this.wechat.validateSendTaskWithCurrentWindow(id);
  }

  @Post("send-tasks/:id/mark-sent")
  markSent(
    @Param("id") id: string,
    @Body() payload: { mode?: "correct" | "wrong_chat"; activeWindow?: Record<string, unknown> },
  ) {
    return this.wechat.markSentAfterGuard(id, payload || {});
  }

  @Post("send-tasks/:id/mark-sent-current-window")
  markSentWithCurrentWindow(@Param("id") id: string) {
    return this.wechat.markSentAfterCurrentWindowGuard(id);
  }

  @Post("send-tasks/:id/execute-dry-run")
  executeDryRun(@Param("id") id: string, @Body() payload: ExpectedIdentityPayload = {}) {
    return this.wechat.executeDryRunSend(id, payload || {});
  }

  @Post("send-tasks/:id/execute")
  executeSend(@Param("id") id: string, @Body() payload: { adapter?: string } & ExpectedIdentityPayload) {
    return this.wechat.executeSend(id, payload || {});
  }

  @Post("send-tasks/:id/requeue")
  requeueSendTask(@Param("id") id: string, @Body() payload: { reason?: string } & ExpectedIdentityPayload) {
    return this.wechat.requeueSendTask(id, payload || {});
  }

  @Post("send-tasks/:id/cancel")
  cancelSendTask(@Param("id") id: string, @Body() payload: { reason?: string } & ExpectedIdentityPayload) {
    return this.wechat.cancelSendTask(id, payload || {});
  }

  @Post("send-tasks/:id/bridge-ack")
  acknowledgeBridgeSend(
    @Param("id") id: string,
    @Body() payload: {
      status: "sent" | "failed";
      version?: string;
      protocolVersion?: string;
      ackToken?: string;
      bridgeAckToken?: string;
      taskId?: string;
      attemptId?: string;
      wechatAccountId?: string;
      conversationId?: string;
      outboxFileName?: string;
      outboxFile?: string;
      errorMessage?: string;
      metadata?: Record<string, unknown>;
      sentAt?: string;
    },
  ) {
    return this.wechat.acknowledgeBridgeSend(id, payload || { status: "failed" });
  }
}
