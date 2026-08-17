import { TrainingReviewPage } from "../../../../features/training/training-review-page";
import { FeatureRouteShell } from "../../../feature-route-shell";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../../identity-search-params";

type PageProps = { searchParams: IdentitySearchParams };

export default async function Page({ searchParams }: PageProps) {
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="trainingReviewBatch">
      <TrainingReviewPage identityFilters={identityFilters} />
    </FeatureRouteShell>
  );
}
