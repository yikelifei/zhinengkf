import { TrainingSkillsPage } from "../../../features/training/training-skills-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="trainingSkills">
      <TrainingSkillsPage />
    </FeatureRouteShell>
  );
}
