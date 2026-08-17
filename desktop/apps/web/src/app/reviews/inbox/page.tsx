import { ReviewInboxPage } from "../../../features/reviews/review-inbox-page";
import { FeatureRouteShell } from "../../feature-route-shell";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../identity-search-params";

export default async function Page({ searchParams }: { searchParams?: IdentitySearchParams }) {
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="reviewInbox">
      <ReviewInboxPage identityFilters={identityFilters} />
    </FeatureRouteShell>
  );
}
