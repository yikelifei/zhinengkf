"use client";

import { useRouter } from "next/navigation";
import { OverviewPage, type OverviewDestination } from "../features/overview";

const overviewDestinations: Record<OverviewDestination, string> = {
  conversations: "/conversations",
  channels: "/integrations/channels",
  automation: "/automation/runs",
  reviews: "/reviews/inbox",
  notifications: "/notifications",
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
