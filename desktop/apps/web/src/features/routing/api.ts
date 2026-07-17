import {
  evaluateRoute,
  getOperatorAccessStatus,
  getWechatConversations,
  processInboundMessage,
} from "../../lib/api";

export type RoutingFeatureApi = {
  getOperatorAccessStatus: typeof getOperatorAccessStatus;
  getWechatConversations: typeof getWechatConversations;
  evaluateRoute: typeof evaluateRoute;
  processInboundMessage: typeof processInboundMessage;
};

export const routingFeatureApi: RoutingFeatureApi = {
  getOperatorAccessStatus,
  getWechatConversations,
  evaluateRoute,
  processInboundMessage,
};
