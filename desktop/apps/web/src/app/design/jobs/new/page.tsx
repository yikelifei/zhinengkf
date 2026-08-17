import { DesignJobCreatePage } from "../../../../features/design/design-job-create-page";
import { FeatureRouteShell } from "../../../feature-route-shell";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../../identity-search-params";

type PageProps = { searchParams: IdentitySearchParams };

export default async function Page({ searchParams }: PageProps) {
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return <FeatureRouteShell routeId="designJobCreate"><DesignJobCreatePage initialIdentityFilters={identityFilters} /></FeatureRouteShell>;
}
