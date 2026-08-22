"use strict";

const MATERIAL_REQUEST_PATTERN = /发我看看|给我看看|发来看看|(?:发(?:我|来|一下|一份|点|些)?|给我|想看|看看|挑|推荐)(?:.{0,6})?(?:方案|资料|图册|目录|ppt|pdf)|(?:方案|资料|图册|目录|ppt|pdf).{0,6}(?:发我|给我|看看|挑一下)|有(?:没有)?(?:.{0,4})?(?:方案|资料|图册|目录|ppt|pdf)/i;
const PAGE_RECOMMENDATION_PATTERN = /推荐(?:一|两|三|几)(?:个|款|页|张)|推荐(?:几个|几款|几页|几张)|帮我(?:挑|选)|替我(?:挑|选)|给我(?:挑|选)(?:一|两|三|几|个|款|页|张)?|(?:挑|选)(?:一|两|三|几)(?:个|款|页|张)|哪(?:个|款|几款|几页)(?:好|合适|适合)|发(?:一|两|三|几)(?:页|张)(?:看看)?|截图(?:推荐|发我|给我)/;
const PAGE_QUOTE_PATTERN = /多少钱|什么价|怎么卖|价格|报价|单价|总价|合计|一共|总共|各多少|分别多少/;
const PAGE_REPLACEMENT_PATTERN = /(?:换掉|更换|替换|换成|改成|不要|去掉|拿掉).{0,16}(?:品类|商品|款|香薰|杯|梳|皂|茶|咖啡|毛巾|雨伞|风扇|护手霜|眼罩)|(?:香薰|杯|梳|皂|茶|咖啡|毛巾|雨伞|风扇|护手霜|眼罩).{0,12}(?:换掉|更换|替换|换成|改成|不要|去掉|拿掉)/;
const PAGE_PRICE_NEGOTIATION_PATTERN = /便宜|优惠|折扣|打折|最低价|底价|少一点|再低|能否优惠|能不能优惠|\d+(?:\.\d+)?\s*元.{0,8}(?:能做|可以吗|行吗|能不能|能否|成交)|(?:能做|可以|能不能|能否).{0,8}\d+(?:\.\d+)?\s*元/;
const PAGE_INTERNAL_COST_PATTERN = /成本价|进货价|采购价|内部价|不加利润|商品库.{0,8}(?:价格|价钱|金额|成本)/;
const PAGE_ATTRIBUTE_CHANGE_PATTERN = /(?:颜色|色号|图案|花色|包装|礼盒|丝带|文案|logo|LOGO|印刷|数量|份数|尺寸|规格).{0,8}(?:换成|改成|更换|替换|调整)/;
const SPECIFIC_MATERIAL_REQUEST_PATTERN = /(?:瑜伽|普拉提|教师节|老师礼|教师礼|商务伴手礼).{0,24}(?:发|看|挑|选|推荐|方案|资料|图册|目录|ppt|pdf)|(?:发|看|挑|选|推荐|方案|资料|图册|目录|ppt|pdf).{0,24}(?:瑜伽|普拉提|教师节|老师礼|教师礼|商务伴手礼)/i;
const ALTERNATE_MATERIAL_PATTERN = /还有(?:别的|其他|另一)?(?:吗|呢|没)?|换(?:一|另)(?:份|本|册)|另(?:一|外一)(?:份|本|册)|下一册|另一册/;
const SPECIFIC_MATERIAL_CATEGORIES = new Set(["yoga", "business_gift", "teachers_day"]);
const CUSTOMER_MATERIAL_CATEGORIES = new Set(["beauty", "enterprise", "small_budget", ...SPECIFIC_MATERIAL_CATEGORIES]);
const DIRECT_PRODUCT_TERMS = [
  "颈椎按摩仪", "车载无线充", "提神醒脑清凉液", "山茶花香薰", "折叠环保袋", "无线充鼠标垫",
  "保温杯", "马克杯", "咖啡杯", "吸管杯", "晴雨伞", "胶囊雨伞", "小风扇", "充电宝",
  "蓝牙音箱", "护手霜", "无火香薰", "香薰", "按摩梳", "气垫梳", "木梳", "养生锤",
  "毛巾", "笔记本", "签字笔", "书签", "咖啡", "茶", "巧克力", "洗护", "眼罩", "发圈",
  "抓夹", "香皂", "U型枕", "围巾", "冰袖", "湿巾", "环保袋", "盆栽", "加湿器", "鼠标",
  "数据线", "雨伞", "风扇", "杯子", "梳子", "食品", "特产", "瑜伽垫", "瑜伽球",
  "瑜伽袜", "瑜伽手套", "运动毛巾", "拉力器", "拉力带", "弹力带", "弹力绳", "筋膜球",
  "按摩球", "握力器", "帆布袋", "帆布包", "手提袋", "收纳包", "礼篮",
];
const PAGE_SIGNAL_GROUPS = [
  signalGroup("实用", /实用|日常|办公|员工福利|通勤|耐用/, ["保温杯", "雨伞", "毛巾", "笔记本", "充电宝", "小风扇", "环保袋", "鼠标", "数据线"]),
  signalGroup("商务", /商务|大气|稳重|客户答谢|送客户|会议|高端|高级|质感/, ["保温杯", "咖啡", "茶", "笔记本", "签字笔", "蓝牙音箱", "雨伞"]),
  signalGroup("女性", /女性|女生|女员工|女客户|美容|美业|精致|氛围感/, ["护手霜", "香薰", "按摩梳", "木梳", "眼罩", "发圈", "抓夹", "香皂", "毛巾"]),
  signalGroup("养生", /养生|健康|长辈|按摩|舒缓|疗愈/, ["养生锤", "按摩", "茶", "U型枕", "护手霜", "洗护", "香薰"]),
  signalGroup("夏季", /夏天|夏季|清凉|防晒|驱蚊|户外/, ["小风扇", "风扇", "晴雨伞", "雨伞", "冰袖", "清凉", "驱蚊", "湿巾"]),
  signalGroup("冬季", /冬天|冬季|保暖|年会|春节|新年/, ["围巾", "保温杯", "护手霜", "咖啡", "茶", "巧克力"]),
  signalGroup("可爱", /可爱|少女|活泼|年轻|小清新/, ["小熊", "花", "香薰", "护手霜", "抓夹", "发圈", "巧克力"]),
  signalGroup("教师", /教师|老师|学校|开学|毕业/, ["笔记本", "签字笔", "书签", "保温杯", "杯", "花"]),
  signalGroup("运动", /瑜伽|普拉提|健身|运动|塑形|拉伸|户外/, ["瑜伽垫", "瑜伽袜", "运动毛巾", "拉力器", "拉力带", "弹力带", "筋膜球", "按摩球", "握力器"]),
  signalGroup("地方特色", /临沂|沂蒙|地方特色|伴手礼|特产|非遗/, ["临沂炒鸡", "沂蒙", "非遗", "馓子", "糁", "特产"]),
];

let CUSTOMER_SELECTION_PAGE_INDEX = { version: 0, materials: [], pages: [] };
try {
  CUSTOMER_SELECTION_PAGE_INDEX = require("./customerSelectionPageIndex.json");
} catch {
  CUSTOMER_SELECTION_PAGE_INDEX = { version: 0, materials: [], pages: [] };
}

