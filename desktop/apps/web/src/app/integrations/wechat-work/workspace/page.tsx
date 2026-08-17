import { WechatWorkWorkspacePage } from "../../../../features/integrations/wechat-work-workspace-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="wechatWorkWorkspace">
      <WechatWorkWorkspacePage />
    </FeatureRouteShell>
  );
}
