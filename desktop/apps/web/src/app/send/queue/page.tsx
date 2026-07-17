import { SendQueuePage } from "../../../features/send/send-queue-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="sendQueue">
      <SendQueuePage />
    </FeatureRouteShell>
  );
}
