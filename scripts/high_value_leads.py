#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export high-value lead shortlist for sales follow-up."""

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
from core.high_value import evaluate_lead, format_money  # noqa: E402
from core.lead_pipeline import pipeline_rules, stage_label  # noqa: E402
from scripts.report_params import argparse_limit, report_limit  # noqa: E402


def build_high_value_leads(limit: int = 200, include_all: bool = False) -> dict:
    limit = report_limit(limit, default=200)
    db = Database(str(ROOT / "data" / "kefu.db"))
    rules = pipeline_rules()
    rules = rules if isinstance(rules, dict) else {}
    rows = []
    for lead in db.list_leads(limit=limit):
        assessment = evaluate_lead(lead, rules)
        if not include_all and not assessment["is_high_value"]:
            continue
        rows.append(_item(lead, assessment))

    rows.sort(
        key=lambda item: (
            0 if item["is_high_value"] else 1,
            -item["priority_score"],
            -(item["estimated_deal_value"] or 0),
            -item["lead_score"],
        )
    )
    high_value_count = sum(1 for item in rows if item["is_high_value"])
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "rules": rules,
        "total": len(rows),
        "high_value": high_value_count,
        "items": rows,
    }


def export_high_value_leads(limit: int = 200, include_all: bool = False) -> Path:
    report = build_high_value_leads(limit=limit, include_all=include_all)
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    path = reports_dir / f"high_value_leads_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    path.write_text(render_markdown(report), encoding="utf-8")
    return path


def render_markdown(report: dict) -> str:
    rules = report.get("rules")
    rules = rules if isinstance(rules, dict) else {}
    min_score = _safe_int(rules.get("high_value_min_score", rules.get("high_intent_score", 80)), 80)
    min_deal_value = _safe_float(rules.get("high_value_min_deal_value"), 10000)
    lines = [
        "# 高价值客户筛选清单",
        "",
        f"- 生成时间：{report['generated_at']}",
        f"- 高价值客户数：{report['high_value']}",
        f"- 意向分阈值：{min_score}",
        f"- 预计金额阈值：{format_money(min_deal_value)}",
        "",
        "|客户|阶段|优先级|意向分|预计金额|联系方式|数量|预算|日期|城市|筛选原因|建议动作|",
        "|---|---|---:|---:|---:|---|---|---|---|---|---|---|",
    ]
    if not report["items"]:
        lines.append("|暂无|-|0|0|-|-|-|-|-|-|-|-|")
    for item in report["items"]:
        lines.append(
            f"|{_md(item['customer'])}|{_md(item['stage_label'])}|{item['priority_score']}|"
            f"{item['lead_score']}|{_md(format_money(item['estimated_deal_value']))}|"
            f"{_md(item['contact'])}|{_md(item['quantity'])}|{_md(item['budget'])}|"
            f"{_md(item['due_date'])}|{_md(item['city'])}|"
            f"{_md('、'.join(item['reasons']))}|{_md(item['suggested_action'])}|"
        )
    lines.append("")
    return "\n".join(lines)


def _item(lead: dict, assessment: dict) -> dict:
    stage = lead.get("stage") or "new_inquiry"
    return {
        "lead_id": lead.get("id"),
        "session_id": lead.get("session_id"),
        "customer": lead.get("company_name") or lead.get("contact_person") or lead.get("session_id"),
        "stage": stage,
        "stage_label": stage_label(stage),
        "is_high_value": assessment["is_high_value"],
        "priority_score": assessment["priority_score"],
        "lead_score": assessment["lead_score"],
        "estimated_deal_value": assessment["estimated_deal_value"],
        "estimated_value_source": assessment["estimated_value_source"],
        "contact": lead.get("phone") or lead.get("wechat_id") or "-",
        "quantity": lead.get("quantity_estimate") or "-",
        "budget": lead.get("budget") or "-",
        "due_date": lead.get("due_date") or "-",
        "city": lead.get("city") or "-",
        "missing_labels": assessment["missing_labels"],
        "reasons": assessment["reasons"],
        "suggested_action": assessment["suggested_action"],
    }


def _md(value) -> str:
    return str(value or "").replace("|", "｜").replace("\n", " ")


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(default if value in (None, "") else value)
    except Exception:
        return default


def _safe_int(value, default: int = 0) -> int:
    try:
        return int(default if value in (None, "") else value)
    except Exception:
        return default


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Export high-value lead shortlist.")
    parser.add_argument("--limit", type=argparse_limit, default=200)
    parser.add_argument("--include-all", action="store_true", help="include non-high-value leads for comparison")
    args = parser.parse_args(argv)
    print(export_high_value_leads(limit=args.limit, include_all=args.include_all))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
