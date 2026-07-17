import { PersonalWechatInstancesPage } from "../../../../features/integrations/personal-wechat-instances-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="personalWechatInstances">
      <PersonalWechatInstancesPage />
    </FeatureRouteShell>
  );
}
