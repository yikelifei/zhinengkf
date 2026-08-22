"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");
const { WechatSendAdapterService } = require("../apps/api/src/wechat/wechat-send-adapter.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

function setup() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-messages-"));
  appConfig.useLocalStore = true;
  appConfig.wechatBridgeOutboxDir = path.join(tempDir, "outbox");
  appConfig.wechatBridgeInboxDir = path.join(tempDir, "inbox");
  appConfig.wechatBridgeDispatchDir = path.join(tempDir, "dispatch");
  appConfig.wechatBridgeLockDir = path.join(tempDir, "locks");
  const localStore = new LocalStoreService();
  localStore.filePath = path.join(tempDir, "local-store.json");
  const service = new WechatDispatchService(
    {},
    localStore,
    new WechatSendAdapterService(),
    { create: async () => ({}) },
    { getById: async (id) => localStore.getOrderDraft(id) },
  );
  return { tempDir, localStore, service };
}

const primaryIdentity = {
  wechatAccountId: "wechat_demo_1",
  conversationId: "conversation_demo_1",
  customerId: "customer_demo_1",
};

test("conversation timeline requires and enforces account customer conversation identity", async () => {
  const { service } = setup();
  await assert.rejects(() => service.listConversationTimeline({ conversationId: primaryIdentity.conversationId }), /complete conversation identity/);
  await assert.rejects(() => service.listConversationTimeline({ ...primaryIdentity, wechatAccountId: "wechat_demo_2" }), /conversation not found|wechat account binding invalid/);
  await assert.rejects(() => service.listConversationTimeline({ ...primaryIdentity, customerId: "customer_demo_2" }), /customer binding invalid/);
  const timeline = await service.listConversationTimeline(primaryIdentity);
  assert.equal(timeline.every((item) => item.conversationId === primaryIdentity.conversationId), true);
  assert.equal(timeline.some((item) => item.text.includes("企业伴手礼")), false);
});

test("timeline shows inbound attachments and queued outbound tasks immediately", async () => {
  const { localStore, service } = setup();
  localStore.createMessage({
    ...primaryIdentity,
    text: "请看附件",
    externalId: "external-attachment-1",
    attachments: [
      { name: "参考图.png", mimeType: "image/png", status: "loaded" },
      { name: "需求单.pdf", mimeType: "application/pdf", status: "available" },
      { source: "wechat_work", externalUserId: "wm_customer", raw: { msgtype: "text" } },
    ],
  });
  const reply = await service.enqueueManualReply({
    ...primaryIdentity,
    text: "收到，我先核对附件。",
    operator: "客服甲",
    operationKey: "conversation-attachment-reply-1",
  });
  const queuedTimeline = await service.listConversationTimeline(primaryIdentity);
  const inbound = queuedTimeline.find((item) => item.externalId === "external-attachment-1");
  assert.deepEqual(inbound.attachments.map((item) => item.kind), ["image", "file"]);
  const queuedOutbound = queuedTimeline.find((item) => item.sendTaskId === reply.task.id);
  assert.equal(queuedOutbound.direction, "outbound");
  assert.equal(queuedOutbound.status, "queued");
  assert.equal(queuedOutbound.text, reply.task.payload.text);

  localStore.updateSendTask(reply.task.id, {
    status: "sent",
    sentAt: new Date().toISOString(),
    errorMessage: "",
  });
  const timeline = await service.listConversationTimeline(primaryIdentity);
  const outbound = timeline.find((item) => item.sendTaskId === reply.task.id);
  assert.equal(outbound.direction, "outbound");
  assert.equal(outbound.status, "sent");
  assert.equal(outbound.text, "收到，我先核对附件。");
  assert.equal(timeline.every((item, index) => index === 0 || timeline[index - 1].createdAt <= item.createdAt), true);
});

test("read state is isolated, inbound-only, and idempotent", async () => {
  const { localStore, service } = setup();
  localStore.createMessage({ ...primaryIdentity, text: "新的未读消息", externalId: "unread-1" });
  await service.enqueueManualReply({
    ...primaryIdentity,
    text: "人工回复不增加未读",
    operationKey: "conversation-read-state-reply-1",
  });
  const before = localStore.listConversations().find((item) => item.id === primaryIdentity.conversationId);
  assert.equal(before.unreadCount >= 2, true);
  const first = await service.markConversationMessagesRead(primaryIdentity);
  const second = await service.markConversationMessagesRead(primaryIdentity);
  const after = localStore.listConversations().find((item) => item.id === primaryIdentity.conversationId);
  const other = localStore.listConversations().find((item) => item.id === "conversation_demo_2");
  assert.equal(first.updatedCount >= 2, true);
  assert.equal(second.updatedCount, 0);
  assert.equal(after.unreadCount, 0);
  assert.equal(other.unreadCount, 1);
});

test("external inbound replay is idempotent within the conversation", () => {
  const { localStore } = setup();
  const payload = { ...primaryIdentity, text: "一次", externalId: "same-event" };
  const first = localStore.createMessage(payload);
  const replay = localStore.createMessage(payload);
  const timeline = localStore.listConversationTimeline(primaryIdentity);
  assert.equal(replay.id, first.id);
  assert.equal(timeline.filter((item) => item.externalId === "same-event").length, 1);
  assert.throws(
    () => localStore.createMessage({ ...payload, text: "同一外部事件被替换为不同内容" }),
    /inbound message create operationKey was already used with different identity or payload/,
  );
});

