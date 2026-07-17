import { WechatWorkPreflightPage } from "../../../features/integrations/wechat-work-preflight-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="wechatWorkChannels">
      <WechatWorkPreflightPage />
    </FeatureRouteShell>
  );
}
