import { CatalogAuditPage } from "../../../features/catalog/catalog-audit-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="catalogAudit">
      <CatalogAuditPage />
    </FeatureRouteShell>
  );
}
