# 微信主客服闭环

- 模块 ID: `01_wechat_core`
- 分类: `channel`
- 状态: `running`

## 目标

保持微信作为主要成交和客服承接阵地，稳定收消息、生成回复、发送回复、记录会话。

## 输入

- 微信 PC 客户端消息
- config/settings.yaml
- config/customer_knowledge.yaml

## 输出

- data/kefu.db
- logs/bot.log
- 客户会话和线索记录

## 独立运行

- `tools\quality\run_smoke_tests.bat`

## 独立检查

- `tools\quality\run_tests.bat`
- `tools\_run_python_task.bat scripts\run_unit_tests.py tests\test_core.py`

## 验收标准

- 常见问题能自动回复。
- 投诉、退款、复杂报价能转人工。
- 不重复刷屏，不乱承诺价格和交期。

## 下一步

- 继续修复真实微信运行中的边界问题。
- 保持每次修改后运行 smoke 检查。
