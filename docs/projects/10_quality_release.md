# 测试、验收、备份和上线

- 模块 ID: `10_quality_release`
- 分类: `quality`
- 状态: `running`

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

## 独立运行

- `tools\quality\run_tests.bat`
- `tools\quality\run_web_console_smoke.bat`
- `tools\quality\run_launch_readiness.bat`

## 独立检查

- `tools\quality\run_tests.bat`
- `tools\quality\run_static_sanity.bat`
- `tools\quality\run_ui_contract_check.bat`
- `tools\quality\run_web_console_http_smoke.bat`
- `tools\quality\run_acceptance_scenarios.bat`
- `tools\operations\run_backup.bat`

## 验收标准

- 核心 smoke 测试通过。
- Web 控制台 smoke 通过。
- 上线检查能生成报告。

## 下一步

- 把每次关键修改后的检查固定成一键命令。
- 增加更多真实场景回归测试。
