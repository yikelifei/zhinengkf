import {
  evaluateRoute,
  getConversationOperationsQueue,
  getConversationTimeline,
  getOperatorAccessStatus,
  getWechatConversations,
  markConversationMessagesRead,
  queueManualConversationReply,
  setConversationManualLock,
  updateConversationOperations,
} from "../../lib/api";

export type ConversationsFeatureApi = {
  getOperatorAccessStatus: typeof getOperatorAccessStatus;
  getWechatConversations: typeof getWechatConversations;
  getConversationOperationsQueue: typeof getConversationOperationsQueue;
  getConversationTimeline: typeof getConversationTimeline;
  markConversationMessagesRead: typeof markConversationMessagesRead;
  queueManualConversationReply: typeof queueManualConversationReply;
  setConversationManualLock: typeof setConversationManualLock;
  updateConversationOperations: typeof updateConversationOperations;
  evaluateRoute: typeof evaluateRoute;
};

export const conversationsFeatureApi: ConversationsFeatureApi = {
  getOperatorAccessStatus,
  getWechatConversations,
  getConversationOperationsQueue,
  getConversationTimeline,
  markConversationMessagesRead,
  queueManualConversationReply,
  setConversationManualLock,
  updateConversationOperations,
  evaluateRoute,
};
