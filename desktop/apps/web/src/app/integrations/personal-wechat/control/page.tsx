import { PersonalWechatControlPage } from "../../../../features/integrations/personal-wechat-control-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="personalWechatControl">
      <PersonalWechatControlPage />
    </FeatureRouteShell>
  );
}
