import { ConversationsFeaturePage } from "../../features/conversations/conversations-feature-page";
import { FeatureRouteShell } from "../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="conversations">
      <ConversationsFeaturePage />
    </FeatureRouteShell>
  );
}
