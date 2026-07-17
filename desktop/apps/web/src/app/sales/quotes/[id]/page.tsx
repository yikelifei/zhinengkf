import { SalesQuoteDetailPage } from "../../../../features/sales/sales-quote-detail-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="salesQuoteDetail">
      <SalesQuoteDetailPage key={id} quoteId={id} />
    </FeatureRouteShell>
  );
}
