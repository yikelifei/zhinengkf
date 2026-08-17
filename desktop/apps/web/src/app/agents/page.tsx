import { AgentsPage } from "../../features/agents/agents-page";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../identity-search-params";
import { FeatureRouteShell } from "../feature-route-shell";

export default async function Page({ searchParams }: { searchParams?: IdentitySearchParams }) {
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="agents">
      <AgentsPage identityFilters={identityFilters} />
    </FeatureRouteShell>
  );
}
