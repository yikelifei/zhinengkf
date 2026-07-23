# 统一工作台和运营控制台

- 模块 ID: `09_console_workspace`
- 分类: `console`
- 状态: `partial`

## 目标

把线索、会话、高价值客户、人工接管、报表和系统状态集中到一个终端。

## 输入

- 数据库
- 报表
- 渠道状态
- 后台服务状态

## 输出

- 今日工作台
- 报表下载
- 人工接管队列
- 系统状态

## 独立运行

- `tools\quality\run_web_console_smoke.bat`

## 独立检查

- `node --check docs\web_console.js`
- `tools\quality\run_ui_contract_check.bat`
- `tools\quality\run_web_console_http_smoke.bat`
- `tools\quality\run_web_console_smoke.bat`

## 验收标准

- Web 控制台接口正常。
- 核心报表可以生成。
- 渠道状态可查看。

## 下一步

- 新增平台线索录入界面。
- 新增出图任务队列界面。
