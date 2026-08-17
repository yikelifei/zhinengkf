import { SendBlockedPage } from "../../../../features/send/send-blocked-page";
import { FeatureRouteShell } from "../../../feature-route-shell";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../../identity-search-params";

type PageProps = { params: Promise<{ id: string }>; searchParams: IdentitySearchParams };

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const filters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="sendBlockedTask">
      <SendBlockedPage key={id} initialTaskId={id} filters={filters} />
    </FeatureRouteShell>
  );
}
