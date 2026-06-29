"use strict";

function validateInboundConversationBinding({ requestedWechatAccountId, requestedConversationId, conversation }) {
  const checks = [];

  checks.push({
    key: "requestedConversationProvided",
    label: "inbound request has explicit conversation id",
    expected: "conversationId",
    actual: requestedConversationId || "",
    passed: Boolean(requestedConversationId),
  });

  checks.push({
    key: "conversationExists",
    label: "会话存在",
    expected: requestedConversationId || "resolved conversation",
    actual: conversation?.id || "",
    passed: Boolean(conversation?.id),
  });

  if (requestedConversationId) {
    checks.push({
      key: "requestedConversationMatches",
      label: "请求会话匹配",
      expected: requestedConversationId,
      actual: conversation?.id || "",
      passed: conversation?.id === requestedConversationId,
    });
  }

  if (requestedWechatAccountId) {
    checks.push({
      key: "requestedWechatAccountMatches",
      label: "请求微信账号匹配会话",
      expected: requestedWechatAccountId,
      actual: conversation?.wechatAccountId || "",
      passed: conversation?.wechatAccountId === requestedWechatAccountId,
    });
  }

  return summarize(checks, "入站会话绑定关系正确");
}

function validateDesignJobIdentity({ payload, conversation }) {
  const checks = [];

  checks.push({
    key: "conversationExists",
    label: "设计任务会话存在",
    expected: payload?.conversationId || "",
    actual: conversation?.id || "",
    passed: Boolean(payload?.conversationId && conversation?.id === payload.conversationId),
  });

  checks.push({
    key: "customerMatchesConversation",
    label: "设计任务客户匹配会话",
    expected: conversation?.customerId || "",
    actual: payload?.customerId || "",
    passed: Boolean(payload?.customerId && conversation?.customerId && payload.customerId === conversation.customerId),
  });

  if (payload?.wechatAccountId || conversation?.wechatAccountId) {
    checks.push({
      key: "wechatAccountMatchesConversation",
      label: "设计任务微信账号匹配会话",
      expected: conversation?.wechatAccountId || "",
      actual: payload?.wechatAccountId || "",
      passed: Boolean(payload?.wechatAccountId && conversation?.wechatAccountId && payload.wechatAccountId === conversation.wechatAccountId),
    });
  }

  return summarize(checks, "设计任务绑定关系正确");
}

function validateDesignCallbackBinding({ payload, job }) {
  const checks = [];

  checks.push({
    key: "designJobExists",
    label: "design job exists",
    expected: payload?.requestId || "",
    actual: job?.requestId || "",
    passed: Boolean(job?.id || job?.requestId),
  });

  checks.push({
    key: "callbackRequestMatchesJob",
    label: "callback requestId matches design job",
    expected: job?.requestId || "",
    actual: payload?.requestId || "",
    passed: Boolean(job?.requestId && payload?.requestId === job.requestId),
  });

  const expectedExternalJobId = job?.externalJobId || "";
  const actualExternalJobId = payload?.externalJobId || "";
  checks.push({
    key: "callbackExternalJobMatches",
    label: "callback externalJobId matches design job",
    expected: expectedExternalJobId,
    actual: actualExternalJobId,
    passed: !expectedExternalJobId && !actualExternalJobId
      ? true
      : Boolean(expectedExternalJobId && actualExternalJobId && expectedExternalJobId === actualExternalJobId),
  });

  return summarize(checks, "design callback binding is valid");
}

