import { ConversationListPage, conversationNavigationFromSearchParams, type ConversationNavigationSearchParams } from "../../features/conversations";
import { FeatureRouteShell } from "../feature-route-shell";

type PageProps = { searchParams: Promise<ConversationNavigationSearchParams> };

export default async function Page({ searchParams }: PageProps) {
  const navigation = conversationNavigationFromSearchParams(await searchParams);
  return (
    <FeatureRouteShell routeId="conversations">
      <ConversationListPage initialNavigation={navigation} />
    </FeatureRouteShell>
  );
}
