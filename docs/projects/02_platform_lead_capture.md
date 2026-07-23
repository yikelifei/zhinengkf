# 抖音/小红书平台线索承接

- 模块 ID: `02_platform_lead_capture`
- 分类: `lead_acquisition`
- 状态: `partial`

## 目标

把抖音、小红书来的客户作为获客线索记录下来，最终引导到微信成交。

## 输入

- 平台来源
- 客户昵称
- 来源笔记/视频/评论
- 客户需求

## 输出

- 平台线索池
- 微信来源绑定
- 来源转化报表

## 独立运行

- `tools\reports\run_platform_leads.bat`

## 独立检查

- `tools\_run_python_task.bat scripts\run_unit_tests.py tests\test_platform_leads.py`

## 验收标准

- 可以手动录入抖音/小红书线索。
- 客户加微信后能绑定来源。
- 能统计不同平台带来的高价值客户。

## 下一步

- 新增平台线索数据结构。
- 新增 Web 控制台录入和筛选界面。
