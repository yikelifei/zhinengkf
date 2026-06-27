export type UploadAssetPayload = {
  ownerType: "customer" | "sku" | "design_job" | string;
  ownerId: string;
  role?: "customer_logo" | "reference" | "sku_image" | "product_image" | string;
  fileName: string;
  mimeType?: string;
  source?: string;
  base64?: string;
  text?: string;
  url?: string;
};
