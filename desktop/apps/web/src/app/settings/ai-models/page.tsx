import { AiModelsPage } from "../../../features/system";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="settingsAiModels">
      <AiModelsPage />
    </FeatureRouteShell>
  );
}
