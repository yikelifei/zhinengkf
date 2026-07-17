import { TrainingImportHistoryPage } from "../../../../features/training/training-import-history-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="trainingImportHistory">
      <TrainingImportHistoryPage />
    </FeatureRouteShell>
  );
}
