import { SendDiagnosticsOperationsPage } from "../../../../features/send/send-diagnostics-operations-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="sendDiagnosticOperations">
      <SendDiagnosticsOperationsPage />
    </FeatureRouteShell>
  );
}
