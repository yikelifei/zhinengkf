# 实现状态

本页只记录可由当前仓库代码定位的真值。动态清单运行 `npm.cmd run project:completion:audit`，报告见 `desktop/.runtime/project-completion-audit/latest.{json,md}`；真实账号、密钥、预发布和硬件证据不会在本文伪装成已完成。

## 仓库内已实现

- Electron 桌面壳、Next.js 工作台、NestJS API 与 PostgreSQL Prisma schema。
- 设计平台客户端/回调契约、SKU 商品库、礼盒推荐、预算与高价值转人工、设计任务、选图、报价/订单和安全发送队列。设计平台 Axios 实例和每次请求拦截器均固定 `maxRedirects=0`，30x 响应显式失败，登录、激活、凭据与 POST body 不会被自动转发到其他 origin、协议或私网地址。
- `art_image_local` 每次生成使用独立 `DesignPlatformExecution` 做 durable begin/CAS/outcome/acceptance/recovery；timeout、5xx、连接重置或进程重启期间的在途请求均 fail-closed 为 `outcome_unknown`，禁止自动重生成和重复扣费。
- 企业微信加密回调、`sync_msg`、文本/图片媒体发送、身份绑定、幂等/审计；`WechatPersistence` 在 `USE_LOCAL_STORE=false` 时使用 Prisma 保存绑定、消息、任务、attempt 与审计日志。
- 设计任务与聊天训练导入的创建幂等会先按确定性操作键读取已保存记录，再使用记录中的账号/会话/客户身份校验原请求；因此会话被删除或重新绑定后，同一精确请求仍能安全重放，显式提交错误身份则失败关闭。设计任务持久化后的提醒、人工锁定与复核副作用按 `effectKey` 去重并分阶段恢复，只有全部完成后才写入 `completedAt`。训练页面在网络响应丢失时保留同一操作键，内容或身份变化才换键，成功后才清除。
- SKU 上传文件解析支持 `.xlsx`、`.csv`、`.tsv`、`.txt`，包括标准 XLSX 模板生成和模板回读测试；规范 Base64、输入字节、ZIP 目录/路径/重复条目、单项与累计解压、共享字符串、行/列/单元格和最终文本均有 fail-closed 上限。ZIP64、多磁盘和加密条目被拒绝，data descriptor、CRC、本地条目区间及声明/实际大小必须一致。XLSX 的 `sharedStrings`、`row`、`cell` 与文本片段使用只前进、不物化匹配数组的索引扫描器，第 N+1 个元素在读取标签体前立即拒绝；单标签、文本片段数、单单元格解码文本及累计解码文本均设硬上限，未闭合大标签按线性路径返回受控错误。旧文档中的“Excel 文件解析未实现”已过期。
- 候选图与企业微信客户入站图片对真实 JPG/PNG 字节生成 `dhash64:v1`：EXIF 旋转、白底、灰度 `9x8`，使用 XOR/popcount 汉明距离强阈值匹配；旧元数据 SHA-256 仅保留为 `legacyIdentityHash`，不参与自动匹配。
- 企业微信入站图片使用官方临时素材下载接口，流式限制 2 MB，并在 `LOCAL_STORAGE_ROOT` 下使用确定性路径和原子 no-clobber 发布；明确永久失败才落人工复核，网络/5xx/限流失败会中止当前同步页。
- SKU 在 Prisma 生产模式下的新增、更新、批量导入、状态、批量修改和演示图更新，会把 before/after、changedFields、source、operator、reason 审计与实际变更放入同一事务；无变化不制造日志。
- 素材在 Prisma 中保存 Windows 规范绝对路径，客户素材上传、列表和本地读取均校验微信账号/会话/客户三元身份；未知或歧义的客户目录记录失败关闭。
- Windows electron-builder/NSIS 构建、显式文件白名单、未签名测试包和包内容验证工具。
- Windows GitHub Actions 最小权限质量工作流与本地 release-quality 编排。
- PostgreSQL 恢复演练工具：默认计划模式零命令；执行模式要求独立 rehearsal/sandbox 目标和绑定库名的确认短语。
- 生产发布门禁、预发布只读证据工具、Windows 打包只读预检、交付 handoff 包和本完成度真值审计。
- 生产安装包由 Electron 主进程在内存中生成独立 `DESKTOP_WEB_SESSION_PROOF`，只传给 Web 子进程，并在专属 Electron partition 写入 `HttpOnly`、`SameSite=Strict`、`Path=/api` Cookie；Next `/api/*` catch-all 的所有方法都必须恒定时间验证该证明，证明 Cookie 和来访内部令牌不会转发给 API，设计平台 callback 永不经 Web 代理。
- `standard_v1` 远端地址只允许 `DESIGN_PLATFORM_BASE_URL` 明确配置的 origin 或 `DESIGN_PLATFORM_ALLOWED_ORIGINS` 中的精确 HTTPS origin；access token、cookie、API key 和 device id 分别绑定 origin，切换 origin 不会自动重绑旧凭据。standard_v1 回调必须使用与内部令牌、平台 API key、登录 token/cookie 独立的回调密钥，并在 readiness/preflight 前失败关闭。
- 个人微信 RPA 代码仅作为遗留兼容模块保留，产品默认不展示、不启动、不作为生产接入通道；企业微信是当前唯一对外微信通道。若未来重新启用，`PersonalWechatRpaPersistence` 必须在 `USE_LOCAL_STORE=false` 时走 Prisma 绑定与审计路径，不能回退成本机 LocalStore 作为生产通道。