test("timeline keeps pure WeCom text out of attachments and preserves structured message types", async () => {
  const { localStore, service } = setup();
  localStore.createMessage({
    ...primaryIdentity,
    text: "参考这个卡片",
    externalId: "wecom-text-with-legacy-payload",
    attachments: [{
      source: "wechat_work_kf",
      msgid: "wecom-text-with-legacy-payload",
      msgtype: "text",
      payload: { content: "参考这个卡片" },
      raw: { msgtype: "text", text: { content: "参考这个卡片" } },
    }],
  });
  localStore.createMessage({
    ...primaryIdentity,
    text: "[链接] 企业礼赠方案 https://example.com/gift",
    externalId: "wecom-link-with-legacy-payload",
    attachments: [{
      source: "wechat_work_kf",
      msgid: "wecom-link-with-legacy-payload",
      msgtype: "link",
      payload: { title: "企业礼赠方案", desc: "查看商品搭配", url: "https://example.com/gift" },
    }],
  });
  localStore.createMessage({
    ...primaryIdentity,
    text: "[语音]",
    externalId: "wecom-voice-media",
    attachments: [{
      source: "wechat_work_kf",
      msgid: "wecom-voice-media",
      msgtype: "voice",
      type: "audio/wav",
      localPath: "E:\\storage\\voice.wav",
      status: "ready",
    }],
  });

  const timeline = await service.listConversationTimeline(primaryIdentity);
  const textMessage = timeline.find((item) => item.externalId === "wecom-text-with-legacy-payload");
  assert.equal(textMessage.messageType, "text");
  assert.equal(textMessage.text, "参考这个卡片");
  assert.deepEqual(textMessage.content, { content: "参考这个卡片" });
  assert.deepEqual(textMessage.attachments, []);

  const linkMessage = timeline.find((item) => item.externalId === "wecom-link-with-legacy-payload");
  assert.equal(linkMessage.messageType, "link");
  assert.equal(linkMessage.text, "");
  assert.deepEqual(linkMessage.attachments, []);
  assert.deepEqual(linkMessage.content, {
    title: "企业礼赠方案",
    description: "查看商品搭配",
    url: "https://example.com/gift",
  });

  const voiceMessage = timeline.find((item) => item.externalId === "wecom-voice-media");
  assert.equal(voiceMessage.text, "");
  assert.equal(voiceMessage.attachments[0].kind, "voice");
  assert.equal(voiceMessage.attachments[0].name, "voice.wav");
});

test("official inbound media is read through the conversation-bound attachment route", async () => {
  const { tempDir, localStore, service } = setup();
  const storageRoot = path.join(tempDir, "storage");
  const inboundDirectory = path.join(storageRoot, "wechat-work", "inbound", "message-1");
  fs.mkdirSync(inboundDirectory, { recursive: true });
  const mediaPath = path.join(inboundDirectory, "voice.wav");
  const bytes = Buffer.from("RIFF0000WAVEfmt ", "ascii");
  fs.writeFileSync(mediaPath, bytes);
  appConfig.localStorageRoot = storageRoot;
  localStore.createMessage({
    ...primaryIdentity,
    text: "[语音]",
    externalId: "official-media-message-1",
    attachments: [{
      source: "wechat_work_kf",
      msgid: "official-media-message-1",
      msgtype: "voice",
      type: "audio/wav",
      localPath: mediaPath,
      size: bytes.length,
      status: "ready",
    }],
  });
  const timeline = await service.listConversationTimeline(primaryIdentity);
  const message = timeline.find((item) => item.externalId === "official-media-message-1");
  const file = await service.readConversationTimelineAttachment(primaryIdentity, message.id, message.attachments[0].id);
  assert.equal(file.mimeType, "audio/wav");
  assert.equal(file.sizeBytes, bytes.length);
  assert.equal(file.fileName, "voice.wav");
  file.stream.destroy();
  await assert.rejects(
    () => service.readConversationTimelineAttachment({ ...primaryIdentity, customerId: "customer_demo_2" }, message.id, message.attachments[0].id),
    /customer binding invalid/,
  );
});

test("one rich outbound task is displayed as the same ordered WeCom message sequence", async () => {
  const { localStore, service } = setup();
  const task = localStore.createSendTask({
    operationKey: "rich-outbound-timeline-1",
    ...primaryIdentity,
    payload: {
      kind: "wechat_work_messages",
      messages: [
        { msgtype: "text", message: { content: "先看商品方案" } },
        { msgtype: "link", message: { title: "企业礼赠方案", desc: "打开查看", url: "https://example.com/gift" } },
        { msgtype: "miniprogram", message: { title: "礼赠商城", appid: "wx-demo", pagepath: "/products", thumb_media_id: "media-1" } },
        { msgtype: "file", message: { media_id: "media-file-1" }, fileName: "报价单.pdf" },
      ],
    },
    guardSnapshot: { policy: "safe-send-queue" },
  });
  const timeline = await service.listConversationTimeline(primaryIdentity);
  const parts = timeline.filter((item) => item.sendTaskId === task.id);
  assert.deepEqual(parts.map((item) => item.messageType), ["text", "link", "miniprogram", "file"]);
  assert.equal(parts[0].text, "先看商品方案");
  assert.equal(parts[1].content.title, "企业礼赠方案");
  assert.equal(parts[2].content.title, "礼赠商城");
  assert.equal(parts[3].attachments[0].kind, "file");
  assert.equal(parts[3].attachments[0].name, "报价单.pdf");
});

