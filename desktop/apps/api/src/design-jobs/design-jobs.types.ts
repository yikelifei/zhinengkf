export type CreateDesignJobPayload = {
  operationKey: string;
  wechatAccountId?: string;
  customerId: string;
  conversationId: string;
  orderId?: string;
  budget: Record<string, unknown>;
  scene?: string;
  bundle: Record<string, unknown>;
  assetIds?: string[];
  assets: Array<Record<string, unknown>>;
  customerText?: string;
  designType?: string;
  outputCount?: number;
};

export type CreateDesignRevisionPayload = {
  operationKey: string;
  instruction: string;
  selectedImageId?: string;
  sourceText?: string;
};

export type SubmitDesignJobPayload = {
  operationKey: string;
};

export type SelectDesignImagePayload = {
  text?: string;
  referencedImageId?: string;
  quotedImageId?: string;
  attachmentImageId?: string;
  screenshotFingerprint?: string;
  attachmentFingerprint?: string;
};

export type ResolveUnknownDesignExecutionPayload = {
  resolution: "confirmed_not_generated_refunded";
};

export type ResolveDesignExecutionRefundPayload = {
  resolution: "confirmed_refunded";
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
