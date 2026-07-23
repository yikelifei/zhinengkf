# 项目目录分类与边界

更新日期：2026-07-22

## 结论

这个仓库不是混入了几十个独立产品，而是叠加了三类内容：

1. 第一代 Python 智能客服系统；
2. 新版 Windows 桌面客服平台；
3. 本地运行、验证、Codex 并行工作树和历史迁移产物。

其中 `desktop/` 是 README 明确标注的“新版桌面客服平台”。仓库根目录的 Python 代码是第一代/兼容线，仍可能用于运行或数据兼容，不能在没有迁移验收的情况下直接删除。

## 一、产品源码

| 路径 | 分类 | 职责 | 当前处理原则 |
| --- | --- | --- | --- |
| `desktop/` | 新版主产品 | Windows 桌面客服平台总工程 | 新功能默认落在这里 |
| `desktop/apps/api/` | 新版后端 | NestJS 本地 API、渠道、会话、设计、订单和自动化 | 后端唯一主入口 |
| `desktop/apps/web/` | 新版前端 | Next.js 客服工作台 | 前端唯一主入口 |
| `desktop/apps/electron/` | 桌面外壳 | Electron 窗口和桌面集成 | 只放桌面壳职责 |
| `desktop/packages/rules/` | 共享规则 | 可脱离 UI/API 测试的业务规则 | 保持无运行时副作用 |
| `desktop/prisma/` | 新版数据模型 | Prisma schema 和迁移 | 新版数据库事实来源 |
| `desktop/tests/` | 新版测试 | Node/API/UI/安全契约测试 | 与新版源码同步维护 |
| `desktop/tools/` | 新版运维工具 | 启停、端口、微信桥接、RPA、诊断 | 不承载核心业务模型 |

## 二、第一代 Python/兼容线

| 路径 | 分类 | 职责 | 当前处理原则 |
| --- | --- | --- | --- |
| `core/` | Python 核心 | AI、会话、CRM、规则、微信自动化 | 仅修兼容问题或明确的旧版需求 |
| `config/` | Python 配置 | 知识库、话术、模块清单和业务配置 | 目前只覆盖 Python 产品线 |
| `scripts/` | Python 任务 | 报表、检查、备份、控制台和业务任务 | 不再新增新版桌面业务 |
| `tests/` | Python 测试 | 第一代系统回归测试 | Python 改动必须继续验证 |
| `tools/` | Python 启动工具 | 旧版批处理入口和质量/报表命令 | 后续与新版工具分开命名 |
| `installer/` | 旧版交付 | Python/PyInstaller 安装与交付文件 | 未确认替代方案前保留 |
| `assets/` | 旧版资源 | Python UI/安装资源 | 不与新版 Web public 混用 |
| `README.md`、`__main__.py`、`run.bat`、`requirements*.txt` | 旧版入口 | Python 系统说明、入口和依赖 | 明确标记为兼容线，不与新版入口混写 |

`config/project_modules.yaml` 中的 10 个模块属于第一代 Python 业务分类，不是整个仓库的完整目录分类。

## 三、文档与启动入口

| 路径 | 分类 | 说明 |
| --- | --- | --- |
| `docs/` | 仓库根/旧版文档 | 第一代规划、部署、验收和历史设计资料 |
| `desktop/docs/` | 新版文档 | 桌面平台、微信桥接、企业微信和设计说明 |
| `DESKTOP_QUICKSTART.md`、`run_desktop*.bat`、`check_desktop*.bat` | 新版快捷入口 | 从仓库根目录启动/检查 `desktop/` |
| `*migration*`、`*-stable-desktop*.cmd` | 迁移与兼容入口 | C 盘到 D 盘迁移、稳定运行快捷方式；不是独立项目 |

新文档必须放到对应产品线。跨产品线的仓库治理文档放在根 `docs/`，例如本文件。

## 四、本地数据和生成物

以下目录不是源码项目，不应作为功能开发位置：

