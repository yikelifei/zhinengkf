# 礼盒定制智能客服系统

这是一个面向礼盒定制、企业礼品、伴手礼等私域场景的智能客服与线索转化系统。当前版本以 Windows 微信 PC 客户端自动化为入口，结合规则话术、行业知识库、AI 兜底、人工接管和线索 CRM，服务于中小商家快速落地。

## 核心能力

- 高频问题自动回复：价格、起订量、交期、定制流程、物流、案例。
- 高风险问题转人工：投诉、退款、售后、发票、付款异常、合同和法律问题。
- 人工接管队列：集中查看待人工、锁定中会话、等待时长、接管原因和最近客户消息。
- SLA 监控：统计首次响应达标率、客户待回复、待回复超时和转人工超时。
- 回复安全护栏：拦截保证当天发货、保证最低价、未核价最终报价等高风险承诺。
- 非工作时间兜底：按客户资料里的工作时间自动切换留言话术，并进入人工待处理。
- 优化待办：把知识缺口、AI 兜底、人工回复和转人工原因沉淀为可执行改进项。
- 报价准备清单：判断线索是否具备报价条件，提示缺失字段和下一句追问。
- 订单交付清单：维护合同、付款、开票、收货地址、生产和发货状态。
- 线索自动提取：公司、联系人、电话、微信号、数量、预算、日期、城市、节日。
- 可配置知识库和客服 skills。
- 本地数据库记录会话、消息、线索和审计事件。
- Web 控制台查看会话、线索、知识库、skills 和 API 设置。

## 快速开始

1. 打开并登录微信 PC 客户端。
2. 从 `.env.example` 复制 `.env`，填写 AI 接口配置。
3. 运行部署体检：

```bat
tools/quality/run_health_check.bat
```

4. 运行业务冒烟测试：

```bat
tools/quality/run_smoke_tests.bat
```

5. 运行智能客服落地场景验收：

```bat
tools/quality/run_acceptance_scenarios.bat
```

场景验收会覆盖价格、起订量、交期、定制、流程、案例、物流、风险转人工和留资提取。

6. 开发或交付前运行测试入口：

```bat
tools/quality/run_tests.bat
```

如果本机安装了 `pytest`，会跑完整测试；否则自动运行冒烟测试。

7. 启动客服主程序：

```bat
run.bat
```

8. 启动 Web 控制台：

```bat
run_web_console.bat
```

## 关键配置

- `config/settings.yaml`：微信轮询、限频、AI 供应商和模型路由。
- `config/customer_knowledge.yaml`：行业知识库。
- `config/customer_skills.yaml`：客服 skills 和转人工规则。
- `config/lead_pipeline.yaml`：线索阶段、意向分阈值和跟进规则。
- `config/customer_profile.yaml`：客户公司资料、客服名称、服务范围和报价必填字段。
- `config/templates.yaml`：固定话术模板。
- `config/prompts.yaml`：AI 系统提示词。

Web 控制台的系统设置页已经支持维护 API 接口、客户资料、线索管道和上线检查。保存客户资料或线索管道时会自动备份原 YAML 配置。
转化分析页提供交付文件中心，可查看和下载最近生成的报告、验收包、跟进任务、报价准备清单、订单交付清单、人工接管队列、SLA 监控报告、回复安全审计、非工作时间审计、优化待办和备份包。
风控质检页提供 SLA 运行监控、人工接管队列、回复安全护栏、非工作时间兜底、优化待办和操作审计，可追踪配置保存、报告生成、备份创建、人工锁定和人工发送等关键动作。

## 备份与导出

创建本地备份：

```bat
tools/operations/run_backup.bat
```

备份文件保存在 `backups/`，包含核心配置和 `data/kefu.db`。

导出线索 CSV：

```bat
tools/reports/run_export_leads.bat
```

导出文件保存在 `exports/`，可直接给销售或老板查看。

导出运营报告：

```bat
tools/reports/run_export_report.bat
```

报告文件保存在 `reports/`，包含线索总览、阶段分布、消息量和待跟进客户。

导出质检报告：

```bat
tools/quality/run_quality_audit.bat
```

质检报告保存在 `reports/`，用于发现知识缺口、AI 兜底比例和转人工情况。