test("timeline shows an accepted QR as sent when a later optional text message hits the session limit", async () => {
  const { tempDir, localStore, service } = setup();
  const task = localStore.createSendTask({
    operationKey: "partial-qr-timeline-1",
    ...primaryIdentity,
    payload: {
      kind: "wechat_work_messages",
      source: "manual_reply",
      messages: [
        { msgtype: "image", mediaPath: path.join(tempDir, "specialist.png") },
        { msgtype: "text", message: { content: "请长按识别二维码" } },
      ],
    },
    guardSnapshot: { policy: "safe-send-queue" },
  });
  localStore.updateSendTask(task.id, {
    status: "sending",
    errorMessage: "wechat work send_msg failed: send msg count limit, errcode 95001",
  });
  localStore.createSendAttempt({
    sendTaskId: task.id,
    adapter: "wechat_work_kf",
    status: "started",
    errorMessage: "wechat work send_msg failed: send msg count limit, errcode 95001",
    metadata: {
      deliveryState: "partial",
      acceptedMessageIds: ["accepted-qr-msgid"],
      failureStage: "send_text",
    },
  });

  const timeline = await service.listConversationTimeline(primaryIdentity);
  const parts = timeline.filter((item) => item.sendTaskId === task.id);
  assert.deepEqual(parts.map((item) => item.status), ["sent", "failed"]);
  assert.equal(parts[0].attachments[0].status, "sent");
  assert.equal(parts[0].errorMessage, "");
  assert.match(parts[1].errorMessage, /95001/);
});

test("production-ready customer poster creates a grounded four-image Zhenxi job without gift-box fields", async () => {
  const { localStore, service } = setup();
  const result = await service.processInboundMessage({
    ...primaryIdentity,
    externalId: "zhenxi-poster-inbound-1",
    text: "帮我做一套七夕活动海报设计，画面只包含文案“七夕有礼”，尺寸1080x1440，不要添加品牌和联系方式",
  });
  assert.equal(result.plan.reason, "customer_creative_ready");
  assert.equal(result.designJob.designType, "zhenxi_image");
  assert.equal(result.designJob.outputCount, 4);
  assert.deepEqual(result.designJob.budget, {});
  assert.equal(result.designJob.requirements.zhenxi.size, "1080x1440");
  assert.equal(result.designJob.requirements.zhenxi.ratio, "3:4");
  assert.equal(result.designJob.requirements.zhenxi.canvasSize, "1080x1440");
  assert.equal(result.designJob.requirements.zhenxi.orientation, "vertical");
  assert.equal(result.designJob.requirements.zhenxi.category, "poster");
  assert.equal(result.designJob.requirements.zhenxi.templateGroupKey, "poster");
  assert.equal(result.designJob.requirements.zhenxi.cardType, "海报自定义模板");
  assert.equal(result.designJob.requirements.zhenxi.copyCount, 4);
  assert.equal(result.designJob.requirements.zhenxi.copyText, "七夕有礼");
  assert.equal(result.designJob.requirements.zhenxi.visualContentMode, "graphic_only");
  assert.equal(result.designJob.requirements.zhenxi.exactCopyOnly, true);
  assert.equal(result.designJob.requirements.zhenxi.forbidInventedProducts, true);
  assert.equal(result.designJob.requirements.useRealSkuImages, false);
  assert.equal(localStore.listDesignJobs().filter((job) => job.requestId === result.designJob.requestId).length, 1);
});

test("explicit video script request creates a durable Zhenxi copy job", async () => {
  const { service } = setup();
  const result = await service.processInboundMessage({
    ...primaryIdentity,
    externalId: "zhenxi-video-script-inbound-1",
    text: "帮我写一份30秒新品介绍短视频口播脚本",
  });
  assert.equal(result.plan.type, "create_zhenxi_copy_job");
  assert.equal(result.designJob.designType, "zhenxi_copy_video_script");
  assert.equal(result.designJob.outputCount, 1);
  assert.equal(result.designJob.requirements.zhenxi.module, "video_script");
});

test("customer greeting card request starts immediately with generated copy and configured material defaults", async () => {
  const { localStore, service } = setup();
  const result = await service.processInboundMessage({
    ...primaryIdentity,
    externalId: "creative-card-pending-1",
    text: "帮我做一张教师节贺卡",
  });
  assert.equal(result.plan.reason, "customer_creative_ready");
  assert.equal(result.designJobs.length, 1);
  assert.equal(result.designJob.designType, "zhenxi_image");
  assert.equal(result.designJob.requirements.customerAgent.deliverable, "greeting_card");
  assert.equal(result.designJob.requirements.zhenxi.copyText, "");
  assert.equal(result.designJob.requirements.zhenxi.logoMode, "none");
  assert.equal(result.designJob.requirements.zhenxi.copyCount, 4);
  assert.equal(result.designJob.requirements.zhenxi.canvasSize, "1063x1535");
  assert.equal(result.designJob.requirements.zhenxi.cardType, "贺卡自定义模板");
  assert.equal(localStore.listDesignJobs().filter((job) => job.requirements?.customerAgent?.planId === result.route.replyDraft.customerToolPlan.planId).length, 1);
});

