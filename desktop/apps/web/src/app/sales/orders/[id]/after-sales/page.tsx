import { SalesOrderAfterSalesPage } from "../../../../../features/sales/sales-order-after-sales-page";
import { FeatureRouteShell } from "../../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="salesOrderAfterSales">
      <SalesOrderAfterSalesPage key={id} orderId={id} />
    </FeatureRouteShell>
  );
}
