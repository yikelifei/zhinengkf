import {
  executeManualReplyNow,
  generateConversationReplySuggestion,
  getConversationOperationsQueue,
  getAiProviderStatus,
  getConversationTimeline,
  getOperatorAccessStatus,
  getSendTasks,
  getWechatWorkUpgradeServiceConfig,
  getWechatConversations,
  markConversationMessagesRead,
  queueManualConversationReply,
  refreshWechatWorkCustomerProfile,
  setConversationManualLock,
  uploadAsset,
  updateConversationOperations,
  upgradeWechatWorkCustomerService,
} from "../../lib/api";

export type ConversationsFeatureApi = {
  getOperatorAccessStatus: typeof getOperatorAccessStatus;
  getWechatConversations: typeof getWechatConversations;
  getConversationOperationsQueue: typeof getConversationOperationsQueue;
  getAiProviderStatus: typeof getAiProviderStatus;
  getConversationTimeline: typeof getConversationTimeline;
  markConversationMessagesRead: typeof markConversationMessagesRead;
  queueManualConversationReply: typeof queueManualConversationReply;
  uploadAsset: typeof uploadAsset;
  executeManualReplyNow: typeof executeManualReplyNow;
  getSendTasks: typeof getSendTasks;
  setConversationManualLock: typeof setConversationManualLock;
  updateConversationOperations: typeof updateConversationOperations;
  generateConversationReplySuggestion: typeof generateConversationReplySuggestion;
  refreshWechatWorkCustomerProfile: typeof refreshWechatWorkCustomerProfile;
  getWechatWorkUpgradeServiceConfig: typeof getWechatWorkUpgradeServiceConfig;
  upgradeWechatWorkCustomerService: typeof upgradeWechatWorkCustomerService;
};

export const conversationsFeatureApi: ConversationsFeatureApi = {
  getOperatorAccessStatus,
  getWechatConversations,
  getConversationOperationsQueue,
  getAiProviderStatus,
  getConversationTimeline,
  markConversationMessagesRead,
  queueManualConversationReply,
  uploadAsset,
  executeManualReplyNow,
  getSendTasks,
  setConversationManualLock,
  updateConversationOperations,
  generateConversationReplySuggestion,
  refreshWechatWorkCustomerProfile,
  getWechatWorkUpgradeServiceConfig,
  upgradeWechatWorkCustomerService,
};