test("square greeting-card evidence is persisted as a 1:1 Zhenxi material job", async () => {
  const { service } = setup();
  const result = await service.processInboundMessage({
    ...primaryIdentity,
    externalId: "creative-square-card-1",
    text: "帮我做一张贺卡，图片里的贺卡款式是正方形的",
  });

  assert.equal(result.plan.reason, "customer_creative_ready");
  assert.equal(result.designJob.requirements.customerAgent.deliverable, "greeting_card");
  assert.equal(result.designJob.requirements.zhenxi.orientation, "square");
  assert.equal(result.designJob.requirements.zhenxi.ratio, "1:1");
  assert.equal(result.designJob.requirements.zhenxi.canvasSize, "1:1");
  assert.equal(result.designJob.requirements.zhenxi.cardType, "贺卡自定义模板");
});

test("one customer turn can fan out into separate card and tag design jobs", async () => {
  const { service } = setup();
  const result = await service.processInboundMessage({
    ...primaryIdentity,
    externalId: "creative-multi-ready-1",
    text: "请做贺卡和吊牌，文案是“感谢一路相伴”，不放logo，尺寸90x54mm",
  });
  assert.equal(result.plan.reason, "customer_creative_ready");
  assert.equal(result.designJobs.length, 2);
  assert.deepEqual(
    result.designJobs.map((job) => job.requirements.customerAgent.deliverable),
    ["greeting_card", "hang_tag"],
  );
  assert.ok(result.designJobs.every((job) => job.outputCount === 4));
  assert.ok(result.designJobs.every((job) => job.requirements.customerAgent.deliverable !== "belly_band"));
});

test("out-of-order LocalStore inbound messages never move conversation lastMessageAt backwards", () => {
  const { localStore } = setup();
  localStore.createMessage({
    ...primaryIdentity,
    text: "较新消息",
    externalId: "conversation-newer-event",
    createdAt: "2030-07-20T12:00:00.000Z",
  });
  localStore.createMessage({
    ...primaryIdentity,
    text: "延迟到达的旧消息",
    externalId: "conversation-stale-event",
    createdAt: "2030-07-20T10:00:00.000Z",
  });
  const conversation = localStore.listConversations().find((item) => item.id === primaryIdentity.conversationId);
  assert.equal(conversation.lastMessageAt, "2030-07-20T12:00:00.000Z");
});

test("LocalStore compares valid ISO offsets by epoch and persists canonical UTC activity", () => {
  const { localStore } = setup();
  localStore.createMessage({
    ...primaryIdentity,
    text: "基准时间",
    externalId: "offset-base",
    createdAt: "2030-07-20T10:00:00.000Z",
  });
  localStore.createMessage({
    ...primaryIdentity,
    text: "字典序更小但实际更晚",
    externalId: "offset-newer",
    createdAt: "2030-07-20T09:30:00-01:00",
  });
  localStore.createMessage({
    ...primaryIdentity,
    text: "字典序更大但实际更早",
    externalId: "offset-stale",
    createdAt: "2030-07-20T20:00:00+10:00",
  });
  const conversation = localStore.listConversations().find((item) => item.id === primaryIdentity.conversationId);
  assert.equal(conversation.lastMessageAt, "2030-07-20T10:30:00.000Z");
});

test("inbound replay resumes after route commit failure without duplicate route or message", async () => {
  const { localStore, service } = setup();
  const originalCreateRoute = localStore.createRouteEvaluation.bind(localStore);
  let injectFailure = true;
  localStore.createRouteEvaluation = (...args) => {
    const route = originalCreateRoute(...args);
    if (injectFailure) {
      injectFailure = false;
      throw new Error("injected failure after durable route create");
    }
    return route;
  };
  const payload = {
    ...primaryIdentity,
    text: "你好，请介绍一下礼盒",
    externalId: "recover-after-route-commit",
    createdAt: "2030-07-20T11:00:00.000Z",
  };
  await assert.rejects(service.processInboundMessage(payload), /injected failure/);
  const afterFailure = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"));
  assert.equal(afterFailure.messages.filter((item) => item.externalId === payload.externalId).length, 1);
  assert.equal(afterFailure.routeEvaluations.length, 1);
  assert.equal(afterFailure.inboundMessageOperations[0].status, "retryable");
  assert.equal(afterFailure.inboundMessageOperations[0].stage, "message_persisted");

  const recovered = await service.processInboundMessage(payload);
  const afterRecovery = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"));
  assert.equal(recovered.message.externalId, payload.externalId);
  assert.equal(afterRecovery.messages.filter((item) => item.externalId === payload.externalId).length, 1);
  assert.equal(afterRecovery.routeEvaluations.length, 1);
  assert.equal(afterRecovery.inboundMessageOperations[0].status, "completed");
  assert.equal(afterRecovery.inboundMessageOperations[0].stage, "completed");

  const completedReplay = await service.processInboundMessage(payload);
  assert.equal(completedReplay.duplicate, true);
  assert.equal(completedReplay.processing, false);
  assert.equal(completedReplay.message.id, recovered.message.id);
  assert.equal(completedReplay.route.id, recovered.route.id);
  assert.equal(completedReplay.outcome, recovered.plan.type);
  assert.equal(JSON.parse(fs.readFileSync(localStore.filePath, "utf8")).routeEvaluations.length, 1);
});

