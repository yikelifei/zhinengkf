"use strict";

const ZHENXI_CUSTOMER_IMAGE_COUNT = 4;
const ZHENXI_CUSTOMER_COPY_COUNT = 4;
const ZHENXI_COPY_MODULES = Object.freeze(["poster_copy", "xiaohongshu", "detail_page", "video_script"]);
const CUSTOMER_CREATIVE_DELIVERABLES = Object.freeze({
  bundle_effect: Object.freeze({ label: "搭品效果图", capability: "伴手礼搭品效果图", needsCatalog: true, experimental: true }),
  poster: Object.freeze({
    label: "活动海报",
    capability: "活动海报设计",
    needsCatalog: false,
    category: "poster",
    templateGroupKey: "poster",
    cardType: "海报自定义模板",
    defaultCanvasSize: "2480x3508",
  }),
  greeting_card: Object.freeze({
    label: "贺卡",
    capability: "贺卡设计",
    needsCatalog: false,
    category: "card",
    templateGroupKey: "card",
    cardType: "贺卡自定义模板",
    defaultCanvasSize: "1063x1535",
  }),
  hang_tag: Object.freeze({
    label: "吊牌",
    capability: "吊牌设计",
    needsCatalog: false,
    category: "packaging",
    templateGroupKey: "hangtag",
    cardType: "吊牌自定义模板",
    defaultCanvasSize: "650x1063",
  }),
  belly_band: Object.freeze({
    label: "腰封",
    capability: "腰封设计",
    needsCatalog: false,
    category: "packaging",
    templateGroupKey: "waistband",
    cardType: "腰封自定义模板",
    defaultCanvasSize: "950x2800",
  }),
});

const IMAGE_REQUEST_PATTERN = /(?:设计稿|设计图|效果图|海报图|海报设计|主图|封面图|配图|出图|生成(?:一组|几张|图片|图)|做图|图片设计|视觉稿|详情页图|小红书封面|小红书配图)/i;
const COPY_REQUEST_PATTERN = /(?:文案|标题|正文|笔记|脚本|口播|分镜|卖点|介绍词|宣传语|广告语)/i;
const TEXT_ONLY_REQUEST_PATTERN = /(?:(?:只|仅)(?:需(?:要)?|要|用|给我|回复|提供|发)?\s*(?:文字|文本)(?:建议|方案|回复|内容|说明|推荐|文案)?|(?:文字|文本)(?:建议|回复|方案)?\s*(?:就行|即可))/i;
const NEGATED_IMAGE_REQUEST_PATTERN = /(?:不要|不用|无需|不需要|别|暂时不要|先不要|不)\s*(?:先|再)?\s*(?:给我)?\s*(?:做|生成|出|制作|提供|发)?\s*(?:任何|这些|这类)?\s*(?:设计稿|设计图|效果图|海报图|主图|封面图|配图|图片|图|视觉稿)/gi;
const REFERENCE_DEPENDENT_PATTERN = /(?:logo|标志|商标|产品|商品|实物|包装|人物|人像|参考图|原图|素材|照着|按照.{0,8}图|保留.{0,12}(?:外观|文字|品牌|logo)|换背景|改图|修图|抠图|去背)/i;
const CREATIVE_REQUEST_PATTERN = /(?:做|设计|生成|出|制作|要|需要|想要|想做|来)(?:一|个|张|套|版|几张|一下|份|些)?/i;
const GRAPHIC_ONLY_PATTERN = /(?:纯文字|文字氛围|只(?:包含|保留|放|要)(?:指定|这句|以下)?文案|不(?:要|用|展示|放)(?:任何)?(?:产品|商品|礼品|礼盒|实物|包装)|不放实物|纯背景|只做背景)/i;
const REAL_PRODUCT_VISUAL_PATTERN = /(?:(?:展示|放上|带上|使用|加入|呈现).{0,10}(?:产品|商品|礼品|伴手礼|礼盒|实物|包装)|(?:产品|商品|礼品|伴手礼|礼盒|实物|包装).{0,10}(?:展示|入镜|放进|放上|带上))/i;

