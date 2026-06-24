# Tools

项目根目录只保留高频启动入口：

- `run.bat`: 启动微信客服主程序
- `run_web_console.bat`: 启动 Web Console

其余一键脚本按用途放在这里：

- `projects/`: 按项目模块查看、运行、检查和生成模块文档
- `agents/`: 生成和查看可投喂给 Codex 子线程的模块任务
- `quality/`: 健康检查、测试、验收、质检、上线检查
- `reports/`: 运营报表、线索导出、跟进任务、交付清单、真人话术样本
- `operations/`: 备份、数据清理、操作审计

常用质量入口：

- `quality/run_tests.bat`: 运行单元测试；没有 pytest 时自动使用本地测试运行器
- `quality/run_smoke_tests.bat`: 运行核心业务冒烟测试
- `quality/run_static_sanity.bat`: 扫描 Python 死代码和不可达代码
- `quality/run_ui_contract_check.bat`: 校验 Web Console 前端 API 与后端路由一致
- `quality/run_web_console_http_smoke.bat`: 启动临时 HTTP 服务检查真实 Web 响应
- `quality/run_web_console_smoke.bat`: 检查 Web Console 关键接口
- `quality/run_launch_readiness.bat --strict`: 上线前严格缺口检查

项目模块入口：

- `projects/list_projects.bat`: 列出全部模块
- `projects/show_project.bat <模块ID>`: 查看单个模块
- `projects/run_project.bat <模块ID>`: 独立运行单个模块
- `projects/check_project.bat <模块ID>`: 独立检查单个模块
- `projects/run_all_projects.bat`: 运行全部已配置运行命令的模块
- `projects/check_all_projects.bat`: 检查全部已配置检查命令的模块
- `projects/generate_project_docs.bat`: 根据 `config/project_modules.yaml` 重新生成模块文档

子线程任务入口：

- `agents/generate_agent_tasks.bat`: 根据项目模块清单生成子线程任务
- `agents/list_agent_tasks.bat`: 列出可派工模块
- `agents/show_agent_task.bat <模块ID>`: 打印可直接喂给子线程的任务提示词

这些脚本都可以直接双击运行，也可以在命令行执行。

打包配置已归档到 `installer/specs/`：

- `smart_bot.spec`: 客服主程序打包
- `smart_bot_console.spec`: 桌面控制台打包
- `smart_bot_sfx.spec`: 自解压安装包打包

项目计划文档已归档到 `docs/PROJECT_PLAN.md`。
