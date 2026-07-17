import { DesignActivationPage } from "../../../features/design/design-activation-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="designActivation">
      <DesignActivationPage />
    </FeatureRouteShell>
  );
}
