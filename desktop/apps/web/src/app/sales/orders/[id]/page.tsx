import { SalesOrderDetailPage } from "../../../../features/sales/sales-order-detail-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="salesOrderDetail">
      <SalesOrderDetailPage key={id} orderId={id} />
    </FeatureRouteShell>
  );
}
