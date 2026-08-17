import { ConversationDetailPage, conversationNavigationFromSearchParams, type ConversationNavigationSearchParams } from "../../../features/conversations";
import { FeatureRouteShell } from "../../feature-route-shell";
import { identityFiltersFromSearchParams } from "../../identity-search-params";

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<ConversationNavigationSearchParams> };

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const rawSearchParams = await searchParams;
  const identityFilters = await identityFiltersFromSearchParams(Promise.resolve(rawSearchParams));
  const navigation = conversationNavigationFromSearchParams(rawSearchParams);
  return (
    <FeatureRouteShell routeId="conversationDetail">
      <ConversationDetailPage key={id} conversationId={id} identityFilters={identityFilters} navigation={navigation} />
    </FeatureRouteShell>
  );
}
