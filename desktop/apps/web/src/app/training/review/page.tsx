import { TrainingReviewQueuePage } from "../../../features/training/training-review-queue-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="trainingReview">
      <TrainingReviewQueuePage />
    </FeatureRouteShell>
  );
}
