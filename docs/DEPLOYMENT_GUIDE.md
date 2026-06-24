# 智能客服部署与验收指南

## 部署前准备

- Windows 电脑一台，保持微信 PC 客户端已登录。
- 项目完整目录，至少包含 `config/`、`core/`、`scripts/`、`data/`、`run.bat`。
- 可用 Python 环境或已打包好的 `dist/smart_bot/smart_bot.exe`。
- AI 接口配置写入 `.env`，可从 `.env.example` 复制。

## 首次配置

1. 复制 `.env.example` 为 `.env`。
2. 填写至少一个可用 AI 接口，例如 GeekNow、OpenAI、DeepSeek 或智谱。
3. 检查 `config/settings.yaml` 中 `ai_engine.primary` 是否对应已启用供应商。
4. 根据客户业务修改：
   - `config/customer_profile.yaml`
   - `config/customer_knowledge.yaml`
   - `config/customer_skills.yaml`
   - `config/lead_pipeline.yaml`
   - `config/templates.yaml`

## 部署体检

新客户首次部署时可以先生成客户资料：

```bat
python scripts\init_customer.py --company "客户公司名称" --assistant "小礼" --owner "默认负责人"
```

运行：

```bat
tools/quality/run_health_check.bat
```

必须满足：

- `failed` 为 0。
- 知识库、skills、agent 路由、线索提取均为 OK。
- AI provider warning 可以在未配置真实 Key 时出现；正式上线前应清零。

## 业务冒烟测试

运行：

```bat
tools/quality/run_smoke_tests.bat
```

必须输出：

```text
Smoke tests passed.
```

该测试不连接微信、不调用外部 AI，只验证核心客服逻辑。

## 落地场景验收

运行：

```bat
tools/quality/run_acceptance_scenarios.bat
```

必须满足：

- 标准场景通过率达到 100%。
- 价格、起订量、交期、定制、流程、案例、物流能自动回复。
- 发票、退款、投诉、售后等高风险问题能转人工。
- 留资消息能提取公司、联系人、电话、数量、预算、使用日期和城市。

## 测试入口

开发机或交付前可运行：

```bat
tools/quality/run_tests.bat
```

如果已安装 `pytest`，该入口会运行完整测试；如果未安装，则运行不依赖第三方测试框架的冒烟测试。

## 启动系统

确保微信 PC 客户端已打开并登录，然后运行：

```bat
run.bat
```

## 备份与线索导出

上线前、升级前、迁移前先运行：

```bat
tools/operations/run_backup.bat
```

备份文件会写入 `backups/`，包含核心配置和本地数据库。

需要给销售或老板查看线索时运行：

```bat
tools/reports/run_export_leads.bat
```

CSV 文件会写入 `exports/`，使用 UTF-8 BOM 编码，Excel 可直接打开。

需要生成运营复盘报告时运行：

```bat
tools/reports/run_export_report.bat
```

报告会写入 `reports/`，包括线索总览、阶段分布、最近消息量和待跟进客户。

需要检查知识库缺口和自动回复质量时运行：

```bat
tools/quality/run_quality_audit.bat
```

质检报告会写入 `reports/`，包括 AI 兜底比例、转人工比例、回复来源和知识缺口样本。

需要导出操作审计时运行：

```bat
tools/operations/run_audit_log.bat
```

审计报告会写入 `reports/`，包括事件类型分布和最近操作记录。

需要检查过期日志、报告、导出文件和备份时运行：

```bat
tools/operations/run_cleanup_retention.bat
```

该命令默认只生成清理预览报告，不删除文件。确认无误后再执行：

```bat
python scripts\cleanup_retention.py --apply
```

客服每天开始工作前可运行：

```bat
tools/reports/run_followup_tasks.bat
```

任务清单会写入 `reports/`，按高意向、缺联系方式、缺预算、缺数量、缺使用日期等原因提示跟进动作。

需要核对人工接管时运行：

```bat
tools/operations/run_handoff_queue.bat
```

人工接管队列会写入 `reports/`，按优先级、等待时长、接管原因、线索阶段和最近客户消息提示客服优先处理顺序。

需要检查响应 SLA 时运行：

```bat
tools/quality/run_sla_monitor.bat
```

SLA 监控报告会写入 `reports/`，用于核对首次响应达标率、客户待回复、待回复超时和转人工超时。

需要核对回复安全护栏时运行：

```bat
tools/quality/run_answer_guard_audit.bat
```

回复安全护栏审计会写入 `reports/`，用于确认禁用承诺、未核价报价、未确认排期交期等风险话术会被拦截或改写。

需要核对非工作时间兜底时运行：

```bat
tools/quality/run_business_hours_audit.bat
```

非工作时间兜底审计会写入 `reports/`，用于确认工作时间可解析、非工作时间回复已配置。

需要沉淀话术和知识缺口时运行：

