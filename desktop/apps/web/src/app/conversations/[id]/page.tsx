import { ConversationDetailPage } from "../../../features/conversations/conversation-detail-page";
import { FeatureRouteShell } from "../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="conversationDetail">
      <ConversationDetailPage key={id} conversationId={id} />
    </FeatureRouteShell>
  );
}
