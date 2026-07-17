import { PersonalWechatInstancesPage } from "../../../../features/integrations/personal-wechat-instances-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { searchParams: Promise<{ accountId?: string | string[] }> };

export default async function Page({ searchParams }: PageProps) {
  const { accountId } = await searchParams;
  const initialAccountId = Array.isArray(accountId) ? accountId[0] : accountId;
  return (
    <FeatureRouteShell routeId="personalWechatInstances">
      <PersonalWechatInstancesPage
        key={initialAccountId || "index"}
        initialAccountId={initialAccountId}
      />
    </FeatureRouteShell>
  );
}
