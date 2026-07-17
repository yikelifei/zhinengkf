import { ReviewQuotesPage } from "../../../features/reviews/review-quotes-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="reviewQuotes">
      <ReviewQuotesPage />
    </FeatureRouteShell>
  );
}
