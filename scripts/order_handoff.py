#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build order handoff checklist after quotation or deal confirmation."""

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
from core.lead_pipeline import stage_label  # noqa: E402


ORDER_STAGES = {"quotation_given", "design_discussion", "sample_sent", "ready_to_order", "ordered"}
REQUIRED_FIELDS = {
    "ready_to_order": ["deal_value", "contract_status", "payment_status", "delivery_address"],
    "ordered": ["deal_value", "payment_status", "invoice_requirement", "delivery_address", "production_status", "shipping_status"],
}
FIELD_LABELS = {
    "deal_value": "成交金额",
    "contract_status": "合同状态",
    "payment_status": "付款状态",
    "invoice_requirement": "开票要求",
    "delivery_address": "收货地址",
    "production_status": "生产状态",
    "shipping_status": "发货状态",
}


def build_order_handoff(limit: int = 100) -> dict:
    db = Database(str(ROOT / "data" / "kefu.db"))
    leads = db.list_leads(limit=limit)
    items = []
    for lead in leads:
        stage = lead.get("stage") or "new_inquiry"
        score = int(lead.get("lead_score") or 0)
        if stage not in ORDER_STAGES and score < 80:
            continue
        required = REQUIRED_FIELDS.get(stage, ["deal_value", "delivery_address"])
        missing = [field for field in required if not lead.get(field)]
        status = "ready" if not missing else "pending"
        items.append(
            {
                "lead_id": lead.get("id"),
                "session_id": lead.get("session_id"),
                "customer": lead.get("company_name") or lead.get("contact_person") or lead.get("session_id"),
                "stage": stage,
                "stage_label": stage_label(stage),
                "lead_score": score,
                "status": status,
                "missing_fields": missing,
                "missing_labels": [FIELD_LABELS.get(item, item) for item in missing],
                "deal_value": lead.get("deal_value") or "-",
                "contract_status": lead.get("contract_status") or "-",
                "payment_status": lead.get("payment_status") or "-",
                "invoice_requirement": lead.get("invoice_requirement") or "-",
                "delivery_address": lead.get("delivery_address") or "-",
                "production_status": lead.get("production_status") or "-",
                "shipping_status": lead.get("shipping_status") or "-",
                "suggested_action": _suggest_action(stage, missing),
            }
        )
    items.sort(key=lambda item: (0 if item["status"] == "pending" else 1, -item["lead_score"], len(item["missing_fields"])))
    ready = sum(1 for item in items if item["status"] == "ready")
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total": len(items),
        "ready": ready,
        "pending": len(items) - ready,
        "ready_rate": round(ready / len(items), 4) if items else 0,
        "items": items,
    }


def export_order_handoff(limit: int = 100) -> Path:
    report = build_order_handoff(limit=limit)
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    path = reports_dir / f"order_handoff_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    lines = [
        "# 订单交付清单",
        "",
        f"- 生成时间：{report['generated_at']}",
        f"- 订单线索：{report['total']}",
        f"- 可交付：{report['ready']}",
        f"- 待补充：{report['pending']}",
        f"- 完整率：{report['ready_rate']:.1%}",
        "",
        "|客户|阶段|状态|缺失字段|金额|合同|付款|开票|地址|生产|发货|建议动作|",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    if report["items"]:
        for item in report["items"]:
            lines.append(
                f"|{_md(item['customer'])}|{_md(item['stage_label'])}|{_md('可交付' if item['status'] == 'ready' else '待补充')}|"
                f"{_md('、'.join(item['missing_labels']) or '-')}|{_md(item['deal_value'])}|{_md(item['contract_status'])}|"
                f"{_md(item['payment_status'])}|{_md(item['invoice_requirement'])}|{_md(item['delivery_address'])}|"
                f"{_md(item['production_status'])}|{_md(item['shipping_status'])}|{_md(item['suggested_action'])}|"
            )
    else:
        lines.append("|暂无|-|-|-|-|-|-|-|-|-|-|-|")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def _suggest_action(stage: str, missing: list[str]) -> str:
    if not missing:
        return "信息完整，可以交接生产/发货或进行成交复盘。"
    labels = [FIELD_LABELS.get(item, item) for item in missing]
    if stage == "ordered":
        return "补齐" + "、".join(labels) + "，同步生产和发货负责人。"
    return "补齐" + "、".join(labels) + "，再推进合同、付款或下单。"


def _md(value) -> str:
    return str(value or "").replace("|", "｜").replace("\n", " ")


def main() -> int:
    parser = argparse.ArgumentParser(description="Export order handoff checklist.")
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()
    print(export_order_handoff(limit=args.limit))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
