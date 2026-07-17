import { SendBlockedPage } from "../../../features/send/send-blocked-page";
import { FeatureRouteShell } from "../../feature-route-shell";

type PageProps = { searchParams: Promise<{ taskId?: string | string[] }> };

export default async function Page({ searchParams }: PageProps) {
  const { taskId } = await searchParams;
  const initialTaskId = Array.isArray(taskId) ? taskId[0] : taskId;
  return (
    <FeatureRouteShell routeId="sendBlocked">
      <SendBlockedPage key={initialTaskId || "index"} initialTaskId={initialTaskId} />
    </FeatureRouteShell>
  );
}