| 路径 | 内容 | 处理原则 |
| --- | --- | --- |
| `.venv/`、`.codex_deps/`、`.codex_deps_wheels/` | Python 环境和依赖缓存 | 可重建，本地保留 |
| `desktop/node_modules/` | Node 依赖 | 可重建，不提交 |
| `build/`、`dist/`、`desktop/dist/`、`.next/` | 构建产物 | 由构建命令生成 |
| `data/`、`desktop/storage/` | 本地业务数据 | 先备份再清理 |
| `logs/`、`reports/`、`exports/`、`backups/` | 日志、报表和备份 | 设保留期限，不放源码 |
| `__pycache__/`、`.pytest_cache/`、`*.tsbuildinfo` | 编译/测试缓存 | 可安全重建 |
| `.venv_broken_*` | 已损坏环境快照 | 确认无取证需要后归档到仓库外 |

## 五、开发编排和工作树

| 路径 | 分类 | 说明 |
| --- | --- | --- |
| `.agents/`、`.claude/`、`.codex/` | 本地智能体/编辑器配置 | 开发辅助，不是产品模块 |
| `.runtime/` | Codex 批次工作树、工具链和验证运行时 | 同一仓库的并行副本，不是新项目 |
| `.runtime-d-repo/` | 稳定运行时、少量专用工作树和浏览器验证资料 | 本地运行基础设施 |
| `.tmp_github/` | 临时 GitHub 检查/副本 | 临时目录，不作为事实来源 |

截至 2026-07-22，本仓库注册了 191 个仍存在的 Git worktree，根 `.runtime/` 下有 72 个 `completion-wave*` 批次。它们是同一项目的并行工作副本，不能按“191 个项目”理解，也不能直接在资源管理器中批量删除；应通过 Git worktree 清单逐一确认、合并、归档和移除。

## 六、当前不能当垃圾清理的内容

当前工作区中，`desktop/apps/api/src/`、`desktop/apps/web/src/`、`desktop/prisma/migrations/`、`desktop/tests/`、`desktop/tools/` 和 `desktop/docs/` 下存在大量尚未跟踪的新源码。这些内容属于正在开发的新版功能，不属于运行垃圾。

清理时必须区分：

- `?? desktop/...`：可能是待纳入版本控制的新源码，逐文件审查；
- `?? .runtime/`、`?? .tmp_github/`：本地编排/临时目录，已由 `.gitignore` 隔离；
- `M desktop/...`：现有新版源码的未提交修改，必须保留；
- `data/`、`storage/`、`backups/`：可能含业务数据，先备份后处理。

## 七、后续目录规则

1. 新版业务只能进入 `desktop/apps/*`、`desktop/packages/*` 或 `desktop/prisma/`。
2. 第一代 Python 仅做兼容维护；新功能不得继续同时实现 Python 和 TypeScript 两份。
3. 运行时、截图、浏览器 profile、临时仓库和工作树统一放入被忽略的 `.runtime*`，不得进入源码目录。
4. 根目录只保留跨产品入口和仓库级文件，不再新增零散启动脚本。
5. 删除或移动第一代目录前，必须先列出仍被新版启动器、数据迁移和验收脚本引用的路径。
6. Git worktree 应设置数量上限和生命周期；任务完成后必须合并或明确废弃，不能无限增加 `completion-wave*`。

## 八、建议的治理顺序

1. **先冻结扩张**：停止继续创建新的 `completion-wave*` 和同义 worktree。
2. **再收口版本控制**：审查并提交/放弃当前 `desktop/` 的未跟踪源码。
3. **再清工作树**：生成 191 个 worktree 的分支、HEAD、脏状态和保留理由清单，然后分批移除。
4. **再定产品主线**：确认第一代 Python 是否只读冻结、仅保留数据迁移，还是仍需独立交付。
5. **最后搬目录**：只有引用扫描和回归测试通过后，才考虑把第一代系统迁入 `legacy/python/`，把根启动器集中到 `ops/`。
