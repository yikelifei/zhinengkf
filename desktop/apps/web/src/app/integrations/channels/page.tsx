import { ChannelsStatusPage } from "../../../features/integrations/channels-status-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="integrationChannels">
      <ChannelsStatusPage />
    </FeatureRouteShell>
  );
}
