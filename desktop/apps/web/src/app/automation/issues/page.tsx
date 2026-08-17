import { AutomationIssuesPage } from "../../../features/automation/automation-issues-page";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../identity-search-params";
import { FeatureRouteShell } from "../../feature-route-shell";

export default async function Page({ searchParams }: { searchParams?: IdentitySearchParams }) {
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="automationIssues">
      <AutomationIssuesPage identityFilters={identityFilters} />
    </FeatureRouteShell>
  );
}
