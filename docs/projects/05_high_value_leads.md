# 高价值客户筛选

- 模块 ID: `05_high_value_leads`
- 分类: `crm`
- 状态: `running`

## 目标

根据数量、预算、交期、企业采购、联系方式等信息筛出值得人工优先跟进的客户。

## 输入

- 客户线索
- 会话阶段
- 报价字段

## 输出

- 高价值客户清单
- 优先级分数
- 推荐下一步动作

## 独立运行

- `tools\reports\run_high_value_leads.bat`

## 独立检查

- `tools\_run_python_task.bat scripts\run_unit_tests.py tests\test_high_value.py`

## 验收标准

- 能输出高价值客户清单。
- 能解释筛选原因。
- 能指出缺失字段和下一步动作。

## 下一步

- 加入来源平台权重。
- 加入是否愿意加微信作为评分因子。
