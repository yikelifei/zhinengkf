import { SalesOrderEditPage } from "../../../../../features/sales/sales-order-edit-page";
import { FeatureRouteShell } from "../../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <FeatureRouteShell routeId="salesOrderEdit"><SalesOrderEditPage key={id} orderId={id} /></FeatureRouteShell>;
}
