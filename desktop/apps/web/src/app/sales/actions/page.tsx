import { SalesActionsPage } from "../../../features/sales/sales-actions-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="salesActions">
      <SalesActionsPage />
    </FeatureRouteShell>
  );
}
