import { DesignAssetsPage } from "../../../features/design/design-assets-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="designAssets">
      <DesignAssetsPage />
    </FeatureRouteShell>
  );
}
