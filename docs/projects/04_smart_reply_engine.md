# 智能回复与安全护栏

- 模块 ID: `04_smart_reply_engine`
- 分类: `reply`
- 状态: `running`

## 目标

用规则、知识库、AI 和安全护栏生成自然、可靠、可控的客服回复。

## 输入

- 客户消息
- 会话上下文
- 知识库
- 客户资料

## 输出

- 建议回复
- 人工接管原因
- 回复来源和意图

## 独立运行

- `tools\_run_python_task.bat scripts\run_unit_tests.py tests\test_core.py`

## 独立检查

- `tools\quality\run_answer_guard_audit.bat`
- `tools\quality\run_business_hours_audit.bat`

## 验收标准

- 回复不暴露 AI。
- 不编造价格、交期和售后承诺。
- 支持多话术随机表达。

## 下一步

- 把回复质量样本接入控制台复盘。
- 继续补充危险承诺拦截规则。
