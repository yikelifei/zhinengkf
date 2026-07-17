import { CatalogBundlesPage } from "../../../features/catalog/catalog-bundles-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="catalogBundles">
      <CatalogBundlesPage />
    </FeatureRouteShell>
  );
}