function planZhenxiCustomerRequest(input = {}) {
  const text = String(input.text || "").trim();
  const currentAssetIds = normalizeList(input.assetIds);
  const availableAssets = normalizeAssets(input.availableAssets, currentAssetIds);
  const previousPlan = normalizePreviousPlan(input.previousPlan, input.existingJobs);
  const textOnly = TEXT_ONLY_REQUEST_PATTERN.test(text);
  const hasNegatedImageRequest = new RegExp(NEGATED_IMAGE_REQUEST_PATTERN.source, "i").test(text);
  const imageIntentText = stripNegatedImageRequests(text);
  const explicitlyDeclinesImages = textOnly || hasNegatedImageRequest;
  const explicitDeliverables = textOnly ? [] : detectCreativeDeliverables(text);
  const continuingPreviousPlan = !explicitDeliverables.length && Boolean(previousPlan);

  if (explicitDeliverables.length || (continuingPreviousPlan && !explicitlyDeclinesImages)) {
    return planCustomerCreativeRequest({
      text,
      currentAssetIds,
      availableAssets,
      previousPlan,
      explicitDeliverables,
      requestContextId: String(input.requestContextId || "").trim(),
      bundleRecommendation: input.bundleRecommendation || null,
    });
  }

  const module = detectRequestedModule(text);
  const wantsImage = !textOnly && (
    IMAGE_REQUEST_PATTERN.test(imageIntentText)
    || (/(?:海报)(?!文案)/i.test(imageIntentText) && !COPY_REQUEST_PATTERN.test(imageIntentText))
  );
  const wantsCopy = COPY_REQUEST_PATTERN.test(text) || module === "video_script";

  if (!wantsImage && !wantsCopy && explicitlyDeclinesImages) {
    return {
      kind: "cancel",
      module: "customer_creative",
      reason: "explicit_image_generation_declined",
      planId: String(
        previousPlan?.planId
        || `customer-creative-cancel:${input.requestContextId || stablePlanSeed(text, ["no_image"])}`,
      ),
      missingFields: [],
    };
  }

  if (!text || !hasGenerationVerb(text)) return null;

  if (!wantsImage && !wantsCopy) {
    if (["xiaohongshu", "detail_page"].includes(module)) {
      return {
        kind: "clarify",
        module,
        reason: "zhenxi_output_type_unclear",
        replyText: "可以做。您这次需要的是文案，还是需要一次生成 4 张设计图片供您挑选？",
      };
    }
    return null;
  }

  if (wantsImage) {
    const referenceRequired = REFERENCE_DEPENDENT_PATTERN.test(text);
    const size = detectImageSize(text);
    const ratio = detectImageRatio(text, size);
    const copyText = extractRequestedCopy(text);
    const visualContentMode = detectVisualContentMode(text)
      || (currentAssetIds.length ? "reference_bound" : "graphic_only");
    const copyOnly = explicitlyCopyOnlyVisual(text);
    return {
      kind: "image",
      module: "image",
      copyModule: module === "image" || module === "video_script" ? "poster_copy" : module,
      capability: imageCapability(module, text),
      prompt: text,
      outputCount: ZHENXI_CUSTOMER_IMAGE_COUNT,
      referenceRequired,
      missingReference: referenceRequired && !currentAssetIds.length,
      assetIds: currentAssetIds,
      copyText,
      logoMode: copyOnly || explicitlyNoLogo(text) ? "none" : "",
      visualContentMode,
      exactCopyOnly: copyOnly,
      forbidInventedProducts: currentAssetIds.length === 0,
      size,
      ratio,
      transparent: /(?:透明底|透明背景|去背|抠图)/i.test(text),
      replyText: referenceRequired && !currentAssetIds.length
        ? "可以做。为了保留真实的产品、Logo、人物或原图内容，请先把对应图片素材发给我；收到后我会一次生成 4 张设计稿供您挑选。"
        : "收到，我会按您的要求调用臻希 AI，一次生成 4 张设计稿供您挑选。",
    };
  }

  return {
    kind: "copy",
    module: module === "image" ? "poster_copy" : module,
    capability: copyCapability(module),
    prompt: text,
    outputCount: 1,
    referenceRequired: false,
    missingReference: false,
    assetIds: [],
    ratio: detectImageRatio(text),
    replyText: `收到，我正在用臻希 AI 生成${copyCapability(module)}，完成后直接发给您。`,
  };
}

