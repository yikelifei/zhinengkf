import { DesignJobDetailPage } from "../../../../features/design/design-job-detail-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="designJobDetail">
      <DesignJobDetailPage key={id} jobId={id} />
    </FeatureRouteShell>
  );
}
