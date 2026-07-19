# 生产发布门禁与发布清单

本清单用于在 Windows 上判断当前提交是否具备进入预发布环境的条件。门禁只验证仓库内可重复检查的内容，不读取真实密钥、不执行真实发送、不打包、不选择安装包输出目录、不上传远端，也不会自动终止占用端口的进程。

## 一键入口

在仓库根目录运行：

```bat
production-release-gate.cmd
```

也可以在 `desktop` 目录运行：

```bat
npm.cmd run release:gate
```

固定报告位置：

- `desktop/.runtime/production-release-gate/latest.md`
- `desktop/.runtime/production-release-gate/latest.json`
- 每项命令日志：`desktop/.runtime/production-release-gate/logs/`

这些文件位于已忽略的 `.runtime` 目录，不进入 Git。

本地门禁通过后，在隔离预发布环境继续运行可审计的只读证据检查：

```powershell
cd desktop
npm.cmd run staging:readiness
npm.cmd run staging:readiness -- --execute --api-base https://staging-api.your-domain.cn/api
```

第一条命令只做本地脱敏配置盘点；第二条必须显式加入 `--execute`，且只运行 `prisma migrate status` 和现有 API 的固定 `GET` 就绪接口，不部署迁移、不真实发送、不提交设计任务。报告写入 `desktop/.runtime/staging-readiness-evidence/`。完整口径见 `docs/STAGING_READINESS_EVIDENCE.md`。

数据库备份/恢复证据使用独立的安全演练入口：

```powershell
cd desktop
npm.cmd run database:recovery:plan
npm.cmd run database:recovery:execute -- --confirm "RESTORE ISOLATED REHEARSAL DATABASE: <恢复目标数据库名>"
```

默认 `plan` 不执行命令或数据库连接；`execute` 仅允许源库之外、名称明确为 rehearsal/sandbox 且不含生产标识的隔离目标。报告不记录 URL、用户名、密码或业务数据，临时备份在演练结束前删除。完整操作和审批边界见 `desktop/docs/DATABASE_RECOVERY_REHEARSAL.md`。

## 状态口径

- `PASS`：本机可重复执行的代码、构建、测试和静态安全检查通过。
- `BLOCKED`：代码检查未必失败，但缺少真实外部环境、授权、数据库证据或空闲端口；禁止发布。
- `FAIL`：仓库、构建、测试、安全或本地工具链检查失败；禁止发布。

Windows 入口退出码为：`PASS=0`、`FAIL=1`、`BLOCKED=2`。默认不接入真实密钥，因此即使所有本地检查通过，真实生产依赖仍会保留为 `BLOCKED`。在预发布环境用 `staging:readiness -- --execute` 收集可重复的只读证据，再由发布负责人完成下面无法自动化的人工证据清单。

## Windows CI 口径

`.github/workflows/windows-quality.yml` 在固定的 Windows Server 2022、Node.js 20.19.4 和 Python 3.12.10 环境中复用本门禁。流水线执行锁文件安装、Prisma 生成/校验/离线迁移 SQL、安全扫描与关键安全测试、Python/Node 全量测试以及 API/Web 构建。

CI 不注入真实密钥，也不加 `staging:readiness --execute`，因此真实数据库、企业微信、个人微信和设计平台证据可以继续为 `BLOCKED`。但端口预检、Prisma、测试、安全与构建等仓库内项目必须全部为 `PASS`；任一项目为 `FAIL`，或本应在干净 CI 主机执行的本地项目被跳过/阻塞，job 都会失败。

无论 job 成功或失败，CI 都上传以下脱敏报告，保留 14 天：

- `desktop/.runtime/production-release-gate/latest.json` 与 `latest.md`
- `desktop/.runtime/staging-readiness-evidence/latest.json` 与 `latest.md`

工作流权限仅为 `contents: read`，checkout 不保留凭据，不使用 `pull_request_target`，不部署、不发布、不真实发送，也不执行外部写入。

## 自动门禁范围

门禁必须完成以下检查：