function stripNegatedImageRequests(text) {
  return String(text || "")
    .replace(NEGATED_IMAGE_REQUEST_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function planCustomerCreativeRequest(input) {
  const previous = input.previousPlan || null;
  const requestedDeliverables = input.explicitDeliverables.length
    ? input.explicitDeliverables
    : normalizeDeliverableKeys(previous?.requestedDeliverables);
  if (!requestedDeliverables.length) return null;

  const planId = input.explicitDeliverables.length
    ? `customer-creative:${input.requestContextId || stablePlanSeed(input.text, requestedDeliverables)}`
    : String(previous?.planId || `customer-creative:${input.requestContextId || stablePlanSeed(input.text, requestedDeliverables)}`);
  const physicalSize = detectPhysicalSize(input.text) || String(previous?.physicalSize || "");
  const packageBoxSize = detectPackageBoxSize(input.text) || String(previous?.packageBoxSize || "");
  const pixelSize = detectImageSize(input.text) || String(previous?.size || "");
  const detectedRatio = detectImageRatio(input.text, pixelSize) || ratioFromPhysicalSize(physicalSize);
  const orientation = detectMaterialOrientation(input.text, pixelSize, physicalSize, detectedRatio)
    || String(previous?.orientation || "")
    || "vertical";
  const ratio = orientation === "square"
    ? "1:1"
    : detectedRatio || String(previous?.ratio || "");
  const copyText = extractRequestedCopy(input.text, {
    acceptWholeText: Boolean(previous?.missingFields?.includes("copy_text")) && !input.explicitDeliverables.length,
  }) || String(previous?.copyText || "");
  const exactCopyOnly = explicitlyCopyOnlyVisual(input.text) || previous?.exactCopyOnly === true;
  const noLogo = explicitlyNoLogo(input.text) || exactCopyOnly || previous?.logoMode === "none";
  const selectedAssetIds = creativeAssetIds(input.availableAssets, input.currentAssetIds, previous);
  const logoProvided = !noLogo && selectedAssetIds.length > 0;
  const logoMode = logoProvided ? "provided" : "none";
  const bundleReady = Boolean(input.bundleRecommendation?.items?.length);
  const visualContentMode = detectVisualContentMode(input.text)
    || String(previous?.visualContentMode || "")
    || "graphic_only";

  const deliverables = requestedDeliverables.map((key) => {
    const definition = CUSTOMER_CREATIVE_DELIVERABLES[key];
    const missingFields = [];
    if (definition.needsCatalog && !bundleReady) missingFields.push("bundle_selection");
    if (
      key === "poster"
      && visualContentMode === "real_product"
      && !bundleReady
      && selectedAssetIds.length === 0
    ) missingFields.push("product_assets_or_selection");
    return {
      key,
      label: definition.label,
      capability: definition.capability,
      needsCatalog: definition.needsCatalog,
      missingFields,
      ready: missingFields.length === 0,
    };
  });
  const missingFields = [...new Set(deliverables.flatMap((item) => item.missingFields))];
  const basePlan = {
    planId,
    requestedDeliverables,
    deliverables,
    missingFields,
    copyText,
    logoMode,
    visualContentMode,
    exactCopyOnly,
    physicalSize,
    packageBoxSize,
    size: pixelSize,
    ratio,
    orientation,
    assetIds: selectedAssetIds,
    toolIntents: {
      catalog: deliverables.some((item) => item.needsCatalog) || visualContentMode === "real_product",
      pptRag: true,
      zhenxiAi: deliverables.some((item) => !item.needsCatalog),
    },
  };

  if (missingFields.length) {
    return {
      ...basePlan,
      kind: "clarify",
      module: "customer_creative",
      reason: missingFields.includes("bundle_selection") ? "creative_bundle_details_required" : "creative_materials_required",
      replyText: creativeClarificationReply(deliverables, missingFields),
    };
  }

  const designRequests = deliverables.map((deliverable) => buildCreativeDesignRequest({
    ...basePlan,
    deliverable,
    customerText: input.text,
  }));
  return {
    ...basePlan,
    kind: designRequests.length > 1 ? "multi" : designRequests[0].kind,
    module: "customer_creative",
    reason: designRequests.some((item) => item.kind === "bundle")
      ? "customer_tool_plan_ready"
      : "customer_creative_ready",
    designRequests,
    replyText: creativeReadyReply(deliverables),
  };
}

function buildCreativeDesignRequest(input) {
  const deliverable = input.deliverable;
  if (deliverable.key === "bundle_effect") {
    return {
      kind: "bundle",
      deliverable: deliverable.key,
      deliverableLabel: deliverable.label,
      capability: deliverable.capability,
      planId: input.planId,
      outputCount: ZHENXI_CUSTOMER_IMAGE_COUNT,
      copyCount: 0,
      prompt: "根据商品库已确认的真实商品、包装尺寸和客户预算生成伴手礼搭品效果图。",
      assetIds: [],
      referenceRequired: true,
      missingReference: false,
      copyText: "",
      physicalSize: "",
      size: "",
      ratio: "",
    };
  }
  const definition = CUSTOMER_CREATIVE_DELIVERABLES[deliverable.key];
  const canvasSize = input.size || materialCanvasSize(definition.defaultCanvasSize, input.orientation);
  const description = [
    `为客户制作${deliverable.label}设计效果图。`,
    `必须使用臻希 AI 物料设计中的“${definition.cardType}”。`,
    `构图方向：${materialOrientationLabel(input.orientation)}；画布尺寸：${canvasSize}。`,
    input.copyText ? `必须原样使用客户文案：${input.copyText}` : "",
    !input.copyText ? "客户未指定成品文案，请先根据客户主题生成适合该物料的简洁中文文案，再用于图片设计。" : "",
    input.logoMode === "provided" ? "必须使用客户提供的 Logo 素材，不得重绘、改字或虚构品牌。" : "客户明确不放 Logo，不得自行添加品牌标识。",
    input.physicalSize ? `成品尺寸：${input.physicalSize}。` : "",
    input.packageBoxSize ? `客户给出的配套盒子尺寸：${input.packageBoxSize}；这是包装适配约束，不是${deliverable.label}成品尺寸。` : "",
    input.visualContentMode === "graphic_only"
      ? "只做平面视觉，不展示或虚构任何商品、礼盒、包装和实物。"
      : input.visualContentMode === "real_product"
        ? "海报必须展示已提供或商品库已选定的真实商品，不得凭空创造、替换或改变商品数量。"
        : "",
    input.exactCopyOnly ? "画面中只能出现客户指定文案，不得添加副标题、英文、日期、地址、电话或其他占位文字。" : "",
    input.customerText ? `本轮补充要求：${input.customerText}` : "",
  ].filter(Boolean).join("\n");
  return {
    kind: "image",
    module: "image",
    copyModule: "poster_copy",
    deliverable: deliverable.key,
    deliverableLabel: deliverable.label,
    capability: deliverable.capability,
    planId: input.planId,
    prompt: description,
    outputCount: ZHENXI_CUSTOMER_IMAGE_COUNT,
    copyCount: ZHENXI_CUSTOMER_COPY_COUNT,
    referenceRequired: input.logoMode === "provided" || input.visualContentMode === "real_product",
    missingReference: false,
    assetIds: input.logoMode === "provided" ? input.assetIds : [],
    copyText: input.copyText,
    logoMode: input.logoMode,
    physicalSize: input.physicalSize,
    packageBoxSize: input.packageBoxSize,
    visualContentMode: input.visualContentMode,
    exactCopyOnly: input.exactCopyOnly,
    forbidInventedProducts: input.visualContentMode !== "real_product",
    size: input.size,
    ratio: input.ratio,
    canvasSize,
    orientation: input.orientation,
    category: definition.category,
    templateGroupKey: definition.templateGroupKey,
    cardType: definition.cardType,
    transparent: false,
  };
}

function detectCreativeDeliverables(text) {
  if (!text || !(CREATIVE_REQUEST_PATTERN.test(text) || isCreativeDeliverableRequirementUpdate(text))) return [];
  const candidates = [
    ["bundle_effect", /(?:搭品|搭配(?:商品|礼品|产品|礼盒)?|组合礼盒|配礼盒|套装效果|礼盒效果图|搭配效果图)/i],
    ["poster", /海报(?!文案)/i],
    ["greeting_card", /(?:贺卡|祝福卡|感谢卡|心意卡|卡片)/i],
    ["hang_tag", /(?:吊牌|挂牌|挂签)/i],
    ["belly_band", /(?:腰封|围条|纸腰封)/i],
  ];
  return candidates
    .filter(([key, pattern]) => pattern.test(text) && !deliverableNegated(text, key))
    .map(([key]) => key);
}

function isCreativeDeliverableRequirementUpdate(text) {
  const value = String(text || "");
  if (!/(?:贺卡|祝福卡|感谢卡|心意卡|卡片)/i.test(value)) return false;
  return /(?:盒子(?:的)?尺寸|尺寸是(?:盒子|包装|礼盒)|1\s*[:：]\s*1|正方形|方形|主题(?:色|颜色)|紫色|不要(?:这个)?花|不要花|去掉花|无花)/i.test(value);
}

function deliverableNegated(text, key) {
  const labels = {
    bundle_effect: "(?:搭品|搭配效果图|礼盒效果图)",
    greeting_card: "(?:贺卡|卡片)",
    hang_tag: "(?:吊牌|挂牌|挂签)",
    belly_band: "(?:腰封|围条)",
  };
  const label = labels[key];
  return new RegExp(
    `(?:不要|不用|不需要|取消|去掉)\\s*(?:做|放|生成)?\\s*${label}|${label}\\s*(?:不要|不用|不需要|取消|去掉)(?:[，。！？、]|$)`,
    "i",
  ).test(text);
}

function normalizePreviousPlan(plan, existingJobs) {
  if (!plan || typeof plan !== "object" || !String(plan.planId || "")) return null;
  if (plan.kind === "cancel" || plan.reason === "explicit_image_generation_declined") return null;
  const planId = String(plan.planId);
  const alreadyDispatched = (Array.isArray(existingJobs) ? existingJobs : []).some((job) => {
    const requirements = job?.requirements && typeof job.requirements === "object" ? job.requirements : {};
    const customerAgent = requirements.customerAgent && typeof requirements.customerAgent === "object"
      ? requirements.customerAgent
      : {};
    return String(customerAgent.planId || "") === planId;
  });
  return alreadyDispatched ? null : plan;
}

function creativeClarificationReply(deliverables, missingFields) {
  const labels = deliverables.map((item) => item.label).join("和");
  if (missingFields.includes("bundle_selection")) {
    return `可以，我来调商品库给您搭${labels}。先告诉我用途、数量、单份预算和喜欢的风格，我选好真实商品后再出效果图。`;
  }
  const asks = [];
  if (missingFields.includes("copy_text")) asks.push("要放的准确文案");
  if (missingFields.includes("logo_decision")) asks.push("Logo 图片（不放 Logo 也请说一声）");
  if (missingFields.includes("finished_size")) asks.push("成品尺寸");
  if (missingFields.includes("visual_content_mode")) asks.push("画面是纯文字氛围，还是要展示实际商品");
  if (missingFields.includes("product_assets_or_selection")) asks.push("要展示的产品图，或用途、数量和单份预算让我从商品库选品");
  return `${labels}可以做。把${asks.join("、")}发我，资料齐了我就用臻希 AI 出 4 版给您挑。`;
}

function creativeReadyReply(deliverables) {
  const labels = deliverables.map((item) => item.label).join("和");
  return `收到，我现在按您的要求做${labels}：先生成 4 条文案方案，再生成对应的 4 张设计图，做好直接发您挑。`;
}

function creativeAssetIds(assets, currentAssetIds, previous) {
  const current = new Set(normalizeList(currentAssetIds));
  const previousIds = new Set(normalizeList(previous?.assetIds));
  const matching = assets
    .filter((asset) => current.has(asset.id) || previousIds.has(asset.id) || /logo|标志|商标|customer_(?:logo|reference)/i.test(asset.role))
    .map((asset) => asset.id);
  return [...new Set([...matching, ...current, ...previousIds])];
}

function extractRequestedCopy(text, options = {}) {
  const value = String(text || "").trim();
  if (!value || /^\[(?:图片|语音|视频|文件)\]$/.test(value)) return "";
  const quoted = /[“\"]([^”\"]{2,160})[”\"]/.exec(value)?.[1];
  if (quoted) return quoted.trim();
  const marked = /(?:文案|文字|内容|祝福语|卡片上写|吊牌上写|腰封上写)(?:是|用|写|为|：|:)?\s*[“\"]?([^”\"\n]{2,180})/i.exec(value)?.[1];
  if (marked) return trimCopyAtStructuredInstruction(marked);
  if (options.acceptWholeText && !detectCreativeDeliverables(value).length && value.length <= 180 && !/^(?:有|没有|要|不要|不用|尺寸|大小|logo)/i.test(value)) {
    return value;
  }
  return "";
}

function trimCopyAtStructuredInstruction(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const boundary = /(?:[，,。；;！？]\s*)?(?:(?:不要|不用|不放|无需|没有|无)\s*(?:公司)?\s*(?:logo|标志|商标)|(?:logo|标志|商标|成品尺寸|展开尺寸|尺寸|大小)\s*(?:是|为|用|：|:)?|成品\s*\d{1,4}(?:\.\d+)?\s*[x×*]\s*\d{1,4}(?:\.\d+)?\s*(?:mm|cm|毫米|厘米)|(?:不要|不用|不需要|取消|去掉)\s*(?:做|放|生成)?\s*(?:搭品(?:效果图)?|搭配效果图|礼盒效果图|贺卡|卡片|吊牌|挂牌|挂签|腰封|围条))/i.exec(text);
  const copy = boundary ? text.slice(0, boundary.index) : text;
  return copy.replace(/[，,。；;！？、\s]+$/u, "").trim();
}

function explicitlyNoLogo(text) {
  return /(?:不要|不用|不放|无需|没有|无)\s*(?:公司)?\s*(?:logo|标志|商标)/i.test(String(text || ""));
}

function explicitlyCopyOnlyVisual(text) {
  return /(?:画面|海报|图片|图中)?\s*只(?:包含|保留|放|要)(?:指定|这句|以下)?\s*(?:文案|文字)/i.test(String(text || ""));
}

function detectVisualContentMode(text) {
  const value = String(text || "");
  if (GRAPHIC_ONLY_PATTERN.test(value)) return "graphic_only";
  if (REAL_PRODUCT_VISUAL_PATTERN.test(value)) return "real_product";
  return "";
}

function detectPhysicalSize(text) {
  const match = /(?:成品|展开|尺寸|大小)?\s*(\d{1,4}(?:\.\d+)?)\s*[x×*]\s*(\d{1,4}(?:\.\d+)?)\s*(mm|cm|毫米|厘米)/i.exec(String(text || ""));
  if (!match) return "";
  return `${match[1]}×${match[2]}${normalizePhysicalUnit(match[3])}`;
}

function detectPackageBoxSize(text) {
  const match = /(?:盒子|礼盒|包装)(?:尺寸|大小|是|为|约|规格)?\s*(\d{1,4}(?:\.\d+)?)\s*[x×*]\s*(\d{1,4}(?:\.\d+)?)\s*[x×*]\s*(\d{1,4}(?:\.\d+)?)(?:\s*(mm|cm|毫米|厘米))?/i.exec(String(text || ""));
  if (!match) return "";
  const unit = match[4] ? normalizePhysicalUnit(match[4]) : "（未注明单位）";
  return `${match[1]}×${match[2]}×${match[3]}${unit}`;
}

function detectMaterialOrientation(text, pixelSize = "", physicalSize = "", ratio = "") {
  const value = String(text || "");
  const dimensions = parseDimensions(pixelSize) || parseDimensions(physicalSize);
  if (
    /(?:正方形|方形(?:贺卡|卡片|款式|版式|构图|画幅)?|方版|正方款)/i.test(value)
    || isSquareRatio(ratio)
    || (dimensions && dimensions.width === dimensions.height)
  ) return "square";
  if (/(?:横版|横向|横构图|横着|横幅)/i.test(value)) return "horizontal";
  if (/(?:竖版|竖向|竖构图|竖着)/i.test(value)) return "vertical";
  if (!dimensions) return "";
  return dimensions.width > dimensions.height ? "horizontal" : "vertical";
}

function materialCanvasSize(defaultCanvasSize, orientation) {
  const dimensions = parseDimensions(defaultCanvasSize);
  if (!dimensions) return String(defaultCanvasSize || "");
  if (orientation === "square") return "1:1";
  return orientation === "horizontal"
    ? `${dimensions.height}x${dimensions.width}`
    : `${dimensions.width}x${dimensions.height}`;
}

function materialOrientationLabel(orientation) {
  if (orientation === "square") return "正方形（1:1）";
  return orientation === "horizontal" ? "横向" : "竖向";
}

function isSquareRatio(value) {
  const match = /^(\d{1,2})\s*[:：]\s*(\d{1,2})$/.exec(String(value || "").trim());
  return Boolean(match && Number(match[1]) > 0 && Number(match[1]) === Number(match[2]));
}

function parseDimensions(value) {
  const match = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i.exec(String(value || ""));
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

function ratioFromPhysicalSize(size) {
  const match = /(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)/.exec(String(size || ""));
  if (!match) return "";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return "";
  const scaledWidth = Math.round(width * 100);
  const scaledHeight = Math.round(height * 100);
  const divisor = greatestCommonDivisor(scaledWidth, scaledHeight);
  const ratioWidth = scaledWidth / divisor;
  const ratioHeight = scaledHeight / divisor;
  if (ratioWidth > 100 || ratioHeight > 100) return width >= height ? "3:2" : "2:3";
  return `${ratioWidth}:${ratioHeight}`;
}

function normalizePhysicalUnit(value) {
  return /cm|厘米/i.test(String(value || "")) ? "cm" : "mm";
}

function normalizeAssets(value, fallbackIds) {
  const rows = Array.isArray(value) ? value : [];
  const normalized = rows.map((item) => ({
    id: String(typeof item === "string" ? item : item?.id || item?.assetId || "").trim(),
    role: String(typeof item === "string" ? "" : item?.role || "").trim(),
  })).filter((item) => item.id);
  const seen = new Set(normalized.map((item) => item.id));
  for (const id of fallbackIds) if (!seen.has(id)) normalized.push({ id, role: "" });
  return normalized;
}

function normalizeDeliverableKeys(value) {
  return normalizeList(value).filter((key) => CUSTOMER_CREATIVE_DELIVERABLES[key]);
}

function stablePlanSeed(text, deliverables) {
  const seed = `${String(text || "").trim()}|${deliverables.join(",")}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function hasGenerationVerb(text) {
  return /(?:帮我|给我|需要|想要|想做|要做|制作|生成|设计|写|出|做|改|换|抠|去背|来一|整一)/i.test(text);
}

function detectRequestedModule(text) {
  if (/(?:视频脚本|短视频脚本|口播脚本|分镜脚本|口播稿)/i.test(text)) return "video_script";
  if (/(?:小红书|种草笔记|种草文案)/i.test(text)) return "xiaohongshu";
  if (/(?:详情页|商品详情|详情文案|详情卖点)/i.test(text)) return "detail_page";
  if (/(?:海报|宣传文案|活动文案|促销文案|广告语)/i.test(text)) return "poster_copy";
  return "image";
}

function imageCapability(module, text) {
  if (module === "xiaohongshu") return "小红书视觉设计";
  if (module === "detail_page") return "详情页视觉设计";
  if (module === "poster_copy" || /海报/i.test(text)) return "海报设计";
  if (/(?:透明底|透明背景|去背|抠图)/i.test(text)) return "透明背景图片";
  return "图片设计";
}

function copyCapability(module) {
  const labels = {
    poster_copy: "海报文案",
    xiaohongshu: "小红书文案",
    detail_page: "详情页文案",
    video_script: "视频脚本",
    image: "海报文案",
  };
  return labels[module] || "文案";
}

function detectImageSize(text) {
  const match = /(?:^|[^\d])(\d{2,5})\s*[x×*]\s*(\d{2,5})(?:\s*(?:px|像素))?/i.exec(text);
  if (!match) return "";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 64 || height < 64 || width > 8192 || height > 8192) return "";
  return `${width}x${height}`;
}

function detectImageRatio(text, size = "") {
  const ratioMatch = /(?:比例|画幅|尺寸)?\s*(\d{1,2})\s*[:：]\s*(\d{1,2})/i.exec(text);
  if (ratioMatch) return `${Number(ratioMatch[1])}:${Number(ratioMatch[2])}`;
  if (size) {
    const [width, height] = size.split("x").map(Number);
    const divisor = greatestCommonDivisor(width, height);
    return `${width / divisor}:${height / divisor}`;
  }
  return "";
}

function greatestCommonDivisor(a, b) {
  let left = Math.abs(Number(a) || 1);
  let right = Math.abs(Number(b) || 1);
  while (right) [left, right] = [right, left % right];
  return left || 1;
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => (typeof item === "string" ? item : item?.id || item?.assetId)).filter(Boolean).map(String))];
}

module.exports = {
  CUSTOMER_CREATIVE_DELIVERABLES,
  ZHENXI_COPY_MODULES,
  ZHENXI_CUSTOMER_COPY_COUNT,
  ZHENXI_CUSTOMER_IMAGE_COUNT,
  detectCreativeDeliverables,
  planZhenxiCustomerRequest,
};
