import { WechatWorkFlowPage } from "../../../../features/integrations/wechat-work-flow-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="wechatWorkFlow">
      <WechatWorkFlowPage />
    </FeatureRouteShell>
  );
}
