import { CatalogProductEditorPage } from "../../../features/catalog/catalog-product-editor-page";
import { FeatureRouteShell } from "../../feature-route-shell";

type PageProps = { searchParams: Promise<{ sku?: string }> };

export default async function Page({ searchParams }: PageProps) {
  const { sku = "" } = await searchParams;
  return <FeatureRouteShell routeId="catalogEditor"><CatalogProductEditorPage key={sku || "new"} skuCode={sku} /></FeatureRouteShell>;
}
