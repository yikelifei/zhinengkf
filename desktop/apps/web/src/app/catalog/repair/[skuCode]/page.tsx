import { CatalogRepairDetailPage } from "../../../../features/catalog/catalog-repair-detail-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ skuCode: string }> };

export default async function Page({ params }: PageProps) {
  const { skuCode } = await params;
  return <FeatureRouteShell routeId="catalogRepairDetail"><CatalogRepairDetailPage key={skuCode} skuCode={skuCode} /></FeatureRouteShell>;
}
