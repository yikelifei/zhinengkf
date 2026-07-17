import { PersonalWechatInstanceConfigPage } from "../../../../../features/integrations/personal-wechat-instance-config-page";
import { FeatureRouteShell } from "../../../../feature-route-shell";

type PageProps = { searchParams: Promise<{ accountId?: string | string[] }> };

export default async function Page({ searchParams }: PageProps) {
  const { accountId } = await searchParams;
  const initialAccountId = Array.isArray(accountId) ? accountId[0] : accountId;
  return (
    <FeatureRouteShell routeId="personalWechatInstanceConfig">
      <PersonalWechatInstanceConfigPage key={initialAccountId || "new"} accountId={initialAccountId} />
    </FeatureRouteShell>
  );
}
