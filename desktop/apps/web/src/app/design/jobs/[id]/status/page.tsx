import { DesignJobStatusPage } from "../../../../../features/design/design-job-status-page";
import { FeatureRouteShell } from "../../../../feature-route-shell";
import { identityFiltersFromSearchParams, type IdentitySearchParams } from "../../../../identity-search-params";

type PageProps = { params: Promise<{ id: string }>; searchParams?: IdentitySearchParams };

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const identityFilters = await identityFiltersFromSearchParams(searchParams);
  return <FeatureRouteShell routeId="designJobStatus"><DesignJobStatusPage key={id} jobId={id} initialIdentityFilters={identityFilters} /></FeatureRouteShell>;
}
