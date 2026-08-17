import { RoutingFeaturePage } from "../../features/routing/routing-feature-page";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../identity-search-params";
import { FeatureRouteShell } from "../feature-route-shell";

export default async function Page({ searchParams }: { searchParams?: IdentitySearchParams }) {
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="routing">
      <RoutingFeaturePage initialConversationId={identityFilters.conversationId} />
    </FeatureRouteShell>
  );
}
