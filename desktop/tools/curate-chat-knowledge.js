"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const desktopRoot = path.resolve(__dirname, "..");
const defaultStorePath = path.join(desktopRoot, ".runtime-stable", "local-store.json");
const curationSourceId = "chat_import_curated_20260819";
const curator = "codex-chat-knowledge-curator";

const agentIds = {
  pre_sales: "agent_pre_sales",
  gift_design: "agent_gift_design",
  order_payment: "agent_order_payment",
  logistics_exception: "agent_logistics_exception",
  after_sales: "agent_after_sales",
  general: "agent_general",
};

const curatedKnowledge = [
  entry("pre_sales", "售前：客户只问价格或怎么收费", ["售前转化", "价格咨询", "预算澄清", "聊天整理"], [
    "适用：客户只问多少钱、怎么收费、这套多少，暂未说明数量、用途或交期。",
    "做法：先承接问题，再补问数量或用途；如果已有商品库匹配，只能引用商品库事实，不能直接承诺最低价、含税、运费或最终报价。",
    "建议话术：可以的，我先按您的用途和数量帮您看合适档位。方便说下大概做多少份、送给谁、单份预算想控制在多少吗？我确认后给您更准确的方案。",
    "禁用：不要凭聊天历史直接报固定价格，不说全网最低，不承诺未核实优惠。",
  ], 95),
  entry("pre_sales", "售前：客户已有预算但缺少数量或用途", ["售前转化", "预算澄清", "用途确认", "聊天整理"], [
    "适用：客户说每份 50、100、180、200 左右，或说预算有限，但没有说明份数、用途、交付时间。",
    "做法：把预算先复述成可执行条件，再只追问当前最关键的一项，避免一次问太多。",
    "建议话术：这个预算可以先按常规伴手礼方向筛一版。您这边大概做多少份，是员工福利、客户答谢、开业活动还是节日礼？我按场景给您缩小范围。",
    "禁用：不要直接承诺某个固定组合一定能做，要以商品库和人工核价为准。",
  ], 94),
  entry("pre_sales", "售前：中秋月饼和节日礼盒咨询", ["售前转化", "中秋", "月饼礼盒", "节礼", "聊天整理"], [
    "适用：客户问中秋、月饼、节日伴手礼、企业节礼方案。",
    "做法：先确认是否做企业/员工/客户场景，再问预算和份数；可以引导看产品册或商品库中对应节日方案。",
    "建议话术：有的，我先按中秋节礼方向帮您筛。您这边是送员工还是客户？大概多少份、单份预算想控制在多少？我按预算给您整理几套更贴近的方案。",
    "禁用：不要自动发送过期节日款或未核实库存。",
  ], 93),
  entry("pre_sales", "售前：低预算和十几块档位咨询", ["售前转化", "低预算", "商品推荐", "聊天整理"], [
    "适用：客户问十几块、几十块、预算很低、之前买过某款更便宜。",
    "做法：承认预算范围，再说明可从基础款、轻定制、简包装方向筛选；最终价格、包邮和起订必须查商品库或人工确认。",
    "建议话术：可以先按轻量伴手礼方向看，低预算更适合基础款或简包装。您要做多少份、是否需要 Logo 或卡片？我先按能落地的范围帮您筛。",
    "禁用：不要自动承诺起订数、包邮、免费定制。",
  ], 92),
  entry("pre_sales", "售前：批量数量和优惠申请", ["售前转化", "批量优惠", "数量确认", "聊天整理"], [
    "适用：客户说 100 份、120 套、能不能优惠、还能便宜吗、送几份。",
    "做法：先确认数量、预算、交期和是否开票，再说明可以申请核价；优惠、赠品、含税和运费必须人工确认。",
    "建议话术：数量上来后可以帮您重新核一下批量方案。您这边确认下份数、预算、是否需要发票和 Logo，我整理好后给人工核最终优惠。",
    "禁用：不要说最低价、不能再少、赠送数量等确定承诺。",
  ], 95),
  entry("pre_sales", "售前：女性客户群体和员工福利偏好", ["售前转化", "员工福利", "女性客户", "偏好确认", "聊天整理"], [
    "适用：客户说明受众多为女性、员工福利、客户答谢、美业或活动礼。",
    "做法：把受众转成选品方向，如实用、精致、轻礼盒、护手霜、香氛等，但具体商品必须来自商品库。",
    "建议话术：明白，受众偏女性的话可以优先看实用又精致的组合。您希望偏商务大气、温柔精致，还是性价比实用？我按这个方向筛。",
    "禁用：不要自行编造商品库存或固定组合。",
  ], 91),
  entry("pre_sales", "售前：开业礼和美业会场场景", ["售前转化", "开业礼", "美业", "会场", "聊天整理"], [
    "适用：客户说开业礼、美业会场、门店活动、伴手礼给顾客。",
    "做法：先问行业、活动时间、预算和份数；推荐应围绕体面、好拿、适合拍照和可定制展示，但不承诺具体库存。",
    "建议话术：开业礼可以做得更有仪式感一点。您这边活动日期、份数和单份预算大概是多少？如果有门店 Logo 或主色，也可以一起发我，我按场景帮您筛。",
    "禁用：不要直接复用其他客户案例图片当作已确认方案。",
  ], 92),
  entry("pre_sales", "售前：客户要看款式产品册或样品", ["售前转化", "产品册", "样品", "选款", "聊天整理"], [
    "适用：客户说发方案、看款式、看产品册、寄样、先看图片。",
    "做法：优先调用商品库或已审核素材；如果没有实时素材，就说明先整理，不要伪造附件已经发送。",
    "建议话术：可以，我先按您的预算和用途筛几组款式。您要是有喜欢的风格或参考图也可以发我，我会一起对照，避免推荐偏掉。",
    "禁用：不要在没有附件任务或素材时写“已发您 PDF/图片”。",
  ], 94),
  entry("pre_sales", "售前：客户说晚点联系下个月再看", ["售前转化", "跟进节奏", "柔和收口", "聊天整理"], [
    "适用：客户说晚点、这会忙、下个月需要、暂时再看看、以后联系。",
    "做法：简短收口，保留后续跟进空间，不继续追问过多信息。",
    "建议话术：好的，那我先不打扰您。后面需要做伴手礼的时候直接找我就行，您到时候告诉我用途、份数和预算，我再帮您快速筛方案。",
    "禁用：不要连续催单或强推报价。",
  ], 93),
  entry("pre_sales", "售前：客户嫌可爱或要求简单商务大气", ["售前转化", "风格偏好", "换款", "聊天整理"], [
    "适用：客户说太可爱、不喜欢、不好看、简单一点、商务一点、大气一点。",
    "做法：把否定表达翻译成正向筛选条件，再确认保留和排除方向。",
    "建议话术：明白，那我先避开偏可爱和花哨的款，往简单、商务、大气一点的方向筛。您更想要实用感强，还是礼盒看起来更有档次？",
    "禁用：不要反驳客户审美，不要继续推同一类风格。",
  ], 94),
  entry("gift_design", "礼盒设计：客户要求看效果图", ["礼盒设计", "效果图", "出图前确认", "聊天整理"], [
    "适用：客户问能不能看效果图、真实摆拍、带 Logo 的礼盒图。",
    "做法：先确认预算、份数、用途、Logo/参考图、指定商品和风格，再进入设计平台；效果图必须基于真实商品或客户素材。",
    "建议话术：可以的，我先按您的预算和用途搭一套真实商品组合。您把 Logo、参考图或指定产品发我一下，我再整理几版效果图给您挑。",
    "禁用：不要承诺图片里商品可售、价格已定或 Logo 工艺已确认。",
  ], 96),
  entry("gift_design", "礼盒设计：Logo 企业名称和祝福语素材收集", ["礼盒设计", "Logo", "素材收集", "聊天整理"], [
    "适用：客户说可以定制 Logo 吗、把 Logo 发给你、店名公司名祝福语怎么放。",
    "做法：确认 Logo 文件、文案、使用位置和是否有品牌色；不清楚时先追问一项关键素材。",
    "建议话术：可以先发我 Logo 或店名，我帮您看适合放在卡片、腰封还是礼盒封面。祝福语和品牌色如果有，也一起发我，效果会更统一。",
    "禁用：不要承诺所有款式都能印 Logo，具体工艺和费用要人工或商品规则确认。",
  ], 95),
  entry("gift_design", "礼盒设计：卡片腰封礼盒封面定制", ["礼盒设计", "卡片", "腰封", "礼盒封面", "聊天整理"], [
    "适用：客户问卡片是什么、腰封能不能定制、礼盒封面能不能加 Logo。",
    "做法：用通俗语言解释定制位置，并引导客户确认是否只做卡片、腰封或封面。",
    "建议话术：卡片/腰封/封面是礼盒外观定制的几个位置。您可以先发 Logo 和想放的文字，我帮您看放在哪里更合适，再确认是否需要出效果图。",
    "禁用：不要把免费定制、起订数量和出版费说死。",
  ], 94),
  entry("gift_design", "礼盒设计：客户不要周年庆只保留 Logo", ["礼盒设计", "删改文案", "Logo", "聊天整理"], [
    "适用：客户明确说不需要周年庆、不要其他名字、只要 Logo 或简单文字。",
    "做法：复述客户要删除和保留的内容，再确认最终文案，避免设计稿残留多余文字。",
    "建议话术：好的，我按简单版处理：不放周年庆和其他多余文字，只保留您确认的 Logo/名称。您把最终 Logo 发我，我按这个方向出图。",
    "禁用：不要继续套用节日/周年庆模板。",
  ], 96),
  entry("gift_design", "礼盒设计：更换盒内单品或确认能否装下", ["礼盒设计", "换品", "尺寸确认", "聊天整理"], [
    "适用：客户问这个能不能换、护手霜换成别的、口罩香薰梳子能不能放下、盒子尺寸够不够。",
    "做法：先确认要保留和替换的单品、数量、尺寸；涉及装盒适配必须查商品尺寸或人工确认。",
    "建议话术：可以先帮您看替换方向。您想保留哪些单品、换掉哪一个？如果是自己额外定的产品，麻烦发下尺寸，我核对能不能装进礼盒。",
    "禁用：不要只凭感觉承诺一定装得下。",
  ], 95),
  entry("gift_design", "礼盒设计：客户发送附件或引用图", ["礼盒设计", "附件处理", "参考图", "聊天整理"], [
    "适用：客户发附件、引用图片、说按这个组合、照着这个做。",
    "做法：先确认附件用途：Logo、参考风格、指定商品还是历史订单；无法读取附件时转人工或要求补充说明。",
    "建议话术：我看到了您发的参考素材。我先确认一下，这张图是作为 Logo、参考风格，还是指定要放进礼盒的商品？确认后我再按这个方向处理。",
    "禁用：不要在未识别附件内容时直接进入出图或报价。",
  ], 94),
  entry("gift_design", "礼盒设计：小数量定制需要先核算", ["礼盒设计", "小单定制", "Logo工艺", "聊天整理"], [
    "适用：客户数量较少但要求 Logo、卡片、礼盒封面等定制。",
    "做法：先说明可以帮忙核算，但小数量定制可能涉及起订、工艺和费用；最终由人工确认。",
    "建议话术：可以帮您看定制方案，不过数量比较少时，Logo 工艺和费用需要单独核一下。我先把数量、Logo 位置和用途整理好，再给您确认可做方式。",
    "禁用：不要直接承诺免费定制或最低起订。",
  ], 93),
  entry("gift_design", "礼盒设计：极简风格和不要多余元素", ["礼盒设计", "极简风格", "文案确认", "聊天整理"], [
    "适用：客户说很简单、盒子里其他名字或 Logo 都不要、只做一张卡片。",
    "做法：明确设计减法：只保留客户确认元素，其他装饰、品牌名、节日字样全部去掉。",
    "建议话术：明白，这版就走极简方向。除您确认的 Logo/文字外，其他名称、节日字样和多余装饰都不加，我按干净简单的效果来做。",
    "禁用：不要自动添加营销口号或节庆文案。",
  ], 95),
  entry("order_payment", "下单支付：客户要求开票", ["下单支付", "发票", "订单核对", "聊天整理"], [
    "适用：客户问可以开票吗、发票按之前的开、要发票。",
    "做法：先收集开票信息、订单金额和订单归属；涉及历史订单、拆分付款或金额调整必须人工核对。",
    "建议话术：可以，我先帮您核对订单和开票信息。麻烦发一下开票抬头、税号、订单或付款记录，金额确认后再开具，避免开错。",
    "禁用：不要凭聊天里提到的旧金额直接确认发票金额。",
  ], 94),
  entry("order_payment", "下单支付：最低价定金赠品和付款方式", ["下单支付", "优惠确认", "定金", "赠品", "聊天整理"], [
    "适用：客户问最低了是吗、能否定金、能否送几份、微信/支付宝/对公怎么付。",
    "做法：先确认订单金额、数量、是否开票和付款方式；定金、赠品、最终优惠必须人工确认。",
    "建议话术：我先帮您把数量、金额、是否开票和付款方式核清楚。最终优惠、定金比例或赠品需要人工确认后再给您准话。",
    "禁用：不要自动给收款码、账户、定金门槛或赠品承诺。",
  ], 95),
  entry("order_payment", "下单支付：收货地址和付款状态核对", ["下单支付", "收货地址", "付款状态", "聊天整理"], [
    "适用：客户要发地址、改地址、问是否付款、什么时候付款、订单状态。",
    "做法：必须绑定当前会话和订单，核对收件人、电话、地址、订单号和付款状态。",
    "建议话术：收到，我先核对一下订单和收货信息。麻烦把订单号或付款记录、收件人、电话和完整地址发我，我确认后再处理。",
    "禁用：不要跨客户或跨会话改地址、确认收款。",
  ], 94),
  entry("logistics_exception", "物流：客户催发货或要快递单号", ["物流异常", "催发货", "快递单号", "聊天整理"], [
    "适用：客户问发货了吗、单号发我、快递一直不动、好多天了。",
    "做法：先要订单号或收件信息，再查询物流；未查到前只能说明会核对，不能编造单号或发货时间。",
    "建议话术：我帮您查一下。麻烦发下订单号、收件手机号后四位或快递单号，我核对到准确状态后马上同步给您。",
    "禁用：不要自动生成快递单号，不承诺未核实发货。",
  ], 95),
  entry("logistics_exception", "物流：客户问几天到来不来得及", ["物流异常", "交期", "到货时间", "聊天整理"], [
    "适用：客户问几天能到、某日来得及吗、急用、活动日期。",
    "做法：确认活动日期、收货城市、数量和是否定制；交期只能按订单/物流状态核实后回复。",
    "建议话术：我先按您的活动时间帮您核一下是否来得及。麻烦发下收货城市、需要日期、份数和是否需要定制，我确认后给您更稳的时间判断。",
    "禁用：不要直接承诺几天发货、几天到货。",
  ], 94),
  entry("logistics_exception", "物流：运输破损和包装风险", ["物流异常", "包装", "破损风险", "聊天整理"], [
    "适用：客户担心快递中途损毁、包装盒要不要多放、运输是否安全。",
    "做法：先说明会按正常包装发出，再让客户保留签收和开箱凭证；破损补发/赔付要按订单和证据人工确认。",
    "建议话术：我们会按正常运输要求包装。您收到后如果外箱或商品有明显问题，先拍外箱、面单和问题商品照片发我，我会帮您核对处理。",
    "禁用：不要绝对保证不会损坏，也不要提前承诺赔付金额。",
  ], 92),
  entry("after_sales", "售后：破损少件质量问题先收凭证", ["售后安抚", "破损", "少件", "质量问题", "聊天整理"], [
    "适用：客户反馈破损、少件、漏发、质量问题、不满意。",
    "做法：先安抚，再收订单号、外包装、面单、问题商品照片或视频；退款、补发、赔偿必须核实后处理。",
    "建议话术：很抱歉给您添麻烦。我先帮您核对处理，麻烦发一下订单号、外包装/面单和问题商品照片，我确认具体情况后给您明确方案。",
    "禁用：不要没看凭证就承诺退款、补发或赔偿。",
  ], 95),
  entry("after_sales", "售后：非质量问题退换先转人工确认", ["售后安抚", "退换货", "非质量问题", "聊天整理"], [
    "适用：客户问用不完能退吗、后期能不能退、想换货。",
    "做法：先确认订单商品、定制属性、收货状态和原因；非质量退换、定制品退换必须人工确认规则。",
    "建议话术：我先帮您看下订单和商品属性。退换需要结合是否定制、是否影响二次销售和具体原因确认，我核对后再给您明确处理方式。",
    "禁用：不要直接说一定能退或一定不能退。",
  ], 93),
  entry("general", "通用：附件引用和实时事实不清时先确认", ["通用兜底", "防乱回复", "附件", "实时事实", "聊天整理"], [
    "适用：消息只有附件、引用、表情、单个数字，或涉及价格、库存、运费、交期、订单、收款等实时事实但信息不足。",
    "做法：先确认客户要处理的重点，或转人工/查询系统；不要根据旧聊天记录补齐当前事实。",
    "建议话术：我先确认一下，您这条主要是想看方案、改设计、查订单/物流，还是确认价格付款？确认后我再按对应流程处理，避免回错。",
    "禁用：不要把历史附件、旧价格、旧单号当成当前事实自动发送。",
  ], 96),
];

