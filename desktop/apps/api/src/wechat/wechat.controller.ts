import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { WechatDispatchService } from "./wechat-dispatch.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";
import {
  OperatorAccessGuard,
  RequireOperatorCapability,
  TrustedOperator,
} from "../operator-access/operator-access.guard";
import { TrustedOperatorPrincipal } from "../operator-access/operator-access.types";

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

  @Get("conversations/:id/messages")
  listConversationTimeline(
    @Param("id") id: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("customerId") customerId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.wechat.listConversationTimeline({
      wechatAccountId,
      conversationId: id,
      customerId,
      limit: Number(limit || 300),
    });
  }

  @Post("conversations/:id/read")
  markConversationMessagesRead(@Param("id") id: string, @Body() payload: ExpectedIdentityPayload = {}) {
    if (!payload.expectedConversationId || payload.expectedConversationId !== id) {
      throw new BadRequestException("mark messages read requires matching expectedConversationId");
    }
    return this.wechat.markConversationMessagesRead({
      wechatAccountId: payload.expectedWechatAccountId,
      conversationId: id,
      customerId: payload.expectedCustomerId,
    });
  }

  @Post("conversations/:id/manual-replies")
  @RequireOperatorCapability("reply_conversations")
  @UseGuards(OperatorAccessGuard)
  enqueueManualReply(
    @Param("id") id: string,
    @Body() payload: { text?: string; operator?: string } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    if (!payload.expectedConversationId || payload.expectedConversationId !== id) {
      throw new BadRequestException("manual reply requires matching expectedConversationId");
    }
    return this.wechat.enqueueManualReply({
      wechatAccountId: payload.expectedWechatAccountId,
      conversationId: id,
      customerId: payload.expectedCustomerId,
      text: payload.text,
      operator: principal.id,
    });
  }

  @Post("conversations/:id/manual-lock")
  @RequireOperatorCapability("manage_assignments")
  @UseGuards(OperatorAccessGuard)
  setConversationManualLock(
    @Param("id") id: string,
    @Body() payload: { locked?: boolean; reviewer?: string; reason?: string; note?: string } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    return this.wechat.setConversationManualLock(id, { ...(payload || {}), reviewer: principal.id });
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

  @Get("channels/status")
  getChannelStatus(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.wechat.getChannelStatus({ wechatAccountId, conversationId, customerId });
  }

  @Post("channels/:channel/inbound/test")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  processChannelInboundTest(
    @Param("channel") channel: "personal_wechat" | "work_wechat" | "mini_program",
    @Body() payload: {
      wechatAccountId?: string;
      conversationId?: string;
      customerId?: string;
      text?: string;
      externalId?: string;
      assetIds?: string[];
      attachments?: Array<Record<string, unknown>>;
    } & ExpectedIdentityPayload,
  ) {
    return this.wechat.processChannelInboundTest(channel, payload || {});
  }

  @Get("bridge/outbox")
  listBridgeOutbox(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.wechat.listBridgeOutbox({ wechatAccountId, conversationId, customerId });
  }

  @Get("bridge/dispatch")
  listBridgeDispatch(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.wechat.listBridgeDispatch({ wechatAccountId, conversationId, customerId });
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
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  captureWindowObserverOnce() {
    return this.wechat.captureWindowObserverOnce();
  }

  @Post("window-snapshots/inbox/scan")
  scanWindowSnapshotInbox() {
    return this.wechat.scanWindowSnapshotInbox();
  }

  @Post("window-snapshots/demo")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  createDemoWindowSnapshot(
    @Body()
    payload: {
      mode?: "correct" | "wrong_chat" | "offline";
      wechatAccountId?: string;
      conversationId?: string;
    } & ExpectedIdentityPayload,
  ) {
    return this.wechat.createDemoWindowSnapshot(payload || {});
  }

  @Post("send-tasks/demo")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  createDemoSendTask(@Body() payload: { wechatAccountId?: string; conversationId?: string; text?: string } & ExpectedIdentityPayload) {
    return this.wechat.createDemoSendTask(payload || {});
  }

  @Post("orders/:id/queue-confirmation")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  queueOrderConfirmation(
    @Param("id") id: string,
    @Body()
    payload: {
      owner?: string;
      note?: string;
      reason?: string;
      releaseManualLock?: boolean;
      releaseReason?: string;
    } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    return this.wechat.queueOrderConfirmation(id, { ...(payload || {}), owner: principal.id });
  }

  @Post("orders/:id/queue-followup")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  queueOrderFollowup(
    @Param("id") id: string,
    @Body()
    payload: {
      type?: "production" | "delivery";
      owner?: string;
      reason?: string;
      releaseManualLock?: boolean;
      releaseReason?: string;
    } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    return this.wechat.queueOrderFollowup(id, { ...(payload || {}), owner: principal.id });
  }

  @Post("send-tasks/scan-ops")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  scanSendOperations(@Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.wechat.scanSendOperations(payload || {});
  }

  @Post("send-tasks/process-safe-queue")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  processSafeSendQueue(
    @Body() payload: { adapter?: string; limit?: number; wechatAccountId?: string; conversationId?: string; customerId?: string },
  ) {
    return this.wechat.processSafeSendQueue(payload || {});
  }

  @Post("send-tasks/:id/validate")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  validateSendTask(
    @Param("id") id: string,
    @Body() payload: ExpectedIdentityPayload,
  ) {
    return this.wechat.validateSendTask(id, payload || {});
  }

  @Post("send-tasks/:id/validate-current-window")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  validateWithCurrentWindow(@Param("id") id: string, @Body() payload: ExpectedIdentityPayload = {}) {
    return this.wechat.validateSendTaskWithCurrentWindow(id, payload || {});
  }

  @Post("send-tasks/:id/mark-sent")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  markSent(
    @Param("id") id: string,
    @Body() payload: { mode?: "correct" | "wrong_chat"; activeWindow?: Record<string, unknown> },
  ) {
    return this.wechat.markSentAfterGuard(id, payload || {});
  }

  @Post("send-tasks/:id/mark-sent-current-window")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  markSentWithCurrentWindow(@Param("id") id: string) {
    return this.wechat.markSentAfterCurrentWindowGuard(id);
  }

  @Post("send-tasks/:id/execute-dry-run")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  executeDryRun(@Param("id") id: string, @Body() payload: ExpectedIdentityPayload = {}) {
    return this.wechat.executeDryRunSend(id, payload || {});
  }

  @Post("send-tasks/:id/execute")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  executeSend(@Param("id") id: string, @Body() payload: { adapter?: string } & ExpectedIdentityPayload) {
    return this.wechat.executeQueuedSend(id, payload || {});
  }

  @Post("send-tasks/:id/requeue")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  requeueSendTask(@Param("id") id: string, @Body() payload: { reason?: string } & ExpectedIdentityPayload) {
    return this.wechat.requeueSendTask(id, payload || {});
  }

  @Post("send-tasks/:id/cancel")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
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
