import { SendQueuePage } from "../../../features/send/send-queue-page";
import { FeatureRouteShell } from "../../feature-route-shell";

type PageProps = { searchParams: Promise<{ taskId?: string | string[] }> };

export default async function Page({ searchParams }: PageProps) {
  const { taskId } = await searchParams;
  const initialTaskId = Array.isArray(taskId) ? taskId[0] : taskId;
  return (
    <FeatureRouteShell routeId="sendQueue">
      <SendQueuePage key={initialTaskId || "index"} initialTaskId={initialTaskId} />
    </FeatureRouteShell>
  );
}
