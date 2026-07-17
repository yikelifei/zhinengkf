import { TrainingReviewPage } from "../../../features/training/training-review-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="trainingReview">
      <TrainingReviewPage />
    </FeatureRouteShell>
  );
}
