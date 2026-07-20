# 项目完成度真值审计

`project:completion:audit` 用仓库内的代码和配置证据生成可重复的完成度清单。它不等同于生产发布门禁：完成度审计负责找出“已经实现、仍是占位、生产仍固定走 LocalStore、只能由外部环境验收”的真值；发布门禁负责执行测试和构建。

## 运行

```powershell
cd desktop
npm.cmd run project:completion:audit
```

固定输出：

- `desktop/.runtime/project-completion-audit/latest.json`
- `desktop/.runtime/project-completion-audit/latest.md`

`.runtime` 已被仓库根 `.gitignore` 忽略。工具不会调用子进程或网络，不连接数据库，不读取 `.env`，不执行真实发送，只在上述目录写报告。报告只记录仓库相对路径、状态和脱敏契约结果。

## 状态与退出码

- `PASS=0`：仓库内检查项存在且契约一致；仅在测试 fixture 或明确排除外部证据时，总体状态才可能为 `PASS`。
- `BLOCKED=2`：需要真实签名证书、账号、密钥、预发布数据库、公开 HTTPS 或 Windows/微信现场证据。
- `FAIL=1`：仓库内脚本、迁移、生产持久化或实现契约存在缺口。

`FAIL` 的优先级高于 `BLOCKED`。真实环境缺失不能掩盖内部代码缺口。

审计 schema `smart_kefu_project_completion_audit_v3` 还固定检查两组输入边界：设计平台请求必须在 Axios 实例和请求拦截器两层保持零重定向并显式拒绝 30x；SKU 文件导入必须保留规范 Base64、输入字节、ZIP/解压和工作表资源上限。对应安全测试文件也属于必需制品，删除实现标记或测试会产生仓库内 `FAIL`。

## 固定 LocalStore 清单

审计器维护显式清单，不只搜索 `not implemented`：

- 会话运营字段与审计固定走 LocalStore 时为 `FAIL`。
- 个人微信 RPA 的账号绑定与业务审计当前通过持久化适配器在生产模式写入 Prisma；若重新固定走 LocalStore，或迁移、模型、事务适配器发生漂移，则为 `FAIL`。
- RPA endpoint/token 注册表与 Windows 登录会话、主机进程绑定，允许作为主机本地配置；该白名单不覆盖业务绑定或审计。
- 自动化 interval/本地兼容模式可以保留 LocalStore `recentRuns`，但生产 durable readiness、队列状态和故障证据必须来自 BullMQ/Redis runtime；缺少该生产契约时仍为 `FAIL`。

规划中的小红书、拼多多、淘宝、抖音和快手 Adapter 只有在 `SUPPORTED_CHANNELS` 保持 `planned`、代码继续 fail-closed 且路线图明确“不能假装已接通”时，才进入精确白名单。

## 图片指纹口径

当前候选图与企业微信入站 JPG/PNG 会基于解码后的真实像素生成 `dhash64:v1`：处理 EXIF 旋转、白底、灰度 `9x8`，再以 XOR/popcount 汉明距离和最优/次优差距做失败关闭匹配。历史元数据 SHA-256 仅作为 `legacyIdentityHash` 保留，不参与自动相似匹配。该契约只覆盖已验证的轻微重编码和像素变化，不承诺任意裁剪、大幅编辑或复杂截图。
