import { CatalogProductsPage } from "../../../features/catalog/catalog-products-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="catalogProducts">
      <CatalogProductsPage />
    </FeatureRouteShell>
  );
}
