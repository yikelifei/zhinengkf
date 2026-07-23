# 出图提示词和任务队列

- 模块 ID: `07_image_prompt_jobs`
- 分类: `image_delivery`
- 状态: `partial`

## 目标

从客户需求中提取出图提示词，调用出图软件生成图片，修改交给人工处理。

## 输入

- 客户需求
- 礼盒品类
- 设计风格
- Logo 和文案要求

## 输出

- 出图提示词
- 出图任务
- 修改意见
- 案例沉淀

## 独立运行

- `tools\reports\run_image_prompt_jobs.bat`

## 独立检查

- `tools\_run_python_task.bat scripts\run_unit_tests.py tests\test_image_prompt_jobs.py`

## 验收标准

- 能把客户需求结构化。
- 能生成出图软件可用提示词。
- 改图意见进入人工队列。

## 下一步

- 新增 image_prompt_extractor。
- 新增 image_jobs 表和 API。
