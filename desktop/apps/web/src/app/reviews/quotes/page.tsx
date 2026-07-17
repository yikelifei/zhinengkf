import { ReviewQuotesQueuePage } from "../../../features/reviews/review-queue-pages";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="reviewQuotes">
      <ReviewQuotesQueuePage />
    </FeatureRouteShell>
  );
}
