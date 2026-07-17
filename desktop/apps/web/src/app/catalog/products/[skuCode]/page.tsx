import { CatalogProductDetailPage } from "../../../../features/catalog/catalog-product-detail-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ skuCode: string }> };

export default async function Page({ params }: PageProps) {
  const { skuCode } = await params;
  return <FeatureRouteShell routeId="catalogProductDetail"><CatalogProductDetailPage key={skuCode} skuCode={skuCode} /></FeatureRouteShell>;
}
