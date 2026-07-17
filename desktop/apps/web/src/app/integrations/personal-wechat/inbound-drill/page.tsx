import { PersonalWechatInboundDrillPage } from "../../../../features/integrations/personal-wechat-inbound-drill-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="personalWechatInboundDrill">
      <PersonalWechatInboundDrillPage />
    </FeatureRouteShell>
  );
}
