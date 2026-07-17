import { RoutingFeaturePage } from "../../features/routing/routing-feature-page";
import { FeatureRouteShell } from "../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="routing">
      <RoutingFeaturePage />
    </FeatureRouteShell>
  );
}