test("effects-committed replay completes without repeating downstream effects", async () => {
  const { localStore, service } = setup();
  let notificationCalls = 0;
  service.notifications.create = async (...args) => ({ id: `notice-${++notificationCalls}`, target: args[3] });
  const originalComplete = service.persistence.completeInboundOperation.bind(service.persistence);
  let injectFailure = true;
  service.persistence.completeInboundOperation = async (...args) => {
    if (injectFailure) {
      injectFailure = false;
      throw new Error("injected failure after durable effects stage");
    }
    return originalComplete(...args);
  };
  const payload = {
    ...primaryIdentity,
    text: "预算两万元，需要人工确认礼盒方案",
    externalId: "recover-after-effects-commit",
    createdAt: "2030-07-20T12:00:00.000Z",
  };
  await assert.rejects(service.processInboundMessage(payload), /injected failure/);
  const failed = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"));
  const operation = failed.inboundMessageOperations.find((item) => item.externalId === payload.externalId);
  const routesAfterFailure = failed.routeEvaluations.length;
  assert.equal(operation.status, "retryable");
  assert.equal(operation.stage, "effects_committed");
  assert.equal(routesAfterFailure > 0, true);

  const recovered = await service.processInboundMessage(payload);
  const completed = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"))
    .inboundMessageOperations.find((item) => item.externalId === payload.externalId);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.processing, false);
  assert.equal(recovered.message.externalId, payload.externalId);
  assert.equal(recovered.route.id, operation.result.routeEvaluationId);
  assert.equal(recovered.outcome, recovered.plan.type);
  assert.equal(notificationCalls, 0);
  assert.equal(JSON.parse(fs.readFileSync(localStore.filePath, "utf8")).routeEvaluations.length, routesAfterFailure);
  assert.equal(completed.status, "completed");
  assert.equal(completed.stage, "completed");
});

test("inbound operation snapshot strips host secrets and local paths from attachments", async () => {
  const { localStore, service } = setup();
  await service.processInboundMessage({
    ...primaryIdentity,
    text: "带附件引用的消息",
    externalId: "safe-operation-attachment",
    attachments: [{
      role: "付款凭证",
      label: "客户付款截图",
      fileName: "付款截图.png",
      name: "转账回单.jpg",
      mimeType: "image/png",
      mediaId: "media/a?b=c+d",
      imageId: "safe-remote-image-id",
      referencedImageId: "C:\\secret\\reference.png",
      remoteImageId: "file:///private/remote.png",
      token: "operation-secret-token",
      endpoint: "http://127.0.0.1:3999",
      localPath: "C:\\secret\\attachment.png",
    }, {
      role: "reference",
      imageId: "opaque|C:\\Users\\agent\\secret.png",
      remoteImageId: "opaque|https://internal.example/private",
      mimeType: "image/png C:\\host\\vault.key",
      fingerprint: "opaque-token=credential-value",
      label: "receipt https://internal.example/private",
      fileName: "opaque|C:\\Users\\agent\\secret.png",
      name: "password=hidden-value",
      mediaId: "opaque|file:///private/media",
    }],
    createdAt: "2030-07-20T13:00:00.000Z",
  });
  const operation = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"))
    .inboundMessageOperations.find((item) => item.externalId === "safe-operation-attachment");
  const snapshot = JSON.stringify(operation.normalizedPayload);
  assert.match(snapshot, /image\/png/);
  assert.match(snapshot, /safe-remote-image-id/);
  assert.match(snapshot, /付款凭证|客户付款截图|付款截图\.png|转账回单\.jpg|media\/a\?b=c\+d/);
  assert.doesNotMatch(snapshot, /operation-secret-token|credential-value|hidden-value|127\.0\.0\.1|internal\.example|secret\\\\(?:attachment|reference)|Users\\\\agent|host\\\\vault|file:\/\/\/private/i);
  assert.doesNotMatch(snapshot, /"(?:token|endpoint|localPath)"/i);
});

test("inbound assetIds reject non-strings, credentials, endpoints, absolute paths and control characters", async () => {
  const unsafeValues = [
    [{ token: "nested-secret", endpoint: "https://private.example", localPath: "C:\\private\\asset.png" }],
    ["token=secret-value"],
    ["https://private.example/asset"],
    ["file:///private/asset.png"],
    ["C:\\private\\asset.png"],
    ["\\\\server\\share\\asset.png"],
    ["opaque|C:\\private\\asset.png"],
    ["opaque|https://private.example/asset"],
    ["opaque-token=secret-value"],
    ["asset-id\u0000hidden"],
  ];
  for (const [index, assetIds] of unsafeValues.entries()) {
    const { service } = setup();
    await assert.rejects(
      () => service.processInboundMessage({
        ...primaryIdentity,
        text: "unsafe asset id",
        externalId: `unsafe-operation-asset-${index}`,
        assetIds,
      }),
      /assetIds must/,
    );
  }
});

