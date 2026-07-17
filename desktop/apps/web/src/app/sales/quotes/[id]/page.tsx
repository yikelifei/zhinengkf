import { SalesQuotesPage } from "../../../../features/sales/sales-quotes-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="salesQuoteDetail">
      <SalesQuotesPage key={id} initialQuoteId={id} />
    </FeatureRouteShell>
  );
}
