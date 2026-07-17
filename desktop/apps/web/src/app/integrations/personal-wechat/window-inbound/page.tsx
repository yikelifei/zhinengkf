import { WindowEvidencePage } from "../../../../features/integrations/window-evidence-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="personalWechatInbound">
      <WindowEvidencePage />
    </FeatureRouteShell>
  );
}
