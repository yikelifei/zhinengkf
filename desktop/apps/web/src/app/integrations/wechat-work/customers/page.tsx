import { WechatWorkCustomerEntryPage } from "../../../../features/integrations/wechat-work-customer-entry-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

export default function Page() {
  return (
    <FeatureRouteShell routeId="wechatWorkCustomers">
      <WechatWorkCustomerEntryPage />
    </FeatureRouteShell>
  );
}
