# 实现状态

本页只记录可由当前仓库代码定位的真值。动态清单运行 `npm.cmd run project:completion:audit`，报告见 `desktop/.runtime/project-completion-audit/latest.{json,md}`；真实账号、密钥、预发布和硬件证据不会在本文伪装成已完成。

## 仓库内已实现

- Electron 桌面壳、Next.js 工作台、NestJS API 与 PostgreSQL Prisma schema。
- 设计平台客户端/回调契约、SKU 商品库、礼盒推荐、预算与高价值转人工、设计任务、选图、报价/订单和安全发送队列。
- 企业微信加密回调、`sync_msg`、文本/图片媒体发送、身份绑定、幂等/审计；`WechatPersistence` 在 `USE_LOCAL_STORE=false` 时使用 Prisma 保存绑定、消息、任务、attempt 与审计日志。
- SKU 上传文件解析支持 `.xlsx`、`.csv`、`.tsv`、`.txt`，包括标准 XLSX 模板生成和模板回读测试。旧文档中的“Excel 文件解析未实现”已过期。
- 候选图与企业微信客户入站图片对真实 JPG/PNG 字节生成 `dhash64:v1`：EXIF 旋转、白底、灰度 `9x8`，使用 XOR/popcount 汉明距离强阈值匹配；旧元数据 SHA-256 仅保留为 `legacyIdentityHash`，不参与自动匹配。
- 企业微信入站图片使用官方临时素材下载接口，流式限制 2 MB，并在 `LOCAL_STORAGE_ROOT` 下使用确定性路径和原子 no-clobber 发布；明确永久失败才落人工复核，网络/5xx/限流失败会中止当前同步页。
- SKU 在 Prisma 生产模式下的新增、更新、批量导入、状态、批量修改和演示图更新，会把 before/after、changedFields、source、operator、reason 审计与实际变更放入同一事务；无变化不制造日志。
- 素材在 Prisma 中保存 Windows 规范绝对路径，客户素材上传、列表和本地读取均校验微信账号/会话/客户三元身份；未知或歧义的客户目录记录失败关闭。
- Windows electron-builder/NSIS 构建、显式文件白名单、未签名测试包和包内容验证工具。
- Windows GitHub Actions 最小权限质量工作流与本地 release-quality 编排。
- PostgreSQL 恢复演练工具：默认计划模式零命令；执行模式要求独立 rehearsal/sandbox 目标和绑定库名的确认短语。
- 生产发布门禁、预发布只读证据工具和本完成度真值审计。

## 仓库内未完成或必须继续审计

- Agent、路由、训练和会话运营只有在 Prisma 迁移、初始化工具、`PrismaOperationsService` 以及各服务的 list/update/audit 路由契约全部存在时才会通过审计；仅删除 `not implemented` 报错字符串不算完成。
- 会话运营分配、优先级、SLA 与运营审计若仍固定走 LocalStore 会记为 `FAIL`；生产实现必须同时提供 list/update/audit 的 Prisma 路由。
- 个人微信 RPA 账号绑定与业务审计固定走 LocalStore，属于生产持久化缺口。RPA endpoint/token 注册表与 Windows 主机/登录会话绑定，属于有明确理由的本机配置白名单，不覆盖前述业务记录。
- 自动化本地/interval 兼容模式可以保留 LocalStore `recentRuns`，但生产 durable 能力只有在 BullMQ/Redis scheduler/runtime、readiness、队列状态和故障证据契约全部存在时才会通过审计。
- dHash 只覆盖已验证的轻微重编码/像素变化近似匹配，不承诺任意裁剪、大幅编辑或复杂截图；同分、第二名差距不足、缺失/混合/旧算法全部转人工。
- 素材读取会先用 `realpath` 解析真实存在的 Windows 路径，覆盖大小写、斜杠、点段、扩展前缀及文件系统可解析的 8.3 别名。Windows trailing-dot/space 和禁用 8.3 的卷仍需目标机验收；迁移回填与运行时规范化不一致、无法解析或历史回填歧义的客户素材都不会被自动授权。
- 小红书、拼多多、淘宝、抖音和快手是路线图中的 `planned` 渠道。它们只有在状态继续为 planned、代码 fail-closed 且路线图明确“不能假装已接通”时才属于允许的规划占位。

## 只能由真实环境清零的 BLOCKED

- 企业代码签名、SmartScreen、目标 Windows 安装/卸载和发布渠道验收。
- 预发布 PostgreSQL 迁移、隔离数据库备份/恢复演练、Redis 权限/持久化/故障证据。
- 企业微信公开 HTTPS 回调、Token/AESKey、客服账号权限与受控真实收发。
- 真实设计平台账号、密钥、网络、回调和文件访问边界。
- 个人微信目标版本、登录账号、Windows 会话、UI Automation 元素和人工接管验收。

## 状态解释

- `PASS`：仓库内可重复核对的实现或契约存在。
- `FAIL`：仓库内实现、迁移、持久化或文档契约存在缺口；外部环境不能豁免。
- `BLOCKED`：代码未必失败，但需要真实签名、密钥、账号、预发布数据库或现场硬件证据。
