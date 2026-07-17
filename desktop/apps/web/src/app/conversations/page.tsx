import { ConversationListPage } from "../../features/conversations/conversation-list-page";
import { FeatureRouteShell } from "../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="conversations">
      <ConversationListPage />
    </FeatureRouteShell>
  );
}
