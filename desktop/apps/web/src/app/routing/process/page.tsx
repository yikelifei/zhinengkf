import { RoutingFeaturePage } from "../../../features/routing/routing-feature-page";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../identity-search-params";
import { FeatureRouteShell } from "../../feature-route-shell";

export default async function Page({ searchParams }: { searchParams?: IdentitySearchParams }) {
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="routingProcess">
      <RoutingFeaturePage mode="process" initialConversationId={identityFilters.conversationId} />
    </FeatureRouteShell>
  );
}
