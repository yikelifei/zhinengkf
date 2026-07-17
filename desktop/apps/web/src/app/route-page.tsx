import LegacyWorkbench from "./legacy-workbench";
import { getWorkbenchRoute, type WorkbenchRouteId } from "./route-manifest";

export type WorkbenchRoutePageProps = {
  routeId: WorkbenchRouteId;
};

export function WorkbenchRoutePage({ routeId }: WorkbenchRoutePageProps) {
  const route = getWorkbenchRoute(routeId);
  return <LegacyWorkbench key={route.id} route={route} />;
}

export type WorkbenchDetailRoutePageProps = WorkbenchRoutePageProps & {
  entityId: string;
};

export function WorkbenchDetailRoutePage({ routeId, entityId }: WorkbenchDetailRoutePageProps) {
  const route = getWorkbenchRoute(routeId);
  return <LegacyWorkbench key={`${route.id}:${entityId}`} route={route} />;
}
