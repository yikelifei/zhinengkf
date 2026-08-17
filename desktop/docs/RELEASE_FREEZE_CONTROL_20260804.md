# 发布冻结总控报告

生成时间：2026-08-04

## 初始化失败原因

Codex 新任务初始化失败发生在创建隔离 worktree 的“复制未跟踪文件”阶段，不是项目业务启动失败。

直接证据：

- `git status --short` 原先提示 3 个根目录临时目录 `Permission denied`。
- 失败日志为 `Path is a directory: cp returned EISDIR`。
- 这些目录名为 `zhinengkefudesktop.runtimepython-temp-codex-*`，内容是 Python 测试临时目录，例如 `test_add_lead_*`。
- 这些目录没有被 `.gitignore` 排除，因此 Codex 复制未跟踪文件时尝试复制权限异常目录并失败。

本轮处理：

- 在 `.gitignore` 增加 `*runtimepython-temp-codex*/`。
- 在 `.gitignore` 增加 `desktop/.runtime-c-qa/`。
- 未删除任何临时目录或用户改动。
- 复核 `git ls-files --others --exclude-standard --directory | Select-String 'runtimepython-temp|runtime-c-qa'` 无输出，说明这些目录不再进入未跟踪复制集合。

## 当前冻结结论

- 当前仓库不是可直接发布的干净候选工作区。
- `delivery:handoff` 重新生成结果：`status=BLOCKED`、`readiness=internal-verified-external-blocked`、`pass=1`、`blocked=10`、`fail=0`。
- `delivery:freeze-plan` 重新生成结果：`status=BLOCKED`、`branches=6`、`changes=401`、`untracked=135`。
- `release-candidate-freeze-plan` 单测通过：3 passed, 0 failed。
- `latest.json` 由 Node `JSON.parse` 验证可读；PowerShell `ConvertFrom-Json` 在当前控制台下会受中文编码显示影响，不作为 JSON 失效证据。

`BLOCKED` 的含义：本地代码门禁没有报告 `FAIL`，但发布候选仍未冻结，且正式生产发布缺少外部证据。不能把外部证据缺失包装成代码失败，也不能把它改写成 `PASS`。

## 候选改动分类

基于 `git status --short` 的可见工作区条目，当前有 397 行状态项；冻结脚本按更细粒度路径统计为 401 项。差异来自 untracked 目录展开口径，不影响结论。

| 分类 | 当前条目 | Modified | Untracked | 决策 | 冻结处理 |
| --- | ---: | ---: | ---: | --- | --- |
| web | 150 | 106 | 44 | defer | 按核心产品流、企业微信通道、个人微信隔离、设计/销售子域拆分，不进入一个总提交。 |
| api | 45 | 38 | 7 | defer | 业务 controller/service 随对应产品分支冻结；只允许 demo 边界、delivery readiness 等治理子集进基础治理分支。 |
| tests | 105 | 66 | 39 | include/defer | 与冻结分支同域的测试一起纳入；跨域测试不得用来夹带业务改动。 |
| tools | 53 | 28 | 25 | include/defer | release/handoff/gate/preflight 工具进治理或桌面运行时分支；截图评估脚本随对应 UI 分支走。 |
| docs | 16 | 11 | 5 | include | 发布治理、验收边界、外部 BLOCKED 说明可以纳入；不得写成生产已发布。 |
| prisma | 5 | 1 | 4 | defer | 单独进入 `codex/rc-database-migrations`，必须有迁移和恢复演练证据。 |
| electron | 5 | 4 | 1 | defer | 单独进入 `codex/rc-desktop-package-runtime`，正式包仍受 Windows 签名和目标机验收阻塞。 |
| packages | 9 | 7 | 2 | include/defer | 规则包只随对应验证范围纳入，禁止作为杂项一次性提交。 |
| config | 5 | 5 | 0 | include/defer | `.gitignore` 修复可进入冻结控制分支；`package.json`、配置只随对应验证范围纳入。 |
| unknown/generated | 4 | 0 | 4 | unknown/defer | `desktop/.env.stage-*.bak` 和 `desktop/training-knowledge-current*.png` 不进入发布候选，先保留，待人工确认清理或归档。 |

## 最小冻结方案

推荐先冻结一个只包含发布治理和初始化修复的控制分支：

- 分支名：`codex/rc-freeze-control-20260804`
- 基线提交：`598e605f1fd8d4b5d036b594d905370f922afffc`
- 允许路径：
  - `.gitignore`
  - `desktop/docs/RELEASE_FREEZE_CONTROL_20260804.md`
  - 已存在的发布治理文档和冻结计划报告，需逐文件确认后再纳入
  - `desktop/tools/release-candidate-freeze-plan.js`、`desktop/tools/delivery-handoff-bundle.js`、相关测试，仅在本轮确实修改并通过测试时纳入
- 明确排除：
  - `desktop/.env.stage-*.bak`
  - `desktop/.verification/`
  - `desktop/training-knowledge-current*.png`
  - `zhinengkefudesktop.runtimepython-temp-codex*/`
  - `desktop/.runtime-c-qa/`
  - 任何真实密钥、企业微信凭证、臻希 AI 账号密码、签名证书

业务候选仍按 6 个既有分支拆分：

1. `codex/rc-foundation-governance`
2. `codex/rc-core-product-flow`
3. `codex/rc-database-migrations`
4. `codex/rc-enterprise-wechat-channel`
5. `codex/compat-personal-wechat-quarantine`
6. `codex/rc-desktop-package-runtime`

## 发布准入边界

允许本地交付：

- 本地演示、内测、交付治理报告。
- `local_verified_external_blocked` 状态下的内部验收包。
- 明确标注未完成真实企业微信、臻希 AI 授权、Windows 正式签名、预发布和数据库恢复演练。

禁止生产发布：

- 不允许用个人微信作为生产客服通道。
- 不允许用 mock/local-safe 结果声明真实渠道上线。
- 不允许在缺少签名、目标机安装/卸载、SmartScreen 和 SHA-256 证据时声明正式 Windows 包可发布。
- 不允许在缺少隔离 staging、真实企业微信回调和数据库恢复演练时关闭外部 `BLOCKED`。

## 复核命令

```powershell
git -c safe.directory=E:/zhinengkefu status --short
git -c safe.directory=E:/zhinengkefu diff --stat
git -c safe.directory=E:/zhinengkefu diff --name-status
git -c safe.directory=E:/zhinengkefu ls-files --others --exclude-standard --directory
npm.cmd run delivery:handoff
npm.cmd run delivery:freeze-plan
node --test --test-concurrency=1 tests\release-candidate-freeze-plan.test.js
```

提交时只允许显式 stage 已确认路径，禁止 `git add -A`。
