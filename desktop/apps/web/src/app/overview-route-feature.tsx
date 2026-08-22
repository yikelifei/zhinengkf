"use client";

import { useRouter } from "next/navigation";
import { OverviewPage, type OverviewDestination } from "../features/overview";

const overviewDestinations: Record<OverviewDestination, string> = {
  conversations: "/conversations",
  channels: "/integrations/channels",
  launch: "/integrations/wechat-work",
  automation: "/automation/runs",
  reviews: "/reviews/inbox",
  notifications: "/notifications",
  delivery: "/settings/delivery-readiness",
  sendQueue: "/send/queue",
  sendBlocked: "/send/blocked",
  wechatSettings: "/integrations/wechat-work/settings",
  wechatFlow: "/integrations/wechat-work/flow",
};

export function OverviewRouteFeature() {
  const router = useRouter();

  return (
    <OverviewPage
      onNavigate={(destination, context) => {
        if (destination === "conversations" && context?.conversationId) {
          router.push(`/conversations/${encodeURIComponent(context.conversationId)}`);
          return;
        }
        router.push(overviewDestinations[destination]);
      }}
    />
  );
}
