export type DesignJob = {
  id: string;
  requestId: string;
  externalJobId?: string | null;
  wechatAccountId?: string | null;
  customerId?: string | null;
  conversationId?: string | null;
  status: string;
  scene?: string;
  isHighValue: boolean;
  outputCount: number;
  retryCount?: number;
  revisionCount?: number;
  revisionPolicy?: {
    action?: string;
    reason?: string;
    chargeRequired?: boolean;
    manualReviewRequired?: boolean;
    submitAllowed?: boolean;
  };
  errorMessage?: string;
  budget: {
    mode?: string;
    totalAmount?: number;
    perUnitAmount?: number;
    quantity?: number;
  };
  images?: Array<{
    id: string;
    imageId: string;
    position: number;
    localPath?: string;
    downloadUrl?: string;
    fingerprint?: string;
    selected?: boolean;
  }>;
  assets?: DesignAsset[];
  revisions?: DesignRevision[];
  customer?: { name: string };
  conversation?: { title: string };
  updatedAt?: string;
  readiness?: {
    ok: boolean;
    missing?: string[];
  };
};

export type DesignRevision = {
  id: string;
  designJobId: string;
  selectedImageId?: string | null;
  revisionNumber: number;
  instruction: string;
  sourceText?: string;
  policyAction: string;
  status: string;
  chargeRequired?: boolean;
  manualReviewRequired?: boolean;
  externalJobId?: string | null;
  resultImageIds?: string[];
  createdAt: string;
  updatedAt: string;
};

export type DesignAsset = {
  id: string;
  ownerType: string;
  ownerId: string;
  role?: string;
  fileName: string;
  mimeType: string;
  localPath: string;
  sizeBytes?: number;
  source: string;
  createdAt: string;
};

export type Sku = {
  id: string;
  skuCode: string;
  name: string;
  type: "gift_box" | "item" | "accessory";
  category?: string;
  salePrice: number;
  costPrice: number;
  stock: number;
  sceneTags?: string[];
  dimensions?: Record<string, unknown>;
  weightGram?: number;
  material?: string;
  supplier?: string;
  leadTimeDays?: number;
  mainImagePath?: string;
  angleImages?: string[];
  matchingRules?: Record<string, unknown>;
  replacementSkuCodes?: string[];
  isActive?: boolean;
};

export type SkuPayload = Omit<Sku, "id">;

export type SkuChangeLog = {
  id: string;
  skuId?: string | null;
  skuCode: string;
  name?: string;
  action: string;
  source: string;
  operator: string;
  reason?: string;
  changedFields: Array<{ field: string; before: unknown; after: unknown }>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  createdAt: string;
};

export type SkuBatchUpdatePayload = {
  skuCodes: string[];
  patch: {
    costPrice?: number;
    salePrice?: number;
    stock?: number;
    supplier?: string;
    leadTimeDays?: number;
    sceneTags?: string[];
    isActive?: boolean;
  };
};

export type SkuCatalogIssue = {
  skuCode: string;
  name: string;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  field?: string;
  imageRole?: "main" | "angle";
  imageIndex?: number | null;
  path?: string;
};

export type SkuCatalogAudit = {
  total: number;
  readyCount: number;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  missingImageCount: number;
  imageIssueCount?: number;
  invalidImageCount?: number;
  missingAngleImageCount?: number;
  imageProblems?: SkuImageProblem[];
  lowStockCount: number;
  negativeMarginCount: number;
  duplicateSkuCodeCount?: number;
  duplicateNameCount?: number;
  unsafeSkuCodeCount?: number;
  typeIssueCount?: number;
  invalidReplacementCount?: number;
  invalidMatchingRuleCount?: number;
  leadTimeIssueCount?: number;
  specificationIssueCount?: number;
  availableGiftBoxCount?: number;
  availableItemCount?: number;
  availableAccessoryCount?: number;
  catalogStructureIssueCount?: number;
  availableSceneTagCount?: number;
  availableCategoryCount?: number;
  topSceneTags?: Array<{ name: string; count: number }>;
  topCategories?: Array<{ name: string; count: number }>;
  catalogCoverageIssueCount?: number;
  minGiftBoxPrice?: number;
  minItemPrice?: number;
  minBundleBudget?: number;
  availableGiftBoxStock?: number;
  availableItemStock?: number;
  basicBundleCapacity?: number;
  bundleCapacityBottleneck?: string;
  bundleCapacityBottleneckLabel?: string;
  bundleCapacityChecks?: Array<{ quantity: number; enough: boolean; shortage: number }>;
  bundleCapacityRiskCount?: number;
  bundleReadinessIssueCount?: number;
  bundleReadinessWarnings?: string[];
  repairQueueCount?: number;
  blockingRepairCount?: number;
  repairQueue?: SkuRepairQueueItem[];
  issues: SkuCatalogIssue[];
};

export type SkuImageProblem = {
  skuCode: string;
  name: string;
  code: string;
  message: string;
  field: string;
  imageRole: "main" | "angle";
  imageIndex: number | null;
  path: string;
  severity: "error" | "warning" | "info";
};

export type SkuRepairQueueItem = {
  skuCode: string;
  name: string;
  type?: string;
  severity: "error" | "warning" | "info";
  priority: number;
  blocking: boolean;
  issueCount: number;
  recommendedAction: string;
  missingFields: Array<{ field: string; label: string; action: string }>;
  issues: SkuCatalogIssue[];
};

export type SkuImportField = {
  field: string;
  label: string;
  required: boolean;
  example: string;
  description: string;
  aliases: string[];
};

export type SkuImportFieldMapping = SkuImportField & {
  sourceHeader: string;
  column: number | null;
  matched: boolean;
};

export type Agent = {
  id: string;
  key: string;
  name: string;
  scene: string;
  description: string;
  enabled: boolean;
  skills: Array<{
    id: string;
    name: string;
    description: string;
    enabled: boolean;
  }>;
  trainingSampleCount: number;
  averageTrainingScore: number;
};

export type ChatImport = {
  id: string;
  name: string;
  source: string;
  channel: string;
  messageCount: number;
  pairCount: number;
  warnings: string[];
  samples?: TrainingSample[];
  createdAt: string;
};

export type TrainingSample = {
  id: string;
  agentId?: string;
  agentKey: string;
  scene: string;
  customerText: string;
  idealReply: string;
  score: number;
  status: string;
  reviewer?: string;
  reviewNote?: string;
  reviewedAt?: string;
  sourceType?: string;
  sourceRouteId?: string;
  importId?: string;
  skillHints: string[];
  quality?: {
    level: "safe" | "review" | "risk" | "blocked";
    label: string;
    reason: string;
    recommendedAction?: string;
    trainable: boolean;
    flags: string[];
  };
  createdAt: string;
};

