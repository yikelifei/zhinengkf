import { AutomationHistoryPage } from "../../../features/automation/automation-history-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="automationHistory">
      <AutomationHistoryPage />
    </FeatureRouteShell>
  );
}
