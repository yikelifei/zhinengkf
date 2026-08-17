import { ReviewQuotesPage } from "../../../../features/reviews/review-quotes-page";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../../identity-search-params";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }>; searchParams?: IdentitySearchParams };

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="reviewQuoteDecision">
      <ReviewQuotesPage key={id} reviewId={id} identityFilters={identityFilters} />
    </FeatureRouteShell>
  );
}