export type TrainingOverview = {
  totalSamples: number;
  readySamples: number;
  reviewSamples: number;
  rejectedSamples: number;
  correctionSamples: number;
  chatImportSamples: number;
  averageScore: number;
  suggestionCount: number;
  agentsWithSamples: number;
  qualitySummary?: {
    safeSamples: number;
    reviewQualitySamples: number;
    riskSamples: number;
    blockedSamples: number;
    trainableSamples: number;
    antiWrongReplySamples: number;
    lowScoreSamples: number;
    missingAnswerSamples: number;
    missingSkillHintSamples: number;
  };
  topCorrectionScenes: Array<{
    scene: string;
    agentKey: string;
    count: number;
    latestAt?: string;
  }>;
  byAgent: Array<{
    agentId?: string | null;
    agentKey: string;
    name: string;
    scene: string;
    sampleCount: number;
    readyCount: number;
    reviewCount: number;
    rejectedCount: number;
    correctionCount: number;
    chatImportCount: number;
    averageScore: number;
    suggestionCount: number;
    lastSampleAt?: string;
    topSkillHints: Array<{ name: string; count: number }>;
  }>;
  recommendations: string[];
};

export type SkillSuggestion = {
  suggestionKey: string;
  agentId?: string | null;
  agentKey: string;
  name: string;
  description: string;
  sampleCount: number;
  averageScore: number;
  confidence: number;
  sampleIds: string[];
  scenes: string[];
  evidence?: {
    question?: string;
    answer?: string;
  };
  existingSkillId?: string | null;
  action: "create" | "update";
  quality?: {
    level: "safe" | "review" | "risk";
    label: string;
    reason: string;
    needsReview: boolean;
    minSampleCount?: number;
    minConfidence?: number;
  };
};

export type ApplySkillSuggestionsResult = {
  suggested: number;
  selected?: number;
  applied?: number;
  filtered?: number;
  requiresReview?: number;
  blocked?: Array<Record<string, unknown>>;
  created: Array<Record<string, unknown>>;
  updated: Array<Record<string, unknown>>;
  skipped: Array<Record<string, unknown>>;
};

export type WechatAccount = {
  id: string;
  displayName: string;
  alias?: string;
  isActive: boolean;
};

export type Conversation = {
  id: string;
  title: string;
  channel: string;
  customerId: string;
  wechatAccountId: string;
  manualLocked?: boolean;
  customer?: { id: string; name: string };
  wechatAccount?: WechatAccount;
};

export type WechatWindowSnapshot = {
  id: string;
  source: string;
  isOnline: boolean;
  wechatAccountId?: string | null;
  accountDisplayName?: string;
  chatTitle?: string;
  activeChatTitle?: string;
  externalChatId?: string;
  recentCustomerId?: string;
  recentMessageText?: string;
  confidence?: number;
  diagnostic?: {
    ok?: boolean;
    status?: string;
    riskLevel?: string;
    reason?: string;
    activeConversationId?: string | null;
    activeCustomerId?: string | null;
    failedKeys?: string[];
  };
  capturedAt: string;
  createdAt: string;
  wechatAccount?: WechatAccount | null;
  activeConversation?: Conversation | null;
};

export type SendTask = {
  id: string;
  status: string;
  wechatAccountId: string;
  conversationId: string;
  payload: Record<string, unknown>;
  guardSnapshot?: {
    status?: string;
    reason?: string;
    queueBlockedAlertedBy?: string;
    queueBlockedAlertedAt?: string;
    queueBlockedAdvice?: {
      reason: string;
      severity: "info" | "warning" | "error";
      blockingTaskId?: string | null;
      message: string;
      recommendedAction: string;
    };
    blockedByManualLock?: boolean;
    blockedBy?: string;
    blockedAt?: string;
    failedKeys?: string[];
    checks?: Array<{
      key: string;
      label: string;
      expected?: string;
      actual?: string;
      passed: boolean;
    }>;
  };
  errorMessage?: string;
  createdAt: string;
  sentAt?: string;
  wechatAccount?: WechatAccount;
  conversation?: Conversation;
  attempts?: SendAttempt[];
  attemptCount?: number;
  latestAttempt?: SendAttempt | null;
};

export type SendAttempt = {
  id: string;
  sendTaskId: string;
  adapter: string;
  status: string;
  guardStatus?: string;
  windowSnapshotId?: string | null;
  payloadSummary?: {
    kind?: string;
    textLength?: number;
    imageCount?: number;
    hasText?: boolean;
    hasImages?: boolean;
  };
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  startedAt: string;
  completedAt?: string | null;
  createdAt: string;
};

export type SendAdapterInfo = {
  name: string;
  label: string;
  realSend: boolean;
  description: string;
  configuredName?: string;
  capabilities?: {
    text?: boolean;
    images?: boolean;
    quote?: boolean;
    requiresWindowGuard?: boolean;
    writesOutbox?: boolean;
  };
};

export type BridgeOutboxEntry = {
  fileName: string;
  taskId?: string;
  wechatAccountId?: string;
  conversationId?: string;
  payloadKind?: string;
  actionCount?: number;
  createdAt?: string;
  modifiedAt: string;
  ageSeconds: number;
  taskStatus?: string | null;
  attemptId?: string | null;
  ignoreReason?: string;
  errorMessage?: string;
  preview?: {
    protocolVersion?: string;
    outboxFileName?: string;
    attemptId?: string;
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    payloadKind?: string;
    actionCount?: number;
    textActionCount?: number;
    imageActionCount?: number;
    textLength?: number;
    windowSnapshotId?: string;
    guardStatus?: string;
    constraints?: Record<string, unknown>;
    createdAt?: string;
  };
};

export type BridgeOutboxResult = {
  pending: BridgeOutboxEntry[];
  ignored: BridgeOutboxEntry[];
};

export type BridgeInboxEntry = {
  fileName: string;
  taskId?: string;
  attemptId?: string;
  wechatAccountId?: string;
  conversationId?: string;
  status?: string;
  protocolVersion?: string;
  outboxFileName?: string;
  payloadKind?: string;
  actionCount?: number;
  createdAt?: string;
  modifiedAt?: string;
  ageSeconds?: number;
  hasAckToken?: boolean;
  errorMessage?: string;
  archivedPath?: string;
  result?: {
    taskId?: string;
    taskStatus?: string;
    attemptId?: string;
    attemptStatus?: string;
  };
};

export type BridgeInboxScanResult = {
  scanned: number;
  processed: BridgeInboxEntry[];
  failed: BridgeInboxEntry[];
};

export type WindowSnapshotInboxScanResult = {
  scanned: number;
  processed: Array<{
    fileName: string;
    modifiedAt: string;
    ageSeconds: number;
    snapshotCount: number;
    snapshots: Array<{
      id: string;
      source: string;
      isOnline: boolean;
      wechatAccountId?: string;
      recentCustomerId?: string;
      confidence?: number;
      capturedAt?: string;
      createdAt?: string;
      diagnostic?: WechatWindowSnapshot["diagnostic"];
    }>;
  }>;
  failed: Array<{
    fileName: string;
    modifiedAt: string;
    ageSeconds: number;
    errorMessage: string;
  }>;
};