const CUSTOMER_SELECTION_MATERIALS = [
  material("yoga_gifts_pdf", "yoga", null, null, {
    title: "瑜伽系列礼品（PDF分册）",
    sourceName: "瑜伽系列礼品PPT.pdf",
    sendFileName: "瑜伽系列礼品_PDF分册_发送版.pdf",
    specificCategory: true,
    variantPriority: 1,
    minimumListedPriceCny: 26,
    maximumListedPriceCny: 198,
  }),
  material("yoga_gifts_pptx", "yoga", null, null, {
    title: "瑜伽系列礼品（PPT分册）",
    sourceName: "瑜伽系列礼品PPT.pptx",
    sendFileName: "瑜伽系列礼品_PPT分册_发送版.pdf",
    specificCategory: true,
    variantPriority: 2,
    minimumListedPriceCny: 26,
    maximumListedPriceCny: 198,
  }),
  material("business_gifts_2026", "business_gift", null, null, {
    title: "2026年商务伴手礼",
    sourceName: "2026年商务伴手礼PPT.pptx",
    sendFileName: "2026年商务伴手礼_发送版.pdf",
    specificCategory: true,
    variantPriority: 1,
    minimumListedPriceCny: 69,
    maximumListedPriceCny: 280,
  }),
  material("teachers_day_pdf", "teachers_day", null, null, {
    title: "2026教师节伴手礼（PDF分册）",
    sourceName: "2026教师节伴手礼(1).pdf",
    sendFileName: "2026教师节伴手礼_PDF分册_发送版.pdf",
    specificCategory: true,
    variantPriority: 1,
    minimumListedPriceCny: 28,
    maximumListedPriceCny: 232,
  }),
  material("teachers_day_pptx", "teachers_day", null, null, {
    title: "2026教师节伴手礼（PPT分册）",
    sourceName: "2026教师节伴手礼.pptx",
    sendFileName: "2026教师节伴手礼_PPT分册_发送版.pdf",
    specificCategory: true,
    variantPriority: 2,
    minimumListedPriceCny: 28,
    maximumListedPriceCny: 232,
  }),
  material("enterprise_under_50", "enterprise", null, 50, {
    title: "企业礼赠 50 元以内方案",
    sourceName: "2025企业50以内.pdf",
    sendFileName: "2025企业50以内.pdf",
  }),
  material("enterprise_51_100", "enterprise", 50, 100, {
    title: "企业礼赠 51-100 元方案",
    sourceName: "企业51-100.pdf",
    sendFileName: "企业礼赠_51-100元_发送版.pdf",
  }),
  material("enterprise_101_150", "enterprise", 100, 150, {
    title: "企业礼赠 101-150 元方案",
    sourceName: "企业101-150.pdf",
    sendFileName: "企业礼赠_101-150元_发送版.pdf",
  }),
  material("enterprise_151_200", "enterprise", 150, 200, {
    title: "企业礼赠 151-200 元方案",
    sourceName: "企业151-200.pdf",
    sendFileName: "企业礼赠_151-200元_发送版.pdf",
  }),
  material("enterprise_over_200", "enterprise", 200, null, {
    title: "企业礼赠 200 元以上方案",
    sourceName: "2025企业200+.pdf",
    sendFileName: "2025企业200+.pdf",
  }),
  material("beauty_20_below_50", "beauty", 19.999, 49.999999, {
    title: "美业礼赠 20-50 元方案",
    sourceName: "2025美业20-50.pdf",
    sendFileName: "美业礼赠_20-50元_发送版.pdf",
  }),
  material("beauty_50_80_2026", "beauty", 49.999999, 80, {
    title: "美业礼赠 50-80 元方案（2026）",
    sourceName: "2026美业50-80   ppt.pptx",
    sendFileName: "美业礼赠_50-80元_2026发送版.pdf",
  }),
  material("beauty_over_80_100", "beauty", 80, 100, {
    title: "美业礼赠 81-100 元方案",
    sourceName: "2025美业51-100.pdf",
    sendFileName: "美业礼赠_51-100元_发送版.pdf",
  }),
  material("small_budget_under_20", "small_budget", null, 20, {
    title: "通用小预算 20 元以内方案（2026）",
    sourceName: "2026小预算20内 .pptx",
    sendFileName: "通用小预算_20元以内_2026发送版.pdf",
  }),
  material("small_budget_over_20_30", "small_budget", 20, 30, {
    title: "通用小预算 20-30 元方案（2026）",
    sourceName: "2026小预算20-30  pptx.pptx",
    sendFileName: "通用小预算_20-30元_2026发送版.pdf",
  }),
  material("small_budget_over_30_50", "small_budget", 30, 50, {
    title: "通用小预算 30-50 元方案（2026）",
    sourceName: "2026小预算30-50.pptx",
    sendFileName: "通用小预算_30-50元_2026发送版.pdf",
  }),
];

function material(id, category, minimumExclusive, maximumInclusive, details) {
  return Object.freeze({
    id,
    category,
    minimumExclusive,
    maximumInclusive,
    storageRelativePath: `knowledge-materials/customer-selection-2026-08-21/${details.sendFileName}`,
    ...details,
  });
}

function signalGroup(label, pattern, pageTerms) {
  return Object.freeze({ label, pattern, pageTerms });
}

function classifyCustomerMaterialCategory(value, fallback = null) {
  const text = String(value || "").trim();
  if (/瑜伽|普拉提|瑜伽馆|普拉提馆|健身房|健身馆|运动馆/.test(text)) return "yoga";
  if (/教师节|老师礼|教师礼|送老师|教职工|学校礼品|校庆|毕业季/.test(text)) return "teachers_day";
  if (/商务伴手礼|商务礼盒|商务定制|高端商务|商务客户伴手礼/.test(text)) return "business_gift";
  if (/美业|美容院|美容店|美甲|美睫|皮肤管理|医美|美发|理发店|spa|养生馆/i.test(text)) return "beauty";
  if (/企业|公司|员工福利|工会|客户答谢|商务拜访|商务礼|年会|会议礼|团建|周年庆|送员工|送客户/.test(text)) return "enterprise";
  if (/通用|小预算|低预算|预算不高|活动款|散发礼|引流礼|不分行业/.test(text)) return "small_budget";
  return normalizeCustomerMaterialCategory(fallback);
}

function normalizeCustomerMaterialCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CUSTOMER_MATERIAL_CATEGORIES.has(normalized) ? normalized : null;
}

function customerMaterialCategoryLabel(value) {
  return value === "beauty" ? "美业客户"
    : value === "enterprise" ? "企业客户"
      : value === "small_budget" ? "通用小预算客户"
        : value === "yoga" ? "瑜伽/普拉提客户"
          : value === "business_gift" ? "商务伴手礼客户"
            : value === "teachers_day" ? "教师节送礼客户"
              : "未确认客户类别";
}

function customerRequestedSelectionMaterial(value) {
  const text = String(value || "");
  return MATERIAL_REQUEST_PATTERN.test(text) || SPECIFIC_MATERIAL_REQUEST_PATTERN.test(text);
}

