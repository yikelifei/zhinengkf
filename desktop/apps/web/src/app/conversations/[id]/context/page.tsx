import { ConversationContextPage } from "../../../../features/conversations/conversation-context-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="conversationContext">
      <ConversationContextPage key={id} conversationId={id} />
    </FeatureRouteShell>
  );
}
