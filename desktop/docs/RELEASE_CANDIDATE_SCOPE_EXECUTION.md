# 发布候选范围收口执行清单

生成时间：2026-08-06

这份文档给不想再被技术细节绕晕的人看：当前项目本地代码门禁已经没有 `FAIL`，但还不能正式生产发布。下一步不是继续堆功能，而是把 403 个混在一起的改动拆成可验证、可回退、可交付的几个候选范围。

## 当前结论

- 当前状态：`BLOCKED`
- 本地交付结论：`local_verified_external_blocked`
- 本地代码缺陷数：`0`
- 生产发布允许：`false`
- 当前候选改动：403 个状态项，其中 267 个 modified、136 个 untracked
- 冻结计划：6 个候选分支
- 高风险分支：4 个
- 兼容隔离分支：1 个

已经通过的本地证据：

- `npm.cmd run release:gate`：本地测试、API/Web 构建、Electron 语法通过，最终状态因候选未冻结和外部证据缺失保持 `BLOCKED`
- `npm.cmd run project:completion:audit`：`PASS=192 / BLOCKED=4 / FAIL=0`
- `npm.cmd run acceptance:e2e:local-safe`：`passed=14 / failed=0 / blocked=0 / skipped=2`
- `npm.cmd run delivery:handoff`：`readiness=internal-verified-external-blocked`，`fail=0`
- `npm.cmd run delivery:windows-package-preflight`：`pass=4 / blocked=5 / fail=0`

不能做的事：

- 不能直接正式发布。
- 不能把 403 个改动一次性提交成一个版本。
- 不能用本地 mock 验收冒充真实企业微信、真实臻玺 AI、真实 Windows 安装包验收。
- 不能把个人微信当生产客服通道。
- 不能用 `git add -A` 全量暂存。

## 给人的简单解释

冻结不是停止开发。冻结是把这次要交付的内容圈出来，形成一个可以验证的版本。

现在的仓库像一个大篮子，里面同时放了核心产品、企业微信、数据库、打包、个人微信兼容、测试工具和报告。如果直接发布，出问题时不知道是哪一块导致，也无法安全回退。

所以接下来只做一件事：按下面 6 个范围逐个收口。

## 外部阻塞

这些不是代码问题，但它们不完成就不能对外说“正式上线”。

| 阻塞项 | 谁负责 | 关闭条件 | 影响 |
| --- | --- | --- | --- |
| Windows 正式签名与安装验收 | 发布负责人 | 企业代码签名证书、签名报告、目标 Windows 安装/卸载、SmartScreen、SHA-256 校验 | 阻塞正式 Windows 安装包 |
| 真实预发布环境 | 部署负责人 | ICP/HTTPS 域名、隔离 PostgreSQL、Redis、真实环境变量、只读 readiness 报告 | 阻塞生产发布 |
| 真实渠道联调 | 渠道负责人 | 企业微信客服 HTTPS 回调、Token、EncodingAESKey、OpenKfid、受控收发证据；臻玺 AI 真实授权 readiness | 阻塞真实渠道上线 |
| 隔离数据库恢复演练 | 数据库负责人 | 独立 rehearsal/sandbox 数据库、备份恢复、迁移状态、一致性报告 | 阻塞生产数据库切换 |

## 执行顺序

### 1. 先收基础治理

分支：`codex/rc-foundation-governance`

目的：先把发布规则、验收口径、报告工具、demo 边界固定住。没有这一步，后面每个人都会按自己的理解说“完成了”。

范围：

- 交付报告、完成度审计、发布门禁、冻结计划
- demo 数据边界
- 产品验收矩阵
- README 和发布说明
- 基础安全边界说明

不包含：

- 真实密钥
- 企业微信真实凭证
- 臻玺 AI 账号密码
- 数据库生产迁移
- Windows 签名证书
- 业务页面大改

完成标准：