function customerRequestedPageRecommendations(value) {
  return PAGE_RECOMMENDATION_PATTERN.test(String(value || ""));
}

function selectCustomerSelectionMaterial(input = {}) {
  const text = String(input.text || "");
  const previousSelection = normalizePreviousMaterialSelection(
    input.previousSelection || input.customerSelectionMaterialContext,
  );
  const alternateRequested = Boolean(previousSelection && ALTERNATE_MATERIAL_PATTERN.test(text));
  const requested = input.requested === true || customerRequestedSelectionMaterial(text) || alternateRequested;
  if (!requested) return { status: "not_requested", requested: false, matchCount: 0, material: null };
  const priorCategory = input.customerCategory || input.salesContext?.customerCategory || previousSelection?.category;
  const category = classifyCustomerMaterialCategory(text, priorCategory);
  const currentPerUnitAmount = positiveAmount(input.perUnitAmount ?? input.budget?.perUnitAmount);
  const perUnitAmount = currentPerUnitAmount
    || (previousSelection?.category === category ? positiveAmount(previousSelection.perUnitAmount) : null);
  if (!category) {
    return {
      status: "missing_category",
      requested: true,
      matchCount: 0,
      material: null,
      question: "这是给企业员工或客户、美容美业门店、瑜伽/普拉提、教师节，还是通用小预算活动用的？我按客户类别只发一份合适的方案。",
    };
  }
  if (SPECIFIC_MATERIAL_CATEGORIES.has(category)) {
    const categoryMaterials = CUSTOMER_SELECTION_MATERIALS.filter((candidate) => candidate.category === category);
    const selectedMaterial = chooseSpecificCategoryMaterial(categoryMaterials, text, previousSelection, alternateRequested);
    if (!selectedMaterial) {
      return {
        status: "no_match",
        requested: true,
        category,
        categoryLabel: customerMaterialCategoryLabel(category),
        perUnitAmount,
        matchCount: 0,
        material: null,
        question: "这个特定品类暂时没有可发送的独立分册，我先不乱发，转人工确认。",
      };
    }
    return matchedMaterialSelection(category, perUnitAmount, selectedMaterial, {
      alternateRequested,
      availableVariantCount: categoryMaterials.length,
    });
  }
  if (!perUnitAmount) {
    return {
      status: "missing_budget",
      requested: true,
      category,
      categoryLabel: customerMaterialCategoryLabel(category),
      matchCount: 0,
      material: null,
      question: `收到，是${customerMaterialCategoryLabel(category)}。单份预算大概多少元？我按预算档只发一份。`,
    };
  }
  const matches = CUSTOMER_SELECTION_MATERIALS.filter((candidate) => (
    candidate.category === category
    && (candidate.minimumExclusive === null || perUnitAmount > candidate.minimumExclusive)
    && (candidate.maximumInclusive === null || perUnitAmount <= candidate.maximumInclusive)
  ));
  if (matches.length !== 1) {
    return {
      status: "no_match",
      requested: true,
      category,
      categoryLabel: customerMaterialCategoryLabel(category),
      perUnitAmount,
      matchCount: matches.length,
      material: null,
      question: `这类客户的 ${formatAmount(perUnitAmount)} 元档暂时没有唯一匹配资料，我先不乱发，转人工确认一份合适方案。`,
    };
  }
  return matchedMaterialSelection(category, perUnitAmount, matches[0]);
}

function matchedMaterialSelection(category, perUnitAmount, selectedMaterial, details = {}) {
  return {
    status: "matched",
    requested: true,
    category,
    categoryLabel: customerMaterialCategoryLabel(category),
    perUnitAmount,
    matchCount: 1,
    sendCount: 1,
    material: { ...selectedMaterial },
    ...details,
    customerNotice: "资料页内标注的是对应款式的销售单价，您选中后我可以直接按页面价格报价。",
  };
}

function chooseSpecificCategoryMaterial(materials, text, previousSelection, alternateRequested) {
  const ordered = [...materials].sort((left, right) => (
    Number(left.variantPriority || 99) - Number(right.variantPriority || 99)
    || String(left.id).localeCompare(String(right.id))
  ));
  if (!ordered.length) return null;
  const explicitPriority = requestedMaterialVariantPriority(text);
  if (explicitPriority) {
    return ordered.find((candidate) => Number(candidate.variantPriority) === explicitPriority) || ordered[0];
  }
  const previousIndex = previousSelection?.material?.id
    ? ordered.findIndex((candidate) => candidate.id === previousSelection.material.id)
    : -1;
  if (alternateRequested && previousIndex >= 0 && ordered.length > 1) {
    return ordered[(previousIndex + 1) % ordered.length];
  }
  if (previousIndex >= 0) return ordered[previousIndex];
  return ordered[0];
}

function requestedMaterialVariantPriority(text) {
  const value = String(text || "");
  if (/\bpdf\b|PDF分册|第一册|第1册|第一份/i.test(value)) return 1;
  if (/\bpptx?\b|PPT分册|第二册|第2册|第二份/i.test(value)) return 2;
  return null;
}

function buildCustomerSelectionMaterialReply(selection) {
  if (!selection?.requested || selection.status === "not_requested") return "";
  if (selection.status !== "matched") return String(selection.question || "").trim();
  const budgetText = selection.perUnitAmount ? `、单份 ${formatAmount(selection.perUnitAmount)} 元` : "";
  const actionText = selection.alternateRequested ? "这次换发" : "先发";
  return `可以，我按${selection.categoryLabel}${budgetText}，${actionText}《${selection.material.title}》这一份给您挑。${selection.customerNotice}`;
}