```bat
tools/reports/run_improvement_backlog.bat
```

优化待办会写入 `reports/`，用于把知识缺口、AI 兜底、人工回复和转人工原因转成知识库或 Skills 优化任务。

需要核对报价准备度时运行：

```bat
tools/reports/run_quote_readiness.bat
```

报价准备清单会写入 `reports/`，用于判断线索是否已经具备人工核价条件，并提示缺失字段和下一句追问。

需要核对成交后交付信息时运行：

```bat
tools/reports/run_order_handoff.bat
```

订单交付清单会写入 `reports/`，用于核对合同、付款、开票、收货地址、生产和发货状态。

客户交付验收时可运行：

```bat
tools/quality/run_acceptance_pack.bat
```

验收包会写入 `reports/`，用于给客户确认配置范围、验收步骤和上线风险。

智能客服落地验收时可运行：

```bat
tools/quality/run_acceptance_scenarios.bat
```

场景验收报告会写入 `reports/`，用于确认自动回复、转人工和留资提取是否满足上线标准。

正式上线前建议运行：

```bat
tools/quality/run_launch_readiness.bat
```

上线缺口报告会写入 `reports/`，用于区分必须处理的阻塞项和可迭代优化的建议项。

启动脚本会优先使用：

1. `dist/smart_bot/smart_bot.exe`
2. `.venv/Scripts/python.exe`
3. 系统 Python

## Web 控制台

运行：

```bat
run_web_console.bat
```

控制台用于查看会话、线索、知识库、skills 和 API 设置。

系统设置页可直接维护：

- API 接口和默认模型。
- 客户资料、客服名称、服务范围、负责人和热线。
- 线索阶段、意向分阈值、停滞提醒天数和报价必填字段。
- 上线缺口检查、交付验收报告和落地场景验收报告。

转化分析页包含交付文件中心，可用于：

- 生成并下载上线缺口、验收包、落地场景验收、运营报告、质检报告、报价准备清单、订单交付清单、人工接管队列、SLA 监控报告、回复安全审计、非工作时间审计、优化待办和审计报告。
- 查看最近报告文件。
- 创建并下载部署备份包。
- 生成数据留存清理预览报告。

风控质检页包含 SLA 运行监控、人工接管队列、回复安全护栏、非工作时间兜底、优化待办和操作审计，可用于售后排查和交付追溯：

- 首次响应达标率、客户待回复、待回复超时和人工接管超时。
- 待人工、人工锁定、等待时长、接管原因和最近客户消息。
- 禁用承诺、样本拦截状态和安全改写结果。
- 工作时间解析结果、当前值班状态和非工作时间兜底话术。
- 知识缺口、AI 兜底、人工回复和转人工复盘形成的 P0/P1/P2 优化项。
- 报价准备率、缺失字段和建议追问。
- 合同、付款、开票、收货地址、生产和发货状态。
- 配置保存记录。
- 知识库和 skills 变更记录。
- 报告生成和备份创建记录。
- 人工锁定、解除锁定和人工发送记录。

## 商业验收标准

- 落地场景验收通过率达到 100%。
- 常见问题自动回复命中率达到 80% 以上。
- 投诉、退款、售后、发票、付款异常必须转人工。
- 待人工和人工锁定会话必须进入人工接管队列，并能导出报表。
- SLA 监控不能存在 blocker 级超时风险。
- 回复安全护栏必须拦截保证当天发货、保证最低价、未核价最终报价等禁用承诺。
- 非工作时间必须只发送兜底留言话术，并进入人工待处理队列。
- 质检样本必须能生成优化待办，便于持续补知识库和 Skills。
- 报价准备清单必须能区分可报价线索和待补充线索。
- 订单交付清单必须能区分可交付订单和待补充订单。
- 不出现重复刷屏或连续多条无意义回复。
- 能提取手机号、公司、联系人、数量、预算、日期、城市。
- 能在 CRM 或线索列表看到高意向客户。
- 断线、AI 配置缺失、微信未启动时有明确提示。

## 常见问题

### 微信未启动

`run.bat` 会提示先打开并登录微信。处理方式：登录微信 PC 客户端后重新运行。

### AI 接口未配置

`tools/quality/run_health_check.bat` 会显示 API Key 或环境变量未生效。处理方式：检查 `.env` 和 `config/settings.yaml`。

### 知识库不命中

检查 `config/customer_knowledge.yaml` 中是否有对应关键词。关键词建议包含客户真实口语，例如“多少钱”“起做多少”“来得及吗”。

### 客户问题不该自动回复

把对应关键词加入 `config/customer_skills.yaml`，并设置：

```yaml
route: transfer_human
```

### 客户需要人工接管

在控制台对该会话加人工锁定，或在话术里触发转人工关键词。人工锁定期间系统不应自动回复该客户，风控质检页和 `tools/operations/run_handoff_queue.bat` 会把该会话纳入人工接管队列。
