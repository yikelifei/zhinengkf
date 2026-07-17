import { SalesOrderMessagePage } from "../../../../../../features/sales/sales-order-message-page";
import { FeatureRouteShell } from "../../../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <FeatureRouteShell routeId="salesOrderProduction"><SalesOrderMessagePage key={id} orderId={id} kind="production" /></FeatureRouteShell>;
}
