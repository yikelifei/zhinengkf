import { ReviewQuotesQueuePage } from "../../../features/reviews/review-queue-pages";
import { FeatureRouteShell } from "../../feature-route-shell";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../identity-search-params";

export default async function Page({ searchParams }: { searchParams?: IdentitySearchParams }) {
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="reviewQuotes">
      <ReviewQuotesQueuePage identityFilters={identityFilters} />
    </FeatureRouteShell>
  );
}
