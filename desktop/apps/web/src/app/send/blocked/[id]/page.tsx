import { SendBlockedPage } from "../../../../features/send/send-blocked-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="sendBlockedTask">
      <SendBlockedPage key={id} initialTaskId={id} />
    </FeatureRouteShell>
  );
}
