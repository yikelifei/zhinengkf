import { ReviewLogsPage } from "../../../features/reviews/review-logs-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="reviewLogs">
      <ReviewLogsPage />
    </FeatureRouteShell>
  );
}
