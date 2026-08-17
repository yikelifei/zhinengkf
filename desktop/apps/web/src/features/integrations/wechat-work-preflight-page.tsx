"use client";

import Link from "next/link";
import { Building2, MessagesSquare } from "lucide-react";
import { WechatWorkReadinessPanel } from "../../components/wechat-work-readiness-panel";
import { getWechatConversations, getWechatWorkProductionPreflight } from "../../lib/api";
import { FeatureNotice, FeaturePage } from "./feature-page";
import { useAsyncResource } from "./use-async-resource";

export function WechatWorkPreflightPage() {
  const { data, busy, error, refresh } = useAsyncResource(
    async () => {
      const [readiness, conversations] = await Promise.all([
        getWechatWorkProductionPreflight(),
        getWechatConversations(),
      ]);
      return { readiness, conversations };
    },
    "企业微信生产预检失败",
  );
  const readiness = data?.readiness;
  const conversations = data?.conversations || [];
  const unreadCount = conversations.reduce((total, conversation) => total + Number(conversation.unreadCount || 0), 0);
  const latestConversation = [...conversations].sort((left, right) =>
    String(right.lastMessageAt || "").localeCompare(String(left.lastMessageAt || "")),
  )[0];

  return (
    <FeaturePage
      id="wechat-work-preflight-page"
      title="企业微信生产预检"
      description="只负责企业微信本机配置、公网回调和正式收发验收，不把离线检查误报为上线成功。"
      icon={<Building2 size={20} />}
      busy={busy}
    >
      {data ? (
        <FeatureNotice tone="success" title="企业微信官方客服已接入客户端">
          <span>
            当前显示 {conversations.length} 个企业微信会话、{unreadCount} 条未读消息。
            {latestConversation?.lastMessagePreview ? ` 最近消息：${latestConversation.lastMessagePreview}` : ""}
          </span>
          <Link href="/conversations" aria-label="打开企业微信客户会话">
            <MessagesSquare size={16} aria-hidden="true" /> 打开企业微信会话
          </Link>
        </FeatureNotice>
      ) : null}
      {readiness && !readiness.productionReady ? (
        <FeatureNotice tone="warning" title="当前尚未达到生产就绪">
          请按本机检查和外部验收两组阻塞项处理；页面不会主动调用企业微信外网。
        </FeatureNotice>
      ) : null}
      <WechatWorkReadinessPanel
        readiness={readiness || null}
        busy={busy}
        error={error}
        onRefresh={() => void refresh()}
      />
    </FeaturePage>
  );
}
