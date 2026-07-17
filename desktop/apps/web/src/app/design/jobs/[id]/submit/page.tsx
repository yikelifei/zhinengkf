import { DesignJobSubmitPage } from "../../../../../features/design/design-job-submit-page";
import { FeatureRouteShell } from "../../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <FeatureRouteShell routeId="designJobSubmit"><DesignJobSubmitPage key={id} jobId={id} /></FeatureRouteShell>;
}
