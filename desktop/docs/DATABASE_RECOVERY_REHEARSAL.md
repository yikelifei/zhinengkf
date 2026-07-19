# PostgreSQL 备份与恢复演练

本流程用于为预发布评审生成可重复、脱敏的 PostgreSQL 备份/恢复证据。工具默认只做离线计划检查；只有显式加入 `--execute` 和绑定目标库名的确认短语时才会连接数据库。

## 安全边界

- 源库与恢复目标必须是不同的 `host:port/database` 身份。
- 恢复目标库名必须包含 `rehearsal`、`restore-drill`、`recovery-drill` 或 `sandbox`，主机和库名均不得包含 `prod`、`production`、`live`。
- localhost 上的 `postgres/admin/root` 默认管理员弱口令会直接记为 `FAIL`。
- 非本机连接必须显式使用 `sslmode=require`、`verify-ca` 或 `verify-full`。
- 执行确认短语为 `RESTORE ISOLATED REHEARSAL DATABASE: <恢复目标数据库名>`；库名必须完全匹配。
- `pg_dump`、`pg_restore` 和 `psql` 必须已经安装。Prisma 只调用仓库锁定的 `node_modules/prisma/build/index.js`，不使用在线下载或全局临时版本。
- 连接 URL、用户名、密码和业务数据内容不会进入 JSON/Markdown 报告。连接信息只通过子进程环境传递，不出现在命令参数中。
- 自定义格式备份只作为当前演练的临时文件；完成哈希和恢复后立即删除，不作为报告附件保留。

## 离线计划

在 `desktop` 目录配置两项环境变量后运行：

```powershell
$env:DATABASE_RECOVERY_SOURCE_URL = "postgresql://app-user:secret@staging-db.internal:5432/smart_kefu_staging?sslmode=verify-full"
$env:DATABASE_RECOVERY_REHEARSAL_URL = "postgresql://recovery-user:secret@recovery-db.internal:5432/smart_kefu_rehearsal?sslmode=verify-full"
npm.cmd run database:recovery:plan
```

计划模式不会启动任何外部命令，也不会连接数据库。凭据或工具缺失记为 `BLOCKED`；明显不安全的 URL、相同源/目标或生产目标标识记为 `FAIL`。

## 受控执行

执行前必须由数据库负责人创建一个可清空的专用演练数据库，并复核该目标不承载生产、预发布或共享测试数据：

```powershell
npm.cmd run database:recovery:execute -- --confirm "RESTORE ISOLATED REHEARSAL DATABASE: smart_kefu_rehearsal"
```

固定执行顺序：

1. 记录 `pg_dump`、`pg_restore`、`psql` 和仓库 Prisma 的版本。
2. 使用 `pg_dump --format=custom --no-owner --no-privileges` 创建临时备份并计算 SHA-256。
3. 仅对确认过的隔离演练库运行 `pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error`。
4. 分别对源库和恢复库运行仓库锁定 Prisma 的 `migrate status`。
5. 分别读取公共表数量与已完成 Prisma 迁移数量，比较最小结构一致性；不读取或记录业务行内容。
6. 删除临时备份并写出脱敏证据报告。

报告位置：

- `desktop/.runtime/database-recovery-rehearsal/latest.json`
- `desktop/.runtime/database-recovery-rehearsal/latest.md`
- 单次报告：`desktop/.runtime/database-recovery-rehearsal/<run-id>/`

状态口径：工具、凭据或外部数据库不可用为 `BLOCKED`；任何已经启动的命令返回失败、迁移状态失败或最小一致性不匹配为 `FAIL`；全部证据完成才是 `PASS`。

## 评审与清理

- 将 JSON 和中文 Markdown 附到变更单，核对 SHA-256、命令版本、迁移状态以及表/迁移数量一致性。
- 报告不等于生产恢复授权，也不能代替备份保留策略、RPO/RTO 验收或数据库负责人审批。
- 完成后清除当前 PowerShell 会话中的两个 URL 环境变量；不要复制 URL 到聊天、日志或 Git。
