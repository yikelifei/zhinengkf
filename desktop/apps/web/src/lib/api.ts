import { createClientOperationKey } from "./client-operation-key";
export {
  completeClientOperation,
  createClientOperationKey,
  reserveClientOperation,
} from "./client-operation-key";
export type { PendingClientOperation } from "./client-operation-key";

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
    designJobId?: string;
    imageId: string;
    position: number;
    localPath?: string;
    downloadUrl?: string;
    fingerprint?: string;
    selected?: boolean;
    localFile?: {
      state: "ready" | "not_saved" | "stale_record" | "missing_file";
      code:
        | "DESIGN_IMAGE_LOCAL_FILE_READY"
        | "DESIGN_IMAGE_LOCAL_FILE_NOT_SAVED"
        | "DESIGN_IMAGE_LOCAL_FILE_STALE_RECORD"
        | "DESIGN_IMAGE_LOCAL_FILE_MISSING";
      message: string;
      canRepair: boolean;
    };
  }>;
  assets?: DesignAsset[];
  revisions?: DesignRevision[];
  customer?: { id?: string | null; name: string };
  conversation?: {
    id?: string | null;
    title?: string | null;
    customerId?: string | null;
    wechatAccountId?: string | null;
  };
  bundle?: {
    giftBox?: Record<string, unknown> | null;
    items?: Array<Record<string, unknown> & { type?: string; skuCode?: string }>;
    totals?: {
      cost?: number;
      salePrice?: number;
      profit?: number;
      profitRate?: number;
    };
    automation?: {
      ready: boolean;
      blockers: string[];
    } | null;
    warnings?: string[];
  };
  updatedAt?: string;
  readiness?: {
    ok: boolean;
    missing?: string[];
  };
};

export type DesignExecutionAvailableResolution =
  | "confirmed_not_generated_refunded"
  | "confirmed_refunded"
  | null;

