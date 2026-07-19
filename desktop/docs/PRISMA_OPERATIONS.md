# Prisma 业务持久化与初始化

当 `USE_LOCAL_STORE=false` 时，下列业务直接使用 PostgreSQL/Prisma，不再回落到本地 JSON：

- Agent 与 Skill 查询；
- 路由评估、人工场景纠正、纠正样本和知识沉淀；
- 聊天导入、训练样本筛选、复核、批量复核、Skill 建议与应用；
- 会话运营队列、摘要、单会话查询、SLA/分配更新和审计。

所有上述写操作都在 Prisma transaction 内完成。会话纠正、训练复核和运营更新会同时写业务记录及审计；任一步失败会整体回滚。私有 Skill 和知识条目按 `wechatAccountId + conversationId + customerId` 绑定，缺来源样本、身份字段冲突或不完整会话绑定时会拒绝使用或写入。

## 部署顺序

```bat
cd desktop
set DATABASE_URL=postgresql://...
npm.cmd run prisma:generate
npm.cmd run prisma:migrate:deploy
npm.cmd run prisma:agents:init
npm.cmd run prisma:agents:init -- --execute --confirm INITIALIZE_PRISMA_AGENTS
```

第一次 `prisma:agents:init` 只打印计划且零写入。只有同时传入 `--execute` 和确认词才会在一个 transaction 中初始化默认 Agent/Skill。初始化逐字段比较：完全一致时返回 `UNCHANGED`、零更新、零审计；发生创建或实际字段变化时才写一条 `ReviewLog`。数据库已有相同 key 但不同 id 的 Agent 时会复用数据库真实 id，不会用种子 id 破坏 Skill 外键。

初始化不会读取 `.runtime/local-store.json`，也不会由 GET 接口隐式触发。生产发布可通过 `PRISMA_AGENT_INIT_OPERATOR` 写入执行人标识；不要把数据库口令写入命令参数或报告。

## 会话运营查询上限

运营队列每次最多检查最近 500 个会话。API 返回 `truncated`、`scopeLimit`、`totalIsCapped`，摘要返回 `partial`，因此超过上限时不会把样本数量伪装成全库总数。单会话查询始终按 id 直接查询，不受最近 500 条限制。消息预览和首响证据使用 PostgreSQL `DISTINCT ON` 的有界结果，不加载完整历史时间线。

## 验证

```bat
cd desktop
node --test tests\prisma-operations.test.js
npm.cmd exec tsc -- --noEmit -p apps/api/tsconfig.json
set DATABASE_URL=postgresql://user:password@127.0.0.1:5432/validation
npm.cmd run prisma:validate
npm.cmd run prisma:migrate:check
```

专项测试使用 fake Prisma，不连接或修改真实数据库。真实 migration deploy、初始化执行和备份恢复演练应只在明确授权的 staging/production 环境进行。