- 治理相关测试通过
- API/Web 构建通过
- 报告仍显示本地 `FAIL=0`
- 文档明确写着生产发布仍被外部证据阻塞

#### 2026-08-06 执行结果

- 已把 403 项当前改动重新扫描为：40 个基础治理直接文件、13 个需要按变更块拆分的共享文件、350 个本批延期文件。
- 基础治理测试：`pass=176 / fail=0 / skipped=1`。
- `npm.cmd run build:api`：通过。
- `npm.cmd run build:web`：通过。
- 修复了两个测试读取本机 `.env` 和设计平台运行时配置的问题；治理测试现在固定使用隔离的本地回环配置。
- 当前结论：基础治理范围已经明确并验证，但尚未完成分支隔离；`readyToIsolate=false`，原因是 13 个共享文件仍包含多个产品范围的变更。
- 13 个共享文件已经逐个写明“本批纳入”和“本批延期”的变更块；`.gitignore` 与通知 demo 保护改为直接纳入，README、锁文件、本地数据仓库、总览页和演示 SKU 数据测试整体延期。
- 精确文件清单由 `.runtime/release-candidate-freeze-plan/latest.md` 自动生成；除其中 direct/mixed 清单外的当前改动，本批全部延期。

#### 2026-08-06 第一版闭环刷新

- `npm.cmd run acceptance:e2e:local-safe`：`passed=14 / failed=0 / blocked=0 / skipped=2`。
- 企业微信专属测试：`passed=54 / failed=0`，覆盖企业微信 only API、加密入站鉴权、生产就绪模型和 390px 就绪页面。
- 第一版本地闭环已覆盖：企业微信加密回调、入站消息落库与路由、知识/Agent 回复、人工回复安全入队、身份隔离、审计契约和关键工作台布局。
- `npm.cmd run delivery:staging-readiness`：`pass=7 / blocked=5 / fail=1`；唯一 `FAIL` 是当前 `DATABASE_URL` 使用明显的默认管理员凭据且没有预发布 TLS 配置。
- 该数据库结果表示“当前本机配置不能冒充预发布环境”，不表示客服业务代码失败。真实预发布数据库、API 健康检查、企业微信、臻玺 AI 和 Redis/BullMQ 证据仍未执行。
- 当前产品结论：`local_mvp_verified / staging_not_prepared / production_not_allowed`。

### 2. 再收核心产品闭环

分支：`codex/rc-core-product-flow`

目的：把用户真正要用的主流程收好：商品、知识、会话、设计、报价、订单、发送队列。

范围：

- 工作台和会话
- 商品库和知识库
- 训练与 Agent 建议
- 臻玺 AI 设计任务和素材
- 报价、订单、付款凭证、履约审计
- 受控发送队列和发送诊断

不包含：

- 真实外部支付 mutation
- 绕过发送队列的直接发送
- 未授权臻玺 AI 正式任务提交
- 个人微信生产路径

完成标准：

- 本地产品验收 `acceptance:e2e:local-safe` 通过
- 设计、销售、发送、训练相关测试通过
- 页面不能假装外部渠道已经上线
- 付款和发货只能作为人工核验记录，不冒充银行或物流真实回调

### 3. 单独收数据库迁移

分支：`codex/rc-database-migrations`

目的：数据库风险必须单独看，不能混在 UI 或企业微信改动里。

范围：

- `prisma/schema.prisma`
- Prisma migration
- 数据库恢复演练工具和测试

不包含：

- 生产库直接执行
- 用本地离线检查替代真实 rehearsal
- 和业务 UI 一起打包提交

完成标准：

- `prisma:validate` 通过
- `prisma:generate` 通过
- 数据库恢复演练测试通过
- 上生产前必须有独立 rehearsal/sandbox 报告

### 4. 单独收企业微信生产通道

分支：`codex/rc-enterprise-wechat-channel`

目的：生产客服只能走企业微信。这里要做的是正式渠道准备，不是个人微信自动化。

