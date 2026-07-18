import { PersonalWechatVoiceAssistPage } from "../../../../features/integrations/personal-wechat-voice-assist-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="personalWechatVoiceAssist">
      <PersonalWechatVoiceAssistPage />
    </FeatureRouteShell>
  );
}