function entry(agentKey, title, tags, lines, qualityScore) {
  return {
    agentKey,
    title,
    content: lines.join("\n"),
    tags,
    qualityScore,
  };
}

function curateStoreData(input, now = new Date().toISOString()) {
  const data = clone(input || {});
  data.agents = Array.isArray(data.agents) ? data.agents : [];
  data.agentSkills = Array.isArray(data.agentSkills) ? data.agentSkills : [];
  data.trainingSamples = Array.isArray(data.trainingSamples) ? data.trainingSamples : [];
  data.knowledgeEntries = Array.isArray(data.knowledgeEntries) ? data.knowledgeEntries : [];
  data.reviewLogs = Array.isArray(data.reviewLogs) ? data.reviewLogs : [];

  const sizeResult = removeSizeRecommendation(data, now);
  const rawResult = demoteRawChatKnowledge(data, now);
  const upsertResult = upsertCuratedKnowledge(data, now);

  return {
    data,
    summary: {
      ...sizeResult,
      ...rawResult,
      ...upsertResult,
      chatImportStats: summarizeChatImports(data),
    },
  };
}

function removeSizeRecommendation(data, now) {
  const sizeAgentIds = new Set(data.agents
    .filter((agent) => agent?.key === "size_recommendation" || agent?.id === "agent_size_recommendation")
    .map((agent) => agent.id)
    .filter(Boolean));
  const beforeAgents = data.agents.length;
  const beforeSkills = data.agentSkills.length;
  data.agents = data.agents.filter((agent) => agent?.key !== "size_recommendation" && agent?.id !== "agent_size_recommendation");
  data.agentSkills = data.agentSkills.filter((skill) => !sizeAgentIds.has(skill?.agentId) && skill?.agentId !== "agent_size_recommendation");

  let reassignedSamples = 0;
  for (const sample of data.trainingSamples) {
    if (sample?.agentKey !== "size_recommendation" && sample?.agentId !== "agent_size_recommendation") continue;
    sample.agentKey = "general";
    sample.agentId = agentIds.general;
    sample.scene = "未分类";
    sample.status = "review";
    sample.updatedAt = now;
    reassignedSamples += 1;
  }

  let disabledKnowledge = 0;
  for (const knowledge of data.knowledgeEntries) {
    if (knowledge?.agentId !== "agent_size_recommendation" && knowledge?.agentKey !== "size_recommendation") continue;
    knowledge.agentId = agentIds.general;
    knowledge.status = "rejected";
    knowledge.reviewer = curator;
    knowledge.reviewNote = "size recommendation lane removed for gift-business customer service";
    knowledge.reviewedAt = now;
    knowledge.updatedAt = now;
    disabledKnowledge += 1;
  }

  return {
    removedSizeAgents: beforeAgents - data.agents.length,
    removedSizeSkills: beforeSkills - data.agentSkills.length,
    reassignedSizeSamples: reassignedSamples,
    disabledSizeKnowledge: disabledKnowledge,
  };
}

