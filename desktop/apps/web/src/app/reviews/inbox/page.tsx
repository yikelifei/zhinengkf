import { ReviewInboxPage } from "../../../features/reviews/review-inbox-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="reviewInbox">
      <ReviewInboxPage />
    </FeatureRouteShell>
  );
}
