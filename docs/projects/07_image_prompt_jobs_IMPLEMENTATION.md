# 07_image_prompt_jobs 实现说明

## 范围

- 新增本地出图需求解析、提示词生成和任务队列模型。
- 新增 Markdown 报表脚本与 `tools/reports` bat 入口。
- 不接入真实出图软件，不创建或假设外部 API。

## 核心接口

- `extract_image_prompt_fields(text, lead=None)`：从客户需求中提取品类、场景、风格、颜色、文字、logo、尺寸、禁忌/注意事项、修改意见。
- `build_image_prompt(fields)`：生成可交给设计或外部出图软件手动使用的提示词文本。
- `create_image_prompt_job(source_text, lead=None, ...)`：生成本地任务对象，包含状态、来源、字段、prompt 和审计说明。
- `ImagePromptJobQueue`：内存队列，支持新增、按状态查询、状态流转和汇总。

## 报表

运行：

```bat
tools\reports\run_image_prompt_jobs.bat
```

脚本会扫描本地 `leads` 和近期客户消息，识别疑似出图需求并输出 `reports/image_prompt_jobs_*.md`。没有真实任务时，会输出空状态说明和一条未入队示例。

## 验证

核心逻辑覆盖在 `tests/test_image_prompt_jobs.py`。