function selectCustomerSelectionPages(input = {}) {
  const text = String(input.text || "");
  const previousSelection = normalizePreviousMaterialSelection(input.previousSelection || input.customerSelectionMaterialContext);
  const requested = input.requested === true
    || customerRequestedPageRecommendations(text)
    || Boolean(previousSelection && /推荐|挑|选|哪个好|哪款/.test(text));
  if (!requested) return { status: "not_requested", requested: false, pages: [], sendCount: 0 };

  const explicitCategory = classifyCustomerMaterialCategory(text);
  const currentSelection = selectCustomerSelectionMaterial({
    text,
    requested: true,
    budget: input.budget || {},
    salesContext: input.salesContext || {},
    customerCategory: input.customerCategory,
    perUnitAmount: input.perUnitAmount,
    previousSelection,
  });
  const selection = currentSelection.status === "matched"
    ? currentSelection
    : !explicitCategory && previousSelection
      ? previousSelection
      : currentSelection;
  if (selection.status !== "matched" || !selection.material) {
    return {
      status: selection.status || "missing_material",
      requested: true,
      pages: [],
      sendCount: 0,
      question: selection.question || "我先确认客户类别和单份预算，再从对应图册里挑具体款式截图给您。",
      materialSelection: selection,
    };
  }

  let candidates = (Array.isArray(CUSTOMER_SELECTION_PAGE_INDEX.pages) ? CUSTOMER_SELECTION_PAGE_INDEX.pages : [])
    .filter((page) => page?.materialId === selection.material.id && page?.eligible !== false);
  if (!candidates.length) {
    return {
      status: "page_index_unavailable",
      requested: true,
      pages: [],
      sendCount: 0,
      materialSelection: selection,
      material: { ...selection.material },
      question: `我已经定位到《${selection.material.title}》，但单页截图库暂时不可用，我先转人工从这一本里挑页，避免发错款式。`,
    };
  }
  if (selection.material.specificCategory && selection.perUnitAmount) {
    const withinBudget = candidates.filter((page) => (
      positiveAmount(page?.listedPriceCny) && Number(page.listedPriceCny) <= selection.perUnitAmount
    ));
    if (!withinBudget.length) {
      const minimumPrice = Math.min(...candidates.map((page) => positiveAmount(page?.listedPriceCny)).filter(Boolean));
      return {
        status: "no_page_within_budget",
        requested: true,
        pages: [],
        sendCount: 0,
        materialSelection: selection,
        material: { ...selection.material },
        question: `《${selection.material.title}》当前最低页面销售价是 ${formatAmount(minimumPrice)} 元/份，高于 ${formatAmount(selection.perUnitAmount)} 元预算。我先不推荐超预算款，您看是否调整预算？`,
      };
    }
    candidates = withinBudget;
  }

  const query = [
    text,
    input.salesContext?.usageScene,
    input.salesContext?.stylePreference,
  ].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  const requestedCount = requestedPageCount(text);
  const ranked = candidates
    .map((page) => scoreCustomerSelectionPage(page, query, selection.material.category))
    .sort((left, right) => right.score - left.score || left.pageNumber - right.pageNumber);
  const pages = chooseDiversePages(ranked, requestedCount).map((page) => ({
    materialId: page.materialId,
    pageNumber: page.pageNumber,
    imageStorageRelativePath: page.imageStorageRelativePath,
    imageSha256: page.imageSha256,
    productHints: Array.isArray(page.productHints) ? page.productHints.slice(0, 8) : [],
    listedPriceCny: extractCustomerSelectionPagePrice(page),
    priceSource: "ppt_page_marked_price",
    matchedTerms: page.matchedTerms,
    score: page.score,
  }));
  const matchedTerms = [...new Set(pages.flatMap((page) => page.matchedTerms || []))].slice(0, 4);
  return {
    status: pages.length ? "matched" : "page_index_unavailable",
    requested: true,
    sendCount: pages.length,
    pageCount: pages.length,
    category: selection.category,
    categoryLabel: selection.categoryLabel,
    perUnitAmount: selection.perUnitAmount,
    materialSelection: selection,
    material: { ...selection.material },
    pages,
    matchedTerms,
    recommendationBasis: matchedTerms.length ? "customer_preference_match" : "category_default_diverse",
    customerNotice: "图片里标注的金额就是该款销售单价，您选中后我可以直接按页面价格报价。",
  };
}

function validateCustomerSelectionPageProofs(input = {}) {
  const sourceImagePaths = Array.isArray(input.sourceImagePaths) ? input.sourceImagePaths.map(String) : [];
  const proofs = Array.isArray(input.proofs) ? input.proofs : [];
  if (!sourceImagePaths.length || sourceImagePaths.length > 3 || proofs.length !== sourceImagePaths.length) {
    return { ok: false, reason: "customer selection page proof count is invalid" };
  }
  for (let index = 0; index < sourceImagePaths.length; index += 1) {
    const proof = proofs[index] || {};
    const record = (CUSTOMER_SELECTION_PAGE_INDEX.pages || []).find((page) => (
      page.materialId === proof.materialId
      && Number(page.pageNumber) === Number(proof.pageNumber)
      && String(page.imageSha256 || "").toLowerCase() === String(proof.imageSha256 || "").toLowerCase()
    ));
    if (!record) return { ok: false, reason: "customer selection page is not registered in the approved index" };
    const sourcePath = normalizePagePath(sourceImagePaths[index]);
    const expectedSuffix = normalizePagePath(record.imageStorageRelativePath);
    if (!sourcePath || !expectedSuffix || !(sourcePath === expectedSuffix || sourcePath.endsWith(`/${expectedSuffix}`))) {
      return { ok: false, reason: "customer selection page source path does not match the approved index" };
    }
  }
  return { ok: true, reason: "approved customer selection pages matched", count: sourceImagePaths.length };
}

function normalizePagePath(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
}

function buildCustomerSelectionPageReply(recommendation) {
  if (!recommendation?.requested || recommendation.status === "not_requested") return "";
  if (recommendation.status !== "matched") return String(recommendation.question || "").trim();
  const count = Number(recommendation.pageCount || recommendation.pages?.length || 0);
  const basis = recommendation.matchedTerms?.length
    ? `按您提到的“${recommendation.matchedTerms.join("、")}”`
    : "按实用性、接受度和款式差异";
  return `可以，我从刚才的《${recommendation.material.title}》里${basis}挑了 ${count} 页，直接截成 ${count} 张图给您看，您先看更喜欢哪一款。${recommendation.customerNotice}`;
}

function customerRequestedSelectionPageQuote(value) {
  const text = String(value || "");
  return PAGE_QUOTE_PATTERN.test(text)
    || PAGE_PRICE_NEGOTIATION_PATTERN.test(text)
    || PAGE_INTERNAL_COST_PATTERN.test(text);
}

function customerRequestedSelectionPageReplacement(value) {
  const text = String(value || "").trim();
  if (!/(?:换掉|更换|替换|换成|改成|不要|去掉|拿掉)/.test(text)) return false;
  const target = String(text.match(/(?:换成|改成|替换成)\s*([^，。？！,;；]{1,24})/)?.[1] || "").trim();
  const targetIsProduct = Boolean(target && DIRECT_PRODUCT_TERMS.some((term) => target.includes(term)));
  const targetIsAttribute = /(?:红|橙|黄|绿|蓝|紫|黑|白|金|银|灰|粉|棕|咖|透明|深色|浅色|薰衣草|玫瑰|茉莉|香型|味道|气味|大号|小号|大一点|小一点|长|短|圆|方|高档|简约|可爱|商务|logo|LOGO|包装|礼盒|丝带|文案|图案|颜色|尺寸|规格|\d+(?:\.\d+)?\s*(?:g|kg|ml|毫升|克|元|份|套|盒|个))/.test(target);
  const categoryChangeText = text.replace(/商品库/g, "");
  const explicitCategoryChange = /(?:品类|商品|单品|礼品).{0,10}(?:换掉|更换|替换|换成|改成|不要|去掉|拿掉)|(?:换掉|更换|替换|换成|改成|不要|去掉|拿掉).{0,10}(?:品类|商品|单品|礼品)/.test(categoryChangeText);
  const directProductRemoval = DIRECT_PRODUCT_TERMS.some((term) => {
    const index = text.indexOf(term);
    if (index < 0) return false;
    const nearby = text.slice(Math.max(0, index - 4), index + term.length + 10);
    return /(?:换掉|更换|替换|不要|去掉|拿掉)/.test(nearby);
  });
  if (PAGE_ATTRIBUTE_CHANGE_PATTERN.test(text) && !targetIsProduct && !explicitCategoryChange && !directProductRemoval) {
    return false;
  }
  if (targetIsAttribute && !targetIsProduct && !explicitCategoryChange && !directProductRemoval) return false;
  if (explicitCategoryChange || directProductRemoval || targetIsProduct || PAGE_REPLACEMENT_PATTERN.test(text)) return true;
  if (!target) return false;
  return !targetIsAttribute;
}

