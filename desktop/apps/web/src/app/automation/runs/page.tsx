import { AutomationRunsPage } from "../../../features/automation/automation-runs-page";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../identity-search-params";
import { FeatureRouteShell } from "../../feature-route-shell";

export default async function Page({ searchParams }: { searchParams?: IdentitySearchParams }) {
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="automationRuns">
      <AutomationRunsPage identityFilters={identityFilters} />
    </FeatureRouteShell>
  );
}
