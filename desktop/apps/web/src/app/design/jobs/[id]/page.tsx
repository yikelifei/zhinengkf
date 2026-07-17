import { DesignJobsPage } from "../../../../features/design/design-jobs-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="designJobDetail">
      <DesignJobsPage key={id} initialJobId={id} />
    </FeatureRouteShell>
  );
}
