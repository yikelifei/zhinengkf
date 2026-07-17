import { ReviewDesignQueuePage } from "../../../features/reviews/review-queue-pages";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="reviewDesign">
      <ReviewDesignQueuePage />
    </FeatureRouteShell>
  );
}
