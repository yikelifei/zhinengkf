import { SalesQuoteActionPage } from "../../../../../features/sales/sales-quote-action-page";
import { FeatureRouteShell } from "../../../../feature-route-shell";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../../../identity-search-params";

type PageProps = { params: Promise<{ id: string }>; searchParams?: IdentitySearchParams };

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return <FeatureRouteShell routeId="salesQuoteSend"><SalesQuoteActionPage key={id} quoteId={id} action="send" initialIdentityFilters={identityFilters} /></FeatureRouteShell>;
}
