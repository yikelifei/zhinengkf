import { DesignAssetsPage } from "../../../features/design/design-assets-page";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../identity-search-params";
import { FeatureRouteShell } from "../../feature-route-shell";

type PageProps = { searchParams: IdentitySearchParams };

export default async function Page({ searchParams }: PageProps) {
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return (
    <FeatureRouteShell routeId="designAssets">
      <DesignAssetsPage initialIdentityFilters={identityFilters} />
    </FeatureRouteShell>
  );
}
