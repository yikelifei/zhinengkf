import { FeatureRouteShell } from "../feature-route-shell";
import { OverviewRouteFeature } from "../overview-route-feature";

export default function Page() {
  return (
    <FeatureRouteShell routeId="overview">
      <OverviewRouteFeature />
    </FeatureRouteShell>
  );
}
