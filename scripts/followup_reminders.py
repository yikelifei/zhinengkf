#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate a daily follow-up task list for sales/customer service."""

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

from core.database import Database  # noqa: E402
from core.lead_pipeline import default_next_action, pipeline_rules, stage_label  # noqa: E402
from scripts.report_params import argparse_limit, report_limit  # noqa: E402


def _value(lead, key):
    return lead.get(key) or "-"


def build_followup_tasks(limit=50) -> list[dict]:
    limit = report_limit(limit, default=50)
    db = Database(str(ROOT / "data" / "kefu.db"))
    leads = db.get_followup_leads(limit=limit)
    rules = pipeline_rules()
    high_intent_score = int(rules.get("high_intent_score", 80))
    tasks = []
    for lead in leads:
        score = int(lead.get("lead_score") or 0)
        stage = lead.get("stage") or "new_inquiry"
        reasons = []
        if score >= high_intent_score:
            reasons.append("高意向")
        if not lead.get("next_action"):
            reasons.append("缺下一步动作")
        if not (lead.get("phone") or lead.get("wechat_id")):
            reasons.append("缺联系方式")
        if not lead.get("budget"):
            reasons.append("缺预算")
        if not lead.get("quantity_estimate"):
            reasons.append("缺数量")
        if not lead.get("due_date"):
            reasons.append("缺使用日期")
        if not reasons:
            reasons.append("正常跟进")

        suggested_action = lead.get("next_action") or _suggest_next_action(lead, reasons)
        tasks.append(
            {
                "lead_id": lead.get("id"),
                "session_id": lead.get("session_id"),
                "customer": lead.get("company_name") or lead.get("contact_person") or lead.get("session_id"),
                "stage": stage,
                "stage_label": stage_label(stage),
                "score": score,
                "owner": lead.get("owner") or lead.get("assigned_to") or "-",
                "contact": lead.get("phone") or lead.get("wechat_id") or "-",
                "quantity": _value(lead, "quantity_estimate"),
                "budget": _value(lead, "budget"),
                "due_date": _value(lead, "due_date"),
                "city": _value(lead, "city"),
                "reasons": reasons,
                "suggested_action": suggested_action,
            }
        )
    return tasks


def _suggest_next_action(lead, reasons):
    if "缺联系方式" in reasons:
        return "先引导客户留下电话或微信号，方便人工报价和发方案。"
    missing = []
    for label, key in [("数量", "quantity_estimate"), ("预算", "budget"), ("使用日期", "due_date"), ("城市", "city")]:
        if not lead.get(key):
            missing.append(label)
    if missing:
        return "补充" + "、".join(missing) + "后再报价。"
    rules = pipeline_rules()
    if int(lead.get("lead_score") or 0) >= int(rules.get("high_intent_score", 80)):
        return "优先人工跟进，确认方案并推动报价。"
    return default_next_action(lead.get("stage") or "new_inquiry") or "确认客户需求是否继续推进。"


def render_markdown(tasks: list[dict]) -> str:
    lines = [
        "# 今日跟进任务",
        "",
        f"- 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 任务数：{len(tasks)}",
        "",
    ]
    if not tasks:
        lines.append("暂无待跟进线索。")
        return "\n".join(lines) + "\n"

    lines.extend(
        [
            "| 客户 | 阶段 | 意向分 | 联系方式 | 数量 | 预算 | 日期 | 城市 | 原因 | 建议动作 |",
            "| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for task in tasks:
        lines.append(
            f"| {task['customer']} | {task['stage_label']} | {task['score']} | "
            f"{task['contact']} | {task['quantity']} | {task['budget']} | "
            f"{task['due_date']} | {task['city']} | "
            f"{'、'.join(task['reasons'])} | {task['suggested_action']} |"
        )
    return "\n".join(lines) + "\n"


def export_followup_tasks(output=None, limit=50) -> Path:
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    if output is None:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = reports_dir / f"followup_tasks_{stamp}.md"
    else:
        output = Path(output)
    output.write_text(render_markdown(build_followup_tasks(limit=limit)), encoding="utf-8")
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description="Export Smart Kefu follow-up tasks")
    parser.add_argument("--output", help="output Markdown path")
    parser.add_argument("--limit", type=argparse_limit, default=50, help="maximum tasks to export")
    args = parser.parse_args(argv)

    output = export_followup_tasks(args.output, limit=args.limit)
    print(f"Exported follow-up tasks: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
