import { AutomationRunsPage } from "../../../features/automation/automation-runs-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="automationRuns">
      <AutomationRunsPage />
    </FeatureRouteShell>
  );
}
