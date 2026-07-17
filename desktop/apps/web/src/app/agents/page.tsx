import { AgentsPage } from "../../features/agents/agents-page";
import { FeatureRouteShell } from "../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="agents">
      <AgentsPage />
    </FeatureRouteShell>
  );
}
