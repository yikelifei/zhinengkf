import { SalesOrdersPage } from "../../../features/sales/sales-orders-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="salesOrders">
      <SalesOrdersPage />
    </FeatureRouteShell>
  );
}