1. Node.js `>=20.0.0`、npm `>=10.0.0`，Python `>=3.10.0`。
2. `package.json` 与 `package-lock.json` 的依赖、开发依赖和 engines 一致；`requirements-dev.txt` 复用 `requirements.txt`。
3. Prisma schema 校验、Prisma Client 生成、离线 SQL 生成，以及迁移目录/SQL 文件完整性检查。
4. 复用 `ports:preflight:mock:free` 检查 3100、3200、3700 端口冲突；发现占用只报告 `BLOCKED`，不杀进程。
5. 复用 Python 测试入口、Node 全量测试和身份绑定/发送护栏/桌面启动等关键安全测试。
6. 分别执行 API 与 Web 生产构建；端口被占用时不破坏运行中的桌面服务，Web 构建记为 `BLOCKED`。
7. 扫描 Git 候选文件中的私钥、禁止提交的密钥文件、高置信度供应商令牌和硬编码敏感赋值；报告只记录文件、行号和规则，不记录密钥值。
8. 校验 `package.json` 的 Electron main、preload、`run_desktop.bat`、Windows 门禁入口和本发布清单。
9. 校验 BullMQ durable 调度实现与文档存在；真实 Redis 连通性仍保留为 `BLOCKED`。

门禁不会运行 `electron-builder`、PyInstaller、Inno Setup、NSIS、`git push` 或任何真实发送命令。

## 预发布人工证据（必须清零 BLOCKED）

### 数据库与队列

- [ ] 已确认目标 PostgreSQL 的现有基线与仓库迁移历史一致。
- [ ] `staging:readiness -- --execute` 的 `prisma migrate status` 为 `PASS`，报告已附到变更单。
- [ ] 已在隔离的预发布数据库执行并留存 `prisma migrate deploy --schema prisma/schema.prisma` 输出。
- [ ] 已运行安全备份/恢复演练，脱敏报告为 `PASS`，SHA-256、命令版本、源/恢复库迁移状态以及最小结构一致性证据已附到变更单。
- [ ] 已配置 `LOW_VALUE_AUTOMATION_MODE=durable`，且 `LOW_VALUE_AUTOMATION_REDIS_URL` 仅由密钥管理服务注入。
- [ ] 已验证目标 Redis 的连接、ACL、持久化和故障提示；`/api/automation/status` 不包含 URL 或密码。
- [ ] BullMQ 只有一个固定 scheduler，全局并发为 1，Worker 在线；任务固定 `attempts=1`、`maxStalledCount=0`，未知投递不会自动重放。

不要在本地门禁中传入生产 `DATABASE_URL`。数据库迁移必须在受控预发布环境执行：

```bat
cd desktop
npm.cmd exec -- prisma migrate deploy --schema prisma/schema.prisma
```

### 密钥与网络

- [ ] 真实 AI、数据库、Redis、企业微信/微信和设计平台凭据由目标环境的密钥管理能力注入，未写入仓库或报告。
- [ ] 生产 API/Web 使用明确的监听地址、反向代理、HTTPS、访问控制与日志脱敏策略。
- [ ] 企业微信回调使用可达的公开 HTTPS 地址，并完成签名、Token/AESKey 和重放保护验收。
- [ ] 真实设计平台健康检查、超时、重试、回调和文件访问边界已验收。

### Windows 桌面与渠道

- [ ] 在目标 Windows 机器完成 `run_desktop.bat` 启动、API 健康检查、Web 工作台加载和 Electron 窗口打开。
- [ ] 预发布证据报告中的企业微信、个人微信桥和设计平台只读检查均为 `PASS`。
- [ ] 微信客户端版本、登录账号、窗口识别和人工接管流程已由授权操作员验收。
- [ ] 真实发送保持显式授权和审计，未通过测试代码或本地脚本绕过发送护栏。
- [ ] 端口 3100、3200、3700 的占用来源已确认，发布前无未知进程。

## 发布判定

1. 任一自动项为 `FAIL`：停止发布，修复后完整重跑。
2. 任一自动项或人工项为 `BLOCKED`：停止发布，补齐外部证据后再评审。
3. 自动项全部 `PASS` 且人工清单全部完成：可以进入独立的打包/部署流程；本门禁本身不负责打包或上传。
