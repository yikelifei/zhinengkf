import { NotificationsPage } from "../../features/notifications/notifications-page";
import { FeatureRouteShell } from "../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="notifications">
      <NotificationsPage />
    </FeatureRouteShell>
  );
}
