import { ConversationsFeaturePage } from "../../../features/conversations/conversations-feature-page";
import { FeatureRouteShell } from "../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="conversationDetail">
      <ConversationsFeaturePage key={id} initialConversationId={id} />
    </FeatureRouteShell>
  );
}