function extractCustomerSelectionPagePrice(value) {
  const page = value && typeof value === "object" ? value : null;
  const text = String(page?.text ?? value ?? "").replace(/\s+/g, " ").trim();
  const indexedAmount = positiveAmount(page?.listedPriceCny);
  const patterns = [
    /(?:礼盒售价|产品价格|礼盒.{0,5}售价|售价)\s*[：:]\s*(?:活动款\s*)?(\d+(?:\.\d+)?)(?=\s*(?:元|礼盒尺寸|包装尺寸|产品尺寸|礼盒清单|礼品清单|礼\s*品\s*清单|礼\s*盒|$))/i,
    /采购价.{0,240}?(\d+(?:\.\d+)?)\s*元/i,
    /[¥￥]\s*(\d+(?:\.\d+)?)\s*元?/i,
    /(\d+(?:\.\d+)?)\s*元(?=\s*(?:型号编码|礼盒尺寸|包装尺寸|产品尺寸|$))/i,
    /product\s*price\s*(\d+(?:\.\d+)?)\s*产品价格/i,
  ];
  let amount = indexedAmount;
  if (!amount && text) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      amount = positiveAmount(match[1]);
      if (amount) break;
    }
  }
  if (!amount) return null;
  const material = page?.materialId
    ? CUSTOMER_SELECTION_MATERIALS.find((item) => item.id === page.materialId)
    : null;
  if (material?.maximumInclusive && amount > material.maximumInclusive * 2) return null;
  if (material?.minimumExclusive && amount < material.minimumExclusive / 2) return null;
  if (material?.maximumListedPriceCny && amount > material.maximumListedPriceCny * 2) return null;
  if (material?.minimumListedPriceCny && amount < material.minimumListedPriceCny / 2) return null;
  return Math.round(amount * 100) / 100;
}

