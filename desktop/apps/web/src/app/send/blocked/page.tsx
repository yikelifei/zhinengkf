import { SendBlockedPage } from "../../../features/send/send-blocked-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="sendBlocked">
      <SendBlockedPage />
    </FeatureRouteShell>
  );
}
