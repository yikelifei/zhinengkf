import { WechatWorkConfigurationPage } from "../../../../features/integrations/wechat-work-configuration-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="wechatWorkSettings">
      <WechatWorkConfigurationPage />
    </FeatureRouteShell>
  );
}