export type BridgeWorkerStatus = {
  ok: boolean;
  status: string;
  ageSeconds?: number | null;
  modifiedAt?: string;
  mode?: string;
  ackTransport?: string;
  errorMessage?: string;
  message?: string;
  result?: {
    scanned?: number;
    processedCount?: number;
    skippedCount?: number;
    failedCount?: number;
  };
};

export type BridgeLockEntry = {
  fileName: string;
  accountId?: string;
  pid?: number;
  createdAt?: string;
  modifiedAt: string;
  ageSeconds: number;
  stale: boolean;
  errorMessage?: string;
};

export type BridgeStatusResult = {
  adapter: SendAdapterInfo;
  worker: BridgeWorkerStatus;
  outbox: {
    pendingCount: number;
    ignoredCount: number;
    pending: BridgeOutboxEntry[];
  };
  inbox: {
    pendingCount: number;
    pending: BridgeInboxEntry[];
  };
  locks: {
    activeCount: number;
    staleCount: number;
    active: BridgeLockEntry[];
  };
};

export type WindowObserverStatus = {
  ok: boolean;
  status: string;
  ageSeconds?: number | null;
  modifiedAt?: string;
  scan?: boolean;
  dryRun?: boolean;
  message?: string;
  errorMessage?: string;
  result?: {
    wroteSnapshot?: boolean;
    isOnline?: boolean;
    wechatAccountId?: string;
    confidence?: number;
    processName?: string;
    processId?: number | null;
    scanProcessed?: number | null;
    scanFailed?: number | null;
  } | null;
};

export type RouteEvaluation = {
  id: string;
  channel: string;
  text: string;
  agentKey: string;
  scene: string;
  sceneScore?: number;
  matchedKeywords?: string[];
  sceneScores?: Array<{
    scene: string;
    agentKey: string;
    score: number;
    matchedKeywords: string[];
  }>;
  sceneDecision?: {
    status: "clear" | "weak" | "ambiguous" | "unmatched" | string;
    reason: string;
    scoreGap: number;
    topScene?: {
      scene: string;
      agentKey: string;
      score: number;
      matchedKeywords: string[];
    } | null;
    secondaryScene?: {
      scene: string;
      agentKey: string;
      score: number;
      matchedKeywords: string[];
    } | null;
  } | null;
  sceneClarification?: {
    required?: boolean;
    type?: string;
    question?: string;
    options?: Array<{
      agentKey: string;
      scene: string;
      score?: number;
      label?: string;
      matchedKeywords?: string[];
    }>;
  } | null;
  clarificationResolution?: {
    type?: string;
    text?: string;
    agentKey?: string;
    scene?: string;
    label?: string;
    matchedKeywords?: string[];
    confidence?: string;
  } | null;
  sceneMemory?: {
    matched?: boolean;
    applied?: boolean;
    score?: number;
    sampleId?: string | null;
    sourceRouteId?: string | null;
    agentKey?: string;
    scene?: string;
    reason?: string;
    originalAgentKey?: string;
    originalScene?: string;
    originalScore?: number;
  } | null;
  sceneAudit?: {
    level?: "pass" | "review" | "manual" | string;
    label?: string;
    summary?: string;
    nextStep?: string;
    evidence?: string[];
    warnings?: string[];
  } | null;
  action: "auto_agent" | "collect_info" | "manual_review";
  confidence: number;
  isHighValue: boolean;
  budget?: {
    mode?: string;
    totalAmount?: number | null;
    perUnitAmount?: number | null;
    quantity?: number | null;
  } | null;
  missingFields: string[];
  riskFlags: string[];
  suggestedReply: string;
  appliedSkills?: Array<{
    id?: string;
    name: string;
    description?: string;
    confidence?: number;
    sampleCount?: number;
    version?: number;
  }>;
  knowledgeMatches?: Array<{
    id?: string;
    title: string;
    qualityScore?: number;
    score?: number;
    excerpt?: string;
    tags?: string[];
  }>;
  replyDraft?: {
    source?: string;
    style?: string;
    nextAction?: string;
    safetyChecks?: Array<{
      key: string;
      passed: boolean;
      label: string;
    }>;
  };
  correction?: {
    corrected?: boolean;
    reviewer?: string;
    note?: string;
    correctedAt?: string;
    before?: {
      agentKey?: string;
      scene?: string;
      action?: string;
      confidence?: number;
    };
  };
  createdAt: string;
  agent?: Agent | null;
};

export type InboundProcessResult = {
  message: {
    id: string;
    conversationId: string;
    direction: string;
    text?: string;
    createdAt: string;
  };
  route: RouteEvaluation;
  plan: {
    type: string;
    reason: string;
    shouldQueueReply?: boolean;
    shouldCreateDesignJob?: boolean;
    shouldNotifyHuman?: boolean;
    missingFields?: string[];
  };
  sendTask?: SendTask | null;
  designJob?: DesignJob | null;
  quote?: QuoteDraft | null;
  orderDraft?: OrderDraft | null;
  selection?: {
    ok?: boolean;
    action?: string;
    reason?: string;
    reviewRequired?: boolean;
    result?: {
      imageId?: string;
      source?: string;
      confidence?: string;
    };
  } | null;
  quoteAcceptance?: {
    ok: boolean;
    action: string;
    reason: string;
    hasIntent?: boolean;
    quotePatch?: {
      status?: string;
      paymentStatus?: string;
      customerNotes?: string;
      owner?: string;
    };
  } | null;
  notification?: NotificationItem | null;
  bundleRecommendation?: BundleRecommendation | null;
};

export type QuoteDraft = {
  id: string;
  designJobId: string;
  customerId: string;
  selectedImageId?: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  totalCost: number;
  profit: number;
  profitRate?: number;
  status: string;
  paymentStatus: string;
  sendTaskId?: string | null;
  customerNotes?: string;
  owner?: string;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; name: string };
  designJob?: DesignJob;
  selectedImage?: NonNullable<DesignJob["images"]>[number] | null;
  sendTask?: SendTask | null;
};

export type OrderDraft = {
  id: string;
  quoteDraftId: string;
  designJobId: string;
  customerId: string;
  conversationId: string;
  wechatAccountId: string;
  selectedImageId?: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  totalCost: number;
  profit: number;
  profitRate?: number;
  status: string;
  paymentStatus: string;
  customerNotes?: string;
  owner?: string;
  bundleSnapshot?: Record<string, unknown> | null;
  selectedImageSnapshot?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; name: string };
  quoteDraft?: QuoteDraft | null;
  designJob?: DesignJob | null;
  selectedImage?: NonNullable<DesignJob["images"]>[number] | null;
  confirmationSendTaskId?: string | null;
  confirmationSendTask?: SendTask | null;
  followupSendTaskId?: string | null;
  followupSendTask?: SendTask | null;
  followupSendTasks?: SendTask[];
  productionFollowupSendTaskId?: string | null;
  productionFollowupSendTask?: SendTask | null;
  deliveryFollowupSendTaskId?: string | null;
  deliveryFollowupSendTask?: SendTask | null;
};