function resolveCustomerSelectionPageQuote(input = {}) {
  const text = String(input.text || "").trim();
  const context = normalizePreviousPageRecommendation(
    input.previousPageRecommendation || input.customerSelectionPageContext,
  );
  const quantityInCurrentMessage = extractQuoteQuantity(text, null);
  const replacementRequested = customerRequestedSelectionPageReplacement(text);
  const requested = input.requested === true
    || customerRequestedSelectionPageQuote(text)
    || Boolean(context && replacementRequested)
    || Boolean(context?.pages?.length && quantityInCurrentMessage);
  if (!requested) return { status: "not_requested", requested: false, pages: [], quantity: null, totalAmount: null };
  if (!context) {
    return {
      status: "missing_page_context",
      requested: true,
      pages: [],
      quantity: extractQuoteQuantity(text, input.quantity ?? input.budget?.quantity),
      totalAmount: null,
      question: "您问的是哪一本资料、哪一页或刚才发的第几个款式？您告诉我后，我直接按PPT页面标价报价。",
    };
  }

  const explicitPageNumbers = parseExplicitPageNumbers(text);
  const explicitPageNumber = explicitPageNumbers[0] || null;
  let ordinals = explicitPageNumbers.length ? [] : parseRecommendationOrdinals(text);
  if (!explicitPageNumbers.length && !ordinals.length && /前(?:两|2)(?:个|款|张)/.test(text)) ordinals = [1, 2];
  if (!explicitPageNumbers.length && !ordinals.length && /后(?:两|2)(?:个|款|张)/.test(text) && context.pages.length >= 2) {
    ordinals = [context.pages.length - 1, context.pages.length];
  }
  const ordinal = ordinals[0] || null;
  const deicticCountToken = text.match(/这\s*([两三23])\s*(?:个|款|张)/)?.[1];
  const deicticCount = deicticCountToken === "两" ? 2 : deicticCountToken === "三" ? 3 : Number(deicticCountToken || 0);
  if (!explicitPageNumbers.length && !ordinals.length && deicticCount && deicticCount !== context.pages.length) {
    return {
      status: "ambiguous_page",
      requested: true,
      material: context.material,
      pages: [],
      quantity: extractQuoteQuantity(text, input.quantity ?? input.budget?.quantity),
      totalAmount: null,
      question: `刚才一共发了 ${context.pages.length} 款，您说的“这${deicticCount}款”还不能唯一定位。请直接说第几个，我按对应PPT页面报价。`,
    };
  }
  const quoteAll = /这(?:几|两|三)(?:个|款|张)|分别|都(?:是)?多少钱|各(?:是)?多少|(?:各|都要)\s*(?:\d|[零〇一二两三四五六七八九十百千万])|全部.*(?:价格|报价)/.test(text);
  let pages = [];
  let selectionLabel = null;
  let missingExplicitPageNumber = null;
  let missingOrdinal = null;
  if (explicitPageNumbers.length) {
    const indexedPages = explicitPageNumbers.map((pageNumber) => ({
      pageNumber,
      page: findIndexedSelectionPage(context.material?.id, pageNumber),
    }));
    missingExplicitPageNumber = indexedPages.find((item) => !item.page)?.pageNumber || null;
    if (!missingExplicitPageNumber) {
      pages = indexedPages.map((item) => ({
        ...item.page,
        selectionLabel: `图册第${item.pageNumber}页`,
      }));
      if (pages.length === 1) selectionLabel = pages[0].selectionLabel;
    }
  } else if (ordinals.length) {
    missingOrdinal = ordinals.find((item) => item > context.pages.length) || null;
    if (!missingOrdinal) {
      pages = ordinals.map((item) => ({
        ...context.pages[item - 1],
        recommendationOrdinal: item,
        selectionLabel: `第${item}个`,
      }));
      if (pages.length === 1) selectionLabel = pages[0].selectionLabel;
    }
  } else if (quoteAll) {
    pages = context.pages.slice(0, 3).map((page, index) => ({
      ...page,
      recommendationOrdinal: index + 1,
      selectionLabel: `第${index + 1}个`,
    }));
  } else if (context.pages.length === 1) {
    pages = [{ ...context.pages[0], recommendationOrdinal: 1, selectionLabel: "这款" }];
    selectionLabel = "这款";
  } else if (/这(?:个|款|一款|张)|这个礼盒|这套/.test(text)) {
    return {
      status: "ambiguous_page",
      requested: true,
      material: context.material,
      pages: [],
      quantity: extractQuoteQuantity(text, input.quantity ?? input.budget?.quantity),
      totalAmount: null,
      question: `刚才一共发了 ${context.pages.length} 款，您说的是第1个、第2个还是第3个？确认后我直接按对应页面标价报价。`,
    };
  }

  if (!pages.length) {
    const detail = missingExplicitPageNumber || explicitPageNumber
      ? `刚才这本资料里没有定位到第${missingExplicitPageNumber || explicitPageNumber}页`
      : missingOrdinal || ordinal
        ? `刚才只发了 ${context.pages.length} 款，没有第${missingOrdinal || ordinal}个`
        : `刚才发了 ${context.pages.length} 款`;
    return {
      status: explicitPageNumbers.length || ordinals.length ? "page_not_found" : "ambiguous_page",
      requested: true,
      material: context.material,
      pages: [],
      quantity: extractQuoteQuantity(text, input.quantity ?? input.budget?.quantity),
      totalAmount: null,
      question: `${detail}。您告诉我是第几个，或直接说图册页码，我马上按页内标价报价。`,
    };
  }

  const pricedPages = pages.map((page) => hydrateSelectionPagePrice(page));
  const unavailable = pricedPages.find((page) => !positiveAmount(page.listedPriceCny));
  const quantityRange = extractQuoteQuantityRange(text);
  const quantityByOrdinal = extractRecommendationQuantities(text);
  const defaultQuantity = quantityRange
    ? null
    : extractQuoteQuantity(text, input.quantity ?? input.budget?.quantity);
  const quantityApproximate = quoteQuantityIsApproximate(text);
  const quotedPages = pricedPages.map((page) => {
    const quantity = positiveAmount(quantityByOrdinal.get(page.recommendationOrdinal)) || defaultQuantity;
    return {
      ...page,
      quantity,
      quantityApproximate: Boolean(quantity && quantityApproximate),
      totalAmount: quantity ? Math.round(page.listedPriceCny * quantity * 100) / 100 : null,
    };
  });
  const quantities = [...new Set(quotedPages.map((page) => page.quantity).filter(Boolean))];
  const quantity = quantities.length === 1 ? quantities[0] : null;
  if (unavailable) {
    return {
      status: "price_unavailable",
      requested: true,
      material: context.material,
      pages: quotedPages,
      quantity,
      totalAmount: null,
      selectionLabel,
      question: `我已定位到《${context.material?.title || "刚才的资料"}》第${unavailable.pageNumber}页，但当前没有可靠识别出页面标价。为避免报错，我先按原页核对价格。`,
    };
  }

  if (replacementRequested) {
    const page = quotedPages.length === 1 ? quotedPages[0] : null;
    return {
      status: "replacement_requires_requote",
      requested: true,
      material: context.material,
      pages: quotedPages,
      page,
      quantity,
      baseUnitPrice: page?.listedPriceCny || null,
      totalAmount: null,
      selectionLabel,
      priceSource: "ppt_page_marked_price",
      catalogPriceRole: "internal_cost_only",
      pricingPolicy: "replacement_requote_required",
      question: "",
    };
  }

  if (PAGE_INTERNAL_COST_PATTERN.test(text)) {
    const page = quotedPages.length === 1 ? quotedPages[0] : null;
    return {
      status: "internal_cost_price_restricted",
      requested: true,
      material: context.material,
      pages: quotedPages,
      page,
      quantity,
      baseUnitPrice: page?.listedPriceCny || null,
      totalAmount: null,
      selectionLabel,
      priceSource: "ppt_page_marked_price",
      catalogPriceRole: "internal_cost_only",
    };
  }

  if (PAGE_PRICE_NEGOTIATION_PATTERN.test(text)) {
    const page = quotedPages.length === 1 ? quotedPages[0] : null;
    return {
      status: "price_negotiation_requires_approval",
      requested: true,
      material: context.material,
      pages: quotedPages,
      page,
      quantity,
      baseUnitPrice: page?.listedPriceCny || null,
      requestedUnitPrice: extractCustomerCounterofferAmount(text),
      totalAmount: null,
      selectionLabel,
      priceSource: "ppt_page_marked_price",
    };
  }

  if (quantityRange) {
    const rangedPages = quotedPages.map((page) => ({
      ...page,
      minimumQuantity: quantityRange.minimum,
      maximumQuantity: quantityRange.maximum,
      minimumTotalAmount: Math.round(page.listedPriceCny * quantityRange.minimum * 100) / 100,
      maximumTotalAmount: Math.round(page.listedPriceCny * quantityRange.maximum * 100) / 100,
    }));
    if (rangedPages.length > 1) {
      return {
        status: "matched_multiple",
        requested: true,
        material: context.material,
        pages: rangedPages,
        quantity: null,
        quantityRange,
        totalAmount: null,
        priceSource: "ppt_page_marked_price",
      };
    }
    const page = rangedPages[0];
    return {
      status: "matched_quantity_range",
      requested: true,
      material: context.material,
      pages: rangedPages,
      page,
      unitPrice: page.listedPriceCny,
      minimumQuantity: page.minimumQuantity,
      maximumQuantity: page.maximumQuantity,
      minimumTotalAmount: page.minimumTotalAmount,
      maximumTotalAmount: page.maximumTotalAmount,
      totalAmount: null,
      selectionLabel,
      priceSource: "ppt_page_marked_price",
    };
  }

  if (quotedPages.length > 1) {
    return {
      status: "matched_multiple",
      requested: true,
      material: context.material,
      pages: quotedPages,
      quantity,
      totalAmount: null,
      priceSource: "ppt_page_marked_price",
    };
  }
  const page = quotedPages[0];
  return {
    status: "matched",
    requested: true,
    material: context.material,
    pages: pricedPages,
    page,
    quantity: page.quantity,
    quantityApproximate: page.quantityApproximate,
    unitPrice: page.listedPriceCny,
    totalAmount: page.totalAmount,
    selectionLabel,
    priceSource: "ppt_page_marked_price",
  };
}