test("inbound lease reclaim fences the stale owner before effects and supplied operationId validation is write-free", async () => {
  const { localStore, service } = setup();
  const original = localStore.claimInboundMessageOperation({
    id: "inbound-lease-fence-operation",
    source: "wechat",
    wechatAccountId: primaryIdentity.wechatAccountId,
    externalId: "inbound-lease-fence-event",
    requestFingerprint: "inbound-lease-fence-fingerprint",
    normalizedPayload: { text: "lease fence" },
    claimToken: "lease-owner-a",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  }).operation;
  const beforeInvalidReplay = localStore.getInboundMessageOperation(
    primaryIdentity.wechatAccountId,
    "inbound-lease-fence-event",
  );
  await assert.rejects(
    () => service.persistence.claimInboundOperation({
      operationId: "wrong-operation-id",
      source: "wechat",
      wechatAccountId: primaryIdentity.wechatAccountId,
      externalId: "inbound-lease-fence-event",
      requestFingerprint: "inbound-lease-fence-fingerprint",
      normalizedPayload: { text: "lease fence" },
      claimToken: "lease-owner-a",
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    /operation identity or payload changed/,
  );
  const afterInvalidReplay = localStore.getInboundMessageOperation(
    primaryIdentity.wechatAccountId,
    "inbound-lease-fence-event",
  );
  assert.equal(afterInvalidReplay.claimToken, beforeInvalidReplay.claimToken);
  assert.equal(afterInvalidReplay.attemptCount, beforeInvalidReplay.attemptCount);

  const expiredDocument = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"));
  expiredDocument.inboundMessageOperations.find((item) => item.id === original.id).leaseExpiresAt =
    new Date(Date.now() - 1_000).toISOString();
  fs.writeFileSync(localStore.filePath, JSON.stringify(expiredDocument, null, 2));
  const reclaimed = localStore.claimInboundMessageOperation({
    source: "wechat",
    wechatAccountId: primaryIdentity.wechatAccountId,
    externalId: "inbound-lease-fence-event",
    requestFingerprint: "inbound-lease-fence-fingerprint",
    claimToken: "lease-owner-b",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(reclaimed.claimed, true);
  assert.equal(reclaimed.operation.claimToken, "lease-owner-b");
  assert.equal(reclaimed.operation.attemptCount, original.attemptCount + 1);

  let staleEffectCalls = 0;
  await assert.rejects(
    () => service.withInboundEffectLease(original.id, "lease-owner-a", () => {
      staleEffectCalls += 1;
    }),
    /lease is no longer owned by this claim/,
  );
  assert.equal(staleEffectCalls, 0);
  assert.throws(
    () => localStore.updateInboundMessageOperation(original.id, "lease-owner-a", { stage: "routed" }),
    /claim changed before stage commit/,
  );
  const advanced = localStore.updateInboundMessageOperation(original.id, "lease-owner-b", { stage: "routed" });
  assert.equal(advanced.stage, "routed");
});

test("completed inbound replay fails closed when a promised durable reference is missing", async () => {
  const { localStore, service } = setup();
  const payload = {
    ...primaryIdentity,
    text: "durable hydration reference",
    externalId: "completed-replay-missing-route",
  };
  await service.processInboundMessage(payload);
  const document = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"));
  const operation = document.inboundMessageOperations.find((item) => item.externalId === payload.externalId);
  operation.result.routeEvaluationId = "missing-route-evaluation";
  fs.writeFileSync(localStore.filePath, JSON.stringify(document, null, 2));
  await assert.rejects(
    () => service.processInboundMessage(payload),
    /missing its durable route evaluation/,
  );
});

test("completed inbound replay requires complete manual-lock and selection references", async () => {
  for (const scenario of ["manual-lock", "selection"]) {
    const { localStore, service } = setup();
    const payload = {
      ...primaryIdentity,
      text: `durable ${scenario} reference`,
      externalId: `completed-replay-incomplete-${scenario}`,
    };
    await service.processInboundMessage(payload);
    const document = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"));
    const operation = document.inboundMessageOperations.find((item) => item.externalId === payload.externalId);
    if (scenario === "manual-lock") {
      operation.result.manualLock = {
        conversationId: primaryIdentity.conversationId,
        blockedSendTaskIds: [],
        inFlightSendTaskIds: [],
      };
    } else {
      delete operation.result.designJobId;
      operation.result.selection = {
        action: "select_image",
        ok: true,
        result: { candidateId: "missing-durable-candidate" },
      };
    }
    fs.writeFileSync(localStore.filePath, JSON.stringify(document, null, 2));
    await assert.rejects(
      () => service.processInboundMessage(payload),
      scenario === "manual-lock"
        ? /incomplete durable manual-lock reference/
        : /missing its durable selection design job or candidate/,
    );
  }
});

test("completed inbound replay fails closed for every existing foreign durable reference", async () => {
  const { localStore, service } = setup();
  const payload = {
    ...primaryIdentity,
    text: "durable foreign identity",
    externalId: "completed-replay-foreign-references",
  };
  await service.processInboundMessage(payload);
  const foreignIdentity = {
    wechatAccountId: "wechat_demo_2",
    conversationId: "conversation_demo_2",
    customerId: "customer_demo_2",
  };
  const foreignRoute = localStore.createRouteEvaluation(
    { ...foreignIdentity, operationKey: "foreign-replay-route", text: "foreign route", channel: "wechat" },
    { agentKey: "general", action: "auto_agent", confidence: 0.9 },
  );
  const foreignJob = localStore.createDesignJob({
    ...foreignIdentity,
    requestId: "foreign-replay-design-job",
    status: "sent",
    budget: { quantity: 1 },
    bundle: { items: [{ skuCode: "FOREIGN", costPrice: 10, salePrice: 20 }] },
  });
  const [foreignImage] = localStore.upsertDesignImages(foreignJob.id, [{ imageId: "foreign-image", position: 1 }]);
  const foreignQuote = localStore.createQuoteFromDesignJob(foreignJob.id, foreignImage.id);
  const foreignOrder = localStore.upsertOrderDraftFromQuote(foreignQuote.id, {
    quoteDraftId: foreignQuote.id,
    designJobId: foreignJob.id,
    customerId: foreignIdentity.customerId,
    conversationId: foreignIdentity.conversationId,
    wechatAccountId: foreignIdentity.wechatAccountId,
    selectedImageId: foreignImage.id,
    quantity: 1,
    unitPrice: 20,
    totalPrice: 20,
    totalCost: 10,
    profit: 10,
    status: "draft",
    paymentStatus: "unpaid",
  });
  const foreignReply = await service.enqueueManualReply({
    operationKey: "foreign-replay-send:00000001",
    ...foreignIdentity,
    text: "foreign task",
    operator: "foreign operator",
  });
  const foreignTask = foreignReply.task;
  const foreignNotification = localStore.createNotification("info", "foreign", "foreign", foreignIdentity);
  const foreignReviewLog = localStore.createReviewLog({
    targetType: "conversation",
    targetId: foreignIdentity.conversationId,
    decision: "foreign",
    metadata: foreignIdentity,
  });
  const base = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"));
  const cases = [
    ["route evaluation", (result) => { result.routeEvaluationId = foreignRoute.id; }],
    ["send task", (result) => { result.sendTaskId = foreignTask.id; }],
    ["design job", (result) => { result.designJobId = foreignJob.id; }],
    ["notification", (result) => { result.notificationId = foreignNotification.id; }],
    ["quote draft", (result) => { result.quoteDraftId = foreignQuote.id; }],
    ["order draft", (result) => { result.orderDraftId = foreignOrder.id; }],
    ["manual-lock conversation", (result) => {
      result.manualLock = { conversationId: foreignIdentity.conversationId, blockedSendTaskIds: [], inFlightSendTaskIds: [] };
    }],
    ["manual-lock review log", (result) => {
      result.manualLock = {
        conversationId: primaryIdentity.conversationId,
        reviewLogId: foreignReviewLog.id,
        blockedSendTaskIds: [],
        inFlightSendTaskIds: [],
      };
    }],
    ["manual-lock send task", (result) => {
      result.manualLock = {
        conversationId: primaryIdentity.conversationId,
        blockedSendTaskIds: [foreignTask.id],
        inFlightSendTaskIds: [],
      };
    }],
    ["manual-lock send task", (result) => {
      result.manualLock = {
        conversationId: primaryIdentity.conversationId,
        blockedSendTaskIds: [],
        inFlightSendTaskIds: [foreignTask.id],
      };
    }],
  ];
  for (const [label, mutate] of cases) {
    const document = structuredClone(base);
    const operation = document.inboundMessageOperations.find((item) => item.externalId === payload.externalId);
    mutate(operation.result);
    fs.writeFileSync(localStore.filePath, JSON.stringify(document, null, 2));
    await assert.rejects(
      () => service.processInboundMessage(payload),
      new RegExp(`foreign or incomplete durable ${label} identity`),
    );
  }
});

test("manual reply uses safe queue while automation stays enabled without takeover", async () => {
  const { localStore, service, tempDir } = setup();
  localStore.updateConversation(primaryIdentity.conversationId, { manualLocked: true });
  const automatic = await service.enqueueTextMessage({
    ...primaryIdentity,
    text: "自动消息",
    operationKey: "conversation-automatic-without-takeover-1",
  });
  assert.equal(automatic.status, "queued");
  await assert.rejects(
    () => service.enqueueManualReply({
      ...primaryIdentity,
      customerId: "customer_demo_2",
      text: "错客户",
      operationKey: "conversation-wrong-customer-1",
    }),
    /customer binding invalid/,
  );
  await assert.rejects(
    () => service.enqueueManualReply({ ...primaryIdentity, text: "   ", operationKey: "conversation-empty-reply-1" }),
    /text or attachment is required/,
  );
  await assert.rejects(
    () => service.enqueueManualReply({
      ...primaryIdentity,
      text: "超".repeat(2001),
      operationKey: "conversation-oversized-reply-1",
    }),
    /exceeds 2000 characters/,
  );
  const boundary = await service.enqueueManualReply({
    ...primaryIdentity,
    text: "a".repeat(2000),
    operator: "客服甲",
    operationKey: "conversation-boundary-reply-1",
  });
  assert.equal(boundary.task.payload.text.length, 2000);
  await assert.rejects(
    () => service.enqueueManualReply({
      ...primaryIdentity,
      text: "界".repeat(683),
      operationKey: "conversation-utf8-oversized-reply-1",
    }),
    /exceeds 2048 UTF-8 bytes/,
  );
  const result = await service.enqueueManualReply({
    ...primaryIdentity,
    text: "人工接管后的可信回复",
    operator: "客服甲",
    operationKey: "conversation-manual-takeover-reply-1",
  });
  assert.equal(result.task.status, "queued");
  assert.equal(result.task.payload.source, "manual_reply");
  assert.equal(result.task.guardSnapshot.manualReply, true);
  assert.equal(localStore.listSendAttempts({ sendTaskId: result.task.id }).length, 0);
  assert.equal(fs.existsSync(path.join(tempDir, "outbox")), false);
  const guarded = service.validateSendTask(result.task.id, {
    expectedWechatAccountId: primaryIdentity.wechatAccountId,
    expectedConversationId: primaryIdentity.conversationId,
    expectedCustomerId: primaryIdentity.customerId,
    activeWindow: { wechatAccountId: "wechat_demo_2", chatTitle: "王总-端午礼盒", recentCustomerId: primaryIdentity.customerId },
  });
  assert.equal(guarded.guardSnapshot.status, "blocked");
  assert.equal(guarded.guardSnapshot.failedKeys.includes("windowSnapshotMissing"), true);
  assert.equal(guarded.guardSnapshot.activeWindow, null);
});

test("manual reply attachments stay customer-bound and appear in the queued timeline", async () => {
  const { localStore, service, tempDir } = setup();
  localStore.updateConversation(primaryIdentity.conversationId, { manualLocked: true });
  const storageRoot = path.join(tempDir, "storage");
  appConfig.localStorageRoot = storageRoot;
  const customerDir = path.join(storageRoot, "assets", "customer", primaryIdentity.customerId);
  fs.mkdirSync(customerDir, { recursive: true });
  const imagePath = path.join(customerDir, "reply.png");
  const filePath = path.join(customerDir, "reply.txt");
  fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]));
  fs.writeFileSync(filePath, "safe reply material", "utf8");
  const identityFields = {
    wechatAccountId: primaryIdentity.wechatAccountId,
    conversationId: primaryIdentity.conversationId,
    customerId: primaryIdentity.customerId,
  };
  const image = localStore.createDesignAsset({
    ownerType: "customer",
    ownerId: primaryIdentity.customerId,
    role: "manual_reply_attachment",
    fileName: "reply.png",
    mimeType: "image/png",
    localPath: imagePath,
    sizeBytes: 9,
    ...identityFields,
  });
  const file = localStore.createDesignAsset({
    ownerType: "customer",
    ownerId: primaryIdentity.customerId,
    role: "manual_reply_attachment",
    fileName: "reply.txt",
    mimeType: "text/plain",
    localPath: filePath,
    sizeBytes: fs.statSync(filePath).size,
    ...identityFields,
  });

  const queued = await service.enqueueManualReply({
    ...primaryIdentity,
    text: "请查收",
    assetIds: [image.id, file.id],
    operator: "客服甲",
    operationKey: "conversation-manual-attachments-1",
  });
  assert.equal(queued.task.payload.source, "manual_reply");
  assert.equal(queued.task.payload.manualReply, true);
  assert.equal(queued.task.guardSnapshot.binding.ok, true);
  assert.equal(queued.task.guardSnapshot.manualReply, true);
  assert.equal(queued.task.payload.imagePaths.length, 1);
  assert.equal(queued.task.payload.filePaths.length, 1);
  assert.deepEqual(queued.task.payload.assetIds, [image.id, file.id]);
  const timeline = await service.listConversationTimeline(primaryIdentity);
  const outbound = timeline.find((item) => item.sendTaskId === queued.task.id);
  assert.deepEqual(outbound.attachments.map((attachment) => attachment.kind), ["image", "file"]);
  assert.deepEqual(outbound.attachments.map((attachment) => attachment.assetId), [image.id, file.id]);

  const foreign = localStore.createDesignAsset({
    ownerType: "customer",
    ownerId: "customer_demo_2",
    role: "manual_reply_attachment",
    fileName: "foreign.txt",
    mimeType: "text/plain",
    localPath: filePath,
    sizeBytes: fs.statSync(filePath).size,
    wechatAccountId: "wechat_demo_2",
    conversationId: "conversation_demo_2",
    customerId: "customer_demo_2",
  });
  await assert.rejects(
    () => service.enqueueManualReply({
      ...primaryIdentity,
      assetIds: [foreign.id],
      operationKey: "conversation-manual-foreign-attachment-1",
    }),
    /identity mismatch|does not match|must belong/,
  );
});

test("inbound service rejects a customer id from another conversation", async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.processInboundMessage({
      ...primaryIdentity,
      customerId: "customer_demo_2",
      externalId: "conversation-cross-customer-1",
      text: "串线请求",
    }),
    /inbound customer binding invalid/,
  );
});
