import { TrainingImportPage } from "../../../features/training/training-import-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="trainingImport">
      <TrainingImportPage />
    </FeatureRouteShell>
  );
}
