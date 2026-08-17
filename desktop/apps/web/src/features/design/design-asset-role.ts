import type { DesignAsset } from "../../lib/api";

export type DesignAssetApplyTarget = "customer" | "product";

export type DesignAssetRoleFilter =
  | "all"
  | "customer_logo"
  | "reference"
  | "product_image"
  | "sku_image"
  | "attachment";

type DesignAssetRoleOption = {
  value: Exclude<DesignAssetRoleFilter, "all">;
  label: string;
  targets: DesignAssetApplyTarget[];
};

export const DESIGN_ASSET_ROLE_OPTIONS: DesignAssetRoleOption[] = [
  { value: "customer_logo", label: "客户 Logo", targets: ["customer"] },
  { value: "reference", label: "参考图", targets: ["customer"] },
  { value: "product_image", label: "商品图", targets: ["product"] },
  { value: "sku_image", label: "SKU 图片", targets: ["product"] },
  { value: "attachment", label: "附件", targets: ["customer"] },
];

export const DESIGN_ASSET_ROLE_FILTERS = [
  { value: "all", label: "全部素材" },
  ...DESIGN_ASSET_ROLE_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
] satisfies Array<{ value: DesignAssetRoleFilter; label: string }>;

export function normalizeDesignAssetRole(role?: string | null) {
  const normalized = String(role || "").trim();
  return normalized || "reference";
}

export function assetRoleLabel(role?: string | null) {
  const normalized = normalizeDesignAssetRole(role);
  return DESIGN_ASSET_ROLE_OPTIONS.find((option) => option.value === normalized)?.label || normalized;
}

export function assetRoleSupportsTarget(asset: Pick<DesignAsset, "role">, target: DesignAssetApplyTarget) {
  const normalized = normalizeDesignAssetRole(asset.role);
  return Boolean(DESIGN_ASSET_ROLE_OPTIONS.find((option) => option.value === normalized)?.targets.includes(target));
}

export function filterDesignAssetsByRole(assets: DesignAsset[], role: DesignAssetRoleFilter) {
  if (role === "all") return assets;
  return assets.filter((asset) => normalizeDesignAssetRole(asset.role) === role);
}

export function assetRoleSummary(assets: DesignAsset[]) {
  return DESIGN_ASSET_ROLE_OPTIONS
    .map((option) => ({
      label: option.label,
      count: assets.filter((asset) => normalizeDesignAssetRole(asset.role) === option.value).length,
    }))
    .filter((item) => item.count > 0);
}