范围：

- 企业微信 API client
- 企业微信 readiness
- 企业微信授权和回调
- 企业微信配置页、渠道状态页
- 受控发送队列相关联动

不包含：

- 个人微信 RPA
- OCR 控制 PC 微信窗口
- 个人微信自动发送
- 无 HTTPS 回调证据的“已上线”结论

完成标准：

- 企业微信相关测试通过
- 默认生产模式不暴露个人微信生产接口
- 真实启用前拿到公网 HTTPS、Token、EncodingAESKey、OpenKfid、Secret 和回调验收证据

### 5. 个人微信只做隔离兼容

分支：`codex/compat-personal-wechat-quarantine`

目的：保留历史兼容能力，但不能进入生产客服主路径。

范围：

- 个人微信 RPA 兼容接口
- 个人微信页面
- 个人微信运行配置
- 隔离诊断和兼容测试

不包含：

- 默认开启
- 生产客服发送
- 自动加好友、自动群发、自动营销
- 和企业微信生产通道混在一个发布分支

完成标准：

- 个人微信兼容测试通过
- 企业微信 only 模式测试通过
- 默认产品入口不把个人微信当正式渠道展示

### 6. 最后收桌面打包运行时

分支：`codex/rc-desktop-package-runtime`

目的：等核心范围清楚后，再做承载它的桌面运行时和 Windows 包。

范围：

- Electron 主进程
- packaged runtime
- 桌面会话刷新
- Windows 打包脚本
- Windows 预检和安装包验证工具

不包含：

- 签名私钥
- 未签名包冒充正式包
- 在脏工作区上直接打正式包
- 没有目标 Windows 安装/卸载证据就宣布可发布

完成标准：

- Electron/Windows 打包相关测试通过
- API/Web 构建通过
- Windows 预检没有本地 `FAIL`
- 正式发布前必须补代码签名和目标机器安装验收

## 当前最小下一步

继续完成 `codex/rc-foundation-governance` 的隔离准备，只处理报告列出的 13 个共享文件。

处理规则：

- 只保留发布门禁、完成度审计、交付汇总、冻结计划、demo 数据边界和交付状态页相关变更块。
- 企业微信、臻玺 AI、数据库、Windows 打包、个人微信兼容和业务 UI 的变更块继续留在后续范围。
- 不执行 `git add -A`，不把共享文件整文件纳入，不接触真实密钥、真实发送或生产数据库。
- 共享文件拆分清楚后，重跑本节的 176 项治理测试以及 API/Web 构建；通过后才允许进入核心产品闭环。

## 人工需要准备的资料

企业微信：

- 备案后的公网 HTTPS 域名
- CorpId
- Token
- EncodingAESKey
- OpenKfid
- Secret
- 企业微信回调验收截图或日志

臻玺 AI：

- 真实账号
- 密码
- deviceId
- 设备激活码
- 真实授权 readiness 结果

数据库：

- 独立 rehearsal/sandbox PostgreSQL
- 备份文件或备份命令输出
- `pg_restore` 或等价恢复记录
- `prisma migrate status` 输出
- 恢复后一致性报告

Windows 发布：

- 企业代码签名证书
- 签名机或 CI 签名记录
- 目标 Windows 安装截图或日志
- 卸载截图或日志
- SmartScreen 证据
- 安装包 SHA-256

业务资料：

- 真实 SKU
- 商品图片
- 可售组合
- 报价规则
- 交期规则
- 客服 SOP
- 人工复核后的真实聊天样本

## 后续工作原则

- 每次只收一个范围。
- 每次只 stage 明确路径。
- 每次都先跑对应测试，再更新报告。
- 报告显示 `BLOCKED` 时要说明阻塞证据，不改写成 `PASS`。
- 任何真实发送、真实支付、真实数据库、真实签名动作，都必须先有明确授权和外部环境。
