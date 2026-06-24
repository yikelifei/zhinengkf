# 子线程任务索引

这些文件用于把项目模块直接喂给新的 Codex 子线程，避免每次人工重复描述上下文。

## 使用方式

- 生成任务文件：`tools\agents\generate_agent_tasks.bat`
- 查看任务列表：`tools\agents\list_agent_tasks.bat`
- 打印单个任务：`tools\agents\show_agent_task.bat <模块ID>`

## 任务列表

| 模块 | 分类 | 状态 | 子线程提示词 |
| --- | --- | --- | --- |
| 微信主客服闭环 | `channel` | `running` | [01_wechat_core.md](01_wechat_core.md) |
| 抖音/小红书平台线索承接 | `lead_acquisition` | `partial` | [02_platform_lead_capture.md](02_platform_lead_capture.md) |
| 知识库与真人话术学习 | `knowledge` | `partial` | [03_knowledge_learning.md](03_knowledge_learning.md) |
| 智能回复与安全护栏 | `reply` | `running` | [04_smart_reply_engine.md](04_smart_reply_engine.md) |
| 高价值客户筛选 | `crm` | `running` | [05_high_value_leads.md](05_high_value_leads.md) |
| 报价准备和跟进任务 | `sales_ops` | `running` | [06_quote_and_followup.md](06_quote_and_followup.md) |
| 出图提示词和任务队列 | `image_delivery` | `partial` | [07_image_prompt_jobs.md](07_image_prompt_jobs.md) |
| 本地 API 和外部软件集成 | `integration` | `partial` | [08_open_api.md](08_open_api.md) |
| 统一工作台和运营控制台 | `console` | `partial` | [09_console_workspace.md](09_console_workspace.md) |
| 测试、验收、备份和上线 | `quality` | `running` | [10_quality_release.md](10_quality_release.md) |
