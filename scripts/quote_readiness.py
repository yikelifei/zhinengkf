#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build quote-readiness checklist for leads."""

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
from core.lead_pipeline import pipeline_rules, stage_label  # noqa: E402


FIELD_LABELS = {
    "phone_or_wechat": "联系方式",
    "quantity_estimate": "数量",
    "budget": "预算",
    "due_date": "使用日期",
    "city": "收货城市",
}


def build_quote_readiness(limit: int = 100) -> dict:
    db = Database(str(ROOT / "data" / "kefu.db"))
    leads = db.list_leads(limit=limit)
    required = pipeline_rules().get("required_fields") or [
        "phone_or_wechat", "quantity_estimate", "budget", "due_date", "city",
    ]
    items = []
    ready_count = 0
    for lead in leads:
        missing = _missing_fields(lead, required)
        ready = not missing
        if ready:
            ready_count += 1
        items.append(
            {
                "lead_id": lead.get("id"),
                "session_id": lead.get("session_id"),
                "customer": lead.get("company_name") or lead.get("contact_person") or lead.get("session_id"),
                "stage": lead.get("stage") or "new_inquiry",
                "stage_label": stage_label(lead.get("stage") or "new_inquiry"),
                "lead_score": int(lead.get("lead_score") or 0),
                "ready": ready,
                "missing_fields": missing,
                "missing_labels": [FIELD_LABELS.get(item, item) for item in missing],
                "quantity": lead.get("quantity_estimate") or "-",
                "budget": lead.get("budget") or "-",
                "due_date": lead.get("due_date") or "-",
                "city": lead.get("city") or "-",
                "contact": lead.get("phone") or lead.get("wechat_id") or "-",
                "suggested_question": _suggest_question(missing),
                "suggested_action": "可进入人工核价并出报价单。" if ready else "补齐报价必填字段后再核价。",
            }
        )
    items.sort(key=lambda item: (0 if item["ready"] else 1, -item["lead_score"], len(item["missing_fields"])))
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "required_fields": required,
        "total": len(items),
        "ready": ready_count,
        "not_ready": len(items) - ready_count,
        "ready_rate": round(ready_count / len(items), 4) if items else 0,
        "items": items,
    }


def export_quote_readiness(limit: int = 100) -> Path:
    report = build_quote_readiness(limit=limit)
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    path = reports_dir / f"quote_readiness_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    lines = [
        "# 报价准备清单",
        "",
        f"- 生成时间：{report['generated_at']}",
        f"- 线索总数：{report['total']}",
        f"- 可报价：{report['ready']}",
        f"- 待补充：{report['not_ready']}",
        f"- 准备率：{report['ready_rate']:.1%}",
        "",
        "|客户|阶段|意向分|状态|缺失字段|数量|预算|日期|城市|建议追问|",
        "|---|---|---:|---|---|---|---|---|---|---|",
    ]
    if report["items"]:
        for item in report["items"]:
            lines.append(
                f"|{_md(item['customer'])}|{_md(item['stage_label'])}|{item['lead_score']}|"
                f"{'可报价' if item['ready'] else '待补充'}|{_md('、'.join(item['missing_labels']) or '-')}|"
                f"{_md(item['quantity'])}|{_md(item['budget'])}|{_md(item['due_date'])}|{_md(item['city'])}|"
                f"{_md(item['suggested_question'])}|"
            )
    else:
        lines.append("|暂无|-|0|-|-|-|-|-|-|-|")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def _missing_fields(lead: dict, required: list[str]) -> list[str]:
    missing = []
    for field in required:
        if field == "phone_or_wechat":
            if not (lead.get("phone") or lead.get("wechat_id")):
                missing.append(field)
        elif not lead.get(field):
            missing.append(field)
    return missing


def _suggest_question(missing: list[str]) -> str:
    if not missing:
        return "信息已完整，可以人工核价并输出报价。"
    labels = [FIELD_LABELS.get(item, item) for item in missing[:3]]
    return "方便再补充一下" + "、".join(labels) + "吗？我好帮您安排人工核价。"


def _md(value) -> str:
    return str(value or "").replace("|", "｜").replace("\n", " ")


def main() -> int:
    parser = argparse.ArgumentParser(description="Export quote readiness checklist.")
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()
    print(export_quote_readiness(limit=args.limit))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