export type DesignPlatformExecutionView = {
  id: string;
  attemptNo: number;
  status: string;
  acceptanceStatus: string;
  refundStatus: string;
  imageCount: number;
  errorCategory: string | null;
  responseHttpStatus: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  resolvedAt: string | null;
  availableResolution: DesignExecutionAvailableResolution;
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
  wechatAccountId?: string | null;
  conversationId?: string | null;
  customerId?: string | null;
  role?: string | null;
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

export type SkuBundleCombinationExample = {
  giftBoxSkuCode: string;
  itemSkuCode: string;
  totalPrice: number;
  costPrice?: number;
  profit?: number;
  marginRate?: number;
  leadTimeDays?: number;
  leadTimeKnown?: boolean;
  weightGram?: number;
  specReady?: boolean;
  sizeReady?: boolean;
  sizeRisk?: boolean;
  deliveryRisk?: boolean;
  automationReady?: boolean;
  autoQuoteBlockers?: string[];
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
  budgetBandCoverage?: Array<{
    key: string;
    label: string;
    min: number;
    max: number | null;
    available: boolean;
    combinationCount: number;
    minBundlePrice: number;
    maxBundlePrice: number;
    capacity: number;
    minMarginRate?: number;
    lowMarginCombinationCount?: number;
    maxLeadTimeDays?: number;
    deliveryRiskCombinationCount?: number;
    specReadyCombinationCount?: number;
    sizeReadyCombinationCount?: number;
    sizeRiskCombinationCount?: number;
    automationReadyCombinationCount?: number;
    automationBlockerCounts?: Array<{ code: string; count: number }>;
    examples: SkuBundleCombinationExample[];
    automationReadyExamples?: SkuBundleCombinationExample[];
  }>;
  budgetCoverageIssueCount?: number;
  sceneBundleCoverage?: Array<{
    scene: string;
    available: boolean;
    giftBoxCount: number;
    itemCount: number;
    combinationCount: number;
    minBundlePrice: number;
    maxBundlePrice: number;
    capacity: number;
    minMarginRate?: number;
    lowMarginCombinationCount?: number;
    maxLeadTimeDays?: number;
    deliveryRiskCombinationCount?: number;
    specReadyCombinationCount?: number;
    sizeReadyCombinationCount?: number;
    sizeRiskCombinationCount?: number;
    automationReadyCombinationCount?: number;
    automationBlockerCounts?: Array<{ code: string; count: number }>;
    examples: SkuBundleCombinationExample[];
    automationReadyExamples?: SkuBundleCombinationExample[];
  }>;
  sceneBundleCoverageIssueCount?: number;
  bundleMarginRiskCount?: number;
  bundleDeliveryRiskCount?: number;
  bundleSpecRiskCount?: number;
  bundleSizeRiskCount?: number;
  bundleAutomationRiskCount?: number;
  commercialReadiness?: {
    score: number;
    level: "ready" | "review" | "blocked";
    canAutoBundle: boolean;
    canSubmitDesign: boolean;
    canAutoQuote: boolean;
    summary: string;
    blockers: string[];
    nextActions: string[];
  };
  dataReadiness?: {
    level: "empty" | "test_only" | "partial" | "verified";
    totalCount: number;
    operatorProvidedCount: number;
    demoImageCount: number;
    customerReplyEligibleCount: number;
    customerReplyEligibleSkuCodes?: string[];
    unverifiedCount: number;
    internalTestReady: boolean;
    customerReplyReady: boolean;
    summary: string;
    blockers: string[];
    nextActions: string[];
  };
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

export type SkuDeleteResult = {
  deletedSku: Sku;
  removedAssetCount: number;
};

export type KnowledgeImportField = SkuImportField;

export type KnowledgeImportRow = {
  title: string;
  content: string;
  agentKey?: string;
  agentId?: string;
  tags?: string[];
  source?: string;
  qualityScore?: number;
};

export type KnowledgeImportResult = {
  ok: boolean;
  importedCount: number;
  skippedCount: number;
  rows: KnowledgeImportRow[];
  errors: Array<{ line: number; message: string }>;
  missingRequiredFields?: KnowledgeImportField[];
  fieldMapping?: Array<KnowledgeImportField & { sourceHeader: string; column: number | null; matched: boolean }>;
  unmappedHeaders?: string[];
  acceptance?: {
    total: number;
    readyCount: number;
    needsReviewCount: number;
    missingAgentCount: number;
    missingTagsCount: number;
    shortContentCount: number;
    blocked: boolean;
    blockers: string[];
    nextActions: string[];
  };
  saved?: {
    count: number;
    results: Array<Record<string, unknown>>;
    skipped?: Array<Record<string, unknown>>;
    reviewLog?: ReviewLog;
    failed?: boolean;
  };
  history?: ReviewLog;
};

export type KnowledgeImportTemplate = {
  fileName: string;
  mimeType: string;
  dataBase64: string;
  fields: KnowledgeImportField[];
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
    agentId?: string;
    name: string;
    description: string;
    enabled: boolean;
    version?: number;
    sourceType?: string | null;
    sampleCount?: number;
    confidence?: number;
    lastCompiledAt?: string | null;
    scope?: {
      level?: string;
      label?: string;
      reason?: string;
      wechatAccountId?: string | null;
      conversationId?: string | null;
      customerId?: string | null;
    };
    executionPolicy?: {
      actionKey:
        | "skill.instruction_preview"
        | "design_platform.health_check"
        | "catalog.audit"
        | "automation.readiness_check";
      label: string;
      description: string;
      mode: "allowlist_read_only";
      riskLevel: "read_only";
      sideEffects: "none";
      timeoutMs: number;
      confirmationRequired: true;
      confirmationText: string;
      rollbackMode: "not_required_read_only";
      canExecute: boolean;
      blockedReason: string | null;
    };
  }>;
  trainingSampleCount: number;
  averageTrainingScore: number;
};

export type AgentSkillExecutionResult = {
  executionId: string;
  status: "completed";
  replayed: boolean;
  policy: NonNullable<Agent["skills"][number]["executionPolicy"]>;
  result: Record<string, unknown>;
  startedAt: string;
  completedAt: string;
};

export type ChatImport = {
  id: string;
  name: string;
  source: string;
  channel: string;
  messageCount: number;
  pairCount: number;
  warnings: string[];
  sceneSummary?: {
    sampleCount: number;
    clearCount: number;
    weakCount: number;
    ambiguousCount: number;
    unmatchedCount: number;
    sceneUncertainCount: number;
    readyCount?: number;
    reviewCount?: number;
    rejectedCount?: number;
  };
  samples?: TrainingSample[];
  createdAt: string;
};

export type TrainingSample = {
  id: string;
  agentId?: string;
  agentKey: string;
  customerId?: string | null;
  conversationId?: string | null;
  wechatAccountId?: string | null;
  scene: string;
  sceneScore?: number;
  sceneScores?: Array<{
    scene: string;
    agentKey: string;
    score: number;
    matchedKeywords: string[];
  }>;
  matchedKeywords?: string[];
  sceneCheck?: {
    status: "clear" | "weak" | "ambiguous" | "unmatched" | string;
    reason: string;
    needsReview?: boolean;
    scoreGap?: number;
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
    usage?: {
      scope: string;
      label: string;
      reason: string;
      routeMemory: boolean;
      replySkill: boolean;
      antiWrongReply: boolean;
      trainable: boolean;
      flags: string[];
    };
    attention?: {
      needsAttention: boolean;
      label: string;
      primaryReason?: {
        code: string;
        label: string;
        detail: string;
        action: string;
      } | null;
      reasons: Array<{
        code: string;
        label: string;
        detail: string;
        action: string;
      }>;
      recommendedAction?: string;
    };
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
  knowledgeEntryCount?: number;
  starterKnowledgeEntryCount?: number;
  agentsWithSamples: number;
  qualitySummary?: {
    safeSamples: number;
    reviewQualitySamples: number;
    riskSamples: number;
    blockedSamples: number;
    trainableSamples: number;
    antiWrongReplySamples: number;
    routeMemorySamples?: number;
    replySkillSamples?: number;
    routeAndReplySamples?: number;
    needsAttentionSamples?: number;
    sceneUncertainSamples?: number;
    attentionReasonCounts?: Array<{ code: string; label: string; count: number }>;
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
  knowledgeByAgent?: Array<{
    agentId?: string | null;
    agentKey?: string;
    name: string;
    count: number;
    starterCount: number;
    topTitles: string[];
  }>;
  topKnowledgeEntries?: Array<{
    id: string;
    agentId?: string | null;
    title: string;
    sourceType?: string;
    qualityScore?: number;
    tags?: string[];
  }>;
  recommendations: string[];
};

export type ConversationLearningDashboard = {
  schema: "conversation_learning_dashboard_v1";
  generatedAt: string;
  summary: {
    conversationCount: number;
    wonCount: number;
    lostCount: number;
    ongoingCount: number;
    stalledCount: number;
    learningObservationCount: number;
    reviewRequiredCount: number;
    topReasons: Array<{ code: string; label: string; count: number }>;
  };
  conversations: Array<{
    conversation: {
      id: string;
      title?: string;
      customerId?: string;
      wechatAccountId?: string;
      status?: string;
      lastMessageAt?: string;
    };
    feedback: {
      outcome: "won" | "lost" | "ongoing";
      state: "converted" | "not_converted" | "stalled" | "in_progress";
      outcomeSource: "automatic" | "operator_confirmed";
      whyNotConverted: string;
      primaryReason: {
        code: string;
        label: string;
        confidence: number;
        inference?: boolean;
        evidence: Array<{ excerpt?: string; source?: string; messageId?: string }>;
      };
      recommendedActions: string[];
      metrics: {
        messageCount: number;
        inboundCount: number;
        quoteCount: number;
        orderCount: number;
        stalledHours: number;
      };
    };
    learningObservationCount: number;
    reviewRequiredCount: number;
    learningInsights: Array<{
      observedAt?: string;
      customerIntent?: string;
      stage?: string;
      nextBestAction?: string;
      learningPolicy?: { autoPromote?: boolean; status?: string };
    }>;
  }>;
  learningPolicy: {
    everyInboundCreatesObservation: boolean;
    silenceIsNotLoss: boolean;
    autoPromoteToKnowledge: boolean;
    reviewRequiredBeforeKnowledgeOrSkill: boolean;
  };
};

export type TrainingSampleQualityApiFilter =
  | "all"
  | "safe"
  | "review"
  | "risk"
  | "blocked"
  | "needs_attention"
  | "scene_uncertain"
  | "anti_wrong_reply"
  | "trainable"
  | "not_trainable"
  | "route_memory"
  | "reply_skill"
  | "route_and_reply";

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
  scope?: {
    level: "global" | "wechat_account" | "customer" | "conversation" | "mixed" | string;
    label: string;
    reason: string;
    wechatAccountId?: string | null;
    conversationId?: string | null;
    customerId?: string | null;
  };
  evidence?: {
    question?: string;
    answer?: string;
  };
  existingSkillId?: string | null;
  action: "create" | "update";
  quality?: {
    level: "safe" | "review" | "risk" | "blocked";
    label: string;
    reason: string;
    needsReview: boolean;
    blocked?: boolean;
    minSampleCount?: number;
    minConfidence?: number;
  };
};

export type SkillSuggestionApplyBlocked = SkillSuggestion & {
  reason: "identity_scope_blocked" | "needs_review" | string;
  quality?: NonNullable<SkillSuggestion["quality"]>;
};

export type ApplySkillSuggestionsResult = {
  suggested: number;
  selected?: number;
  applied?: number;
  filtered?: number;
  requiresReview?: number;
  blocked?: SkillSuggestionApplyBlocked[];
  created: Array<Record<string, unknown>>;
  updated: Array<Record<string, unknown>>;
  skipped: Array<Record<string, unknown>>;
};

export type PersonalWechatRpaInstance = {
  wechatAccountId: string;
  endpoint: string;
  port: number | null;
  accountNickname: string;
  ownerWxId: string;
  enabled: boolean;
  tokenConfigured: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PersonalWechatRpaRegistry = {
  version: string;
  ready: boolean;
  mode: "registry" | "legacy_single" | "unconfigured";
  configPath: string;
  activeCount: number;
  disabledCount: number;
  instances: PersonalWechatRpaInstance[];
  legacy: {
    present: boolean;
    used: boolean;
    ready: boolean;
    endpoint: string;
    port: number | null;
    accountNickname: string | null;
    ownerWxId: string | null;
    tokenConfigured: boolean;
  };
  checks: Array<{ key: string; ok: boolean; detail: string }>;
  errors: string[];
};

export type PersonalWechatRpaInstanceInput = {
  wechatAccountId?: string;
  endpoint?: string;
  token?: string;
  accountNickname?: string;
  ownerWxId?: string;
  enabled?: boolean;
};

export type PersonalWechatRpaInstanceValidation = {
  ok: boolean;
  operation: "create" | "update" | "blocked";
  errors: string[];
  instance: PersonalWechatRpaInstance | null;
  registry: PersonalWechatRpaRegistry;
};

export type OperatorRole = "admin" | "supervisor" | "agent" | "read_only";
export type OperatorCapability =
  | "view_console"
  | "manage_channels"
  | "manage_assignments"
  | "reply_conversations"
  | "approve_send"
  | "manage_design_executions"
  | "manage_training"
  | "execute_agent_skills"
  | "manage_roles";

export type OperatorAccessStatus = {
  mode: "preflight_only" | "local_desktop_enforced";
  policyLoaded: boolean;
  trustedPrincipal: boolean;
  enforcementReady: boolean;
  authenticationProvider: "not_authenticated" | "local_desktop_session";
  roleBindingReady: boolean;
  defaultDecision: "deny";
  principal: {
    id: "local_admin";
    displayName: string;
    role: "admin";
    authenticationProvider: "local_desktop_session";
  } | null;
  capabilities: OperatorCapability[];
  blockers: Array<{ code: string; message: string }>;
  limitations: Array<{ code: string; message: string }>;
  requiredNextSteps: string[];
  notice: string;
};

export type OperatorAccessPolicy = {
  version: string;
  mode: "preflight_only" | "local_desktop_enforced";
  defaultDecision: "deny";
  roles: OperatorRole[];
  capabilities: OperatorCapability[];
  matrix: Record<OperatorRole, OperatorCapability[]>;
  semantics: {
    roleInput: string;
    policyAllows: string;
    authorizationGranted: string;
  };
  notice: string;
};

export type AiProviderStatus = {
  enabled: boolean;
  primary: string;
  fallbackChain: string[];
  timeoutSeconds: number;
  maxRetries: number;
  promptKey: string;
  routing: {
    enabled: boolean;
    complexityThreshold: number;
    economyChain: string[];
    qualityChain: string[];
  };
  adaptiveRouting: {
    enabled: boolean;
    strategy: "latency_reliability_circuit_breaker";
    failureThreshold: number;
    economyOrder: string[];
    qualityOrder: string[];
  };
  probe: boolean;
  providers: Array<{
    name: string;
    label: string;
    description: string;
    region: "china" | "global" | "aggregator" | "custom";
    enabled: boolean;
    configured: boolean;
    apiKeyConfigured: boolean;
    credentialSource: "environment" | "zhenxi_ai_shared" | "invalid";
    sharedSourceConfigured: boolean;
    issues: string[];
    requestFormat: string;
    baseUrl: string;
    apiEndpoint: string;
    model: string;
    routingTier: "economy" | "quality";
    docsUrl: string;
    keyOnlySetup: boolean;
    balanceProbeSupported?: boolean;
    balanceProbeLabel?: string;
    billingCredentialKind?: "provider_api_key" | "alibaba_bss" | "openai_admin" | "console_only";
    billingCredentialConfigured?: boolean;
    billingQueryKind?: "balance" | "cost" | "console_only";
    billingConsoleUrl?: string;
    latestTest?: AiProviderResponseTestResult | null;
    latestBalance?: AiProviderBalanceResult | null;
    performance: {
      sampleCount: number;
      successCount: number;
      failureCount: number;
      successRate: number | null;
      averageLatencyMs: number | null;
      lastLatencyMs: number | null;
      consecutiveFailures: number;
      circuitState: "unmeasured" | "closed" | "open" | "half_open";
      cooldownRemainingMs: number;
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
    };
    isPrimary: boolean;
    inFallbackChain: boolean;
    inEconomyChain: boolean;
    inQualityChain: boolean;
    available?: boolean | null;
    latencyMs?: number;
    error?: string;
  }>;
};

export type AiProviderServerEnvBundle = {
  generated: true;
  generatedAt: string;
  filePath: string;
  fileName: string;
  envText: string;
  providerCount: number;
  configuredProviderCount: number;
  missingProviders: Array<{
    name: string;
    label: string;
    apiKeyEnv: string;
    enabledEnv: string;
    modelEnv: string;
    baseUrlEnv: string;
  }>;
  includedProviders: Array<{
    name: string;
    label: string;
    enabled: boolean;
    apiKeyConfigured: boolean;
    apiKeyEnv: string;
    modelEnv: string;
    baseUrlEnv: string;
  }>;
  copyHint: string;
};

export type AiProviderBalanceResult = {
  checked: boolean;
  supported: boolean;
  metric: "balance" | "cost";
  status: "available" | "insufficient" | "unsupported" | "error";
  display: string;
  amount: number | null;
  currency: string | null;
  endpoint: string;
  checkedAt: string | null;
  details: Array<{ label: string; value: string }>;
  error?: string;
};

export type AiProviderResponseTestResult = {
  tested: true;
  testedAt: string;
  provider: string;
  label: string;
  model: string;
  enabled: boolean;
  configured: boolean;
  testUrl: string;
  requestKind: "chat_completion";
  expectedReply: string;
  available: boolean;
  latencyMs: number;
  outputCharacters: number;
  charactersPerSecond: number;
  responsePreview: string;
  replyMatched: boolean;
  balance: AiProviderBalanceResult;
  checks: Array<{
    key: "configuration" | "connection" | "response" | "speed";
    label: string;
    ok: boolean;
    detail: string;
  }>;
  error?: string;
};

export type DeliveryReadiness = {
  schema: "smart_kefu_delivery_readiness_v1";
  generatedAt: string;
  mode: "offline_report_inventory";
  networkCalls: false;
  commandsExecuted: false;
  commandEnvironment?: {
    platform: string;
    shell: "windows" | "posix";
    workspace: "development_or_release";
    productionServerExecutionSupported: false;
  };
  status: "ready" | "blocked" | "failed" | "unknown";
  productMode: string;
  nextAction: string;
  recommendedCommands: Array<{ label: string; command: string; reason: string }>;
  projectAudit: {
    available: boolean;
    reportPath: string;
    generatedAt: string;
    status: string;
    counts: { pass: number; blocked: number; fail: number };
    blockers: DeliveryReadinessBlocker[];
  };
  acceptance: {
    available: boolean;
    reportPath: string;
    runId: string;
    startedAt: string;
    finishedAt: string;
    requestedMode: string;
    executedModes: string[];
    summary: { passed: number; failed: number; blocked: number; skipped: number; total: number };
    blockers: DeliveryReadinessBlocker[];
  };
  evidenceReports: DeliveryEvidenceReport[];
  releaseCandidateScope: DeliveryReleaseCandidateScope;
  localDelivery: DeliveryLocalDeliveryVerdict;
  freshness: {
    checkedAt: string;
    maxAgeHours: number;
    staleSourceIds: string[];
    sources: Array<{
      id: string;
      label: string;
      available: boolean;
      generatedAt: string;
      external: boolean;
      command: string;
      stale: boolean;
    }>;
  };
  blockers: DeliveryReadinessBlocker[];
};

export type DeliveryLocalDeliveryVerdict = {
  state: "local_verified" | "local_verified_external_blocked" | "local_evidence_incomplete" | "local_failed";
  label: string;
  summary: string;
  localEvidenceReady: boolean;
  productionReleaseAllowed: boolean;
  localCodeDefectCount: number;
  localEvidenceBlockerCount: number;
  externalBlockerCount: number;
  localEvidenceBlockerIds: string[];
  externalBlockerIds: string[];
  canContinueDuringIcp: boolean;
};

export type DeliveryReleaseCandidateScopeGroup = {
  id: string;
  label: string;
  risk: "high" | "medium" | "low" | string;
  count: number;
  untracked: number;
  modified: number;
  paths: string[];
};

export type DeliveryReleaseCandidateScope = {
  available: boolean;
  reportPath: string;
  generatedAt: string;
  status: string;
  requiresCleanReleaseWorkspace: boolean;
  statusEntriesAvailable: boolean;
  statusEntryCount: number;
  untrackedCount: number;
  modifiedCount: number;
  groups: DeliveryReleaseCandidateScopeGroup[];
  riskNotes: string[];
};

export type DeliveryEvidenceReport = {
  id: string;
  label: string;
  available: boolean;
  reportPath: string;
  generatedAt: string;
  status: string;
  mode: string;
  summary: string;
  counts: { pass: number; blocked: number; fail: number; skipped?: number; total?: number };
  command: string;
};

export type DeliveryReadinessBlocker = {
  id: string;
  title: string;
  status: "blocked" | "failed";
  summary: string;
  source: "project_completion_audit" | "product_acceptance" | string;
  external: boolean;
  command?: string;
  ownerHint: string;
  phase: "during_icp" | "after_icp" | "release_gate";
  actionItems: string[];
};

export type WechatWorkReadinessStatus = "ready" | "blocked" | "missing";

export type WechatWorkReadinessCheck = {
  key: string;
  status: WechatWorkReadinessStatus;
  detail: string;
  external: boolean;
  reason: string;
  fix: string;
  evidence?: string;
};

export type WechatWorkLaunchPlanItem = {
  key: string;
  title: string;
  detail: string;
  status: WechatWorkReadinessStatus;
  phase: "during_icp" | "after_icp";
  owner: "developer" | "operator" | "wechat_admin";
  action: string;
};

export type WechatWorkCallbackConsoleField = {
  key: string;
  label: string;
  sourceEnv: string;
  status: WechatWorkReadinessStatus;
  detail: string;
  secret: boolean;
  copyValue?: string;
};

export type WechatWorkPreLiveChecklistItem = {
  key: string;
  title: string;
  detail: string;
  status: WechatWorkReadinessStatus;
  phase: "during_icp" | "before_external_joint_test";
  owner: "developer" | "operator" | "wechat_admin";
  verify: string;
  blockedBy?: string;
};

export type WechatWorkProductionReadiness = {
  schema: "smart_kefu_wechat_work_readiness_v1";
  mode: "offline_preflight";
  networkCalls: false;
  status: WechatWorkReadinessStatus;
  productionReady: boolean;
  source?: {
    kind: "desktop_local" | "production_server" | "remote_unavailable";
    label: string;
    checkedAt: string;
    endpoint?: string;
    errorCode?: string;
  };
  local: {
    status: WechatWorkReadinessStatus;
    ready: boolean;
    checks: WechatWorkReadinessCheck[];
  };
  external: {
    status: WechatWorkReadinessStatus;
    ready: boolean;
    checks: WechatWorkReadinessCheck[];
    blockers: string[];
  };
  callback: {
    path: string;
    url: string;
    publicHttpsFormatReady: boolean;
    consoleFields: WechatWorkCallbackConsoleField[];
    localVerification: string[];
    externalVerification: string[];
  };
  identityPolicy: {
    channel: "work_wechat";
    accountPlatform: "wechat_work_kf";
    adapter: "wechat_work_kf";
    requiresPersistentBinding: true;
    callerSelectableAdapter: false;
  };
  codeContracts: string[];
  launchPlan: {
    currentPhase: "local_configuring" | "icp_waiting" | "external_acceptance" | "production_ready";
    recommendedNextAction: string;
    duringIcp: WechatWorkLaunchPlanItem[];
    afterIcp: WechatWorkLaunchPlanItem[];
  };
  preLiveChecklist: {
    duringIcp: WechatWorkPreLiveChecklistItem[];
    beforeExternalJointTest: WechatWorkPreLiveChecklistItem[];
  };
  metrics: {
    mappedAccounts: number;
    auditRecords: number;
  };
};

export type WechatWorkAuthorizationFlow = {
  id: string;
  status: "pending" | "exchanging" | "completed" | "failed" | "expired";
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  corpId?: string;
  error?: string;
};

export type WechatWorkAuthorizationStatus = {
  schema: "smart_kefu_wechat_work_suite_authorization_status_v1";
  configured: boolean;
  readyForInstall: boolean;
  checks: Array<{ key: string; ok: boolean; detail: string }>;
  callbacks: {
    command: string;
    authorization: string;
  };
  latestFlow: WechatWorkAuthorizationFlow | null;
  flows: WechatWorkAuthorizationFlow[];
  authorizations: Array<{
    corpId: string;
    corpName: string;
    corpType: string;
    logoUrl: string;
    status: "active" | "revoked";
    authorizedAt: string;
    updatedAt: string;
  }>;
  activeAuthorizationCount: number;
  credentialMode: "suite_authorization" | "static_secret" | "unavailable";
};

export type WechatWorkAuthorizationInstallLink = {
  flow: WechatWorkAuthorizationFlow;
  installUrl: string;
};

export type WechatWorkCustomerEntry = {
  openKfid: string;
  scene: string;
  url: string;
  generatedAt: string;
};

export type WechatWorkConnectionDiagnosis = {
  checkedAt: string;
  apiReachable: boolean;
  credentialCompatible: boolean;
  configuredOpenKfid: string;
  configuredOpenKfidFound: boolean;
  accounts: Array<{
    openKfid: string;
    name: string;
    avatar: string;
    managePrivilege: boolean;
    customerEntry: WechatWorkCustomerEntry | null;
  }>;
  customerEntryAccountCount: number;
  evidence: {
    latestCallbackAt: string | null;
    latestInboundAt: string | null;
    latestOfficialSendAt: string | null;
    latestOfficialSendStatus: string | null;
  };
  ready: boolean;
  detail: string;
  blockerCode: string;
};

export type WechatWorkCustomerServiceOperations = {
  checkedAt: string;
  accountCount: number;
  servicerCount: number;
  manageableAccountCount: number;
  directoryAvailable: boolean;
  directoryError: string | null;
  memberSource: "enterprise_directory" | "upgrade_service_members" | "assigned_servicers_only";
  memberSourceDetail: string;
  partial: boolean;
  availableMembers: Array<{
    userId: string;
    displayName: string;
    avatar: string;
    departments: number[];
    resolution: "user_get" | "user_get_alias" | "userid_fallback";
  }>;
  accounts: Array<{
    openKfid: string;
    name: string;
    avatar: string;
    managePrivilege: boolean;
    configured: boolean;
    servicerError: string | null;
    servicers: Array<{
      userId: string;
      displayName: string;
      avatar: string;
      departments: number[];
      resolution: "user_get" | "user_get_alias" | "userid_fallback";
      status: number | null;
      statusName: string;
    }>;
  }>;
  proofBoundary: string;
};

export type WechatWorkCustomerServiceOperationResult = {
  ok: boolean;
  partial: boolean;
  openKfid: string;
  requested: number;
  succeeded: number;
  failed: number;
  results: Array<{ userId: string; ok: boolean; errcode: number; errmsg: string }>;
};

export type WechatWorkCustomerServiceStatisticMetrics = {
  sessionCount: number | null;
  customerCount: number | null;
  customerMessageCount: number | null;
  upgradeServiceCustomerCount: number | null;
  aiSessionReplyCount: number | null;
  aiTransferRate: number | null;
  aiKnowledgeHitRate: number | null;
  replyRate: number | null;
  firstReplyAverageSec: number | null;
  satisfactionInvestigationCount: number | null;
  satisfactionParticipationRate: number | null;
  satisfiedRate: number | null;
  middlingRate: number | null;
  dissatisfiedRate: number | null;
  upgradeServiceMemberInviteCount: number | null;
  upgradeServiceMemberCustomerCount: number | null;
  upgradeServiceGroupchatInviteCount: number | null;
  upgradeServiceGroupchatCustomerCount: number | null;
  messageRejectedCustomerCount: number | null;
};

export type WechatWorkCustomerServiceStatistics = {
  schema: "smart_kefu_wechat_work_statistics_v1";
  status: "ready" | "empty" | "permission_required" | "rate_limited" | "unavailable";
  checkedAt: string;
  period: {
    startDate: string;
    endDate: string;
    startTime: number;
    endTime: number;
    dayCount: number;
    availableThrough: string;
  };
  account: { openKfid: string; name: string };
  corporate: {
    daily: Array<{ statTime: number; date: string; metrics: WechatWorkCustomerServiceStatisticMetrics }>;
    summary: WechatWorkCustomerServiceStatisticMetrics;
  } | null;
  servicerSummary: {
    daily: Array<{ statTime: number; date: string; metrics: WechatWorkCustomerServiceStatisticMetrics }>;
    summary: WechatWorkCustomerServiceStatisticMetrics;
  } | null;
  servicers: Array<{
    userId: string;
    displayName: string;
    nameResolution: "user_get" | "user_get_alias" | "userid_fallback";
    status: number | null;
    statusName: string;
    daily: Array<{ statTime: number; date: string; metrics: WechatWorkCustomerServiceStatisticMetrics }>;
    summary: WechatWorkCustomerServiceStatisticMetrics;
  }>;
  partial: boolean;
  partialReason: "rate_limited" | "servicer_errors" | null;
  errors: Array<{ userId: string; code: string; message: string; apiErrcode: number | null }>;
  error: {
    status: "permission_required" | "rate_limited" | "unavailable";
    code: string;
    message: string;
    apiErrcode: number | null;
    retryAfterSeconds: number | null;
  } | null;
  proofBoundary: string;
};

export type WechatWorkCallbackEventStatus = {
  configured: boolean;
  connected: boolean;
  endpoint: string | null;
  lastConnectedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  reconnects: number;
};

export type WechatWorkCredentialValidation = {
  valid: true;
  configuredOpenKfid: string;
  suggestedOpenKfid: string;
  accounts: Array<{ openKfid: string; name: string; avatar: string; managePrivilege: boolean }>;
  detail: string;
};

export type WechatWorkDesktopSetupOptions = {
  corpId: string;
  callbackToken: string;
  encodingAesKey: string;
  publicBaseUrl?: string;
  enableAutomaticReplies: boolean;
};

export type WechatWorkCredentialSaveResult = {
  saved: boolean;
  secretConfigured: boolean;
  account: WechatWorkCredentialValidation["accounts"][number];
  restartRequired: boolean;
  activation: {
    activated: boolean;
    sync: {
      ok: boolean;
      receivedCount: number;
      processedCount: number;
      failedCount: number;
      errorMessage?: string;
    };
    customerEntry: {
      ok: boolean;
      entry: WechatWorkCustomerEntry | null;
      errorMessage?: string;
    };
  };
  detail: string;
};

export type WechatWorkUpgradeServiceConfig = {
  ready: boolean;
  deliveryReady?: boolean;
  memberUserIds: string[];
  memberOptions?: Array<{
    userId: string;
    displayName: string;
    resolution?: "user_get" | "user_get_alias" | "userid_fallback";
    errorCode?: number | null;
  }>;
  departmentIds: number[];
  groupChatIds: string[];
  customerContact?: {
    configured: boolean;
    ready: boolean;
    credentialSource?: "external_contact_override" | "wechat_work_shared" | "none";
    applications?: Array<{ agentId: number; name: string }>;
    eligibleMemberUserIds: string[];
    blockerCode?: string | null;
    errcode?: number | null;
    detail: string;
    callback?: {
      locallyReady: boolean;
      url: string | null;
      detail: string;
    };
  };
  detail: string;
};

export type WechatWorkCustomerUpgradeResult = {
  ok: boolean;
  manualResend?: boolean;
  recommended: boolean;
  alreadyRecommended: boolean;
  recommendationPending?: boolean;
  memberUserId: string;
  conversationId: string;
  customerId: string;
  recommendationAuditId?: string;
  recommendedAt?: string | null;
  duplicateScope?: "customer_member";
  deliveryMode?: "wechat_work_external_contact_qr" | string;
  customerDeliveryApiAccepted?: boolean;
  customerPhoneReceiptConfirmed?: boolean;
  customerAddedSpecialistConfirmed?: boolean;
  alreadyDelivered?: boolean;
  deliveryPending?: boolean;
  deliveryStatus?: string;
  textStatus?: string;
  imageStatus?: string;
  sendTaskId?: string | null;
  sendAttemptId?: string | null;
  msgids?: string[];
  contactWayConfigId?: string;
  deliveryNote?: string;
};

export type WechatWorkCustomerUpgradeStatus = {
  exists: boolean;
  memberUserId: string;
  status: string;
  deliveryPending: boolean;
  qrRecoveryAvailable?: boolean;
  manualResendAvailable?: boolean;
  customerDeliveryApiAccepted: boolean;
  customerPhoneReceiptConfirmed: boolean;
  customerAddedSpecialistConfirmed: boolean;
  textStatus?: string;
  imageStatus?: string;
  sendTaskId?: string | null;
  sendAttemptId?: string | null;
  apiAcceptedAt?: string | null;
  asyncFailedAt?: string | null;
  halfAddedAt?: string | null;
  identityVerifiedAt?: string | null;
  addedAt?: string | null;
  errorMessage?: string | null;
  detail?: string;
};

export type AiProviderModelSyncResult = {
  synced: true;
  provider: string;
  label: string;
  source: "upstream";
  endpoint: string;
  fetchedAt: string;
  models: Array<{ id: string; label: string }>;
};

export type WechatWorkCustomerUpgradeRetryResult = {
  ok: boolean;
  recovered: boolean;
  recoveryDeferred?: boolean;
  triggerMsgid: string | null;
  status: WechatWorkCustomerUpgradeStatus;
};

export type WechatWorkCapabilityItem = {
  key: string;
  label: string;
  status: string;
  ready: boolean;
  detail: string;
  customerVisibleDelivery?: boolean;
  requiresReceptionistAction?: boolean;
  errcode?: number;
};

export type WechatWorkCapabilities = {
  checkedAt: string;
  configured: boolean;
  checks: Array<{ key: string; env: string; ok: boolean; detail: string }>;
  summary: {
    total: number;
    verified: number;
    available: number;
    availableUnverified: number;
    partial: number;
    blocked: number;
    configMissing: number;
  };
  capabilities: WechatWorkCapabilityItem[];
  proofBoundaries: string[];
};

export type WechatWorkServiceStateResult = {
  ok: boolean;
  serviceState: number | null;
  serviceStateName: string;
  servicerUserId: string | null;
  msgCodePresent: boolean;
  eventCredentialId: string | null;
  eventCredentialExpiresAt: string | null;
  proofBoundary: string;
};

export type WechatWorkCancelUpgradeResult = {
  ok: boolean;
  cancelled: boolean;
  conversationId: string;
  customerId: string;
  customerVisibleDelivery: boolean;
  deliveryNote: string;
};

export type WechatWorkEventTextResult = {
  ok: boolean;
  accepted: boolean;
  sendTaskId: string;
  sendAttemptId: string | null;
  status: string;
  msgid: string | null;
  eventCredentialId: string;
  proofBoundary: string;
};

export type WechatWorkEventMenuResult = WechatWorkEventTextResult;

export type WechatWorkCustomerServiceMessagePayload = {
  msgtype: "text" | "image" | "voice" | "video" | "file" | "link" | "miniprogram" | "msgmenu" | "location";
  message?: Record<string, unknown>;
  text?: Record<string, unknown>;
  image?: Record<string, unknown>;
  voice?: Record<string, unknown>;
  video?: Record<string, unknown>;
  file?: Record<string, unknown>;
  link?: Record<string, unknown>;
  miniprogram?: Record<string, unknown>;
  msgmenu?: Record<string, unknown>;
  location?: Record<string, unknown>;
  mediaId?: string;
  mediaPath?: string;
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
  unreadCount?: number;
  lastMessagePreview?: string;
  lastMessageAt?: string;
  customer?: {
    id: string;
    name: string;
    avatarUrl?: string | null;
    wechatId?: string | null;
    phone?: string | null;
    tags?: string[];
    notes?: string | null;
    source?: string | null;
    createdAt?: string;
    updatedAt?: string;
  };
  wechatAccount?: WechatAccount;
};

export type CreateDesignJobInput = {
  operationKey: string;
  wechatAccountId?: string;
  customerId: string;
  conversationId: string;
  budget: Record<string, unknown>;
  scene?: string;
  bundle: Record<string, unknown>;
  assetIds?: string[];
  assets: Array<Record<string, unknown>>;
  customerText?: string;
  designType?: string;
  outputCount?: number;
};

export type ConversationOperations = Conversation & {
  assignee: string | null;
  assignmentState: "assigned" | "unassigned";
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "pending" | "resolved" | "closed";
  slaDueAt: string | null;
  firstResponseDueAt: string | null;
  firstResponseAt: string | null;
  firstResponseBreached: boolean;
  slaOverdue: boolean;
  firstResponseOverdue: boolean;
  isOverdue: boolean;
  slaState: "no_sla" | "on_track" | "overdue" | "closed" | "invalid";
  configurationIssues: string[];
};

export type ConversationOperationsSummary = {
  total: number;
  assigned: number;
  unassigned: number;
  overdue: number;
  slaOverdue: number;
  firstResponseOverdue: number;
  firstResponseBreached: number;
  noSla: number;
  invalidConfiguration: number;
  priorities: Record<"low" | "normal" | "high" | "urgent", number>;
  statuses: Record<"open" | "pending" | "resolved" | "closed", number>;
};

export type ConversationOperationsQueue = {
  records: ConversationOperations[];
  total: number;
  limit: number;
  offset: number;
  summary: ConversationOperationsSummary;
};

export type ConversationOperationsPatch = {
  assignee?: string | null;
  priority?: ConversationOperations["priority"];
  status?: ConversationOperations["status"];
  slaDueAt?: string | null;
  firstResponseDueAt?: string | null;
};

export type ConversationIdentity = {
  wechatAccountId: string;
  conversationId: string;
  customerId: string;
};

export type ConversationAttachment = {
  id: string;
  assetId?: string;
  source?: string;
  msgtype?: string;
  kind: "image" | "voice" | "video" | "file";
  name: string;
  mimeType?: string;
  status: string;
  url?: string;
  localPath?: string;
  path?: string;
  sizeBytes?: number;
};

export type ConversationTimelineItem = {
  id: string;
  source: "message" | "send_task";
  sendTaskId?: string;
  conversationId: string;
  customerId: string;
  wechatAccountId: string;
  direction: "inbound" | "outbound";
  text?: string;
  messageType?: string;
  content?: Record<string, unknown> | null;
  attachments: ConversationAttachment[];
  status: string;
  errorMessage?: string;
  readAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  sentAt?: string | null;
  metadata?: Record<string, unknown>;
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
  payload: Record<string, unknown> & {
    kind?: string;
    text?: string;
    routeId?: string;
    inboundMessageId?: string;
    automationPlan?: string;
    routingPolicy?: RouteEvaluation["routingPolicy"];
  };
    guardSnapshot?: {
      status?: string;
      reason?: string;
      requeueReason?: string;
      requeuedAt?: string;
      cancelReason?: string;
      cancelledAt?: string;
      deliveryState?: string;
      wechatWorkDeliveryState?: string;
      deliveryUnknownReason?: string;
      deliveryUnknownAt?: string;
      automaticRetryBlocked?: boolean;
      manualReviewRequired?: boolean;
      manualReply?: boolean;
      manualDeliveryResolution?: {
        resolution?: "confirmed_sent" | "confirmed_not_sent";
        reason?: string;
        reviewer?: string;
        resolvedAt?: string;
      };
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
    blockedByRoutingPolicy?: boolean;
    blockedBy?: string;
    blockedAt?: string;
      failedKeys?: string[];
      windowDiagnostic?: {
        ok?: boolean;
        status?: string;
        riskLevel?: string;
        reason?: string;
        activeConversationId?: string | null;
        activeCustomerId?: string | null;
        failedKeys?: string[];
      } | null;
      history?: Array<{
        action?: string;
        fromStatus?: string;
        reason?: string;
        at?: string;
        reviewer?: string;
      }>;
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
  customerId?: string;
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

export type BridgeDispatchEntry = {
  fileName: string;
  taskId?: string;
  attemptId?: string;
  wechatAccountId?: string;
  conversationId?: string;
  protocolVersion?: string;
  payloadKind?: string;
  actionCount?: number;
  outboxFileName?: string;
  ackFileNameHint?: string;
  failedAckFileNameHint?: string;
  preflight?: {
    requiredBeforeSend?: string[];
    expectedWechatAccountId?: string;
    expectedConversationId?: string;
    expectedConversationTitle?: string;
    expectedCustomerId?: string;
    expectedCustomerName?: string;
    expectedWindowSnapshotId?: string | null;
    rejectIfAnyCheckFails?: boolean;
    rejectIfWindowChanged?: boolean;
    rejectIfExpired?: boolean;
    rejectIfOutboxMissing?: boolean;
  };
  createdAt?: string;
  expiresAt?: string;
  modifiedAt?: string;
  ageSeconds?: number;
  expired?: boolean;
  errorMessage?: string;
};

export type BridgeInboxScanResult = {
  scanned: number;
  processed: BridgeInboxEntry[];
  failed: BridgeInboxEntry[];
};

export type BridgeDispatchResult = {
  staleCount?: number;
  pending: BridgeDispatchEntry[];
};

export type WindowSnapshotInboxScanResult = {
  scanned: number;
  total?: number;
  pending?: number;
  limit?: number;
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
  dispatch?: {
    pendingCount: number;
    staleCount?: number;
    pending: BridgeDispatchEntry[];
  };
  locks: {
    activeCount: number;
    staleCount: number;
    active: BridgeLockEntry[];
  };
};

export type WechatChannelKey = "personal_wechat" | "work_wechat" | "mini_program";

export type WechatChannelStatusItem = {
  key: WechatChannelKey;
  label: string;
  kind: string;
  status: "ready" | "needs_runtime" | "needs_send_adapter" | "needs_config" | string;
  ready: boolean;
  description: string;
  entrypoints: Record<string, string>;
  metrics: Record<string, number>;
  checks: Array<{
    key: string;
    label: string;
    passed: boolean;
    detail?: string;
  }>;
};

export type WechatChannelStatus = {
  updatedAt: string;
  summary: {
    total: number;
    ready: number;
    degraded: number;
    needsSendAdapter?: number;
    needsConfig: number;
    pendingSendTasks: number;
    queuedSendTasks?: number;
    inFlightSendTasks?: number;
    knownInFlightSendTasks?: number;
    unknownDeliveryTasks?: number;
    blockedSendTasks?: number;
    failedSendTasks?: number;
    sendAttentionTasks?: number;
    manualLockedConversations: number;
  };
  channels: WechatChannelStatusItem[];
  visualFlow: Array<{
    key: string;
    label: string;
    detail: string;
  }>;
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
    scanScanned?: number | null;
    scanProcessed?: number | null;
    scanFailed?: number | null;
    scanPending?: number | null;
    scanTotal?: number | null;
    scanLimit?: number | null;
  } | null;
};

export type RouteEvaluation = {
  id: string;
  channel: string;
  text: string;
  customerId?: string | null;
  conversationId?: string | null;
  wechatAccountId?: string | null;
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
  routingPolicy?: {
    lane?: string;
    valueTier?: "high" | "standard" | string;
    handler?: "human" | "agent" | string;
    agentKey?: string;
    scene?: string;
    manualRequired?: boolean;
    canDraftReply?: boolean;
    canAskClarification?: boolean;
    canQueueAutoReply?: boolean;
    autoSendAllowed?: boolean;
    reason?: string;
    nextStep?: string;
    safeguards?: string[];
  } | null;
  suggestedReply: string;
  appliedSkills?: Array<{
    id?: string;
    name: string;
    description?: string;
    confidence?: number;
    sampleCount?: number;
    version?: number;
    scope?: {
      level?: string;
      label?: string;
      bindingStatus?: string;
      wechatAccountId?: string;
      conversationId?: string;
      customerId?: string;
    };
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
    routingPolicy?: RouteEvaluation["routingPolicy"];
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
  bundleSnapshot?: Record<string, unknown> | null;
  selectedImageSnapshot?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; name: string };
  designJob?: DesignJob;
  selectedImage?: NonNullable<DesignJob["images"]>[number] | null;
  sendTask?: SendTask | null;
  paymentEvents?: PaymentEvent[];
};

export type ConversationReplySuggestion = {
  suggestedReply: string;
  sourceText: string;
  knowledgeMatches: NonNullable<RouteEvaluation["knowledgeMatches"]>;
  appliedSkills: NonNullable<RouteEvaluation["appliedSkills"]>;
  ai: {
    provider: string;
    model: string;
    attempts: number;
    qualityRepairs: number;
    historyTurns: number;
  };
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
  productionStatus?: string | null;
  productionDueAt?: string | null;
  carrier?: string | null;
  trackingNo?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
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
  paymentEvents?: PaymentEvent[];
};

export type PaymentEvent = {
  id: string;
  quoteDraftId: string;
  orderDraftId?: string | null;
  customerId: string;
  conversationId?: string | null;
  wechatAccountId?: string | null;
  paymentStatus: "deposit_paid" | "paid" | string;
  amountCny?: number | string | null;
  method?: string | null;
  proofReference?: string | null;
  reviewer?: string | null;
  note?: string | null;
  source?: string | null;
  idempotencyKey?: string;
  createdAt: string;
};

export type AfterSalesCase = {
  id: string;
  orderDraftId: string;
  quoteDraftId?: string | null;
  designJobId?: string | null;
  status: "open" | "resolved" | "rejected" | "cancelled" | string;
  type: "refund" | "replacement" | "return" | "compensation" | "other" | string;
  typeLabel?: string;
  reason: string;
  requestedAmountCny?: number | string | null;
  evidenceReference?: string | null;
  desiredResolution?: string | null;
  paymentSummary?: {
    paidAmountCny: number;
    refundedAmountCny: number;
    refundableAmountCny: number;
  } | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  resolution?: {
    type: string;
    typeLabel?: string;
    approvedAmountCny?: number | string | null;
    refundMethod?: string | null;
    refundReference?: string | null;
    replacementCarrier?: string | null;
    replacementTrackingNo?: string | null;
    note?: string | null;
    paymentEventId?: string | null;
    resolvedBy?: string | null;
    resolvedAt?: string | null;
  } | null;
};

export type QuotePreview = {
  quote: QuoteDraft;
  message: string;
  warnings: string[];
};

export type OrderConfirmationPreview = {
  orderDraft: OrderDraft;
  message: string;
  warnings: string[];
};

export type OrderFollowupPreview = OrderConfirmationPreview & {
  type: "production" | "delivery";
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
  orderDrafts: OrderDraft[];
  logs: ReviewLog[];
};

export type ReviewDesignJobResult = {
  result?:
    | {
        designJob?: DesignJob | null;
        sendTask?: SendTask | null;
      }
    | DesignJob
    | null;
  log?: ReviewLog;
  notification?: NotificationItem | null;
};

export type ReviewQuoteResult = {
  result?:
    | {
        quote?: QuoteDraft | null;
        sendTask?: SendTask | null;
        notification?: NotificationItem | null;
      }
    | QuoteDraft
    | null;
  log?: ReviewLog;
  notification?: NotificationItem | null;
};

export type ReviewOrderResult = {
  result?:
    | {
        orderDraft?: OrderDraft | null;
        order?: OrderDraft | null;
        sendTask?: SendTask | null;
        notification?: NotificationItem | null;
      }
    | OrderDraft
    | null;
  log?: ReviewLog;
  notification?: NotificationItem | null;
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
    action?: string;
  }>;
  nextSteps: string[];
  config: {
    hasApiKey: boolean;
    hasAccessToken: boolean;
    hasCookie: boolean;
    hasDeviceId: boolean;
    hasCallbackApiKey?: boolean;
    callbackUrl?: string;
    zhenxiAi?: ZhenxiAiLinks;
  };
  data?: Record<string, unknown>;
};

export type ZhenxiAiLinks = {
  primaryAppUrl: string;
  websiteUrl: string;
  wwwWebsiteUrl: string;
  localDevUrl?: string;
  localPreviewUrl?: string;
  localCandidateBaseUrls?: string[];
  authRedirectUrls: string[];
};

export type DesignPlatformConfigSummary = {
  adapter: string;
  baseUrl: string;
  hasApiKey: boolean;
  hasAccessToken: boolean;
  hasCookie: boolean;
  hasDeviceId: boolean;
  hasCallbackApiKey?: boolean;
  customerServicePublicBaseUrl?: string;
  callbackUrl?: string;
  zhenxiAi?: ZhenxiAiLinks;
  deviceIdSuffix?: string;
  runtimeConfigPath?: string;
};

export type DesignPlatformConfigResponse = {
  ok: boolean;
  config: DesignPlatformConfigSummary;
  readiness?: DesignPlatformReadiness;
};

export type DesignPlatformCandidateProbeResponse = {
  ok: boolean;
  adapter: string;
  selectedBaseUrl: string;
  recommendedBaseUrl: string;
  candidateCount: number;
  candidates: Array<{
    baseUrl: string;
    ok: boolean;
    generationReady?: boolean;
    selected: boolean;
    latencyMs: number;
    statusCode?: number;
    service?: string;
    status?: string;
    version?: string;
    runtimeChannel?: string;
    generationBackend?: string;
    localWorkspace?: boolean;
    imageConfigured?: boolean;
    imageModel?: string;
    imageApiType?: string;
    gptImageModel?: boolean;
    errorMessage?: string;
  }>;
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

export type DesignPlatformSmokeTestResult = {
  ok: boolean;
  adapter: string;
  baseUrl: string;
  latencyMs: number;
  requestId: string;
  externalJobId?: string;
  status: string;
  expectedCandidateCount: number;
  assetUploadCount: number;
  candidateCount: number;
  savedImageCount: number;
  savedImagePaths: string[];
  savedImagePreviews: Array<{
    imageId: string;
    dataUrl: string;
  }>;
  steps: Array<{
    key: string;
    label: string;
    ok: boolean;
    detail?: string;
  }>;
  contractChecks?: Array<{
    key: string;
    label: string;
    ok: boolean;
    detail?: string;
    expected?: string | number;
    actual?: string | number;
  }>;
  errorMessage?: string;
};

export type DesignJobPreflightResult = {
  ok: boolean;
  adapter: string;
  baseUrl: string;
  designJobId: string;
  requestId: string;
  status: string;
  isHighValue: boolean;
  outputCount?: number;
  requiredOutputCountRange?: {
    min: number;
    max: number;
  };
  usableReferenceCount: number;
  unusableReferenceCount: number;
  callback?: {
    url: string;
    method: string;
    events: string[];
    hasAuthorization: boolean;
    fallbackPolling: boolean;
  };
  checks: Array<{
    key: string;
    label: string;
    ok: boolean;
    severity: "info" | "warning" | "error";
    detail?: string;
    action?: string;
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
  fulfillment?: {
    requestedQuantity: number;
    capacity: number;
    enough: boolean;
    bottleneckSkuCode?: string | null;
  };
  automation?: {
    ready: boolean;
    blockers: string[];
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
} & IdentityExpectation;

const API_BASE = "/api";
const WECHAT_CHANNEL_STATUS_RETRY_DELAYS_MS = [300, 700, 1200, 2000, 3200];
const TRUSTED_DESKTOP_SESSION_ERROR_CODES = new Set([
  "desktop_session_unavailable",
  "desktop_session_proof_missing",
  "desktop_session_proof_invalid",
  "trusted_local_session_required",
  "trusted_local_session_unavailable",
  "trusted_session_proof_missing",
  "runtime_session_not_configured",
]);

export type IdentityFilters = {
  agentId?: string;
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
  assetId?: string;
  assetRole?: string;
};

export type AgentTask = {
  id: string;
  operationKey: string;
  status: string;
  taskType: string;
  lane?: string | null;
  routeAction?: string | null;
  objective?: string | null;
  currentStep?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
  steps?: Array<Record<string, unknown>>;
  approvals?: Array<Record<string, unknown>>;
  toolExecutions?: Array<Record<string, unknown>>;
};

export type IdentityExpectation = {
  expectedWechatAccountId?: string;
  expectedConversationId?: string;
  expectedCustomerId?: string;
};

export type ManualReleaseOptions = {
  releaseManualLock?: boolean;
  releaseReason?: string;
  reason?: string;
  note?: string;
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly trustedDesktopSessionRequired: boolean;

  constructor(message: string, options: { status: number; code?: string; trustedDesktopSessionRequired?: boolean }) {
    super(message);
    this.name = options.trustedDesktopSessionRequired ? "TrustedDesktopSessionError" : "ApiRequestError";
    this.status = options.status;
    this.code = options.code || "";
    this.trustedDesktopSessionRequired = Boolean(options.trustedDesktopSessionRequired);
  }
}

export type DesktopShellOpenResponse = {
  ok: boolean;
  action: "open_zhenxi_ai_desktop";
  url: string;
  pid: number | null;
};

export function isTrustedDesktopSessionError(error: unknown) {
  return error instanceof ApiRequestError && error.trustedDesktopSessionRequired;
}

function sleepApi(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function identityExpectation(record: {
  wechatAccountId?: string | null;
  conversationId?: string | null;
  customerId?: string | null;
  target?: { wechatAccountId?: string | null; conversationId?: string | null; customerId?: string | null } | null;
  conversation?: { customerId?: string | null; title?: string | null } | null;
  designJob?: { wechatAccountId?: string | null; conversationId?: string | null; customerId?: string | null } | null;
  quoteDraft?: {
    customerId?: string | null;
    designJob?: { wechatAccountId?: string | null; conversationId?: string | null; customerId?: string | null } | null;
  } | null;
}): IdentityExpectation {
  return {
    expectedWechatAccountId: firstIdentityValue(
      record.wechatAccountId,
      record.target?.wechatAccountId,
      record.designJob?.wechatAccountId,
      record.quoteDraft?.designJob?.wechatAccountId,
    ),
    expectedConversationId: firstIdentityValue(
      record.conversationId,
      record.target?.conversationId,
      record.designJob?.conversationId,
      record.quoteDraft?.designJob?.conversationId,
    ),
    expectedCustomerId: firstIdentityValue(
      record.customerId,
      record.target?.customerId,
      record.conversation?.customerId,
      record.designJob?.customerId,
      record.quoteDraft?.customerId,
      record.quoteDraft?.designJob?.customerId,
    ),
  };
}

function firstIdentityValue(...values: Array<string | null | undefined>) {
  return values.find((value): value is string => Boolean(value));
}

function identityQuery(filters: IdentityFilters = {}) {
  const params = new URLSearchParams();
  if (filters.wechatAccountId) params.set("wechatAccountId", filters.wechatAccountId);
  if (filters.conversationId) params.set("conversationId", filters.conversationId);
  if (filters.customerId) params.set("customerId", filters.customerId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function trainingQuery(filters: IdentityFilters & { minScore?: number; includeReview?: boolean } = {}) {
  const params = new URLSearchParams(identityQuery(filters).replace(/^\?/, ""));
  if (filters.agentId) params.set("agentId", filters.agentId);
  if (filters.minScore) params.set("minScore", String(filters.minScore));
  if (filters.includeReview) params.set("includeReview", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

function expectedIdentityQuery(expected: IdentityExpectation = {}) {
  const params = new URLSearchParams();
  if (expected.expectedWechatAccountId) params.set("wechatAccountId", expected.expectedWechatAccountId);
  if (expected.expectedConversationId) params.set("conversationId", expected.expectedConversationId);
  if (expected.expectedCustomerId) params.set("customerId", expected.expectedCustomerId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function apiResponseError(response: Response) {
  const fallback = `api ${response.status}`;
  const text = await readResponseText(response);
  const payload = parseErrorPayload(text);
  const code = String(payload?.code || "").trim();
  if (isDesktopSessionErrorCode(code)) {
    return new ApiRequestError(trustedDesktopSessionMessage(code), {
      status: response.status,
      code,
      trustedDesktopSessionRequired: true,
    });
  }
  const message = String(payload?.message || "").trim();
  if (message) return new ApiRequestError(message, { status: response.status, code });
  const cleanText = text.trim();
  return new ApiRequestError(cleanText || fallback, { status: response.status, code });
}

async function readResponseText(response: Response) {
  const textReader = (response as { text?: () => Promise<string> }).text;
  if (typeof textReader !== "function") return "";
  try {
    return await textReader.call(response);
  } catch {
    return "";
  }
}

function parseErrorPayload(text: string): { code?: unknown; message?: unknown } | null {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function isDesktopSessionErrorCode(code: string) {
  return TRUSTED_DESKTOP_SESSION_ERROR_CODES.has(code);
}

function trustedDesktopSessionMessage(code: string) {
  if (code === "trusted_local_session_unavailable" || code === "runtime_session_not_configured") {
    return "桌面端可信会话还没有就绪。请用客服桌面启动器重新打开应用，等待 Web 和 API 都就绪后刷新本页；不要直接访问 3200 API。";
  }
  if (code === "trusted_local_session_required" || code === "trusted_session_proof_missing") {
    return "当前操作没有通过桌面端可信会话鉴权。请从臻希智能客服桌面端窗口打开本页；如果已经在桌面端，请刷新页面或重启客服启动器。";
  }
  return "当前页面不是已验证的臻希智能客服桌面端窗口。请从桌面端重新打开客服系统，不要直接用普通浏览器访问 127.0.0.1:3100。";
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

async function postJsonWithNetworkRetry<T>(path: string, body: unknown): Promise<T> {
  const serializedBody = JSON.stringify(body);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serializedBody,
      });
      if (!response.ok) throw await apiResponseError(response);
      return await response.json();
    } catch (error) {
      if (attempt > 0 || !(error instanceof TypeError)) throw error;
    }
  }
  throw new Error("network retry exhausted");
}

async function patchJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

async function deleteJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getDesignJobs(filters: IdentityFilters = {}): Promise<DesignJob[]> {
  const response = await fetch(`${API_BASE}/design-jobs${identityQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function createDesignJob(payload: CreateDesignJobInput): Promise<DesignJob> {
  return postJsonWithNetworkRetry<DesignJob>("/design-jobs", payload);
}

export async function getSkus(includeInactive = false): Promise<Sku[]> {
  const response = await fetch(`${API_BASE}/catalog/skus${includeInactive ? "?includeInactive=true" : ""}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getAssets(ownerType?: string, ownerId?: string, filters: IdentityFilters = {}): Promise<DesignAsset[]> {
  const params = new URLSearchParams();
  if (ownerType) params.set("ownerType", ownerType);
  if (ownerId) params.set("ownerId", ownerId);
  if (filters.wechatAccountId) params.set("wechatAccountId", filters.wechatAccountId);
  if (filters.conversationId) params.set("conversationId", filters.conversationId);
  if (filters.customerId) params.set("customerId", filters.customerId);
  const query = params.toString();
  const response = await fetch(`${API_BASE}/assets${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function uploadAsset(payload: UploadAssetPayload): Promise<DesignAsset> {
  return postJson<DesignAsset>("/assets/upload", payload);
}

export function localAssetUrl(
  localPath?: string,
  expected: IdentityExpectation = {},
  options: { thumbnail?: boolean; width?: number; height?: number } = {},
): string {
  const value = String(localPath || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  if (!/[\\/]storage[\\/]assets[\\/]/i.test(value)) return "";
  const params = new URLSearchParams(expectedIdentityQuery(expected).replace(/^\?/, ""));
  params.set("path", value);
  if (options.width) params.set("width", String(options.width));
  if (options.height) params.set("height", String(options.height));
  const route = options.thumbnail ? "/assets/local-file/thumbnail" : "/assets/local-file";
  return `${API_BASE}${route}?${params.toString()}`;
}

export function localDesignImageUrl(
  designJobId: string,
  image?: NonNullable<DesignJob["images"]>[number],
  expected: IdentityExpectation = {},
): string {
  const jobId = String(designJobId || "").trim();
  const imageKey = String(image?.id || image?.imageId || "").trim();
  if (!jobId || !imageKey || !image?.localPath) return "";
  const query = expectedIdentityQuery(expected);
  return `${API_BASE}/design-jobs/${encodeURIComponent(jobId)}/images/${encodeURIComponent(imageKey)}/local-file${query}`;
}

export async function repairLocalDesignImage(
  designJobId: string,
  imageKey: string,
  expected: IdentityExpectation = {},
): Promise<{
  repaired: boolean;
  image: NonNullable<DesignJob["images"]>[number];
  job: DesignJob;
}> {
  return postJson(
    `/design-jobs/${encodeURIComponent(designJobId)}/images/${encodeURIComponent(imageKey)}/repair-local-file`,
    expected,
  );
}

export async function createDemoCustomerLogo(customerId: string, expected: IdentityExpectation = {}): Promise<DesignAsset> {
  return postJson<DesignAsset>("/assets/demo-customer-logo", { customerId, ...expected });
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

export async function deleteSku(skuCode: string): Promise<SkuDeleteResult> {
  return deleteJson<SkuDeleteResult>(`/catalog/skus/${encodeURIComponent(skuCode)}`);
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

export async function getAgents(filters: IdentityFilters = {}): Promise<Agent[]> {
  const response = await fetch(`${API_BASE}/agents${identityQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export function localAssetByIdUrl(assetId?: string, expected: IdentityExpectation = {}): string {
  const value = String(assetId || "").trim();
  if (!value) return "";
  const params = new URLSearchParams(expectedIdentityQuery(expected).replace(/^\?/, ""));
  return `${API_BASE}/assets/${encodeURIComponent(value)}/local-file?${params.toString()}`;
}

export async function getAgentTasks(filters: IdentityFilters & { status?: string; limit?: number } = {}): Promise<AgentTask[]> {
  const params = new URLSearchParams(identityQuery(filters).replace(/^\?/, ""));
  if (filters.status) params.set("status", filters.status);
  if (filters.limit) params.set("limit", String(filters.limit));
  const query = params.toString();
  const response = await fetch(`${API_BASE}/agent-tasks${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function executeAgentTaskTool(
  taskId: string,
  executionId: string,
  payload: { idempotencyKey: string; input?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    `/agent-tasks/${encodeURIComponent(taskId)}/tool-executions/${encodeURIComponent(executionId)}/execute`,
    payload,
  );
}

export async function previewAgentTaskTool(
  taskId: string,
  executionId: string,
  payload: { idempotencyKey: string; input?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    `/agent-tasks/${encodeURIComponent(taskId)}/tool-executions/${encodeURIComponent(executionId)}/preview`,
    payload,
  );
}

export async function verifyAgentTaskTool(
  taskId: string,
  executionId: string,
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    `/agent-tasks/${encodeURIComponent(taskId)}/tool-executions/${encodeURIComponent(executionId)}/verify`,
  );
}

export function localConversationAttachmentUrl(
  conversationId?: string,
  messageId?: string,
  attachmentId?: string,
  expected: IdentityExpectation = {},
): string {
  const values = [conversationId, messageId, attachmentId].map((value) => String(value || "").trim());
  if (values.some((value) => !value)) return "";
  const params = new URLSearchParams(expectedIdentityQuery(expected).replace(/^\?/, ""));
  return `${API_BASE}/wechat/conversations/${encodeURIComponent(values[0])}/messages/${encodeURIComponent(values[1])}/attachments/${encodeURIComponent(values[2])}?${params.toString()}`;
}

export async function executeAgentSkill(
  agentId: string,
  skillId: string,
  payload: {
    operationKey: string;
    confirmation: string;
  } & IdentityFilters,
): Promise<AgentSkillExecutionResult> {
  return postJson<AgentSkillExecutionResult>(
    `/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillId)}/execute`,
    payload,
  );
}

export async function getChatImports(filters: IdentityFilters = {}): Promise<ChatImport[]> {
  const response = await fetch(`${API_BASE}/training/chat-imports${identityQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function getTrainingOverview(filters: IdentityFilters = {}): Promise<TrainingOverview> {
  const response = await fetch(`${API_BASE}/training/overview${trainingQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function getConversationLearning(
  filters: IdentityFilters & { limit?: number } = {},
): Promise<ConversationLearningDashboard> {
  const params = new URLSearchParams(identityQuery(filters).replace(/^\?/, ""));
  if (filters.limit) params.set("limit", String(filters.limit));
  const query = params.toString();
  const response = await fetch(`${API_BASE}/training/conversation-learning${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function confirmConversationOutcome(
  conversationId: string,
  payload: {
    operationKey: string;
    outcome: "won" | "lost" | "ongoing";
    reasonCode?: string;
    note?: string;
  } & IdentityExpectation,
) {
  return postJson(`/training/conversation-learning/${encodeURIComponent(conversationId)}/outcome`, payload);
}

export async function getTrainingKnowledgeEntries(filters: IdentityFilters & { includeReview?: boolean } = {}) {
  const response = await fetch(`${API_BASE}/training/knowledge${trainingQuery({ ...filters, includeReview: filters.includeReview ?? true })}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export type TrainingRagPreview = {
  query: string;
  route: {
    scene?: string;
    agentKey?: string;
    agentId?: string | null;
    agentName?: string | null;
    action?: string;
    confidence?: number;
    riskFlags?: string[];
  };
  reply: string;
  appliedSkills: Array<{ id?: string; name?: string; description?: string; confidence?: number; sampleCount?: number }>;
  knowledgeMatches: Array<{
    id?: string;
    title?: string;
    excerpt?: string;
    score?: number;
    ragConfidence?: string;
    humanVerbatim?: boolean;
    allowVerbatim?: boolean;
    retrievalReasons?: string[];
    matchedSignals?: string[];
  }>;
  rag: {
    strategy?: string;
    decision?: string;
    confidence?: string;
    candidateCount?: number;
    eligibleCount?: number;
    retrievedCount?: number;
    excludedByReviewStatus?: number;
    topScore?: number;
    querySignals?: string[];
  };
  styleProfile?: {
    id?: string;
    name?: string;
    evidence?: string;
    preserveHumanVerbatim?: boolean;
  };
};

export async function previewTrainingRag(query: string, filters: IdentityFilters = {}): Promise<TrainingRagPreview> {
  return postJson<TrainingRagPreview>("/training/rag/preview", { query, ...filters });
}

export async function reviewTrainingKnowledgeEntry(
  id: string,
  payload: {
    status: "ready" | "review" | "rejected";
    reviewer?: string;
    note?: string;
    operationKey?: string;
    agentId?: string;
    agentKey?: string;
    title?: string;
    content?: string;
    tags?: string[] | string;
    qualityScore?: number;
  } & IdentityExpectation,
): Promise<{ knowledgeEntry: Record<string, unknown>; reviewLog: ReviewLog }> {
  return postJson<{ knowledgeEntry: Record<string, unknown>; reviewLog: ReviewLog }>(`/training/knowledge/${encodeURIComponent(id)}/review`, payload);
}

export async function getTrainingSamples(filters: {
  agentId?: string;
  quality?: TrainingSampleQualityApiFilter;
  status?: string;
  sourceType?: string;
  importId?: string;
  limit?: number;
} & IdentityFilters = {}): Promise<TrainingSample[]> {
  const params = new URLSearchParams();
  if (filters.agentId) params.set("agentId", filters.agentId);
  if (filters.quality) params.set("quality", filters.quality);
  if (filters.status) params.set("status", filters.status);
  if (filters.sourceType) params.set("sourceType", filters.sourceType);
  if (filters.importId) params.set("importId", filters.importId);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.wechatAccountId) params.set("wechatAccountId", filters.wechatAccountId);
  if (filters.conversationId) params.set("conversationId", filters.conversationId);
  if (filters.customerId) params.set("customerId", filters.customerId);
  const query = params.toString();
  const response = await fetch(`${API_BASE}/training/samples${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function getTrainingSample(id: string, filters: IdentityFilters = {}): Promise<TrainingSample> {
  const params = trainingQuery(filters);
  const query = params.toString();
  const response = await fetch(`${API_BASE}/training/samples/${encodeURIComponent(id)}${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function reviewTrainingSample(
  id: string,
  payload: {
    status: "ready" | "review" | "rejected";
    reviewer?: string;
    note?: string;
    operationKey?: string;
    agentId?: string;
    agentKey?: string;
    scene?: string;
    customerText?: string;
    idealReply?: string;
    score?: number;
    skillHints?: string[] | string;
  } & IdentityExpectation,
): Promise<{ sample: TrainingSample; reviewLog: ReviewLog }> {
  return postJson<{ sample: TrainingSample; reviewLog: ReviewLog }>(`/training/samples/${encodeURIComponent(id)}/review`, payload);
}

export async function batchReviewTrainingSamples(payload: {
  sampleIds: string[];
  status: "ready" | "review" | "rejected";
  reviewer?: string;
  note?: string;
  operationKey?: string;
  expectedBySampleId?: Record<string, IdentityExpectation>;
}): Promise<{
  updated: number;
  status: string;
  sampleIds: string[];
  samples: TrainingSample[];
  reviewLogs: ReviewLog[];
}> {
  return postJson("/training/samples/batch-review", payload);
}

export async function getWechatAccounts(): Promise<WechatAccount[]> {
  const response = await fetch(`${API_BASE}/wechat/accounts`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getPersonalWechatRpaRegistry(): Promise<PersonalWechatRpaRegistry> {
  const response = await fetch(`${API_BASE}/personal-wechat-rpa/instances`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function validatePersonalWechatRpaInstance(
  payload: PersonalWechatRpaInstanceInput,
): Promise<PersonalWechatRpaInstanceValidation> {
  return postJson("/personal-wechat-rpa/instances/validate", payload);
}

export async function savePersonalWechatRpaInstance(
  payload: PersonalWechatRpaInstanceInput,
): Promise<{
  ok: true;
  operation: "created" | "updated";
  instance: PersonalWechatRpaInstance;
  registry: PersonalWechatRpaRegistry;
}> {
  return postJson("/personal-wechat-rpa/instances", payload);
}

export async function disablePersonalWechatRpaInstance(wechatAccountId: string): Promise<{
  ok: true;
  operation: "disabled" | "unchanged";
  instance: PersonalWechatRpaInstance;
  registry: PersonalWechatRpaRegistry;
}> {
  return postJson(`/personal-wechat-rpa/instances/${encodeURIComponent(wechatAccountId)}/disable`, {});
}

export async function getOperatorAccessStatus(): Promise<OperatorAccessStatus> {
  const response = await fetch(`${API_BASE}/operator-access/status`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getOperatorAccessPolicy(): Promise<OperatorAccessPolicy> {
  const response = await fetch(`${API_BASE}/operator-access/policy`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getAiProviderStatus(): Promise<AiProviderStatus> {
  const response = await fetch(`${API_BASE}/ai/providers/status`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function probeAiProviderStatus(): Promise<AiProviderStatus> {
  const response = await fetch(`${API_BASE}/ai/providers/status/probe`, { method: "POST" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function saveAiProviderCredential(
  provider: string,
  payload: { apiKey?: string; baseUrl?: string; model?: string; enabled?: boolean },
): Promise<{ saved: boolean; restartRequired: boolean; detail: string; provider: AiProviderStatus["providers"][number] }> {
  const response = await fetch(`${API_BASE}/ai/providers/${encodeURIComponent(provider)}/credential`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function generateAiProviderServerEnv(): Promise<AiProviderServerEnvBundle> {
  const response = await fetch(`${API_BASE}/ai/providers/server-env`, { method: "POST" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function testAiProviderResponse(provider: string): Promise<AiProviderResponseTestResult> {
  const response = await fetch(`${API_BASE}/ai/providers/${encodeURIComponent(provider)}/test`, { method: "POST" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getAiProviderBalance(provider: string): Promise<AiProviderBalanceResult> {
  const response = await fetch(`${API_BASE}/ai/providers/${encodeURIComponent(provider)}/balance`, { method: "POST" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getDeliveryReadiness(): Promise<DeliveryReadiness> {
  const response = await fetch(`${API_BASE}/delivery/readiness`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getWechatWorkProductionPreflight(): Promise<WechatWorkProductionReadiness> {
  const response = await fetch(`${API_BASE}/wechat-work/preflight`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getWechatWorkCallbackEventStatus(): Promise<WechatWorkCallbackEventStatus> {
  const response = await fetch(`${API_BASE}/wechat-work/events/status`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getWechatWorkAuthorizationStatus(): Promise<WechatWorkAuthorizationStatus> {
  const response = await fetch(`${API_BASE}/wechat-work/authorization/status`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function createWechatWorkAuthorizationInstallLink(): Promise<WechatWorkAuthorizationInstallLink> {
  const response = await fetch(`${API_BASE}/wechat-work/authorization/install-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function createWechatWorkCustomerEntry(): Promise<WechatWorkCustomerEntry> {
  return postJson<WechatWorkCustomerEntry>("/wechat-work/kf/contact-way", {});
}

export type WechatWorkCustomerEntryBatchResult = {
  ok: boolean;
  partial: boolean;
  accountCount: number;
  boundAccountCount: number;
  createdAccountCount: number;
  reusedAccountCount: number;
  failedAccountCount: number;
  accounts: Array<{
    openKfid: string;
    name: string;
    ok: boolean;
    reused: boolean;
    entry: WechatWorkCustomerEntry | null;
    errorMessage?: string;
  }>;
};

export async function bindAllWechatWorkCustomerEntries(): Promise<WechatWorkCustomerEntryBatchResult> {
  return postJson<WechatWorkCustomerEntryBatchResult>("/wechat-work/kf/contact-ways/bind-all", {});
}

export async function diagnoseWechatWorkConnection(): Promise<WechatWorkConnectionDiagnosis> {
  return postJson<WechatWorkConnectionDiagnosis>("/wechat-work/kf/connection/diagnose", {});
}

export async function getWechatWorkCustomerServiceOperations(): Promise<WechatWorkCustomerServiceOperations> {
  const response = await fetch(`${API_BASE}/wechat-work/kf/operations`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getWechatWorkCustomerServiceStatistics(filters: {
  openKfid: string;
  startDate: string;
  endDate: string;
}): Promise<WechatWorkCustomerServiceStatistics> {
  const params = new URLSearchParams({
    openKfid: filters.openKfid,
    startDate: filters.startDate,
    endDate: filters.endDate,
  });
  const response = await fetch(`${API_BASE}/wechat-work/kf/statistics?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function createWechatWorkCustomerServiceAccount(payload: {
  name: string;
  avatarBase64: string;
  avatarFileName: string;
  avatarMimeType: string;
  requestId: string;
}): Promise<{ ok: true; openKfid: string; name: string }> {
  return postJson("/wechat-work/kf/operations/accounts/create", payload);
}

export async function updateWechatWorkCustomerServiceAccount(payload: {
  openKfid: string;
  name?: string;
  avatarBase64?: string;
  avatarFileName?: string;
  avatarMimeType?: string;
  requestId: string;
}): Promise<{ ok: true; openKfid: string; name: string }> {
  return postJson("/wechat-work/kf/operations/accounts/update", payload);
}

export async function deleteWechatWorkCustomerServiceAccount(payload: {
  openKfid: string;
  confirmName: string;
  requestId: string;
}): Promise<{ ok: true; deleted: true; openKfid: string; name: string }> {
  return postJson("/wechat-work/kf/operations/accounts/delete", payload);
}

export async function addWechatWorkCustomerServiceServicers(payload: {
  openKfid: string;
  userIds: string[];
  requestId: string;
}): Promise<WechatWorkCustomerServiceOperationResult> {
  return postJson("/wechat-work/kf/operations/servicers/add", payload);
}

export async function deleteWechatWorkCustomerServiceServicers(payload: {
  openKfid: string;
  userIds: string[];
  requestId: string;
}): Promise<WechatWorkCustomerServiceOperationResult> {
  return postJson("/wechat-work/kf/operations/servicers/delete", payload);
}

export async function validateWechatWorkCustomerServiceSecret(
  secret: string,
  corpId?: string,
): Promise<WechatWorkCredentialValidation> {
  return postJson<WechatWorkCredentialValidation>("/wechat-work/kf/connection/validate-credential", { secret, corpId });
}

export async function saveWechatWorkCustomerServiceCredential(
  secret: string,
  openKfid: string,
  setup?: WechatWorkDesktopSetupOptions,
): Promise<WechatWorkCredentialSaveResult> {
  return postJson("/wechat-work/kf/connection/save-credential", { secret, openKfid, ...(setup || {}) });
}

export async function importWechatWorkCustomerEntry(url: string): Promise<WechatWorkCustomerEntry> {
  return postJson<WechatWorkCustomerEntry>("/wechat-work/kf/contact-way/import", { url });
}

export async function getWechatWorkCustomerEntry(): Promise<WechatWorkCustomerEntry | null> {
  const response = await fetch(`${API_BASE}/wechat-work/kf/contact-way`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getWechatWorkUpgradeServiceConfig(): Promise<WechatWorkUpgradeServiceConfig> {
  const response = await fetch(`${API_BASE}/wechat-work/kf/upgrade-service/config`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getWechatWorkCustomerUpgradeStatus(
  identity: ConversationIdentity,
  memberUserId: string,
): Promise<WechatWorkCustomerUpgradeStatus> {
  const params = new URLSearchParams({ ...identity, memberUserId });
  const response = await fetch(`${API_BASE}/wechat-work/kf/upgrade-service/status?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function saveWechatWorkCustomerContactCredential(secret: string): Promise<{
  saved: boolean;
  secretConfigured: boolean;
  valid: boolean;
  configuredMemberCount: number;
  eligibleMemberCount: number;
  eligibleMemberUserIds: string[];
  detail: string;
}> {
  return postJson("/wechat-work/kf/connection/save-customer-contact-credential", { secret });
}

export async function getWechatWorkCapabilities(): Promise<WechatWorkCapabilities> {
  const response = await fetch(`${API_BASE}/wechat-work/kf/capabilities`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function upgradeWechatWorkCustomerService(
  identity: ConversationIdentity,
  memberUserId: string,
  wording: string,
  requestId: string,
): Promise<WechatWorkCustomerUpgradeResult> {
  return postJson<WechatWorkCustomerUpgradeResult>("/wechat-work/kf/customers/upgrade-service", {
    ...identity,
    memberUserId,
    wording,
    requestId,
  });
}

export async function saveAiProviderBillingCredential(
  provider: string,
  payload: { accessKeyId?: string; accessKeySecret?: string; adminKey?: string },
): Promise<{ saved: boolean; restartRequired: boolean; detail: string; provider: AiProviderStatus["providers"][number] }> {
  const response = await fetch(`${API_BASE}/ai/providers/${encodeURIComponent(provider)}/billing-credential`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function syncAiProviderModels(provider: string): Promise<AiProviderModelSyncResult> {
  const response = await fetch(`${API_BASE}/ai/providers/${encodeURIComponent(provider)}/models/sync`, { method: "POST" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function retryWechatWorkCustomerUpgradeQr(
  identity: ConversationIdentity,
  memberUserId: string,
): Promise<WechatWorkCustomerUpgradeRetryResult> {
  return postJson<WechatWorkCustomerUpgradeRetryResult>("/wechat-work/kf/customers/upgrade-service/retry-qr", {
    ...identity,
    memberUserId,
  });
}

export async function resendWechatWorkCustomerUpgradeQr(
  identity: ConversationIdentity,
  memberUserId: string,
  wording: string,
  requestId: string,
): Promise<WechatWorkCustomerUpgradeResult> {
  return postJson<WechatWorkCustomerUpgradeResult>("/wechat-work/kf/customers/upgrade-service/resend-qr", {
    ...identity,
    memberUserId,
    wording,
    requestId,
  });
}

export async function cancelWechatWorkCustomerUpgradeService(
  identity: ConversationIdentity,
  requestId: string,
): Promise<WechatWorkCancelUpgradeResult> {
  return postJson<WechatWorkCancelUpgradeResult>("/wechat-work/kf/customers/cancel-upgrade-service", {
    ...identity,
    requestId,
  });
}

export async function getWechatWorkCustomerServiceState(
  identity: ConversationIdentity,
): Promise<WechatWorkServiceStateResult> {
  return postJson<WechatWorkServiceStateResult>("/wechat-work/kf/customers/service-state/get", identity);
}

export async function transferWechatWorkCustomerServiceState(
  identity: ConversationIdentity,
  serviceState: number,
  servicerUserId: string | undefined,
  requestId: string,
): Promise<WechatWorkServiceStateResult> {
  return postJson<WechatWorkServiceStateResult>("/wechat-work/kf/customers/service-state/transfer", {
    ...identity,
    serviceState,
    servicerUserId,
    requestId,
  });
}

export async function sendWechatWorkEventText(
  identity: ConversationIdentity,
  eventCredentialId: string,
  text: string,
  requestId: string,
  msgid?: string,
): Promise<WechatWorkEventTextResult> {
  return postJson<WechatWorkEventTextResult>("/wechat-work/kf/events/send-text", {
    ...identity,
    eventCredentialId,
    text,
    requestId,
    msgid,
  });
}

export async function sendWechatWorkEventMenu(
  identity: ConversationIdentity,
  eventCredentialId: string,
  msgmenu: Record<string, unknown>,
  requestId: string,
  msgid?: string,
): Promise<WechatWorkEventMenuResult> {
  return postJson<WechatWorkEventMenuResult>("/wechat-work/kf/events/send-menu", {
    ...identity,
    eventCredentialId,
    msgmenu,
    requestId,
    msgid,
  });
}

export async function queueWechatWorkCustomerServiceMessage(
  openKfid: string,
  externalUserId: string,
  messages: WechatWorkCustomerServiceMessagePayload[],
  requestId: string,
): Promise<{ ok: boolean; queued: boolean; task: SendTask }> {
  return postJson<{ ok: boolean; queued: boolean; task: SendTask }>("/wechat-work/kf/send-message", {
    openKfid,
    externalUserId,
    messages,
    requestId,
  });
}

export async function getWechatConversations(): Promise<Conversation[]> {
  const response = await fetch(`${API_BASE}/wechat/conversations`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getConversationOperationsQueue(): Promise<ConversationOperationsQueue> {
  const response = await fetch(`${API_BASE}/conversation-ops/queue`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function updateConversationOperations(
  identity: ConversationIdentity,
  patch: ConversationOperationsPatch,
  operator: string,
  reason = "客服工作台更新会话分配与 SLA",
): Promise<{ conversation: ConversationOperations; audit: ReviewLog | null; changedFields: string[] }> {
  return patchJson(`/conversation-ops/conversations/${encodeURIComponent(identity.conversationId)}`, {
    ...identityExpectation(identity),
    ...patch,
    operator,
    reason,
  });
}

export async function getConversationTimeline(
  identity: ConversationIdentity,
  limit = 300,
): Promise<ConversationTimelineItem[]> {
  const params = new URLSearchParams({
    wechatAccountId: identity.wechatAccountId,
    customerId: identity.customerId,
    limit: String(limit),
  });
  const response = await fetch(
    `${API_BASE}/wechat/conversations/${encodeURIComponent(identity.conversationId)}/messages?${params.toString()}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function markConversationMessagesRead(identity: ConversationIdentity): Promise<{
  updatedCount: number;
  readAt: string;
}> {
  return postJson(`/wechat/conversations/${encodeURIComponent(identity.conversationId)}/read`, identityExpectation(identity));
}

export async function generateConversationReplySuggestion(
  identity: ConversationIdentity,
): Promise<ConversationReplySuggestion> {
  return postJson<ConversationReplySuggestion>(
    `/wechat/conversations/${encodeURIComponent(identity.conversationId)}/reply-suggestion`,
    identityExpectation(identity),
  );
}

export async function refreshWechatWorkCustomerProfile(identity: ConversationIdentity): Promise<{
  refreshed: boolean;
  customer: NonNullable<Conversation["customer"]>;
  conversation: Conversation;
}> {
  return postJson("/wechat-work/kf/customers/refresh-profile", identity);
}

export async function queueManualConversationReply(
  identity: ConversationIdentity,
  text: string,
  operationKey: string,
  operator = "人工客服",
  assetIds: string[] = [],
): Promise<{ queued: true; task: SendTask }> {
  return postJson(`/wechat/conversations/${encodeURIComponent(identity.conversationId)}/manual-replies`, {
    ...identityExpectation(identity),
    text,
    assetIds,
    operationKey,
    operator,
  });
}

export async function preparePersonalWechatConversation(identity: ConversationIdentity): Promise<{
  ok: true;
  identity: ConversationIdentity;
  chatTitle: string;
  recentMessage: string;
  captureSource: string;
}> {
  return postJson("/personal-wechat-rpa/conversations/prepare", identity);
}

export async function setConversationManualLock(
  id: string,
  payload: { locked: boolean; reviewer?: string; reason?: string; note?: string } & IdentityExpectation,
): Promise<{ conversation: Conversation; log: ReviewLog }> {
  return postJson<{ conversation: Conversation; log: ReviewLog }>(`/wechat/conversations/${id}/manual-lock`, payload);
}

export async function getSendTasks(filters: IdentityFilters = {}): Promise<SendTask[]> {
  const response = await fetch(`${API_BASE}/wechat/send-tasks${identityQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getSendAttempts(sendTaskId?: string, filters: IdentityFilters = {}): Promise<SendAttempt[]> {
  const params = new URLSearchParams(identityQuery(filters).replace(/^\?/, ""));
  if (sendTaskId) params.set("sendTaskId", sendTaskId);
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  const response = await fetch(`${API_BASE}/wechat/send-attempts${suffix}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getSendAdapter(): Promise<SendAdapterInfo | null> {
  const response = await fetch(`${API_BASE}/wechat/send-adapter`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getBridgeOutbox(filters: IdentityFilters = {}): Promise<BridgeOutboxResult> {
  const response = await fetch(`${API_BASE}/wechat/bridge/outbox${identityQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getBridgeStatus(filters: IdentityFilters = {}): Promise<BridgeStatusResult> {
  const response = await fetch(`${API_BASE}/wechat/bridge/status${identityQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getBridgeDispatch(filters: IdentityFilters = {}): Promise<BridgeDispatchResult> {
  const response = await fetch(`${API_BASE}/wechat/bridge/dispatch${identityQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getWechatChannelStatus(filters: IdentityFilters = {}): Promise<WechatChannelStatus | null> {
  const url = `${API_BASE}/wechat/channels/status${identityQuery(filters)}`;
  let lastError: unknown = new Error("微信渠道状态响应缺少必要字段");
  for (let attempt = 0; attempt <= WECHAT_CHANNEL_STATUS_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw await apiResponseError(response);
      const status = await response.json();
      if (status && Array.isArray(status.channels) && status.summary) return status;
      lastError = new Error("微信渠道状态响应缺少必要字段");
    } catch (error) {
      lastError = error;
      // The web app can render before the API port is ready; retry briefly before surfacing the real failure.
    }
    const delayMs = WECHAT_CHANNEL_STATUS_RETRY_DELAYS_MS[attempt];
    if (delayMs) await sleepApi(delayMs);
  }
  throw lastError;
}

export async function testWechatChannelInbound(
  channel: WechatChannelKey,
  payload: {
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    text?: string;
  } & IdentityExpectation,
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(`/wechat/channels/${channel}/inbound/test`, payload);
}

export async function getWindowObserverStatus(): Promise<WindowObserverStatus> {
  const response = await fetch(`${API_BASE}/wechat/window-observer/status`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
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

export async function getWechatWindowSnapshots(filters: IdentityFilters = {}): Promise<WechatWindowSnapshot[]> {
  const response = await fetch(`${API_BASE}/wechat/window-snapshots${identityQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function createDemoWindowSnapshot(
  mode: "correct" | "wrong_chat" | "offline",
  wechatAccountId: string,
  conversationId: string,
  expected: IdentityExpectation = {},
): Promise<WechatWindowSnapshot> {
  return postJson<WechatWindowSnapshot>("/wechat/window-snapshots/demo", {
    ...expected,
    mode,
    wechatAccountId,
    conversationId,
  });
}

export async function scanWindowSnapshotInbox(): Promise<WindowSnapshotInboxScanResult> {
  return postJson<WindowSnapshotInboxScanResult>("/wechat/window-snapshots/inbox/scan", {});
}

export async function createDemoSendTask(
  conversationId: string,
  operationKey: string,
  wechatAccountId?: string,
  expected: IdentityExpectation = {},
  text?: string,
): Promise<SendTask> {
  return postJsonWithNetworkRetry<SendTask>("/wechat/send-tasks/demo", {
    ...expected,
    operationKey,
    conversationId,
    wechatAccountId,
    text,
  });
}

export async function validateSendTask(id: string, expected: IdentityExpectation = {}): Promise<SendTask> {
  return postJson<SendTask>(`/wechat/send-tasks/${id}/validate`, expected);
}

export async function validateSendTaskCurrentWindow(id: string, expected: IdentityExpectation = {}): Promise<SendTask> {
  return postJson<SendTask>(`/wechat/send-tasks/${id}/validate-current-window`, expected);
}

export async function executeDryRunSend(id: string, expected: IdentityExpectation = {}): Promise<{ task: SendTask; attempt: SendAttempt }> {
  return postJson<{ task: SendTask; attempt: SendAttempt }>(`/wechat/send-tasks/${id}/execute-dry-run`, expected);
}

export async function executeSendTask(id: string, expected: IdentityExpectation = {}): Promise<{ task: SendTask; attempt: SendAttempt; adapter: SendAdapterInfo }> {
  return postJson<{ task: SendTask; attempt: SendAttempt; adapter: SendAdapterInfo }>(`/wechat/send-tasks/${id}/execute`, expected);
}

export async function executeManualReplyNow(
  id: string,
  identity: ConversationIdentity,
): Promise<{ task: SendTask; attempt: SendAttempt; adapter: SendAdapterInfo }> {
  return postJson<{ task: SendTask; attempt: SendAttempt; adapter: SendAdapterInfo }>(
    `/wechat/send-tasks/${id}/execute-manual-reply`,
    identityExpectation(identity),
  );
}

export async function requeueSendTask(id: string, payload: { reason?: string } & IdentityExpectation = {}): Promise<SendTask> {
  return postJson<SendTask>(`/wechat/send-tasks/${id}/requeue`, {
    reason: "客服重新排队发送",
    ...payload,
  });
}

export async function cancelSendTask(id: string, payload: { reason?: string } & IdentityExpectation = {}): Promise<SendTask> {
  return postJson<SendTask>(`/wechat/send-tasks/${id}/cancel`, {
    reason: "客服取消发送任务",
    ...payload,
  });
}

export async function resolveSendTaskDelivery(
  id: string,
  payload: {
    resolution: "confirmed_sent" | "confirmed_not_sent";
    operationKey: string;
    reason?: string;
  } & IdentityExpectation,
): Promise<SendTask> {
  return postJson<SendTask>(`/wechat/send-tasks/${id}/resolve-delivery`, payload);
}

export type SendOperationsScanResult = {
  scanned: number;
  bridgeTimedOut: number;
  bridgeOutboxBroken: number;
  bridgeDispatchExpired?: number;
  autoRetriedLowValue?: number;
  staleQueued: number;
  alerted: number;
  tasks?: Record<string, unknown>;
};

export async function scanSendOperations(filters: IdentityFilters = {}): Promise<SendOperationsScanResult> {
  return postJson<SendOperationsScanResult>("/wechat/send-tasks/scan-ops", filters);
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

export async function processSafeSendQueue(filters: IdentityFilters = {}): Promise<SafeSendQueueResult> {
    return postJson<SafeSendQueueResult>("/wechat/send-tasks/process-safe-queue", filters);
}

export async function getRouteEvaluations(filters: IdentityFilters = {}): Promise<RouteEvaluation[]> {
  const response = await fetch(`${API_BASE}/routing/evaluations${identityQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function evaluateRoute(text: string, filters: IdentityFilters = {}): Promise<RouteEvaluation> {
  return postJson<RouteEvaluation>("/routing/evaluate", { channel: "wechat", ...filters, text });
}

export async function correctRouteEvaluation(
  id: string,
  payload: { agentKey: string; scene?: string; reviewer?: string; note?: string; idealReply?: string } & IdentityExpectation,
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
  customerId?: string;
  text: string;
  externalId: string;
  assetIds?: string[];
  attachments?: Array<Record<string, unknown>>;
}): Promise<InboundProcessResult> {
  return postJson<InboundProcessResult>("/wechat/inbound/messages", payload);
}

export async function importChatTranscript(payload: {
  operationKey: string;
  name?: string;
  source?: string;
  channel?: string;
  agentId?: string;
  customerId?: string;
  conversationId?: string;
  wechatAccountId?: string;
  text: string;
}): Promise<ChatImport> {
  return postJsonWithNetworkRetry<ChatImport>("/training/chat-imports", payload);
}

export async function previewKnowledgeImportText(
  text: string,
  options: {
    operationKey?: string;
    source?: string;
    customerId?: string;
    conversationId?: string;
    wechatAccountId?: string;
  } = {},
): Promise<KnowledgeImportResult> {
  return postJson<KnowledgeImportResult>("/training/knowledge/import-preview", { ...options, text });
}

export async function importKnowledgeText(payload: {
  operationKey: string;
  source?: string;
  customerId?: string;
  conversationId?: string;
  wechatAccountId?: string;
  text: string;
}): Promise<KnowledgeImportResult> {
  return postJsonWithNetworkRetry<KnowledgeImportResult>("/training/knowledge/import", payload);
}

export async function downloadKnowledgeImportTemplate(): Promise<KnowledgeImportTemplate> {
  const response = await fetch(`${API_BASE}/training/knowledge/import-template`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function getSkillSuggestions(filters: ({ agentId?: string; minScore?: number } & IdentityFilters) | string = {}): Promise<SkillSuggestion[]> {
  const options = typeof filters === "string" ? { agentId: filters } : filters;
  const params = new URLSearchParams();
  if (options.agentId) params.set("agentId", options.agentId);
  if (options.minScore) params.set("minScore", String(options.minScore));
  if (options.wechatAccountId) params.set("wechatAccountId", options.wechatAccountId);
  if (options.conversationId) params.set("conversationId", options.conversationId);
  if (options.customerId) params.set("customerId", options.customerId);
  const query = params.toString();
  const response = await fetch(`${API_BASE}/training/skill-suggestions${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function applySkillSuggestions(
  payload: { agentId?: string; minScore?: number; suggestionKeys?: string[]; includeNeedsReview?: boolean } & IdentityFilters = {},
): Promise<ApplySkillSuggestionsResult> {
  return postJson<ApplySkillSuggestionsResult>("/training/skill-suggestions/apply", payload);
}

export async function recommendBundle(payload: {
  budget: DesignJob["budget"];
  scene: string;
  maxItems?: number;
  selectedSkuCodes?: string[];
  requireImages?: boolean;
}): Promise<BundleRecommendation> {
  return postJson<BundleRecommendation>("/catalog/bundle/recommend", payload);
}

export async function createDemoDesignJob(
  identity: { wechatAccountId: string; customerId: string; conversationId: string },
  assetIds: string[] = [],
  operationKey: string,
): Promise<DesignJob> {
  const budget = { mode: "per_box", perUnitAmount: 180, quantity: 50, totalAmount: 9000 };
  const scene = "员工福利";
  const recommendation = await recommendBundle({ budget, scene, maxItems: 6 });
  const giftBox = recommendation.items.find((item) => item.type === "gift_box") || null;

  return postJsonWithNetworkRetry<DesignJob>("/design-jobs", {
    operationKey,
    wechatAccountId: identity.wechatAccountId,
    customerId: identity.customerId,
    conversationId: identity.conversationId,
    budget,
    scene,
    bundle: {
      giftBox,
      items: recommendation.items,
      totals: recommendation.totals,
      automation: recommendation.automation || null,
      warnings: recommendation.warnings,
    },
    assetIds,
    assets: [{ assetId: "demo-logo", type: "logo", name: "客户Logo" }],
    customerText: "想看一套端午员工福利礼盒真实摆拍效果图，整体要高级、温和、有企业礼赠感。",
    designType: "bundle_render",
    outputCount: 4,
  });
}

export async function createTimeoutDemoJob(conversationId: string, expected: IdentityExpectation = {}): Promise<DesignJob> {
    return postJson<DesignJob>("/design-jobs/demo-timeout", { ...expected, conversationId });
}

export async function createFailureDemoJob(conversationId: string, expected: IdentityExpectation = {}): Promise<DesignJob> {
    return postJson<DesignJob>("/design-jobs/demo-failure", { ...expected, conversationId });
}

export type DesignTimeoutScanResult = {
  scanned: number;
  candidates?: number;
  recovered: number;
  timedOut: number;
  pollErrors: Array<{
    designJobId?: string;
    requestId?: string;
    externalJobId?: string;
    errorMessage: string;
  }>;
  recoveredJobs: DesignJob[];
  jobs: DesignJob[];
};

export async function scanDesignTimeouts(filters: IdentityFilters = {}): Promise<DesignTimeoutScanResult> {
    return postJson<DesignTimeoutScanResult>("/design-jobs/scan-timeouts", filters);
}

export type DesignActivePollResult = {
  scanned: number;
  completed: DesignJob[];
  failed: DesignJob[];
  retried: DesignJob[];
  generating: DesignJob[];
  cancelled: DesignJob[];
  errors: Array<{
    designJobId?: string;
    requestId?: string;
    externalJobId?: string;
    errorMessage: string;
  }>;
};

export async function pollActiveDesignResults(filters: IdentityFilters = {}): Promise<DesignActivePollResult> {
    return postJson<DesignActivePollResult>("/design-jobs/poll-active-results", filters);
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

export async function autoSubmitDesignDrafts(filters: IdentityFilters = {}): Promise<DesignAutoSubmitResult> {
    return postJson<DesignAutoSubmitResult>("/design-jobs/auto-submit-drafts", filters);
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

export async function autoProcessLowValue(filters: IdentityFilters = {}): Promise<LowValueAutomationResult> {
  return postJson<LowValueAutomationResult>("/design-jobs/auto-process-low-value", filters);
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
  identityAudit?: {
    status: "passed" | "warning";
    identityCount: number;
    identities: Array<{
      key: string;
      wechatAccountId?: string;
      conversationId?: string;
      customerId?: string;
      count: number;
      steps: string[];
    }>;
    warnings: Array<{ step: string; path: string; reason: string; fields?: string[] }>;
  };
  skipSummary?: {
    total: number;
    reasons: Array<{
      reason: string;
      count: number;
      steps: string[];
      sampleTargets: string[];
    }>;
  };
  stageSummary?: {
    progressed: number;
    blocked: number;
    failed: number;
    nextAction: string;
    stages: Array<{
      key: string;
      label: string;
      completed: number;
      blocked: number;
      failed: number;
      detail: string;
      action: string;
      tone: "ok" | "warning" | "error" | "idle";
    }>;
  };
};

export type AutomationStatus = {
  enabled: boolean;
  running: boolean;
  active: boolean;
  mode?: "interval" | "durable" | "invalid";
  scheduler?: {
    mode?: "interval" | "durable" | "invalid";
    active?: boolean;
    configured?: boolean;
    connected?: boolean;
    scheduled?: boolean;
    workerReady?: boolean;
    evidenceSource?: string;
    durableEvidence?: { available?: boolean } & Record<string, unknown>;
  };
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
  const response = await fetch(`${API_BASE}/automation/status`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function getAutomationReadiness(): Promise<AutomationReadiness | null> {
  const response = await fetch(`${API_BASE}/automation/readiness`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function runAutomationOnce(filters: IdentityFilters = {}): Promise<AutomationRun> {
  return postJson<AutomationRun>("/automation/run-once", filters);
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

export async function scanHighValueHandoffs(filters: IdentityFilters = {}): Promise<HighValueHandoffResult> {
    return postJson<HighValueHandoffResult>("/design-jobs/scan-high-value-handoffs", filters);
}

export async function getDesignPlatformHealth(): Promise<DesignPlatformHealth> {
  const response = await fetch(`${API_BASE}/integrations/design-platform/health`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getDesignPlatformReadiness(deviceId = ""): Promise<DesignPlatformReadiness> {
  const query = deviceId.trim() ? `?deviceId=${encodeURIComponent(deviceId.trim())}` : "";
  const response = await fetch(`${API_BASE}/integrations/design-platform/readiness${query}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getDesignPlatformConfig(): Promise<DesignPlatformConfigResponse> {
  const response = await fetch(`${API_BASE}/integrations/design-platform/config`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getDesignPlatformCandidates(): Promise<DesignPlatformCandidateProbeResponse> {
  const response = await fetch(`${API_BASE}/integrations/design-platform/candidates`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function openDesktopZhenxiAi(): Promise<DesktopShellOpenResponse> {
  return postJson<DesktopShellOpenResponse>("/desktop-shell/open-zhenxi-ai", {});
}

export async function updateDesignPlatformConfig(payload: {
  adapter?: string;
  baseUrl?: string;
  apiKey?: string;
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

export async function runDesignPlatformSmokeTest(): Promise<DesignPlatformSmokeTestResult> {
  return postJson<DesignPlatformSmokeTestResult>("/integrations/design-platform/smoke-test", {});
}

export async function submitDesignJob(
  id: string,
  operationKey: string,
  expected: IdentityExpectation = {},
): Promise<DesignJob> {
  return postJson<DesignJob>(`/design-jobs/${id}/submit`, { ...expected, operationKey });
}

export async function preflightDesignJob(id: string, expected: IdentityExpectation = {}): Promise<DesignJobPreflightResult> {
  return postJson<DesignJobPreflightResult>(`/design-jobs/${id}/preflight`, expected);
}

export async function pollDesignJob(
  id: string,
  expected: IdentityExpectation = {},
): Promise<{ remoteStatus: string; autoRetried?: boolean; job: DesignJob; result: Record<string, unknown> }> {
  return postJson<{ remoteStatus: string; autoRetried?: boolean; job: DesignJob; result: Record<string, unknown> }>(`/design-jobs/${id}/poll`, expected);
}

function designExecutionExpectedIdentityQuery(expected: IdentityExpectation) {
  const params = new URLSearchParams();
  if (expected.expectedWechatAccountId) params.set("expectedWechatAccountId", expected.expectedWechatAccountId);
  if (expected.expectedConversationId) params.set("expectedConversationId", expected.expectedConversationId);
  if (expected.expectedCustomerId) params.set("expectedCustomerId", expected.expectedCustomerId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function getDesignJobExecutions(
  id: string,
  expected: IdentityExpectation = {},
): Promise<DesignPlatformExecutionView[]> {
  const response = await fetch(
    `${API_BASE}/design-jobs/${encodeURIComponent(id)}/executions${designExecutionExpectedIdentityQuery(expected)}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(designExecutionRequestError("读取执行记录失败", response.status));
  }
  return response.json();
}

export async function resolveUnknownDesignExecution(
  designJobId: string,
  executionId: string,
  expected: IdentityExpectation = {},
): Promise<DesignPlatformExecutionView> {
  return postDesignExecutionResolution(
    `/design-jobs/${encodeURIComponent(designJobId)}/executions/${encodeURIComponent(executionId)}/resolve-unknown`,
    { ...expected, resolution: "confirmed_not_generated_refunded" },
  );
}

export async function resolveDesignExecutionRefund(
  designJobId: string,
  executionId: string,
  expected: IdentityExpectation = {},
): Promise<DesignPlatformExecutionView> {
  return postDesignExecutionResolution(
    `/design-jobs/${encodeURIComponent(designJobId)}/executions/${encodeURIComponent(executionId)}/resolve-refund`,
    { ...expected, resolution: "confirmed_refunded" },
  );
}

async function postDesignExecutionResolution(
  path: string,
  body: IdentityExpectation & { resolution: Exclude<DesignExecutionAvailableResolution, null> },
): Promise<DesignPlatformExecutionView> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(designExecutionRequestError("人工核销失败", response.status));
  }
  return response.json();
}

function designExecutionRequestError(action: string, status: number) {
  if (status === 401 || status === 403) return `${action}：当前会话没有所需权限（HTTP ${status}）。`;
  if (status === 404) return `${action}：任务或执行记录不存在（HTTP 404）。`;
  if (status === 409) return `${action}：执行状态已经变化，请刷新后重新核对（HTTP 409）。`;
  return `${action}：服务暂时不可用（HTTP ${status}）。`;
}

export async function retryDesignJob(id: string, expected: IdentityExpectation = {}): Promise<DesignJob> {
  return postJson<DesignJob>(`/design-jobs/${id}/retry`, expected);
}

export async function getDesignJobRevisions(id: string, expected: IdentityExpectation = {}): Promise<DesignRevision[]> {
  const response = await fetch(`${API_BASE}/design-jobs/${id}/revisions${expectedIdentityQuery(expected)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return response.json();
}

export async function requestDesignRevision(id: string, payload: {
  operationKey: string;
  instruction: string;
  selectedImageId?: string;
  sourceText?: string;
} & IdentityExpectation): Promise<{ decision: Record<string, unknown>; revision: DesignRevision | null; job: DesignJob }> {
  return postJson<{ decision: Record<string, unknown>; revision: DesignRevision | null; job: DesignJob }>(
    `/design-jobs/${id}/revisions`,
    payload,
  );
}

export async function attachDesignJobAssets(id: string, assetIds: string[], expected: IdentityExpectation = {}): Promise<DesignJob> {
  return postJson<DesignJob>(`/design-jobs/${id}/assets`, { ...expected, assetIds });
}

export async function cancelDesignJob(id: string, expected: IdentityExpectation = {}): Promise<{ job: DesignJob; remoteResult?: Record<string, unknown> | null }> {
  return postJson<{ job: DesignJob; remoteResult?: Record<string, unknown> | null }>(`/design-jobs/${id}/cancel`, expected);
}

export async function quickConfirmSend(id: string, operationKey: string, expected: IdentityExpectation = {}): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(`/design-jobs/${id}/quick-confirm-send`, { ...expected, operationKey });
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

export type DesignImageSelectionResult = {
  matched: boolean;
  reviewRequired?: boolean;
  autoQuoteCreated?: boolean;
  quote?: QuoteDraft | null;
  nextStatus?: string;
  reason?: string;
  errorMessage?: string;
  result?: {
    candidate?: NonNullable<DesignJob["images"]>[number] & Record<string, unknown>;
    imageId?: string;
    position?: number;
    reason?: string;
    [key: string]: unknown;
  } | null;
  plan?: Record<string, unknown> | null;
};

export async function selectDesignImage(id: string, input: SelectImagePayload, expected: IdentityExpectation = {}): Promise<DesignImageSelectionResult> {
  const payload = typeof input === "string" ? { ...expected, text: input } : { ...expected, ...input };
  return postJson<DesignImageSelectionResult>(`/design-jobs/${id}/select-image`, payload);
}

export async function createQuote(id: string, expected: IdentityExpectation = {}): Promise<QuoteDraft> {
  return postJson<QuoteDraft>(`/design-jobs/${id}/quote`, expected);
}

export async function getQuotes(filters: IdentityFilters = {}): Promise<QuoteDraft[]> {
  const response = await fetch(`${API_BASE}/quotes${identityQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getQuoteDraft(id: string, expected: IdentityExpectation = {}): Promise<QuoteDraft> {
  const response = await fetch(`${API_BASE}/quotes/${id}${expectedIdentityQuery(expected)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getQuotePreview(id: string, expected: IdentityExpectation = {}): Promise<QuotePreview> {
  const response = await fetch(`${API_BASE}/quotes/${id}/preview${expectedIdentityQuery(expected)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function updateQuote(id: string, patch: {
  status?: string;
  customerNotes?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  totalCost?: number | string;
} & IdentityExpectation): Promise<QuoteDraft> {
  return postJson<QuoteDraft>(`/quotes/${id}/update`, patch);
}

export async function reviseQuoteSelection(id: string, patch: {
  selectedImageId: string;
  note?: string;
} & IdentityExpectation): Promise<QuoteDraft> {
  return postJson<QuoteDraft>(`/quotes/${id}/revise-selection`, patch);
}

export async function queueQuoteSend(id: string, operationKey: string, expected: IdentityExpectation = {}): Promise<{ quote: QuoteDraft; sendTask: SendTask }> {
  return postJson<{ quote: QuoteDraft; sendTask: SendTask }>(`/quotes/${id}/queue-send`, {
    ...expected,
    operationKey,
    note: "报价已进入微信安全发送队列。",
  });
}

export async function verifyQuotePaymentProofAndQueueConfirmation(
  id: string,
  paymentStatus: "deposit_paid" | "paid",
  operationKey: string,
  expected: IdentityExpectation = {},
  note?: string,
  paymentDetails: { amountCny?: number | string; method?: string; proofReference?: string } = {},
): Promise<{ quote: QuoteDraft; orderDraft: OrderDraft; paymentEvent: PaymentEvent; sendTask?: SendTask | null; message: string }> {
  const paymentLabel = paymentStatus === "paid" ? "全款" : "定金";
  return postJson<{ quote: QuoteDraft; orderDraft: OrderDraft; paymentEvent: PaymentEvent; sendTask?: SendTask | null; message: string }>(
    `/quotes/${id}/verify-payment-proof`,
    {
      ...expected,
      operationKey,
      paymentStatus,
      amountCny: paymentDetails.amountCny,
      method: paymentDetails.method,
      proofReference: paymentDetails.proofReference,
      note: note?.trim() || `人工已核验客户${paymentLabel}付款凭证，报价进入订单跟进。`,
    },
  );
}

export async function getOrderDrafts(filters: IdentityFilters = {}): Promise<OrderDraft[]> {
  const response = await fetch(`${API_BASE}/orders${identityQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getOrderDraft(id: string, expected: IdentityExpectation = {}): Promise<OrderDraft> {
  const response = await fetch(`${API_BASE}/orders/${id}${expectedIdentityQuery(expected)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function createOrderDraftFromQuote(id: string, expected: IdentityExpectation = {}): Promise<OrderDraft> {
  return postJson<OrderDraft>(`/orders/from-quote/${id}`, expected);
}

export async function updateOrderDraft(id: string, patch: {
  status?: string;
  customerNotes?: string;
} & IdentityExpectation): Promise<OrderDraft> {
  return postJson<OrderDraft>(`/orders/${id}/update`, patch);
}

export async function updateOrderFulfillment(id: string, patch: {
  operationKey: string;
  status?: string;
  productionStatus?: string;
  productionDueAt?: string;
  carrier?: string;
  trackingNo?: string;
  shippedAt?: string;
  deliveredAt?: string;
  customerNotes?: string;
} & IdentityExpectation): Promise<OrderDraft> {
  return postJson<OrderDraft>(`/orders/${id}/fulfillment`, patch);
}

export async function getOrderAfterSalesCases(id: string, expected: IdentityExpectation = {}): Promise<AfterSalesCase[]> {
  const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(id)}/after-sales${expectedIdentityQuery(expected)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function createOrderAfterSalesCase(id: string, payload: {
  operationKey: string;
  type: string;
  reason: string;
  requestedAmountCny?: number | string;
  evidenceReference?: string;
  desiredResolution?: string;
} & IdentityExpectation): Promise<AfterSalesCase> {
  return postJson<AfterSalesCase>(`/orders/${encodeURIComponent(id)}/after-sales`, payload);
}

export async function resolveOrderAfterSalesCase(id: string, caseId: string, payload: {
  operationKey: string;
  resolutionType: string;
  approvedAmountCny?: number | string;
  refundMethod?: string;
  refundReference?: string;
  replacementCarrier?: string;
  replacementTrackingNo?: string;
  note?: string;
} & IdentityExpectation): Promise<AfterSalesCase> {
  return postJson<AfterSalesCase>(`/orders/${encodeURIComponent(id)}/after-sales/${encodeURIComponent(caseId)}/resolve`, payload);
}

export async function getOrderConfirmationPreview(id: string, expected: IdentityExpectation = {}): Promise<OrderConfirmationPreview> {
  const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(id)}/confirmation-preview${expectedIdentityQuery(expected)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getOrderFollowupPreview(
  id: string,
  type: "production" | "delivery",
  expected: IdentityExpectation = {},
): Promise<OrderFollowupPreview> {
  const identityQuery = expectedIdentityQuery(expected);
  const separator = identityQuery ? "&" : "?";
  const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(id)}/followup-preview${identityQuery}${separator}type=${encodeURIComponent(type)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function reviseOrderSelection(id: string, patch: {
  selectedImageId: string;
  note?: string;
} & IdentityExpectation): Promise<OrderDraft> {
  return postJson<OrderDraft>(`/orders/${id}/revise-selection`, patch);
}

export async function queueOrderConfirmation(
  id: string,
  operationKey: string,
  expected: IdentityExpectation = {},
  manualRelease: ManualReleaseOptions = {},
): Promise<{ orderDraft: OrderDraft; sendTask: SendTask; message: string }> {
  return postJson<{ orderDraft: OrderDraft; sendTask: SendTask; message: string }>(`/wechat/orders/${id}/queue-confirmation`, {
    ...expected,
    ...manualRelease,
    operationKey,
    owner: "人工客服",
    note: manualRelease.note || "订单确认已进入微信安全发送队列。",
  });
}

export async function queueOrderFollowup(
  id: string,
  type: "production" | "delivery",
  operationKey: string,
  expected: IdentityExpectation = {},
  manualRelease: ManualReleaseOptions = {},
): Promise<{ orderDraft: OrderDraft; sendTask: SendTask; message: string }> {
  return postJson<{ orderDraft: OrderDraft; sendTask: SendTask; message: string }>(`/wechat/orders/${id}/queue-followup`, {
    ...expected,
    ...manualRelease,
    operationKey,
    owner: "人工客服",
    type,
  });
}

export async function markManualReview(id: string, expected: IdentityExpectation = {}): Promise<DesignJob> {
  return postJson<DesignJob>(`/design-jobs/${id}/manual-review`, expected);
}

export async function getReviewCenter(filters: IdentityFilters = {}): Promise<ReviewCenter> {
  const response = await fetch(`${API_BASE}/reviews${identityQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getReviewDesignJob(id: string, filters: IdentityFilters = {}): Promise<DesignJob> {
  const response = await fetch(`${API_BASE}/reviews/design-jobs/${encodeURIComponent(id)}${identityQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getReviewQuote(id: string, filters: IdentityFilters = {}): Promise<QuoteDraft> {
  const response = await fetch(`${API_BASE}/reviews/quotes/${encodeURIComponent(id)}${identityQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function getReviewOrder(id: string, filters: IdentityFilters = {}): Promise<OrderDraft> {
  const response = await fetch(`${API_BASE}/reviews/orders/${encodeURIComponent(id)}${identityQuery(filters)}`, { cache: "no-store" });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function reviewDesignJob(id: string, payload: {
  decision: "approve_images" | "approve_send" | "request_revision" | "reject";
  reviewer?: string;
  note?: string;
  operationKey?: string;
} & IdentityExpectation): Promise<ReviewDesignJobResult> {
  return postJson<ReviewDesignJobResult>(`/reviews/design-jobs/${id}`, payload);
}

export async function reviewQuote(id: string, payload: {
  decision: "approve_quote" | "request_followup" | "reject_quote";
  reviewer?: string;
  note?: string;
  operationKey?: string;
} & IdentityExpectation): Promise<ReviewQuoteResult> {
  return postJson<ReviewQuoteResult>(`/reviews/quotes/${id}`, payload);
}

export async function reviewOrder(id: string, payload: {
  decision: "approve_confirmation" | "approve_followup" | "request_followup" | "reject_order";
  reviewer?: string;
  note?: string;
  followupType?: "production" | "delivery";
  operationKey?: string;
} & IdentityExpectation): Promise<ReviewOrderResult> {
  return postJson<ReviewOrderResult>(`/reviews/orders/${id}`, payload);
}

export async function getNotifications(unreadOnly = false, filters: IdentityFilters = {}): Promise<NotificationItem[]> {
  const params = new URLSearchParams(identityQuery(filters).replace(/^\?/, ""));
  params.set("unreadOnly", unreadOnly ? "true" : "false");
  const response = await fetch(`${API_BASE}/notifications?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw await apiResponseError(response);
  return response.json();
}

export async function markNotificationRead(id: string, expected: IdentityExpectation = {}): Promise<NotificationItem> {
  return postJson<NotificationItem>(`/notifications/${id}/read`, expected);
}

export async function markAllNotificationsRead(filters: IdentityFilters = {}): Promise<{ count: number }> {
  return postJson<{ count: number }>("/notifications/read-all", filters);
}
