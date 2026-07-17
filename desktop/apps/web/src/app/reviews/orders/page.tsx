import { ReviewOrdersPage } from "../../../features/reviews/review-orders-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="reviewOrders">
      <ReviewOrdersPage />
    </FeatureRouteShell>
  );
}
