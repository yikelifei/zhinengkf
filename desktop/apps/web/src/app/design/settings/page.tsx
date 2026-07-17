import { DesignSettingsPage } from "../../../features/design/design-settings-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="designSettings">
      <DesignSettingsPage />
    </FeatureRouteShell>
  );
}
