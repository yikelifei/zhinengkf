import { AgentDetailPage } from "../../../features/agents/agent-detail-page";
import { FeatureRouteShell } from "../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="agentDetail">
      <AgentDetailPage key={id} agentId={id} />
    </FeatureRouteShell>
  );
}
