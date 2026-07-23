# 知识库与真人话术学习

- 模块 ID: `03_knowledge_learning`
- 分类: `knowledge`
- 状态: `partial`

## 目标

从真实微信聊天记录中提取 FAQ、客户异议和高转化真人话术，人工审核后进入知识库。

## 输入

- 微信聊天记录
- 人工客服回复
- 现有知识库

## 输出

- FAQ 候选
- 真人话术样本
- 客户异议库
- 知识库更新建议

## 独立运行

- `tools\reports\run_reply_style_miner.bat`

## 独立检查

- `tools\quality\run_answer_guard_audit.bat`
- `tools\quality\run_quality_audit.bat`

## 验收标准

- 聊天记录不能直接污染知识库。
- 新知识必须人工审核后入库。
- 能产出可复用真人话术样本。

## 下一步

- 新增聊天记录导入器。
- 新增知识候选审核界面。
