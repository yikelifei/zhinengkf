import { SendDiagnosticsPage } from "../../../features/send/send-diagnostics-page";
import { FeatureRouteShell } from "../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="sendDiagnostics">
      <SendDiagnosticsPage />
    </FeatureRouteShell>
  );
}
