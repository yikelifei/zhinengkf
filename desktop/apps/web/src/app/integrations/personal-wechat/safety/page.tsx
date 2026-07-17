import { PersonalWechatSafetyPage } from "../../../../features/integrations/personal-wechat-safety-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="personalWechatSafety">
      <PersonalWechatSafetyPage />
    </FeatureRouteShell>
  );
}
