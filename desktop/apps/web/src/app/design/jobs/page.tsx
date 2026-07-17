import { DesignJobsPage } from "../../../features/design/design-jobs-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="designJobs">
      <DesignJobsPage />
    </FeatureRouteShell>
  );
}
