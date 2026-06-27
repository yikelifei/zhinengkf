export type DesignPlatformJobPayload = {
  requestId: string;
  wechatAccountId?: string | null;
  customerId: string;
  conversationId: string;
  orderId?: string | null;
  budget: Record<string, unknown>;
  scene?: string | null;
  bundle: Record<string, unknown>;
  assets: Array<Record<string, unknown>>;
  outputCount: number;
  renderStyle: string;
  requirements: Record<string, unknown>;
  customerText?: string | null;
  revision?: Record<string, unknown> | null;
};

export type DesignPlatformCallbackPayload = {
  requestId: string;
  externalJobId?: string;
  status: "completed" | "failed";
  images?: Array<{
    imageId: string;
    downloadUrl: string;
    width?: number;
    height?: number;
  }>;
  errorMessage?: string;
};
