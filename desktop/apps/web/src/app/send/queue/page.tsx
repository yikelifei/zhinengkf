import { SendQueuePage } from "../../../features/send/send-queue-page";
import { FeatureRouteShell } from "../../feature-route-shell";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../identity-search-params";

export default async function Page({ searchParams }: { searchParams?: IdentitySearchParams }) {
  const filters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="sendQueue">
      <SendQueuePage filters={filters} />
    </FeatureRouteShell>
  );
}
