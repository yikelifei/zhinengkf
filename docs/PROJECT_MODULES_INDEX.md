# 智能客服项目模块索引

配置来源: `config/project_modules.yaml`
更新时间: `2026-06-24`

## 使用方式

- 查看全部模块: `tools\projects\list_projects.bat`
- 查看单个模块: `tools\_run_python_task.bat scripts\project_modules.py show <模块ID>`
- 独立运行模块: `tools\projects\run_project.bat <模块ID>`
- 独立检查模块: `tools\projects\check_project.bat <模块ID>`
- 运行全部可运行模块: `tools\projects\run_all_projects.bat`
- 检查全部模块: `tools\projects\check_all_projects.bat`

## 模块列表

| 模块 | 分类 | 状态 | 说明 |
| --- | --- | --- | --- |
| [微信主客服闭环](projects/01_wechat_core.md) | `channel` | `running` | 保持微信作为主要成交和客服承接阵地，稳定收消息、生成回复、发送回复、记录会话。 |
| [抖音/小红书平台线索承接](projects/02_platform_lead_capture.md) | `lead_acquisition` | `partial` | 把抖音、小红书来的客户作为获客线索记录下来，最终引导到微信成交。 |
| [知识库与真人话术学习](projects/03_knowledge_learning.md) | `knowledge` | `partial` | 从真实微信聊天记录中提取 FAQ、客户异议和高转化真人话术，人工审核后进入知识库。 |
| [智能回复与安全护栏](projects/04_smart_reply_engine.md) | `reply` | `running` | 用规则、知识库、AI 和安全护栏生成自然、可靠、可控的客服回复。 |
| [高价值客户筛选](projects/05_high_value_leads.md) | `crm` | `running` | 根据数量、预算、交期、企业采购、联系方式等信息筛出值得人工优先跟进的客户。 |
| [报价准备和跟进任务](projects/06_quote_and_followup.md) | `sales_ops` | `running` | 检查报价必填字段是否齐全，并生成今日跟进任务。 |
| [出图提示词和任务队列](projects/07_image_prompt_jobs.md) | `image_delivery` | `partial` | 从客户需求中提取出图提示词，调用出图软件生成图片，修改交给人工处理。 |
| [本地 API 和外部软件集成](projects/08_open_api.md) | `integration` | `partial` | 为 Web 控制台、出图软件和后续平台服务提供稳定 API。 |
| [统一工作台和运营控制台](projects/09_console_workspace.md) | `console` | `partial` | 把线索、会话、高价值客户、人工接管、报表和系统状态集中到一个终端。 |
| [测试、验收、备份和上线](projects/10_quality_release.md) | `quality` | `running` | 让项目可以自测、自查、备份、验收，减少人工逐个找 bug。 |

## 分类说明

- `channel`: 微信和后续平台消息通道。
- `lead_acquisition`: 抖音、小红书等平台线索承接。
- `knowledge`: 知识库、话术学习和人工审核。
- `reply`: 智能回复、人情味表达和安全护栏。
- `crm`: 高价值客户筛选和优先跟进。
- `sales_ops`: 报价、跟进、订单交接。
- `image_delivery`: 出图提示词和图片交付任务。
- `integration`: 本地 API 和外部软件集成。
- `console`: 统一工作台。
- `quality`: 自动测试、验收、备份和上线检查。
