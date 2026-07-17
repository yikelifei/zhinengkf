import { AccessPage } from "../../../features/access/access-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="settingsAccess">
      <AccessPage />
    </FeatureRouteShell>
  );
}
