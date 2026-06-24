# Tools

项目根目录只保留高频启动入口：

- `run.bat`：启动微信客服主程序
- `run_web_console.bat`：启动 Web Console

其余一键脚本按用途放在这里：

- `quality/`：健康检查、测试、验收、质检、上线检查
- `reports/`：运营报表、线索导出、跟进任务、交付清单、真人话术样本
- `operations/`：备份、数据清理、操作审计

这些脚本都可以直接双击运行，也可以在命令行执行。

打包配置已归档到 `installer/specs/`：

- `smart_bot.spec`：客服主程序打包
- `smart_bot_console.spec`：桌面控制台打包
- `smart_bot_sfx.spec`：自解压安装包打包

项目计划文档已归档到 `docs/PROJECT_PLAN.md`。
