import { SalesQuotesPage } from "../../../features/sales/sales-quotes-page";
import { FeatureRouteShell } from "../../feature-route-shell";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../identity-search-params";

type PageProps = { searchParams: IdentitySearchParams };

export default async function Page({ searchParams }: PageProps) {
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="salesQuotes">
      <SalesQuotesPage identityFilters={identityFilters} />
    </FeatureRouteShell>
  );
}