function buildCustomerSelectionPageQuoteReply(quote) {
  if (!quote?.requested || quote.status === "not_requested") return "";
  if (quote.status === "replacement_requires_requote") {
    const pageLabel = quote.selectionLabel && quote.page
      ? `${quote.selectionLabel}对应图册第${quote.page.pageNumber}页`
      : quote.page
        ? `图册第${quote.page.pageNumber}页`
        : "您选的款式";
    const basePrice = quote.baseUnitPrice
      ? `，原页销售价是 ${formatAmount(quote.baseUnitPrice)} 元/份`
      : "";
    return `可以更换。${pageLabel}${basePrice}；更换其中品类后原价不再直接沿用，需要按替换后的具体商品重新核算销售报价。请告诉我要换掉什么、换成哪一种具体商品或规格，我确认后给您新报价。`;
  }
  if (quote.status === "internal_cost_price_restricted") {
    const sellingPrice = quote.page
      ? `${quote.selectionLabel || "这款"}对应图册第${quote.page.pageNumber}页，PPT销售价是 ${formatAmount(quote.baseUnitPrice)} 元/份。`
      : `${quote.pages.map((page) => `${page.selectionLabel || `图册第${page.pageNumber}页`}销售价 ${formatAmount(page.listedPriceCny)} 元/份`).join("；")}。`;
    return `${sellingPrice}商品库金额只用于内部核算，不作为对客销售价，也不对外提供；对客报价以PPT页面标注的销售价为准。`;
  }
  if (quote.status === "price_negotiation_requires_approval") {
    const pageLabel = quote.page
      ? `${quote.selectionLabel || "这款"}对应图册第${quote.page.pageNumber}页`
      : "您选的款式";
    const basePrice = quote.baseUnitPrice
      ? `PPT销售价是 ${formatAmount(quote.baseUnitPrice)} 元/份`
      : "销售价以对应PPT页面标注为准";
    const counteroffer = quote.requestedUnitPrice
      ? `，您提出的 ${formatAmount(quote.requestedUnitPrice)} 元/份属于优惠申请`
      : "，您提出的优惠需要单独确认";
    return `${pageLabel}，${basePrice}${counteroffer}，我不能直接承诺改价，需要确认优惠权限后再回复您。`;
  }
  if (quote.status === "matched_quantity_range") {
    const pageLabel = quote.selectionLabel
      ? `${quote.selectionLabel}对应图册第${quote.page.pageNumber}页`
      : `图册第${quote.page.pageNumber}页`;
    return `${pageLabel}，PPT销售价 ${formatAmount(quote.unitPrice)} 元/份；按 ${formatAmount(quote.minimumQuantity)}-${formatAmount(quote.maximumQuantity)} 份计算，合计范围是 ${formatAmount(quote.minimumTotalAmount)}-${formatAmount(quote.maximumTotalAmount)} 元，最终按您确认的准确数量出合计。`;
  }
  if (quote.status === "matched_multiple") {
    const details = quote.pages.map((page, index) => (
      `${page.selectionLabel || `第${index + 1}个`}（图册第${page.pageNumber}页）${formatAmount(page.listedPriceCny)} 元/份${
        page.minimumQuantity
          ? `，${formatAmount(page.minimumQuantity)}-${formatAmount(page.maximumQuantity)} 份合计 ${formatAmount(page.minimumTotalAmount)}-${formatAmount(page.maximumTotalAmount)} 元`
          : page.quantity && page.totalAmount !== null
            ? `，${formatAmount(page.quantity)} 份合计 ${formatAmount(page.totalAmount)} 元`
            : ""
      }`
    )).join("；");
    const next = quote.pages.every((page) => page.totalAmount !== null || page.minimumTotalAmount !== undefined)
      ? "以上均按PPT页面销售价计算。"
      : "这些都是PPT页面标注的销售单价，您定下数量后，我再直接算合计。";
    return `${details}。${next}`;
  }
  if (quote.status !== "matched") return String(quote.question || "").trim();
  const pageLabel = quote.selectionLabel
    ? `${quote.selectionLabel}对应图册第${quote.page.pageNumber}页`
    : `图册第${quote.page.pageNumber}页`;
  const unitText = `${formatAmount(quote.unitPrice)} 元/份`;
  if (quote.quantity && quote.totalAmount !== null) {
    const quantityText = quote.quantityApproximate ? `按大约 ${formatAmount(quote.quantity)} 份暂估` : `${formatAmount(quote.quantity)} 份合计`;
    const ending = quote.quantityApproximate ? "，最终按确认数量出准确合计。" : "。";
    return `${pageLabel}，PPT页面标注销售价 ${unitText}；${quantityText} ${formatAmount(quote.totalAmount)} 元${ending}`;
  }
  return `${pageLabel}，PPT页面标注销售价 ${unitText}。您需要多少份？我可以直接帮您算合计。`;
}

function normalizePreviousPageRecommendation(value) {
  if (!value || value.status !== "matched" || !value.material?.id || !Array.isArray(value.pages) || !value.pages.length) return null;
  return {
    material: { ...value.material },
    pages: value.pages.slice(0, 3).map((page) => hydrateSelectionPagePrice(page)),
  };
}

function findIndexedSelectionPage(materialId, pageNumber) {
  const page = (CUSTOMER_SELECTION_PAGE_INDEX.pages || []).find((item) => (
    item?.materialId === materialId && Number(item?.pageNumber) === Number(pageNumber)
  ));
  return page ? hydrateSelectionPagePrice(page) : null;
}

function hydrateSelectionPagePrice(page = {}) {
  const indexed = findIndexedSelectionPageRecord(page.materialId, page.pageNumber);
  const listedPriceCny = positiveAmount(page.listedPriceCny)
    || extractCustomerSelectionPagePrice(indexed || page);
  return {
    ...page,
    listedPriceCny,
    priceSource: listedPriceCny ? "ppt_page_marked_price" : null,
  };
}

function findIndexedSelectionPageRecord(materialId, pageNumber) {
  return (CUSTOMER_SELECTION_PAGE_INDEX.pages || []).find((item) => (
    item?.materialId === materialId && Number(item?.pageNumber) === Number(pageNumber)
  )) || null;
}

function parseExplicitPageNumber(value) {
  return parseExplicitPageNumbers(value)[0] || null;
}

function parseExplicitPageNumbers(value) {
  const text = String(value || "");
  const values = [];
  for (const match of text.matchAll(/第?\s*(\d{1,4})\s*(?:和|、|,|，|及|与|跟)\s*第?\s*(\d{1,4})\s*页/g)) {
    for (const token of [match[1], match[2]]) {
      const pageNumber = Number(token || 0);
      if (Number.isInteger(pageNumber) && pageNumber > 0 && !values.includes(pageNumber)) values.push(pageNumber);
    }
  }
  for (const match of text.matchAll(/第?\s*(\d{1,4})\s*页/g)) {
    const pageNumber = Number(match[1] || 0);
    if (Number.isInteger(pageNumber) && pageNumber > 0 && !values.includes(pageNumber)) values.push(pageNumber);
  }
  return values;
}

function parseRecommendationOrdinal(value) {
  return parseRecommendationOrdinals(value)[0] || null;
}

function parseRecommendationOrdinals(value) {
  const text = String(value || "");
  const tokenValues = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
    "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  };
  const ordinals = [];
  for (const match of text.matchAll(/第\s*([一二两三四五六七八九123456789])\s*(?:(?:个|款|张)|(?=和|、|,|，|及|与|跟))/g)) {
    const ordinal = tokenValues[String(match[1] || "")];
    if (ordinal && !ordinals.includes(ordinal)) ordinals.push(ordinal);
  }
  if (ordinals.length) return ordinals;
  return [];
}

function extractQuoteQuantity(text, fallback) {
  const known = positiveInteger(fallback);
  if (known) return known;
  const normalized = String(text || "")
    .replace(/第\s*\d+\s*(?:个|款|张|页)/g, "")
    .replace(/第\s*[一二两三四五六七八九]\s*(?:个|款|张)/g, "")
    .replace(/(?:推荐|挑|选|发|给我挑|帮我挑|替我挑)\s*(?:\d+|[一二两三四五六七八九])\s*(?:个|款|页|张)/g, "");
  if (/(?:^|[^\d])[-−]\s*\d+(?:\.\d+)?\s*(?:万|千)?\s*(?:份|套|盒|个)/.test(normalized)) return null;
  const match = normalized.match(/(\d+(?:\.\d+)?\s*(?:万|千)?|[零〇一二两三四五六七八九十百千万]+)\s*(?:多|左右|上下)?\s*(?:份|套|盒|个)/);
  return parseQuoteQuantityToken(match?.[1]);
}

