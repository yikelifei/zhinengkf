import { CatalogImportPage } from "../../../features/catalog/catalog-import-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="catalogImport">
      <CatalogImportPage />
    </FeatureRouteShell>
  );
}