## 仓库内未完成或必须继续审计

- 生产产品的可信桌面会话路径仍是 packaged Electron 内存证明链路；打包版会强制关闭 `ALLOW_LOCAL_BROWSER_WEB_API`，若 Web 与 Electron 不是由同一父环境显式提供同一个 `DESKTOP_WEB_SESSION_PROOF`，生产 Web `/api/*` 请求会返回 403。本地 stable/dev 启动默认打开仅限 `http://127.0.0.1` / `http://localhost` 的浏览器开发通道，方便普通浏览器调试，且不转发证明 Cookie、来访内部令牌或 callback 入口。

- Agent、路由、训练和会话运营只有在 Prisma 迁移、初始化工具、`PrismaOperationsService` 以及各服务的 list/update/audit 路由契约全部存在时才会通过审计；仅删除 `not implemented` 报错字符串不算完成。
- 会话运营分配、优先级、SLA 与运营审计若仍固定走 LocalStore 会记为 `FAIL`；生产实现必须同时提供 list/update/audit 的 Prisma 路由。
- 个人微信 RPA 若未来重新启用，必须另走显式产品决策、合规审查和独立验收；当前完成度审计不再把它作为上线前置能力。
- 自动化本地/interval 兼容模式可以保留 LocalStore `recentRuns`，但生产 durable 能力只有在 BullMQ/Redis scheduler/runtime、readiness、队列状态和故障证据契约全部存在时才会通过审计。
- dHash 只覆盖已验证的轻微重编码/像素变化近似匹配，不承诺任意裁剪、大幅编辑或复杂截图；同分、第二名差距不足、缺失/混合/旧算法全部转人工。
- 素材读取会先用 `realpath` 解析真实存在的 Windows 路径，覆盖大小写、斜杠、点段、扩展前缀及文件系统可解析的 8.3 别名。Windows trailing-dot/space 和禁用 8.3 的卷仍需目标机验收；迁移回填与运行时规范化不一致、无法解析或历史回填歧义的客户素材都不会被自动授权。
- 小红书、拼多多、淘宝、抖音和快手是路线图中的 `planned` 渠道。它们只有在状态继续为 planned、代码 fail-closed 且路线图明确“不能假装已接通”时才属于允许的规划占位。

## 只能由真实环境清零的 BLOCKED

- 企业代码签名、SmartScreen、目标 Windows 安装/卸载和发布渠道验收。
- 预发布 PostgreSQL 迁移、隔离数据库备份/恢复演练、Redis 权限/持久化/故障证据。
- 企业微信公开 HTTPS 回调、Token/AESKey、客服账号权限与受控真实收发。
- 真实设计平台账号、密钥、网络、回调和文件访问边界。

## 状态解释

- `PASS`：仓库内可重复核对的实现或契约存在。
- `FAIL`：仓库内实现、迁移、持久化或文档契约存在缺口；外部环境不能豁免。
- `BLOCKED`：代码未必失败，但需要真实签名、密钥、账号、预发布数据库或现场硬件证据。
