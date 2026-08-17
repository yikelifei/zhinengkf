import { SendQueuePage } from "../../../../features/send/send-queue-page";
import { FeatureRouteShell } from "../../../feature-route-shell";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../../identity-search-params";

type PageProps = { params: Promise<{ id: string }>; searchParams: IdentitySearchParams };

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const filters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="sendQueueTask">
      <SendQueuePage key={id} initialTaskId={id} filters={filters} />
    </FeatureRouteShell>
  );
}
