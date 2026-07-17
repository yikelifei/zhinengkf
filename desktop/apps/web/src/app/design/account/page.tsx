import { DesignAccountPage } from "../../../features/design/design-account-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="designAccount">
      <DesignAccountPage />
    </FeatureRouteShell>
  );
}
