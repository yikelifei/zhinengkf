import { TrainingReviewQueuePage } from "../../../features/training/training-review-queue-page";
import { FeatureRouteShell } from "../../feature-route-shell";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../identity-search-params";

type PageProps = { searchParams: IdentitySearchParams };

export default async function Page({ searchParams }: PageProps) {
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="trainingReview">
      <TrainingReviewQueuePage identityFilters={identityFilters} />
    </FeatureRouteShell>
  );
}