function extractRecommendationQuantities(text) {
  const quantities = new Map();
  const tokenValues = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
    "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  };
  const pattern = /第\s*([一二两三四五六七八九123456789])\s*(?:个|款|张)?\s*(?:要|做|订|定|拿)?\s*(\d+(?:\.\d+)?\s*(?:万|千)?|[零〇一二两三四五六七八九十百千万]+)\s*(?:多|左右|上下)?\s*(?:份|套|盒|个)/g;
  for (const match of String(text || "").matchAll(pattern)) {
    const ordinal = tokenValues[String(match[1] || "")];
    const quantity = parseQuoteQuantityToken(match[2]);
    if (ordinal && quantity) quantities.set(ordinal, quantity);
  }
  return quantities;
}

function extractQuoteQuantityRange(text) {
  const token = "(\\d+(?:\\.\\d+)?\\s*(?:万|千)?|[零〇一二两三四五六七八九十百千万]+)";
  const match = String(text || "").match(new RegExp(`${token}\\s*(?:-|—|–|~|～|到|至)\\s*${token}\\s*(?:份|套|盒|个)`));
  const first = parseQuoteQuantityToken(match?.[1]);
  const second = parseQuoteQuantityToken(match?.[2]);
  if (!first || !second || first === second) return null;
  return { minimum: Math.min(first, second), maximum: Math.max(first, second) };
}

function quoteQuantityIsApproximate(text) {
  return /大约|大概|差不多|约\s*(?:\d|[零〇一二两三四五六七八九十百千万])|(?:\d|[零〇一二两三四五六七八九十百千万])+(?:多|左右|上下)\s*(?:份|套|盒|个)?/.test(String(text || ""));
}

function extractCustomerCounterofferAmount(text) {
  const value = String(text || "");
  const patterns = [
    /(?:按|做到|给到|压到|希望|预算)?\s*(\d+(?:\.\d+)?)\s*元.{0,8}(?:能做|可以吗|行吗|能不能|能否|成交)/,
    /(?:能做|可以|能不能|能否).{0,8}(\d+(?:\.\d+)?)\s*元/,
  ];
  for (const pattern of patterns) {
    const amount = positiveAmount(value.match(pattern)?.[1]);
    if (amount) return amount;
  }
  return null;
}

function parseQuoteQuantityToken(value) {
  const token = String(value || "").trim();
  if (!token) return null;
  const numeric = token.match(/^(\d+(?:\.\d+)?)\s*(万|千)?$/);
  if (numeric) {
    const multiplier = numeric[2] === "万" ? 10000 : numeric[2] === "千" ? 1000 : 1;
    return positiveInteger(Number(numeric[1]) * multiplier);
  }
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let total = 0;
  let section = 0;
  let number = 0;
  for (const character of token) {
    if (Object.prototype.hasOwnProperty.call(digits, character)) {
      number = digits[character];
      continue;
    }
    const unit = units[character];
    if (!unit) return null;
    if (unit === 10000) {
      section += number;
      total += (section || 1) * unit;
      section = 0;
      number = 0;
      continue;
    }
    section += (number || 1) * unit;
    number = 0;
  }
  return positiveAmount(total + section + number);
}

function normalizePreviousMaterialSelection(value) {
  if (!value || value.status !== "matched" || !value.material?.id) return null;
  return {
    ...value,
    requested: true,
    matchCount: 1,
    sendCount: 1,
    material: { ...value.material },
  };
}

function requestedPageCount(text) {
  const value = String(text || "");
  if (/一(?:个|款|页|张)|1\s*(?:个|款|页|张)|单页/.test(value)) return 1;
  if (/两(?:个|款|页|张)|2\s*(?:个|款|页|张)/.test(value)) return 2;
  return 3;
}

function scoreCustomerSelectionPage(page, query, category) {
  const haystack = `${String(page?.text || "")} ${(page?.productHints || []).join(" ")}`;
  let score = Math.min(6, (page?.productHints || []).length * 0.4);
  const matchedTerms = [];
  const directTerms = DIRECT_PRODUCT_TERMS.filter((term) => query.includes(term));
  for (const term of directTerms) {
    if (!haystack.includes(term)) continue;
    score += 80 + Math.min(20, term.length * 2);
    matchedTerms.push(term);
  }
  for (const group of PAGE_SIGNAL_GROUPS) {
    if (!group.pattern.test(query)) continue;
    let groupMatches = 0;
    for (const term of group.pageTerms) {
      if (!haystack.includes(term)) continue;
      groupMatches += 1;
      if (!matchedTerms.includes(group.label)) matchedTerms.push(group.label);
    }
    score += Math.min(36, groupMatches * 9);
  }
  const defaults = category === "beauty"
    ? ["护手霜", "香薰", "按摩梳", "眼罩", "抓夹", "毛巾"]
    : category === "small_budget"
      ? ["小风扇", "湿巾", "杯", "毛巾", "香薰", "笔记本"]
      : category === "yoga"
        ? ["瑜伽袜", "运动毛巾", "拉力器", "拉力带", "弹力带", "按摩球", "握力器", "水杯"]
        : category === "teachers_day"
          ? ["书签", "咖啡杯", "护手霜", "帆布袋", "养生锤", "笔记本", "花茶"]
          : category === "business_gift"
            ? ["U型枕", "保温杯", "笔记本", "手机支架", "咖啡", "雨伞", "蓝牙音箱"]
            : ["保温杯", "雨伞", "笔记本", "咖啡", "茶", "充电宝", "小风扇"];
  score += defaults.reduce((total, term) => total + (haystack.includes(term) ? 3 : 0), 0);
  return {
    ...page,
    score: Math.round(score * 100) / 100,
    matchedTerms: [...new Set(matchedTerms)].slice(0, 4),
    diversityKey: pageDiversityKey(page, haystack),
  };
}

function pageDiversityKey(page, haystack) {
  const product = DIRECT_PRODUCT_TERMS.find((term) => haystack.includes(term));
  if (product) return product;
  return String(page?.productHints?.[0] || `page-${page?.pageNumber || 0}`).slice(0, 12);
}

function chooseDiversePages(ranked, maximum) {
  const selected = [];
  const usedKeys = new Set();
  for (const page of ranked) {
    if (selected.length >= maximum) break;
    if (usedKeys.has(page.diversityKey) && ranked.length > maximum) continue;
    selected.push(page);
    usedKeys.add(page.diversityKey);
  }
  for (const page of ranked) {
    if (selected.length >= maximum) break;
    if (selected.some((item) => item.pageNumber === page.pageNumber)) continue;
    selected.push(page);
  }
  return selected;
}

function positiveAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function positiveInteger(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function formatAmount(value) {
  const amount = Number(value);
  return Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 100) / 100);
}

module.exports = {
  CUSTOMER_SELECTION_MATERIALS,
  CUSTOMER_SELECTION_PAGE_INDEX,
  buildCustomerSelectionMaterialReply,
  buildCustomerSelectionPageReply,
  buildCustomerSelectionPageQuoteReply,
  classifyCustomerMaterialCategory,
  customerMaterialCategoryLabel,
  customerRequestedPageRecommendations,
  customerRequestedSelectionPageQuote,
  customerRequestedSelectionPageReplacement,
  customerRequestedSelectionMaterial,
  normalizeCustomerMaterialCategory,
  extractCustomerSelectionPagePrice,
  resolveCustomerSelectionPageQuote,
  selectCustomerSelectionMaterial,
  selectCustomerSelectionPages,
  validateCustomerSelectionPageProofs,
};
