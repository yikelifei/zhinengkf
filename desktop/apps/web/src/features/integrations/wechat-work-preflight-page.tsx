"use client";

import { Building2 } from "lucide-react";
import { WechatWorkReadinessPanel } from "../../components/wechat-work-readiness-panel";
import { getWechatWorkProductionPreflight } from "../../lib/api";
import { FeatureNotice, FeaturePage } from "./feature-page";
import { useAsyncResource } from "./use-async-resource";

export function WechatWorkPreflightPage() {
  const { data: readiness, busy, error, refresh } = useAsyncResource(
    getWechatWorkProductionPreflight,
    "企业微信生产预检失败",
  );

  return (
    <FeaturePage
      id="wechat-work-preflight-page"
      title="企业微信生产预检"
      description="只负责企业微信本机配置、公网回调和正式收发验收，不把离线检查误报为上线成功。"
      icon={<Building2 size={20} />}
      busy={busy}
    >
      {readiness && !readiness.productionReady ? (
        <FeatureNotice tone="warning" title="当前尚未达到生产就绪">
          请按本机检查和外部验收两组阻塞项处理；页面不会主动调用企业微信外网。
        </FeatureNotice>
      ) : null}
      <WechatWorkReadinessPanel
        readiness={readiness}
        busy={busy}
        error={error}
        onRefresh={() => void refresh()}
      />
    </FeaturePage>
  );
}