function demoteRawChatKnowledge(data, now) {
  let demotedRawChatKnowledge = 0;
  for (const knowledge of data.knowledgeEntries) {
    if (knowledge?.sourceType !== "chat_import") continue;
    if (String(knowledge.status || "ready") !== "ready") continue;
    knowledge.status = "review";
    knowledge.reviewer = curator;
    knowledge.reviewNote = "raw chat import kept for audit; curated knowledge entries are used for automatic replies";
    knowledge.reviewedAt = now;
    knowledge.updatedAt = now;
    knowledge.reviewHistory = appendReviewHistory(knowledge.reviewHistory, {
      status: "review",
      reviewer: curator,
      note: knowledge.reviewNote,
      reviewedAt: now,
    });
    demotedRawChatKnowledge += 1;
  }
  return { demotedRawChatKnowledge };
}

function upsertCuratedKnowledge(data, now) {
  let insertedCuratedKnowledge = 0;
  let updatedCuratedKnowledge = 0;
  for (const item of curatedKnowledge) {
    const id = curatedKnowledgeId(item);
    const existingIndex = data.knowledgeEntries.findIndex((entryItem) => entryItem.id === id);
    const existing = existingIndex >= 0 ? data.knowledgeEntries[existingIndex] : null;
    const next = {
      ...(existing || {}),
      id,
      agentId: agentIds[item.agentKey] || agentIds.general,
      sourceType: "chat_curated_knowledge",
      sourceId: curationSourceId,
      title: item.title,
      content: item.content,
      tags: item.tags,
      qualityScore: item.qualityScore,
      status: "ready",
      reviewer: curator,
      reviewNote: "curated from imported chat records; reusable SOP, not raw verbatim",
      reviewedAt: now,
      metadata: {
        ...(existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
        curatedFrom: "chat_import",
        sourceId: curationSourceId,
        agentKey: item.agentKey,
        rawChatPolicy: "attachments quotes prices inventory freight delivery and payment facts removed or guarded",
      },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (existingIndex >= 0) {
      data.knowledgeEntries[existingIndex] = next;
      updatedCuratedKnowledge += 1;
    } else {
      data.knowledgeEntries.push(next);
      insertedCuratedKnowledge += 1;
    }
  }
  return {
    insertedCuratedKnowledge,
    updatedCuratedKnowledge,
    curatedKnowledgeTotal: curatedKnowledge.length,
  };
}

function curatedKnowledgeId(item) {
  const digest = crypto.createHash("sha1").update(`${item.agentKey}\n${item.title}`).digest("hex").slice(0, 20);
  return `knowledge_chat_curated_${digest}`;
}

function appendReviewHistory(history, item) {
  const rows = Array.isArray(history) ? history.slice() : [];
  rows.push(item);
  return rows.slice(-20);
}

function summarizeChatImports(data) {
  const rows = data.knowledgeEntries.filter((item) => item?.sourceType === "chat_import");
  return {
    total: rows.length,
    ready: rows.filter((item) => String(item.status || "ready") === "ready").length,
    review: rows.filter((item) => String(item.status || "ready") === "review").length,
    rejected: rows.filter((item) => String(item.status || "ready") === "rejected").length,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseArgs(argv) {
  const args = { store: defaultStorePath, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    if (arg === "--store") {
      args.store = path.resolve(argv[index + 1] || "");
      index += 1;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = fs.readFileSync(args.store, "utf8");
  const parsed = JSON.parse(raw);
  const { data, summary } = curateStoreData(parsed);
  if (args.apply) {
    const backupPath = `${args.store}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(args.store, backupPath);
    fs.writeFileSync(args.store, `${JSON.stringify(data, null, 2)}\n`);
    console.log(JSON.stringify({ applied: true, store: args.store, backupPath, summary }, null, 2));
    return;
  }
  console.log(JSON.stringify({ applied: false, store: args.store, summary }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  curateStoreData,
  curatedKnowledge,
  curatedKnowledgeId,
};
