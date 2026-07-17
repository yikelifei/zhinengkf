"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2 } from "lucide-react";
import { WechatWorkReadinessPanel } from "../../components/wechat-work-readiness-panel";
import { getWechatWorkProductionPreflight, type WechatWorkProductionReadiness } from "../../lib/api";
import { FeatureNotice, FeaturePage, errorMessage } from "./feature-page";

export function WechatWorkPreflightPage() {
  const [readiness, setReadiness] = useState<WechatWorkProductionReadiness | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  const refreshPreflight = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError("");
    try {
      const next = await getWechatWorkProductionPreflight();
      if (sequence === requestSequence.current) setReadiness(next);
    } catch (refreshError) {
      if (sequence === requestSequence.current) {
        setError(errorMessage(refreshError, "企业微信生产预检失败"));
      }
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshPreflight();
    return () => { requestSequence.current += 1; };
  }, [refreshPreflight]);

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
        onRefresh={() => void refreshPreflight()}
      />
    </FeaturePage>
  );
}
