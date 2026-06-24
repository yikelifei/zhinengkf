#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate a customer acceptance pack for commercial delivery."""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / ".codex_deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.customer_profile import load_profile, validate_profile  # noqa: E402
from core.knowledge_config import load_knowledge  # noqa: E402
from core.lead_pipeline import load_pipeline, validate_pipeline  # noqa: E402
from core.skill_config import load_skills  # noqa: E402


def _status(ok: bool) -> str:
    return "通过" if ok else "需处理"


def _join(values) -> str:
    items = [str(item).strip() for item in values or [] if str(item).strip()]
    return "、".join(items) if items else "-"


def build_acceptance_pack() -> str:
    profile = load_profile()
    business = profile.get("business") or {}
    sales = profile.get("sales") or {}
    profile_issues = validate_profile(profile)
    knowledge = load_knowledge()
    skills = load_skills().get("skills", [])
    pipeline = load_pipeline()
    pipeline_issues = validate_pipeline(pipeline)

    enabled_skills = [skill for skill in skills if skill.get("enabled", True)]
    documents = knowledge.get("documents", [])
    stages = pipeline.get("stages", [])
    followup_rules = pipeline.get("followup_rules") or pipeline.get("rules") or {}
    has_followup_rules = bool(followup_rules)

    lines = [
        "# 智能客服商业交付验收包",
        "",
        f"- 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 客户公司：{business.get('company_name', '-')}",
        f"- 客服名称：{business.get('assistant_name', '-')}",
        f"- 默认负责人：{sales.get('default_owner') or '-'}",
        f"- 主营业务：{_join(business.get('service_scope'))}",
        "",
        "## 交付配置总览",
        "",
        "| 模块 | 当前状态 | 验收口径 |",
        "| --- | --- | --- |",
        f"| 客户资料 | {_status(not profile_issues)} | 公司名、客服名称、负责人必须配置 |",
        f"| 行业知识库 | {_status(len(documents) >= 6)} | 至少 6 条高频业务知识 |",
        f"| 客服技能 | {_status(len(enabled_skills) >= 6)} | 至少 6 个已启用技能 |",
        f"| 线索管道 | {_status(not pipeline_issues and len(stages) >= 6)} | 覆盖咨询到成交/流失阶段 |",
        f"| 跟进规则 | {_status(has_followup_rules)} | 能识别高意向和缺字段客户 |",
        "",
        "## 知识库清单",
        "",
    ]

    if documents:
        lines.append("| ID | 标题 | 关键词 | 路由 |")
        lines.append("| --- | --- | --- | --- |")
        for doc in documents:
            lines.append(
                f"| {doc.get('id', '-')} | {doc.get('title', '-')} | "
                f"{_join(doc.get('keywords'))} | {doc.get('route', 'direct_reply')} |"
            )
    else:
        lines.append("- 暂无知识库条目")

    lines.extend(["", "## 已启用客服技能", ""])
    if enabled_skills:
        lines.append("| ID | 名称 | 路由 | 优先级 |")
        lines.append("| --- | --- | --- | ---: |")
        for skill in enabled_skills:
            lines.append(
                f"| {skill.get('id', '-')} | {skill.get('title') or skill.get('name', '-')} | "
                f"{skill.get('route', '-')} | {skill.get('priority', 0)} |"
            )
    else:
        lines.append("- 暂无已启用技能")

    lines.extend(["", "## 线索阶段", ""])
    if stages:
        lines.append("| 阶段 | 名称 | 说明 |")
        lines.append("| --- | --- | --- |")
        for stage in stages:
            lines.append(
                f"| {stage.get('id', '-')} | {stage.get('label') or stage.get('name', '-')} | "
                f"{stage.get('description', '-')} |"
            )
    else:
        lines.append("- 暂无线索阶段")

    lines.extend(
        [
            "",
            "## 上线验收步骤",
            "",
            "- 运行 `tools/quality/run_health_check.bat`，确认 failed 为 0。",
            "- 运行 `tools/quality/run_smoke_tests.bat`，确认输出 `Smoke tests passed.`。",
            "- 打开微信 PC 客户端并登录，再运行 `run.bat`。",
            "- 用测试客户发送价格、起订量、交期、定制流程、投诉退款五类问题。",
            "- 在 Web 控制台确认会话、线索、人工接管和报表入口可用。",
            "- 正式上线前补齐 `.env` 中真实 AI Key，并再次运行体检。",
            "",
            "## 交付风险",
            "",
        ]
    )

    risks = []
    if profile_issues:
        risks.append("客户资料未配置完整：" + "；".join(profile_issues))
    if pipeline_issues:
        risks.append("线索管道配置异常：" + "；".join(pipeline_issues))
    if len(documents) < 6:
        risks.append("知识库条目偏少，建议补充客户真实产品、价格和案例")
    if len(enabled_skills) < 6:
        risks.append("已启用客服技能偏少，可能影响自动回复覆盖率")
    if not risks:
        risks.append("未发现配置级阻塞项，主要风险来自真实微信环境和 AI Key 配置")

    lines.extend(f"- {risk}" for risk in risks)
    return "\n".join(lines) + "\n"


def export_acceptance_pack(output=None) -> Path:
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    if output is None:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = reports_dir / f"acceptance_pack_{stamp}.md"
    else:
        output = Path(output)
    output.write_text(build_acceptance_pack(), encoding="utf-8")
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate Smart Kefu acceptance pack")
    parser.add_argument("--output", help="output Markdown path")
    args = parser.parse_args(argv)

    output = export_acceptance_pack(args.output)
    print(f"Generated acceptance pack: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