function validateDesignAssetBinding({ designJob, assets, requestedAssetIds }) {
  const requestedIds = [...new Set((Array.isArray(requestedAssetIds) ? requestedAssetIds : []).filter(Boolean).map(String))];
  const assetRows = Array.isArray(assets) ? assets : [];
  const assetById = new Map(assetRows.map((asset) => [String(asset?.id || ""), asset]));
  const checks = [];

  checks.push({
    key: "designJobExists",
    label: "design job exists for asset binding",
    expected: "designJob",
    actual: designJob?.id || designJob?.requestId || "",
    passed: Boolean(designJob?.id || designJob?.requestId),
  });

  checks.push({
    key: "assetIdsProvided",
    label: "asset ids provided for binding",
    expected: "assetIds",
    actual: requestedIds.join(","),
    passed: requestedIds.length > 0,
  });

  for (const assetId of requestedIds) {
    const asset = assetById.get(assetId);
    checks.push({
      key: `assetExists:${assetId}`,
      label: "design asset exists",
      expected: assetId,
      actual: asset?.id || "",
      passed: Boolean(asset?.id),
    });
    checks.push({
      key: `assetCustomerMatchesJob:${assetId}`,
      label: "design asset customer matches design job",
      expected: designJob?.customerId || "",
      actual: asset?.ownerType === "customer" ? asset?.ownerId || "" : `${asset?.ownerType || ""}:${asset?.ownerId || ""}`,
      passed: Boolean(asset?.ownerType === "customer" && asset?.ownerId && designJob?.customerId && asset.ownerId === designJob.customerId),
    });
  }

  return summarize(checks, "design assets match design job customer");
}

function validateQuoteDraftIdentity({ quoteDraft, designJob, conversation, selectedImage }) {
  const checks = [];

  checks.push({
    key: "designJobExists",
    label: "报价草稿设计任务存在",
    expected: quoteDraft?.designJobId || "",
    actual: designJob?.id || "",
    passed: Boolean(designJob?.id),
  });

  checks.push({
    key: "quoteDesignJobMatches",
    label: "报价草稿匹配设计任务",
    expected: designJob?.id || "",
    actual: quoteDraft?.designJobId || "",
    passed: Boolean(quoteDraft?.designJobId && designJob?.id && quoteDraft.designJobId === designJob.id),
  });

  checks.push({
    key: "quoteCustomerMatchesDesignJob",
    label: "报价草稿客户匹配设计任务",
    expected: designJob?.customerId || "",
    actual: quoteDraft?.customerId || "",
    passed: Boolean(quoteDraft?.customerId && designJob?.customerId && quoteDraft.customerId === designJob.customerId),
  });

  if (conversation || designJob?.conversationId) {
    checks.push({
      key: "designJobConversationMatches",
      label: "报价设计任务匹配会话",
      expected: conversation?.id || "",
      actual: designJob?.conversationId || "",
      passed: Boolean(conversation?.id && designJob?.conversationId && designJob.conversationId === conversation.id),
    });

    checks.push({
      key: "quoteCustomerMatchesConversation",
      label: "报价草稿客户匹配会话",
      expected: conversation?.customerId || "",
      actual: quoteDraft?.customerId || "",
      passed: Boolean(quoteDraft?.customerId && conversation?.customerId && quoteDraft.customerId === conversation.customerId),
    });
  }

  if (conversation?.wechatAccountId || designJob?.wechatAccountId) {
    checks.push({
      key: "designJobWechatAccountMatchesConversation",
      label: "报价设计任务微信账号匹配会话",
      expected: conversation?.wechatAccountId || "",
      actual: designJob?.wechatAccountId || "",
      passed: Boolean(
        conversation?.wechatAccountId &&
          designJob?.wechatAccountId &&
          designJob.wechatAccountId === conversation.wechatAccountId,
      ),
    });
  }

  if (quoteDraft?.selectedImageId) {
    checks.push({
      key: "selectedImageExists",
      label: "报价选中图片存在",
      expected: quoteDraft.selectedImageId,
      actual: selectedImage?.id || selectedImage?.imageId || "",
      passed: Boolean(selectedImage?.id || selectedImage?.imageId),
    });

    checks.push({
      key: "selectedImageMatchesQuote",
      label: "quote selected image matches quote draft",
      expected: quoteDraft.selectedImageId,
      actual: selectedImage?.id || selectedImage?.imageId || "",
      passed: selectedImageMatchesId(selectedImage, quoteDraft.selectedImageId),
    });

    checks.push({
      key: "selectedImageBelongsToDesignJob",
      label: "报价选中图片匹配设计任务",
      expected: designJob?.id || "",
      actual: selectedImage?.designJobId || "",
      passed: Boolean(selectedImage?.designJobId && designJob?.id && selectedImage.designJobId === designJob.id),
    });
  }

  return summarize(checks, "报价草稿绑定关系正确");
}

