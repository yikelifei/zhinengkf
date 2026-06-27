export type SkuPayload = {
  skuCode: string;
  name: string;
  type: "gift_box" | "item" | "accessory";
  category?: string;
  sceneTags?: string[];
  costPrice: number;
  salePrice: number;
  stock?: number;
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

export type BundleRecommendPayload = {
  budget: {
    mode?: "per_box" | "total" | "unknown";
    totalAmount?: number | null;
    perUnitAmount?: number | null;
    quantity?: number | null;
  };
  scene?: string;
  maxItems?: number;
};
