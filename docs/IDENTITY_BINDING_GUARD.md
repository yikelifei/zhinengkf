# 客户账号防串校验

本模块用于防止多微信账号、多客户、多会话同时运行时，把 A 客户的消息、设计图或报价发给 B 客户。

## 已接入的防线

- 入站消息：`wechatAccountId + conversationId` 必须匹配同一个会话，否则返回 `400 Bad Request`。
- 设计任务：`customerId + conversationId + wechatAccountId` 必须和会话归属一致，否则不允许创建设计任务。
- 报价草稿：报价必须来自同一个设计任务、同一个客户、同一个会话；选中的候选图也必须属于该设计任务。
- 发送队列：发送任务入队前再次校验微信账号、会话、设计任务、报价草稿绑定关系。
- 窗口发送：实际发送前仍保留微信账号、当前聊天对象、最近消息/客户 ID 三重校验。

## 验证结果

- 正常入站消息可以进入对应会话并路由到正确 Agent。
- `wechat_demo_2` 请求写入 `conversation_demo_1` 会被拦截：
  `inbound conversation binding invalid: 请求微信账号匹配会话`
- `wechat_demo_2` 请求创建属于 `conversation_demo_1` 的设计任务会被拦截：
  `design job identity invalid: 设计任务微信账号匹配会话`
- 发送队列错绑会被拦截：
  `send task binding invalid: 微信账号绑定会话`

## 开发要求

后续新增任何会创建消息、设计任务、报价、订单或发送任务的接口，都必须先复用 `desktop/packages/rules/identityBinding.js` 或 `desktop/packages/rules/sendGuard.js`，不要在业务代码里临时拼一套新判断。
