# 报价准备和跟进任务

- 模块 ID: `06_quote_and_followup`
- 分类: `sales_ops`
- 状态: `running`

## 目标

检查报价必填字段是否齐全，并生成今日跟进任务。

## 输入

- 客户线索
- 报价必填字段
- 最近对话时间

## 输出

- 报价准备清单
- 跟进任务
- 订单交接清单

## 独立运行

- `tools\reports\run_quote_readiness.bat`
- `tools\reports\run_followup_tasks.bat`
- `tools\reports\run_order_handoff.bat`

## 独立检查

- `tools\quality\run_sla_monitor.bat`
- `tools\operations\run_handoff_queue.bat`

## 验收标准

- 能告诉人工还缺哪些字段。
- 能生成今日应跟进客户。
- 能区分报价准备和订单交接。

## 下一步

- 把报价字段补齐动作接入控制台。
- 增加报价单生成接口。
