import { DeliveryReadinessPage } from "../../../features/system";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="settingsDeliveryReadiness">
      <DeliveryReadinessPage />
    </FeatureRouteShell>
  );
}
