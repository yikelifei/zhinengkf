import { AutomationHistoryPage } from "../../../features/automation/automation-history-page";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../identity-search-params";
import { FeatureRouteShell } from "../../feature-route-shell";

export default async function Page({ searchParams }: { searchParams?: IdentitySearchParams }) {
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="automationHistory">
      <AutomationHistoryPage identityFilters={identityFilters} />
    </FeatureRouteShell>
  );
}
