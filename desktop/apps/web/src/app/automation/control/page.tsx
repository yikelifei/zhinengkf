import { AutomationControlPage } from "../../../features/automation/automation-control-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="automationControl">
      <AutomationControlPage />
    </FeatureRouteShell>
  );
}
