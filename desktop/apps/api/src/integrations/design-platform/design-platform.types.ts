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
  designType?: string;
  outputCount: number;
  renderStyle: string;
  requirements: Record<string, unknown>;
  customerText?: string | null;
  revision?: Record<string, unknown> | null;
  callback?: {
    url: string;
    method: "POST";
    events: Array<"completed" | "failed">;
    headers?: Record<string, string>;
    requestId: string;
    fallbackPolling: boolean;
  };
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
