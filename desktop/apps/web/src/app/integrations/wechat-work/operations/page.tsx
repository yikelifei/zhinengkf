import { WechatWorkOperationsPage } from "../../../../features/integrations/wechat-work-operations-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="wechatWorkOperations">
      <WechatWorkOperationsPage />
    </FeatureRouteShell>
  );
}
