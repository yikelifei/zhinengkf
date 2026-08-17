import { CatalogBundlesPage } from "../../../features/catalog/catalog-bundles-page";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../identity-search-params";
import { FeatureRouteShell } from "../../feature-route-shell";

type PageProps = { searchParams: IdentitySearchParams };

export default async function Page({ searchParams }: PageProps) {
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="catalogBundles">
      <CatalogBundlesPage initialIdentityFilters={identityFilters} />
    </FeatureRouteShell>
  );
}
