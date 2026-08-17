import { AutomationControlPage } from "../../../features/automation/automation-control-page";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../identity-search-params";
import { FeatureRouteShell } from "../../feature-route-shell";

export default async function Page({ searchParams }: { searchParams?: IdentitySearchParams }) {
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="automationControl">
      <AutomationControlPage identityFilters={identityFilters} allowGlobalSchedulerControl />
    </FeatureRouteShell>
  );
}