导出操作审计报告：

```bat
tools/operations/run_audit_log.bat
```

审计报告保存在 `reports/`，用于交付验收、售后排查和关键操作追溯。

生成数据留存清理预览：

```bat
tools/operations/run_cleanup_retention.bat
```

清理报告保存在 `reports/`。默认只预览不删除，确认后可通过 `scripts\cleanup_retention.py --apply` 执行删除。

导出今日跟进任务：

```bat
tools/reports/run_followup_tasks.bat
```

跟进任务保存在 `reports/`，会按意向分、缺失信息和下一步动作整理客服当天该跟进的客户。

导出人工接管队列：

```bat
tools/operations/run_handoff_queue.bat
```

接管队列保存在 `reports/`，会按待人工状态、等待时长和线索意向分整理客服需要优先处理的会话。

导出 SLA 监控报告：

```bat
tools/quality/run_sla_monitor.bat
```

SLA 报告保存在 `reports/`，用于检查首次响应达标率、客户待回复、待回复超时和转人工超时。

导出回复安全护栏审计：

```bat
tools/quality/run_answer_guard_audit.bat
```

回复安全审计保存在 `reports/`，用于确认禁用承诺和高风险话术会被拦截或改写。

导出非工作时间兜底审计：

```bat
tools/quality/run_business_hours_audit.bat
```

非工作时间审计保存在 `reports/`，用于确认工作时间配置可解析、非工作时间话术已配置。

导出优化待办：

```bat
tools/reports/run_improvement_backlog.bat
```

优化待办保存在 `reports/`，用于把知识缺口、AI 兜底、人工回复和转人工原因沉淀成知识库或 Skills 优化任务。

导出报价准备清单：

```bat
tools/reports/run_quote_readiness.bat
```

报价准备清单保存在 `reports/`，用于判断哪些线索已经具备人工核价条件，哪些还缺数量、预算、日期、城市或联系方式。

导出订单交付清单：

```bat
tools/reports/run_order_handoff.bat
```

订单交付清单保存在 `reports/`，用于成交后核对合同、付款、开票、收货地址、生产和发货状态。

生成客户交付验收包：

```bat
tools/quality/run_acceptance_pack.bat
```

验收包保存在 `reports/`，包含客户资料、知识库、skills、线索管道、上线步骤和交付风险。

生成智能客服落地场景验收报告：

```bat
tools/quality/run_acceptance_scenarios.bat
```

验收报告保存在 `reports/`，用于确认常见问题自动回复、风险转人工和线索字段提取是否达标。

检查上线缺口：

```bat
tools/quality/run_launch_readiness.bat
```

检查报告保存在 `reports/`，会按阻塞项和建议项列出正式上线前需要补齐的配置。

## 开发测试

初始化客户资料：

```bat
python scripts\init_customer.py --company "某某礼盒工厂" --assistant "小礼" --owner "张三"
```

安装开发依赖：

```bat
python -m pip install -r requirements-dev.txt
```

运行测试：

```bat
tools/quality/run_tests.bat
```

## 交付文档

- [部署与验收指南](C:/Users/27808/Desktop/zhinengkefu/docs/DEPLOYMENT_GUIDE.md)
- [商业化落地路线](C:/Users/27808/Desktop/zhinengkefu/docs/COMMERCIALIZATION_ROADMAP.md)

## 验收口径

- 体检脚本 `failed` 为 0。
- 冒烟测试输出 `Smoke tests passed.`。
- 落地场景验收通过率达到 100%。
- 常见问题自动回复命中率达到 80% 以上。
- 投诉、退款、售后、发票、付款异常必须转人工。
- 待人工和人工锁定会话能进入接管队列，并能导出给客服主管复盘。
- SLA 报告中不能出现未处理的 blocker 级超时风险。
- 回复中不能出现保证当天发货、保证最低价、未核价最终报价等禁用承诺。
- 非工作时间必须发送固定兜底话术，并把客户会话标记为待人工处理。
- 质检发现的知识缺口、AI 兜底和人工回复必须能生成优化待办。
- 线索必须能判断可报价状态，并给出缺失字段追问。
- 已报价/待下单/已成交线索必须能进入订单交付清单。
- 高意向客户能进入线索列表，并带有下一步动作。
