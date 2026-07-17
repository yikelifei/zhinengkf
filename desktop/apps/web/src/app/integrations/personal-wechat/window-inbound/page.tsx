import { WindowInboundOperationsPage } from "../../../../features/integrations/window-inbound-operations-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="personalWechatInbound">
      <WindowInboundOperationsPage />
    </FeatureRouteShell>
  );
}
