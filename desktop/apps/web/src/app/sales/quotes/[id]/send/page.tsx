import { SalesQuoteActionPage } from "../../../../../features/sales/sales-quote-action-page";
import { FeatureRouteShell } from "../../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <FeatureRouteShell routeId="salesQuoteSend"><SalesQuoteActionPage key={id} quoteId={id} action="send" /></FeatureRouteShell>;
}
