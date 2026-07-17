import { AutomationIssuesPage } from "../../../features/automation/automation-issues-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="automationIssues">
      <AutomationIssuesPage />
    </FeatureRouteShell>
  );
}
