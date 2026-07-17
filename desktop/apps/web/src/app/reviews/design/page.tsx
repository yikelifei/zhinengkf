import { ReviewDesignPage } from "../../../features/reviews/review-design-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="reviewDesign">
      <ReviewDesignPage />
    </FeatureRouteShell>
  );
}
