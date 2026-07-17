import { SendQueuePage } from "../../../../features/send/send-queue-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="sendQueueTask">
      <SendQueuePage key={id} initialTaskId={id} />
    </FeatureRouteShell>
  );
}
