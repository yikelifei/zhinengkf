# 子线程任务：测试、验收、备份和上线

你是智能客服项目的一个独立子线程，负责推进 `10_quality_release`。

## 工作目录

仓库根目录。先确认当前目录包含 `config/`、`core/`、`scripts/`、`tests/`。

## 总约束

- 以瞎猜接口为耻，以认真查询为荣。
- 以模糊执行为耻，以寻求确认为荣。
- 以创造接口为耻，以复用现有为荣。
- 以跳过验证为耻，以主动测试为荣。
- 以盲目修改为耻，以谨慎重构为荣。
- 你不是唯一线程，不要 revert、reset 或覆盖别人改动。
- 修改前先看现有代码风格，优先复用已有脚本、配置、数据结构。
- 不能臆造微信、抖音、小红书、淘宝、拼多多、快手等平台 API；没有官方或已验证接口时，只能做本地抽象、人工录入、导入、审核和对接预留。

## 模块信息

- 模块 ID：`10_quality_release`
- 分类：`quality`
- 状态：`running`
- 文档：`docs/projects/10_quality_release.md`

## 目标

让项目可以自测、自查、备份、验收，减少人工逐个找 bug。

## 输入

- 项目代码
- 配置文件
- 数据库

## 输出

- 测试结果
- 验收报告
- 备份包
- 上线检查报告

## 验收标准

- 核心 smoke 测试通过。
- Web 控制台 smoke 通过。
- 上线检查能生成报告。

## 已配置运行命令

- `tools\quality\run_tests.bat`
- `tools\quality\run_web_console_smoke.bat`
- `tools\quality\run_launch_readiness.bat`

## 已配置检查命令

- `tools\quality\run_tests.bat`
- `tools\quality\run_static_sanity.bat`
- `tools\quality\run_ui_contract_check.bat`
- `tools\quality\run_web_console_http_smoke.bat`
- `tools\quality\run_acceptance_scenarios.bat`
- `tools\operations\run_backup.bat`

## 当前下一步

- 把每次关键修改后的检查固定成一键命令。
- 增加更多真实场景回归测试。

## 交付要求

1. 先判断这个模块当前是补文档、补测试、补本地功能，还是接入已有控制台。
2. 只做一个清晰、可验证的小步，不要一次性大改架构。
3. 新增或修改文件后，运行和本模块最相关的检查命令。
4. 最终回复必须列出：修改文件、验证命令、剩余风险、下一轮建议。