function validateOrderDraftQuoteBinding({ orderDraft, quoteDraft, designJob, conversation, selectedImage }) {
  const effectiveDesignJob = designJob || orderDraft?.designJob || quoteDraft?.designJob || null;
  const effectiveConversation = conversation || orderDraft?.conversation || effectiveDesignJob?.conversation || null;
  const effectiveSelectedImage = selectedImage || orderDraft?.selectedImage || quoteDraft?.selectedImage || null;
  const checks = [];

  checks.push({
    key: "orderDraftExists",
    label: "order draft exists",
    expected: "present",
    actual: orderDraft?.id || "",
    passed: Boolean(orderDraft?.id || orderDraft?.quoteDraftId),
  });

  checks.push({
    key: "quoteDraftExists",
    label: "quote draft exists",
    expected: orderDraft?.quoteDraftId || "",
    actual: quoteDraft?.id || "",
    passed: Boolean(quoteDraft?.id),
  });

  checks.push({
    key: "orderQuoteDraftMatches",
    label: "order draft quote matches",
    expected: orderDraft?.quoteDraftId || "",
    actual: quoteDraft?.id || "",
    passed: Boolean(orderDraft?.quoteDraftId && quoteDraft?.id && orderDraft.quoteDraftId === quoteDraft.id),
  });

  checks.push({
    key: "orderDesignJobMatchesQuote",
    label: "order draft design job matches quote",
    expected: quoteDraft?.designJobId || "",
    actual: orderDraft?.designJobId || "",
    passed: Boolean(orderDraft?.designJobId && quoteDraft?.designJobId && orderDraft.designJobId === quoteDraft.designJobId),
  });

  checks.push({
    key: "orderCustomerMatchesQuote",
    label: "order draft customer matches quote",
    expected: quoteDraft?.customerId || "",
    actual: orderDraft?.customerId || "",
    passed: Boolean(orderDraft?.customerId && quoteDraft?.customerId && orderDraft.customerId === quoteDraft.customerId),
  });

  if (orderDraft?.selectedImageId || quoteDraft?.selectedImageId) {
    checks.push({
      key: "orderSelectedImageMatchesQuote",
      label: "order draft selected image matches quote",
      expected: quoteDraft?.selectedImageId || "",
      actual: orderDraft?.selectedImageId || "",
      passed: Boolean(orderDraft?.selectedImageId && quoteDraft?.selectedImageId && orderDraft.selectedImageId === quoteDraft.selectedImageId),
    });
  }

  if (orderDraft?.designJobId || quoteDraft?.designJobId || effectiveDesignJob) {
    checks.push({
      key: "designJobExists",
      label: "order draft design job exists",
      expected: orderDraft?.designJobId || quoteDraft?.designJobId || "",
      actual: effectiveDesignJob?.id || "",
      passed: Boolean(effectiveDesignJob?.id),
    });

    checks.push({
      key: "orderDesignJobMatchesDesignJob",
      label: "order draft matches design job",
      expected: effectiveDesignJob?.id || "",
      actual: orderDraft?.designJobId || "",
      passed: Boolean(orderDraft?.designJobId && effectiveDesignJob?.id && orderDraft.designJobId === effectiveDesignJob.id),
    });

    checks.push({
      key: "quoteDesignJobMatchesDesignJob",
      label: "quote draft matches design job",
      expected: effectiveDesignJob?.id || "",
      actual: quoteDraft?.designJobId || "",
      passed: Boolean(quoteDraft?.designJobId && effectiveDesignJob?.id && quoteDraft.designJobId === effectiveDesignJob.id),
    });

    checks.push({
      key: "orderCustomerMatchesDesignJob",
      label: "order draft customer matches design job",
      expected: effectiveDesignJob?.customerId || "",
      actual: orderDraft?.customerId || "",
      passed: Boolean(orderDraft?.customerId && effectiveDesignJob?.customerId && orderDraft.customerId === effectiveDesignJob.customerId),
    });

    checks.push({
      key: "quoteCustomerMatchesDesignJob",
      label: "quote draft customer matches design job",
      expected: effectiveDesignJob?.customerId || "",
      actual: quoteDraft?.customerId || "",
      passed: Boolean(quoteDraft?.customerId && effectiveDesignJob?.customerId && quoteDraft.customerId === effectiveDesignJob.customerId),
    });

    checks.push({
      key: "orderConversationMatchesDesignJob",
      label: "order draft conversation matches design job",
      expected: effectiveDesignJob?.conversationId || "",
      actual: orderDraft?.conversationId || "",
      passed: Boolean(orderDraft?.conversationId && effectiveDesignJob?.conversationId && orderDraft.conversationId === effectiveDesignJob.conversationId),
    });

    checks.push({
      key: "orderWechatAccountMatchesDesignJob",
      label: "order draft wechat account matches design job",
      expected: effectiveDesignJob?.wechatAccountId || "",
      actual: orderDraft?.wechatAccountId || "",
      passed: Boolean(
        orderDraft?.wechatAccountId &&
          effectiveDesignJob?.wechatAccountId &&
          orderDraft.wechatAccountId === effectiveDesignJob.wechatAccountId,
      ),
    });
  }

  if (effectiveConversation || effectiveDesignJob?.conversationId) {
    checks.push({
      key: "designJobConversationMatches",
      label: "design job conversation matches",
      expected: effectiveConversation?.id || "",
      actual: effectiveDesignJob?.conversationId || "",
      passed: Boolean(effectiveConversation?.id && effectiveDesignJob?.conversationId && effectiveDesignJob.conversationId === effectiveConversation.id),
    });

    checks.push({
      key: "orderCustomerMatchesConversation",
      label: "order draft customer matches conversation",
      expected: effectiveConversation?.customerId || "",
      actual: orderDraft?.customerId || "",
      passed: Boolean(orderDraft?.customerId && effectiveConversation?.customerId && orderDraft.customerId === effectiveConversation.customerId),
    });

    checks.push({
      key: "orderWechatAccountMatchesConversation",
      label: "order draft wechat account matches conversation",
      expected: effectiveConversation?.wechatAccountId || "",
      actual: orderDraft?.wechatAccountId || "",
      passed: Boolean(
        orderDraft?.wechatAccountId &&
          effectiveConversation?.wechatAccountId &&
          orderDraft.wechatAccountId === effectiveConversation.wechatAccountId,
      ),
    });
  }

  if (orderDraft?.selectedImageId || effectiveSelectedImage) {
    checks.push({
      key: "selectedImageExists",
      label: "order draft selected image exists",
      expected: orderDraft?.selectedImageId || "",
      actual: effectiveSelectedImage?.id || effectiveSelectedImage?.imageId || "",
      passed: Boolean(effectiveSelectedImage?.id || effectiveSelectedImage?.imageId),
    });

    checks.push({
      key: "selectedImageMatchesOrder",
      label: "selected image matches order draft",
      expected: orderDraft?.selectedImageId || "",
      actual: effectiveSelectedImage?.id || effectiveSelectedImage?.imageId || "",
      passed: selectedImageMatchesId(effectiveSelectedImage, orderDraft?.selectedImageId),
    });

    checks.push({
      key: "selectedImageBelongsToDesignJob",
      label: "selected image belongs to design job",
      expected: orderDraft?.designJobId || effectiveDesignJob?.id || "",
      actual: effectiveSelectedImage?.designJobId || "",
      passed: Boolean(
        effectiveSelectedImage?.designJobId &&
          (effectiveSelectedImage.designJobId === orderDraft?.designJobId || effectiveSelectedImage.designJobId === effectiveDesignJob?.id),
      ),
    });
  }

  return summarize(checks, "order draft quote binding is valid");
}

function selectedImageMatchesId(image, id) {
  if (!id) return false;
  return Boolean(image?.id === id || image?.imageId === id);
}

function summarize(checks, successReason) {
  const failed = checks.filter((item) => !item.passed);
  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? "passed" : "blocked",
    checks,
    failedKeys: failed.map((item) => item.key),
    reason: failed.length ? failed.map((item) => item.label).join("、") : successReason,
  };
}

module.exports = {
  validateDesignAssetBinding,
  validateDesignCallbackBinding,
  validateDesignJobIdentity,
  validateInboundConversationBinding,
  validateOrderDraftQuoteBinding,
  validateQuoteDraftIdentity,
};