export type QuotePreview = {
  quote: QuoteDraft;
  message: string;
  warnings: string[];
};

export type NotificationItem = {
  id: string;
  level: "info" | "warning" | "error" | string;
  title: string;
  body?: string;
  target?: Record<string, unknown>;
  readAt?: string | null;
  createdAt: string;
};

export type ReviewLog = {
  id: string;
  targetType: string;
  targetId: string;
  decision: string;
  reviewer: string;
  note?: string;
  beforeStatus?: string;
  afterStatus?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type ReviewCenter = {
  designJobs: DesignJob[];
  quoteDrafts: QuoteDraft[];
  logs: ReviewLog[];
};

export type DesignPlatformHealth = {
  ok: boolean;
  latencyMs: number;
  baseUrl: string;
  adapter?: string;
  data?: Record<string, unknown>;
  errorMessage?: string;
};

export type DesignPlatformReadiness = {
  ok: boolean;
  canSubmitFormalGeneration: boolean;
  adapter: string;
  baseUrl: string;
  latencyMs: number;
  checks: Array<{
    key: string;
    label: string;
    ok: boolean;
    severity: "info" | "warning" | "error";
    detail: string;
  }>;
  nextSteps: string[];
  config: {
    hasApiKey: boolean;
    hasAccessToken: boolean;
    hasCookie: boolean;
    hasDeviceId: boolean;
  };
  data?: Record<string, unknown>;
};

export type DesignPlatformConfigSummary = {
  adapter: string;
  baseUrl: string;
  hasApiKey: boolean;
  hasAccessToken: boolean;
  hasCookie: boolean;
  hasDeviceId: boolean;
  deviceIdSuffix?: string;
  runtimeConfigPath?: string;
};

export type DesignPlatformConfigResponse = {
  ok: boolean;
  config: DesignPlatformConfigSummary;
  readiness?: DesignPlatformReadiness;
};

export type DesignPlatformLoginResponse = DesignPlatformConfigResponse & {
  user?: {
    id?: string;
    email?: string;
  } | null;
};

export type DesignPlatformActivationResponse = DesignPlatformConfigResponse & {
  activation?: Record<string, unknown>;
};

export type DesignJobPreflightResult = {
  ok: boolean;
  adapter: string;
  baseUrl: string;
  designJobId: string;
  requestId: string;
  status: string;
  isHighValue: boolean;
  usableReferenceCount: number;
  unusableReferenceCount: number;
  checks: Array<{
    key: string;
    label: string;
    ok: boolean;
    severity: "info" | "warning" | "error";
    detail?: string;
  }>;
  health?: Record<string, unknown> | null;
};

export type BundleRecommendation = {
  status: string;
  items: Array<Record<string, unknown> & { type?: string; skuCode?: string }>;
  totals: {
    cost: number;
    salePrice: number;
    profit: number;
    profitRate: number;
  };
  warnings: string[];
};

export type SkuImportResult = {
  ok: boolean;
  importedCount: number;
  skippedCount: number;
  rows: SkuPayload[];
  errors: Array<{ line: number; message: string }>;
  fieldMapping?: SkuImportFieldMapping[];
  unmappedHeaders?: string[];
  missingRequiredFields?: SkuImportField[];
  audit?: SkuCatalogAudit;
  saved?: { count: number; results: Sku[] };
};

export type SkuImportTemplate = {
  fileName: string;
  mimeType: string;
  dataBase64: string;
  fields: SkuImportField[];
};

export type UploadAssetPayload = {
  ownerType: string;
  ownerId: string;
  role?: string;
  fileName: string;
  mimeType?: string;
  source?: string;
  base64?: string;
  text?: string;
  url?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:3200/api";

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `api ${response.status}`);
  }
  return response.json();
}

