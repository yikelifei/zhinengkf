import { SalesQuotesPage } from "../../../features/sales/sales-quotes-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="salesQuotes">
      <SalesQuotesPage />
    </FeatureRouteShell>
  );
}
