import { SalesOrdersPage } from "../../../../features/sales/sales-orders-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="salesOrderDetail">
      <SalesOrdersPage key={id} initialOrderId={id} />
    </FeatureRouteShell>
  );
}
