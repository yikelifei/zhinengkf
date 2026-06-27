export type CreateDesignJobPayload = {
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
  instruction: string;
  selectedImageId?: string;
  sourceText?: string;
};

export type SelectDesignImagePayload = {
  text?: string;
  referencedImageId?: string;
  quotedImageId?: string;
  attachmentImageId?: string;
  screenshotFingerprint?: string;
  attachmentFingerprint?: string;
};
