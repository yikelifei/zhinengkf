# Prisma / PostgreSQL 生产切换

桌面 API 的 Prisma datasource 固定为 PostgreSQL。微信关键链路在 `USE_LOCAL_STORE=false` 时会把账号、客户、会话、消息、窗口快照、发送任务和发送尝试写入 PostgreSQL；Windows 窗口观察器与文件 bridge 仍是本机组件，不进入数据库事务。

## 首次部署

1. 创建独立 PostgreSQL 数据库和最小权限应用账号。
2. 设置 `DATABASE_URL`，不要把真实口令提交到 Git。
3. 执行 `npm.cmd run prisma:generate` 和 `npm.cmd run prisma:migrate:deploy`。
4. 已有 local-json 数据时，保持 `USE_LOCAL_STORE=true`，先预检再导入：

   ```powershell
   npm.cmd run prisma:wechat:import -- --source=C:\absolute\path\local-store.json --dry-run
   npm.cmd run prisma:wechat:import -- --source=C:\absolute\path\local-store.json
   ```

   导入器按外键顺序分批 upsert，可重复执行；每批事务最多 100 条。

5. 对比两个模式的数据量，将 `USE_LOCAL_STORE=false` 后重启 API。
6. 调用 `/api/health` 确认 `dataMode=prisma`，再用测试会话完成一次入站、dry-run、Windows bridge 回执闭环。

## 已有数据库的基线

如果数据库此前通过 `prisma db push` 建表但没有 `_prisma_migrations` 记录，不要重复建表。先备份并核对 schema，再按 Prisma baseline 流程把 `20260701000000_init` 标记为已应用，随后运行 `prisma:migrate:deploy`。生产库禁止运行 `prisma migrate dev`。

## 一致性、事务和回滚

- `(conversationId, externalId)` 唯一，平台重放消息返回已有记录。
- `(wechatAccountId, externalChatId)` 唯一，防止同账号重复绑定外部会话。
- 创建消息与更新 `Conversation.lastMessageAt` 在同一短事务内。
- 发送任务通过 `queued` 条件更新原子认领；任务与尝试的完成状态同事务提交。
- 外键列、队列扫描、账号串行队列和窗口快照查询均有索引。
- bridge 文件 I/O 和外部发送在事务外执行，避免持锁等待外部系统。
- 切回 `USE_LOCAL_STORE=true` 不会把 PostgreSQL 新数据自动反写 JSON；回滚前应暂停真实发送并核对切换后的增量。

## 真实外部依赖

- 可访问的 PostgreSQL 实例、有效 `DATABASE_URL`、已部署迁移和已生成 Prisma Client。
- 个人微信真实发送仍依赖 Windows bridge、窗口观察器、正确账号/会话绑定和可信回执。
