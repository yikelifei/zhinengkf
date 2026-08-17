import { DesignZhenxiWorkspacePage } from "../../../features/design/design-zhenxi-workspace-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="designZhenxiAi">
      <DesignZhenxiWorkspacePage />
    </FeatureRouteShell>
  );
}