export async function getDesignJobs(): Promise<DesignJob[]> {
  try {
    const response = await fetch(`${API_BASE}/design-jobs`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return sampleDesignJobs;
  }
}

export async function getSkus(includeInactive = false): Promise<Sku[]> {
  try {
    const response = await fetch(`${API_BASE}/catalog/skus${includeInactive ? "?includeInactive=true" : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return sampleSkus;
  }
}

export async function getAssets(ownerType?: string, ownerId?: string): Promise<DesignAsset[]> {
  try {
    const params = new URLSearchParams();
    if (ownerType) params.set("ownerType", ownerType);
    if (ownerId) params.set("ownerId", ownerId);
    const query = params.toString();
    const response = await fetch(`${API_BASE}/assets${query ? `?${query}` : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return [];
  }
}

export async function uploadAsset(payload: UploadAssetPayload): Promise<DesignAsset> {
  return postJson<DesignAsset>("/assets/upload", payload);
}

export function localAssetUrl(localPath?: string): string {
  const value = String(localPath || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  if (!/[\\/]storage[\\/]assets[\\/]/i.test(value)) return "";
  return `${API_BASE}/assets/local-file?path=${encodeURIComponent(value)}`;
}

export async function createDemoCustomerLogo(customerId: string): Promise<DesignAsset> {
  return postJson<DesignAsset>("/assets/demo-customer-logo", { customerId });
}

export async function importSkuText(text: string): Promise<SkuImportResult> {
  return postJson<SkuImportResult>("/catalog/skus/import-text", { text });
}

export async function previewSkuImportText(text: string): Promise<SkuImportResult> {
  return postJson<SkuImportResult>("/catalog/skus/import-preview", { text });
}

export async function previewSkuImportFile(fileName: string, dataBase64: string): Promise<SkuImportResult> {
  return postJson<SkuImportResult>("/catalog/skus/import-file-preview", { fileName, dataBase64 });
}

export async function getSkuImportFields(): Promise<SkuImportField[]> {
  const response = await fetch(`${API_BASE}/catalog/skus/import-fields`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function downloadSkuImportTemplate(format: "xlsx" | "csv" = "xlsx"): Promise<SkuImportTemplate> {
  const response = await fetch(`${API_BASE}/catalog/skus/import-template?format=${encodeURIComponent(format)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function upsertSku(payload: SkuPayload): Promise<Sku> {
  return postJson<Sku>("/catalog/skus", payload);
}

export async function bulkUpsertSkus(rows: SkuPayload[]): Promise<{ count: number; results: Sku[] }> {
  return postJson<{ count: number; results: Sku[] }>("/catalog/skus/bulk", { rows });
}

export async function batchUpdateSkus(payload: SkuBatchUpdatePayload): Promise<{ count: number; updated: Sku[]; skipped: Array<{ skuCode: string; reason: string }> }> {
  return postJson("/catalog/skus/batch-update", payload);
}

export async function createDemoSkuImages(): Promise<{ count: number; updated: Sku[]; note: string }> {
  return postJson("/catalog/skus/demo-images");
}

export async function deactivateSku(skuCode: string): Promise<Sku> {
  return postJson<Sku>(`/catalog/skus/${encodeURIComponent(skuCode)}/deactivate`);
}

export async function restoreSku(skuCode: string): Promise<Sku> {
  return postJson<Sku>(`/catalog/skus/${encodeURIComponent(skuCode)}/restore`);
}

export async function getSkuCatalogAudit(): Promise<SkuCatalogAudit> {
  const response = await fetch(`${API_BASE}/catalog/skus/audit`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function getSkuChangeLogs(limit = 30, skuCode?: string): Promise<SkuChangeLog[]> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (skuCode) params.set("skuCode", skuCode);
  const response = await fetch(`${API_BASE}/catalog/skus/change-logs?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function getAgents(): Promise<Agent[]> {
  try {
    const response = await fetch(`${API_BASE}/agents`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return [];
  }
}

export async function getChatImports(): Promise<ChatImport[]> {
  try {
    const response = await fetch(`${API_BASE}/training/chat-imports`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return [];
  }
}

export async function getTrainingSamples(filters: {
  agentId?: string;
  quality?: "all" | "safe" | "review" | "risk" | "blocked" | "anti_wrong_reply" | "trainable" | "not_trainable";
  status?: string;
  sourceType?: string;
  limit?: number;
} = {}): Promise<TrainingSample[]> {
  try {
    const params = new URLSearchParams();
    if (filters.agentId) params.set("agentId", filters.agentId);
    if (filters.quality) params.set("quality", filters.quality);
    if (filters.status) params.set("status", filters.status);
    if (filters.sourceType) params.set("sourceType", filters.sourceType);
    if (filters.limit) params.set("limit", String(filters.limit));
    const query = params.toString();
    const response = await fetch(`${API_BASE}/training/samples${query ? `?${query}` : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return [];
  }
}

export async function getTrainingOverview(): Promise<TrainingOverview | null> {
  try {
    const response = await fetch(`${API_BASE}/training/overview`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return null;
  }
}

export async function reviewTrainingSample(
  id: string,
  payload: {
    status: "ready" | "review" | "rejected";
    reviewer?: string;
    note?: string;
    agentId?: string;
    agentKey?: string;
    scene?: string;
    customerText?: string;
    idealReply?: string;
    score?: number;
    skillHints?: string[] | string;
  },
): Promise<{ sample: TrainingSample; reviewLog: ReviewLog }> {
  return postJson<{ sample: TrainingSample; reviewLog: ReviewLog }>(`/training/samples/${encodeURIComponent(id)}/review`, payload);
}

export async function getWechatAccounts(): Promise<WechatAccount[]> {
  try {
    const response = await fetch(`${API_BASE}/wechat/accounts`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return [];
  }
}

export async function getWechatConversations(): Promise<Conversation[]> {
  try {
    const response = await fetch(`${API_BASE}/wechat/conversations`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return [];
  }
}

export async function setConversationManualLock(
  id: string,
  payload: { locked: boolean; reviewer?: string; reason?: string; note?: string },
): Promise<{ conversation: Conversation; log: ReviewLog }> {
  return postJson<{ conversation: Conversation; log: ReviewLog }>(`/wechat/conversations/${id}/manual-lock`, payload);
}

export async function getSendTasks(): Promise<SendTask[]> {
  try {
    const response = await fetch(`${API_BASE}/wechat/send-tasks`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return [];
  }
}

export async function getSendAttempts(sendTaskId?: string): Promise<SendAttempt[]> {
  try {
    const suffix = sendTaskId ? `?sendTaskId=${encodeURIComponent(sendTaskId)}` : "";
    const response = await fetch(`${API_BASE}/wechat/send-attempts${suffix}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return [];
  }
}

export async function getSendAdapter(): Promise<SendAdapterInfo | null> {
  try {
    const response = await fetch(`${API_BASE}/wechat/send-adapter`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return null;
  }
}

export async function getBridgeOutbox(): Promise<BridgeOutboxResult> {
  const response = await fetch(`${API_BASE}/wechat/bridge/outbox`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function getBridgeStatus(): Promise<BridgeStatusResult> {
  const response = await fetch(`${API_BASE}/wechat/bridge/status`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function getWindowObserverStatus(): Promise<WindowObserverStatus> {
  const response = await fetch(`${API_BASE}/wechat/window-observer/status`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function captureWindowObserverOnce(): Promise<{
  status: WindowObserverStatus;
  scan: WindowSnapshotInboxScanResult;
  summary?: {
    hasOutput: boolean;
    lineCount: number;
  };
}> {
  return postJson("/wechat/window-observer/capture-once", {});
}

export async function scanBridgeInbox(): Promise<BridgeInboxScanResult> {
  return postJson<BridgeInboxScanResult>("/wechat/bridge/inbox/scan", {});
}

export async function getWechatWindowSnapshots(): Promise<WechatWindowSnapshot[]> {
  try {
    const response = await fetch(`${API_BASE}/wechat/window-snapshots`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return [];
  }
}

export async function createDemoWindowSnapshot(
  mode: "correct" | "wrong_chat" | "offline",
  wechatAccountId: string,
  conversationId: string,
): Promise<WechatWindowSnapshot> {
  return postJson<WechatWindowSnapshot>("/wechat/window-snapshots/demo", {
    mode,
    wechatAccountId,
    conversationId,
  });
}

export async function scanWindowSnapshotInbox(): Promise<WindowSnapshotInboxScanResult> {
  return postJson<WindowSnapshotInboxScanResult>("/wechat/window-snapshots/inbox/scan", {});
}

export async function createDemoSendTask(conversationId: string): Promise<SendTask> {
  return postJson<SendTask>("/wechat/send-tasks/demo", { conversationId });
}

export async function validateSendTask(id: string, mode: "correct" | "wrong_chat"): Promise<SendTask> {
  return postJson<SendTask>(`/wechat/send-tasks/${id}/validate`, { mode });
}

export async function validateSendTaskCurrentWindow(id: string): Promise<SendTask> {
  return postJson<SendTask>(`/wechat/send-tasks/${id}/validate-current-window`, {});
}

export async function executeDryRunSend(id: string): Promise<{ task: SendTask; attempt: SendAttempt }> {
  return postJson<{ task: SendTask; attempt: SendAttempt }>(`/wechat/send-tasks/${id}/execute-dry-run`, {});
}

export async function executeSendTask(id: string): Promise<{ task: SendTask; attempt: SendAttempt; adapter: SendAdapterInfo }> {
  return postJson<{ task: SendTask; attempt: SendAttempt; adapter: SendAdapterInfo }>(`/wechat/send-tasks/${id}/execute`, {});
}

export async function requeueSendTask(id: string): Promise<SendTask> {
  return postJson<SendTask>(`/wechat/send-tasks/${id}/requeue`, {
    reason: "客服重新排队发送",
  });
}

export async function cancelSendTask(id: string): Promise<SendTask> {
  return postJson<SendTask>(`/wechat/send-tasks/${id}/cancel`, {
    reason: "客服取消发送任务",
  });
}

export async function scanSendOperations(): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>("/wechat/send-tasks/scan-ops", {});
}

export type SafeSendQueueResult = {
  scanned: number;
  processed: Array<{ task: SendTask; attempt: SendAttempt; adapter: SendAdapterInfo }>;
  blocked: Array<{ task: SendTask; attempt: SendAttempt; adapter: SendAdapterInfo }>;
  skipped: Array<{
    sendTaskId: string;
    wechatAccountId?: string;
    reason: string;
    queueHeadId?: string | null;
    advice?: {
      reason: string;
      severity: "info" | "warning" | "error";
      blockingTaskId?: string | null;
      message: string;
      recommendedAction: string;
    };
  }>;
  failed: Array<{
    sendTaskId: string;
    wechatAccountId?: string;
    errorMessage: string;
  }>;
};

export async function processSafeSendQueue(): Promise<SafeSendQueueResult> {
  return postJson<SafeSendQueueResult>("/wechat/send-tasks/process-safe-queue", {});
}

export async function getRouteEvaluations(): Promise<RouteEvaluation[]> {
  try {
    const response = await fetch(`${API_BASE}/routing/evaluations`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return [];
  }
}

export async function evaluateRoute(text: string): Promise<RouteEvaluation> {
  return postJson<RouteEvaluation>("/routing/evaluate", { channel: "wechat", text });
}

export async function correctRouteEvaluation(
  id: string,
  payload: { agentKey: string; scene?: string; reviewer?: string; note?: string; idealReply?: string },
): Promise<{
  route: RouteEvaluation;
  trainingSample: TrainingSample;
  knowledgeEntry: Record<string, unknown>;
  reviewLog: ReviewLog;
}> {
  return postJson(`/routing/evaluations/${encodeURIComponent(id)}/correct`, payload);
}

export async function processInboundMessage(payload: {
  wechatAccountId: string;
  conversationId: string;
  text: string;
  assetIds?: string[];
  attachments?: Array<Record<string, unknown>>;
}): Promise<InboundProcessResult> {
  return postJson<InboundProcessResult>("/wechat/inbound/messages", payload);
}

export async function importChatTranscript(payload: {
  name?: string;
  source?: string;
  channel?: string;
  agentId?: string;
  text: string;
}): Promise<ChatImport> {
  return postJson<ChatImport>("/training/chat-imports", payload);
}

export async function getSkillSuggestions(agentId?: string): Promise<SkillSuggestion[]> {
  try {
    const suffix = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
    const response = await fetch(`${API_BASE}/training/skill-suggestions${suffix}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return [];
  }
}

export async function applySkillSuggestions(
  payload: { agentId?: string; minScore?: number; suggestionKeys?: string[]; includeNeedsReview?: boolean } = {},
): Promise<ApplySkillSuggestionsResult> {
  return postJson<ApplySkillSuggestionsResult>("/training/skill-suggestions/apply", payload);
}

export async function recommendBundle(payload: {
  budget: DesignJob["budget"];
  scene: string;
  maxItems?: number;
}): Promise<BundleRecommendation> {
  return postJson<BundleRecommendation>("/catalog/bundle/recommend", payload);
}

export async function createDemoDesignJob(
  identity: { wechatAccountId: string; customerId: string; conversationId: string },
  assetIds: string[] = [],
): Promise<DesignJob> {
  const budget = { mode: "per_box", perUnitAmount: 180, quantity: 50, totalAmount: 9000 };
  const scene = "员工福利";
  const recommendation = await recommendBundle({ budget, scene, maxItems: 6 });
  const giftBox = recommendation.items.find((item) => item.type === "gift_box") || null;

  return postJson<DesignJob>("/design-jobs", {
    wechatAccountId: identity.wechatAccountId,
    customerId: identity.customerId,
    conversationId: identity.conversationId,
    budget,
    scene,
    bundle: {
      giftBox,
      items: recommendation.items,
      totals: recommendation.totals,
      warnings: recommendation.warnings,
    },
    assetIds,
    assets: [{ assetId: "demo-logo", type: "logo", name: "客户Logo" }],
    customerText: "想看一套端午员工福利礼盒真实摆拍效果图，整体要高级、温和、有企业礼赠感。",
    designType: "bundle_render",
    outputCount: 6,
  });
}

export async function createTimeoutDemoJob(conversationId: string): Promise<DesignJob> {
  return postJson<DesignJob>("/design-jobs/demo-timeout", { conversationId });
}

export async function createFailureDemoJob(conversationId: string): Promise<DesignJob> {
  return postJson<DesignJob>("/design-jobs/demo-failure", { conversationId });
}

export async function scanDesignTimeouts(): Promise<{ scanned: number; timedOut: number; jobs: DesignJob[] }> {
  return postJson<{ scanned: number; timedOut: number; jobs: DesignJob[] }>("/design-jobs/scan-timeouts");
}

export type DesignActivePollResult = {
  scanned: number;
  completed: DesignJob[];
  failed: DesignJob[];
  generating: DesignJob[];
  cancelled: DesignJob[];
  errors: Array<{
    designJobId?: string;
    requestId?: string;
    externalJobId?: string;
    errorMessage: string;
  }>;
};

export async function pollActiveDesignResults(): Promise<DesignActivePollResult> {
  return postJson<DesignActivePollResult>("/design-jobs/poll-active-results");
}

export type DesignAutoSubmitResult = {
  scanned: number;
  submitted: DesignJob[];
  skipped: Array<{
    designJobId: string;
    requestId?: string;
    reason: string;
    missing?: string[];
  }>;
  failed: Array<{
    designJobId: string;
    requestId?: string;
    errorMessage: string;
  }>;
};

export async function autoSubmitDesignDrafts(): Promise<DesignAutoSubmitResult> {
  return postJson<DesignAutoSubmitResult>("/design-jobs/auto-submit-drafts");
}

export type LowValueAutomationResult = {
  autoSubmit: DesignAutoSubmitResult;
  imageSend: {
    scanned: number;
    queued: SendTask[];
    skipped: Array<{
      designJobId: string;
      requestId?: string;
      reason: string;
      missing?: string[];
    }>;
    failed: Array<{
      designJobId: string;
      requestId?: string;
      errorMessage: string;
    }>;
  };
  quoteSend?: {
    scanned: number;
    queued: Array<{ quote: QuoteDraft; sendTask: SendTask }>;
    skipped: Array<{
      quoteDraftId: string;
      designJobId?: string;
      reason: string;
      missing?: string[];
    }>;
    failed: Array<{
      quoteDraftId: string;
      designJobId?: string;
      errorMessage: string;
    }>;
  };
  orderDraft?: LowValueOrderDraftResult;
  orderConfirmation?: LowValueOrderSendResult;
  orderFollowup?: LowValueOrderFollowupResult;
};

export type LowValueOrderDraftResult = {
  scanned: number;
  created: OrderDraft[];
  skipped: Array<{
    quoteDraftId: string;
    designJobId?: string;
    reason: string;
    missing?: string[];
  }>;
  failed: Array<{
    quoteDraftId: string;
    designJobId?: string;
    errorMessage: string;
  }>;
};

export type LowValueOrderSendResult = {
  scanned: number;
  queued: Array<{ orderDraft: OrderDraft; sendTask: SendTask; message: string }>;
  skipped: Array<{
    orderDraftId: string;
    quoteDraftId?: string;
    reason: string;
    missing?: string[];
  }>;
  failed: Array<{
    orderDraftId: string;
    quoteDraftId?: string;
    errorMessage: string;
  }>;
};

export type LowValueOrderFollowupResult = {
  scanned: number;
  queued: Array<{ orderDraft: OrderDraft; sendTask: SendTask; message: string }>;
  skipped: Array<{
    orderDraftId: string;
    quoteDraftId?: string;
    reason: string;
    followupType?: string;
    missing?: string[];
  }>;
  failed: Array<{
    orderDraftId: string;
    quoteDraftId?: string;
    followupType?: string;
    errorMessage: string;
  }>;
};

export async function autoProcessLowValue(): Promise<LowValueAutomationResult> {
  return postJson<LowValueAutomationResult>("/design-jobs/auto-process-low-value");
}

export type AutomationRun = {
  trigger: "startup" | "interval" | "manual";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  skipped?: boolean;
  reason?: string;
  steps?: Array<{
    step: string;
    status: "completed" | "failed";
    durationMs: number;
    errorMessage?: string;
  }>;
  errors: Array<{ step: string; errorMessage: string }>;
  results: Record<string, unknown>;
};

export type AutomationStatus = {
  enabled: boolean;
  running: boolean;
  active: boolean;
  startedAt?: string | null;
  runningStartedAt?: string | null;
  nextRunAt?: string | null;
  intervalMs: number;
  processSendQueue: boolean;
  sendQueueLimit: number;
  pollLimit: number;
  runCount: number;
  lastRun?: AutomationRun | null;
  recentRuns?: AutomationRun[];
};

export type AutomationReadiness = {
  checkedAt: string;
  ready: boolean;
  tone: "ok" | "warning" | "error";
  summary: string;
  checks: Array<{
    key: string;
    label: string;
    ok: boolean;
    severity: "info" | "warning" | "error";
    detail: string;
    action?: string;
  }>;
  blockers: AutomationReadiness["checks"];
  warnings: AutomationReadiness["checks"];
  metrics: {
    lowValueDrafts: number;
    quickConfirmJobs: number;
    pendingSendTasks: number;
    manualLockedConversations: number;
    lowValueQuotesReady: number;
    lowValueOrdersReady: number;
    catalogReadyCount: number;
    catalogBlockingRepairCount: number;
  };
};

export function mergeAutomationStatusRun(
  status: AutomationStatus | null,
  run: AutomationRun | null,
  options: { incrementRunCount?: boolean } = {},
): AutomationStatus | null {
  if (!status || !run) return status;
  const runKey = automationRunIdentity(run);
  const recentRuns = [
    run,
    ...(status.recentRuns || []).filter((item) => automationRunIdentity(item) !== runKey),
  ].slice(0, 10);
  return {
    ...status,
    running: false,
    runningStartedAt: null,
    lastRun: run,
    recentRuns,
    runCount: Number(status.runCount || 0) + (options.incrementRunCount ? 1 : 0),
  };
}

function automationRunIdentity(run: AutomationRun) {
  return [run.startedAt || "", run.trigger || "", run.completedAt || "", run.reason || ""].join("|");
}

export async function getAutomationStatus(): Promise<AutomationStatus | null> {
  try {
    const response = await fetch(`${API_BASE}/automation/status`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return null;
  }
}

export async function getAutomationReadiness(): Promise<AutomationReadiness | null> {
  try {
    const response = await fetch(`${API_BASE}/automation/readiness`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return null;
  }
}

export async function runAutomationOnce(): Promise<AutomationRun> {
  return postJson<AutomationRun>("/automation/run-once", {});
}

export async function startAutomation(): Promise<AutomationStatus> {
  return postJson<AutomationStatus>("/automation/start", {});
}

export async function stopAutomation(): Promise<AutomationStatus> {
  return postJson<AutomationStatus>("/automation/stop", {});
}

export type HighValueHandoffResult = {
  scanned: number;
  handedOff: DesignJob[];
  skipped: Array<{
    designJobId: string;
    requestId?: string;
    status?: string;
    reason: string;
  }>;
};

export async function scanHighValueHandoffs(): Promise<HighValueHandoffResult> {
  return postJson<HighValueHandoffResult>("/design-jobs/scan-high-value-handoffs");
}

export async function getDesignPlatformHealth(): Promise<DesignPlatformHealth> {
  const response = await fetch(`${API_BASE}/integrations/design-platform/health`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function getDesignPlatformReadiness(): Promise<DesignPlatformReadiness> {
  const response = await fetch(`${API_BASE}/integrations/design-platform/readiness`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function getDesignPlatformConfig(): Promise<DesignPlatformConfigResponse> {
  const response = await fetch(`${API_BASE}/integrations/design-platform/config`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function updateDesignPlatformConfig(payload: {
  adapter?: string;
  baseUrl?: string;
  accessToken?: string;
  cookie?: string;
  deviceId?: string;
}): Promise<DesignPlatformConfigResponse> {
  return postJson<DesignPlatformConfigResponse>("/integrations/design-platform/config", payload);
}

export async function loginDesignPlatform(payload: {
  email: string;
  password: string;
  deviceId: string;
}): Promise<DesignPlatformLoginResponse> {
  return postJson<DesignPlatformLoginResponse>("/integrations/design-platform/login", payload);
}

export async function redeemDesignPlatformActivation(payload: {
  code: string;
  deviceId: string;
  deviceLabel?: string;
}): Promise<DesignPlatformActivationResponse> {
  return postJson<DesignPlatformActivationResponse>("/integrations/design-platform/activation/redeem", payload);
}

export async function submitDesignJob(id: string): Promise<DesignJob> {
  return postJson<DesignJob>(`/design-jobs/${id}/submit`);
}

export async function preflightDesignJob(id: string): Promise<DesignJobPreflightResult> {
  return postJson<DesignJobPreflightResult>(`/design-jobs/${id}/preflight`);
}

export async function pollDesignJob(id: string): Promise<{ remoteStatus: string; job: DesignJob; result: Record<string, unknown> }> {
  return postJson<{ remoteStatus: string; job: DesignJob; result: Record<string, unknown> }>(`/design-jobs/${id}/poll`);
}

export async function retryDesignJob(id: string): Promise<DesignJob> {
  return postJson<DesignJob>(`/design-jobs/${id}/retry`);
}

export async function requestDesignRevision(id: string, payload: {
  instruction: string;
  selectedImageId?: string;
  sourceText?: string;
}): Promise<{ decision: Record<string, unknown>; revision: DesignRevision | null; job: DesignJob }> {
  return postJson<{ decision: Record<string, unknown>; revision: DesignRevision | null; job: DesignJob }>(
    `/design-jobs/${id}/revisions`,
    payload,
  );
}

export async function attachDesignJobAssets(id: string, assetIds: string[]): Promise<DesignJob> {
  return postJson<DesignJob>(`/design-jobs/${id}/assets`, { assetIds });
}

export async function cancelDesignJob(id: string): Promise<{ job: DesignJob; remoteResult?: Record<string, unknown> | null }> {
  return postJson<{ job: DesignJob; remoteResult?: Record<string, unknown> | null }>(`/design-jobs/${id}/cancel`);
}

export async function quickConfirmSend(id: string): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(`/design-jobs/${id}/quick-confirm-send`);
}

export type SelectImagePayload =
  | string
  | {
      text?: string;
      referencedImageId?: string;
      quotedImageId?: string;
      attachmentImageId?: string;
      screenshotFingerprint?: string;
      attachmentFingerprint?: string;
    };

export async function selectDesignImage(id: string, input: SelectImagePayload): Promise<Record<string, unknown>> {
  const payload = typeof input === "string" ? { text: input } : input;
  return postJson<Record<string, unknown>>(`/design-jobs/${id}/select-image`, payload);
}

export async function createQuote(id: string): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(`/design-jobs/${id}/quote`);
}

export async function getQuotes(): Promise<QuoteDraft[]> {
  try {
    const response = await fetch(`${API_BASE}/quotes`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return [];
  }
}

export async function getQuotePreview(id: string): Promise<QuotePreview> {
  const response = await fetch(`${API_BASE}/quotes/${id}/preview`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function updateQuote(id: string, patch: {
  status?: string;
  paymentStatus?: string;
  customerNotes?: string;
  owner?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  totalCost?: number | string;
}): Promise<QuoteDraft> {
  return postJson<QuoteDraft>(`/quotes/${id}/update`, patch);
}

export async function queueQuoteSend(id: string): Promise<{ quote: QuoteDraft; sendTask: SendTask }> {
  return postJson<{ quote: QuoteDraft; sendTask: SendTask }>(`/quotes/${id}/queue-send`, {
    owner: "人工客服",
    note: "报价已进入微信安全发送队列。",
  });
}

export async function getOrderDrafts(): Promise<OrderDraft[]> {
  try {
    const response = await fetch(`${API_BASE}/orders`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return [];
  }
}

export async function createOrderDraftFromQuote(id: string): Promise<OrderDraft> {
  return postJson<OrderDraft>(`/orders/from-quote/${id}`);
}

export async function updateOrderDraft(id: string, patch: {
  status?: string;
  paymentStatus?: string;
  customerNotes?: string;
  owner?: string;
}): Promise<OrderDraft> {
  return postJson<OrderDraft>(`/orders/${id}/update`, patch);
}

export async function queueOrderConfirmation(id: string): Promise<{ orderDraft: OrderDraft; sendTask: SendTask; message: string }> {
  return postJson<{ orderDraft: OrderDraft; sendTask: SendTask; message: string }>(`/wechat/orders/${id}/queue-confirmation`, {
    owner: "人工客服",
    note: "订单确认已进入微信安全发送队列。",
  });
}

export async function queueOrderFollowup(id: string, type: "production" | "delivery"): Promise<{ orderDraft: OrderDraft; sendTask: SendTask; message: string }> {
  return postJson<{ orderDraft: OrderDraft; sendTask: SendTask; message: string }>(`/wechat/orders/${id}/queue-followup`, {
    owner: "人工客服",
    type,
  });
}

export async function markManualReview(id: string): Promise<DesignJob> {
  return postJson<DesignJob>(`/design-jobs/${id}/manual-review`);
}

export async function getReviewCenter(): Promise<ReviewCenter> {
  try {
    const response = await fetch(`${API_BASE}/reviews`, { cache: "no-store" });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return { designJobs: [], quoteDrafts: [], logs: [] };
  }
}

export async function reviewDesignJob(id: string, payload: {
  decision: "approve_images" | "approve_send" | "request_revision" | "reject";
  reviewer?: string;
  note?: string;
}): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(`/reviews/design-jobs/${id}`, payload);
}

export async function reviewQuote(id: string, payload: {
  decision: "approve_quote" | "request_followup" | "reject_quote";
  reviewer?: string;
  note?: string;
}): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(`/reviews/quotes/${id}`, payload);
}

export async function getNotifications(unreadOnly = false): Promise<NotificationItem[]> {
  try {
    const response = await fetch(`${API_BASE}/notifications?unreadOnly=${unreadOnly ? "true" : "false"}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`api ${response.status}`);
    return response.json();
  } catch {
    return [];
  }
}

export async function markNotificationRead(id: string): Promise<NotificationItem> {
  return postJson<NotificationItem>(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<{ count: number }> {
  return postJson<{ count: number }>("/notifications/read-all");
}

const sampleDesignJobs: DesignJob[] = [
  {
    id: "demo-design-1",
    requestId: "demo-request-1",
    status: "quick_confirm",
    scene: "员工福利",
    isHighValue: false,
    outputCount: 6,
    budget: { mode: "per_box", perUnitAmount: 200, quantity: 100, totalAmount: 20000 },
    customer: { name: "王总" },
    conversation: { title: "王总-端午礼盒" },
    updatedAt: new Date().toISOString(),
    images: [
      { id: "img-1", imageId: "1", position: 1 },
      { id: "img-2", imageId: "2", position: 2 },
      { id: "img-3", imageId: "3", position: 3 },
    ],
  },
  {
    id: "demo-design-2",
    requestId: "demo-request-2",
    status: "manual_review",
    scene: "客户拜访",
    isHighValue: true,
    outputCount: 6,
    budget: { mode: "total", perUnitAmount: 180, quantity: 80, totalAmount: 14400 },
    customer: { name: "李经理" },
    conversation: { title: "李经理-企业伴手礼" },
    updatedAt: new Date().toISOString(),
    images: [],
  },
];

const sampleSkus: Sku[] = [
  { id: "sku-1", skuCode: "BOX-A", name: "红金礼盒A", type: "gift_box", category: "礼盒", salePrice: 60, costPrice: 30, stock: 120 },
  { id: "sku-2", skuCode: "CARD-A", name: "定制贺卡A", type: "accessory", category: "贺卡", salePrice: 20, costPrice: 5, stock: 500 },
  { id: "sku-3", skuCode: "TEA-A", name: "茶叶礼品A", type: "item", category: "内搭", salePrice: 110, costPrice: 65, stock: 42 },
];
