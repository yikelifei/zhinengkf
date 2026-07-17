import type { ReactNode } from "react";
import { ModularWorkbenchShell } from "./modular-workbench-shell";
import { getWorkbenchRoute, type WorkbenchRouteId } from "./route-manifest";

type FeatureRouteShellProps = {
  routeId: WorkbenchRouteId;
  children: ReactNode;
};

export function FeatureRouteShell({ routeId, children }: FeatureRouteShellProps) {
  return (
    <ModularWorkbenchShell route={getWorkbenchRoute(routeId)}>
      {children}
    </ModularWorkbenchShell>
  );
}
