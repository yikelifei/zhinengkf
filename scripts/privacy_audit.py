#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build privacy and sensitive-data audit report for Smart Kefu."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / ".codex_deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.database import Database  # noqa: E402
from scripts.report_params import argparse_days, argparse_limit, report_days, report_limit  # noqa: E402


PATTERNS = [
    ("phone", "手机号", re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"), "P0"),
    ("wechat", "微信号", re.compile(r"(?:微信|vx|VX|V信|加我)[:：\s]*[A-Za-z][-_A-Za-z0-9]{5,19}"), "P1"),
    ("tax_id", "税号", re.compile(r"(?<![A-Z0-9])[A-Z0-9]{15,20}(?![A-Z0-9])"), "P1"),
    ("address", "收货地址", re.compile(r"[\u4e00-\u9fa5]{2,}(?:省|市|区|县|镇|街道|路|号)[\u4e00-\u9fa50-9A-Za-z\-#栋单元室\s]{4,40}"), "P1"),
    ("invoice", "发票信息", re.compile(r"(?:发票|开票|专票|普票|抬头|税号)"), "P2"),
]

LEAD_FIELDS = [
    ("phone", "手机号"),
    ("wechat_id", "微信号"),
    ("delivery_address", "收货地址"),
    ("invoice_requirement", "发票要求"),
]


def build_privacy_audit(days: int = 30, limit: int = 300) -> dict:
    days = report_days(days, default=30)
    limit = report_limit(limit, default=300)
    db = Database(str(ROOT / "data" / "kefu.db"))
    messages = _load_messages(db, days=days, limit=limit)
    leads = db.list_leads(limit=limit)

    items: list[dict] = []
    for message in messages:
        content = message.get("content") or ""
        for kind, label, pattern, priority in PATTERNS:
            matches = pattern.findall(content)
            if not matches:
                continue
            items.append(
                {
                    "source": "message",
                    "kind": kind,
                    "label": label,
                    "priority": priority,
                    "session_id": message.get("session_id"),
                    "direction": message.get("direction"),
                    "created_at": message.get("created_at"),
                    "masked_sample": mask_sensitive(content),
                    "match_count": len(matches),
                    "suggested_action": _suggest_action(kind, "message"),
                }
            )

    for lead in leads:
        for field, label in LEAD_FIELDS:
            value = lead.get(field)
            if not value:
                continue
            priority = "P0" if field == "phone" else "P1"
            items.append(
                {
                    "source": "lead",
                    "kind": field,
                    "label": label,
                    "priority": priority,
                    "session_id": lead.get("session_id"),
                    "lead_id": lead.get("id"),
                    "customer": lead.get("company_name") or lead.get("contact_person") or lead.get("session_id"),
                    "created_at": lead.get("updated_at") or lead.get("created_at"),
                    "masked_sample": mask_sensitive(str(value)),
                    "match_count": 1,
                    "suggested_action": _suggest_action(field, "lead"),
                }
            )

    items.sort(key=lambda item: (_priority_rank(item["priority"]), item.get("created_at") or ""), reverse=False)
    type_counts = Counter(item["label"] for item in items)
    p0 = sum(1 for item in items if item["priority"] == "P0")
    p1 = sum(1 for item in items if item["priority"] == "P1")
    p2 = sum(1 for item in items if item["priority"] == "P2")
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "days": days,
        "total": len(items),
        "p0": p0,
        "p1": p1,
        "p2": p2,
        "status": "attention" if p0 or p1 else "healthy",
        "type_counts": [{"label": label, "count": count} for label, count in type_counts.most_common()],
        "items": items[:80],
        "policy": [
            "客服工作台和报告默认展示脱敏样本。",
            "敏感信息只保留在本地数据库，正式上线前需要配置数据保留周期。",
            "涉及发票、税号、地址、手机号的会话建议走人工确认和订单交付清单。",
        ],
    }


def export_privacy_audit(days: int = 30, limit: int = 300) -> Path:
    report = build_privacy_audit(days=days, limit=limit)
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    path = reports_dir / f"privacy_audit_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    lines = [
        "# 隐私合规审计报告",
        "",
        f"- 生成时间：{report['generated_at']}",
        f"- 统计周期：近 {report['days']} 天",
        f"- 风险样本：{report['total']}",
        f"- P0：{report['p0']}，P1：{report['p1']}，P2：{report['p2']}",
        "",
        "## 处理原则",
        "",
    ]
    lines.extend(f"- {item}" for item in report["policy"])
    lines.extend(
        [
            "",
            "## 类型分布",
            "",
            "|类型|数量|",
            "|---|---:|",
        ]
    )
    if report["type_counts"]:
        for item in report["type_counts"]:
            lines.append(f"|{_md(item['label'])}|{item['count']}|")
    else:
        lines.append("|暂无|0|")
    lines.extend(
        [
            "",
            "## 风险样本",
            "",
            "|优先级|来源|类型|客户/会话|脱敏样本|建议动作|",
            "|---|---|---|---|---|---|",
        ]
    )
    if report["items"]:
        for item in report["items"]:
            customer = item.get("customer") or item.get("session_id") or "-"
            lines.append(
                f"|{item['priority']}|{item['source']}|{_md(item['label'])}|{_md(customer)}|"
                f"{_md(item['masked_sample'])}|{_md(item['suggested_action'])}|"
            )
    else:
        lines.append("|-|暂无|暂无|暂无|未发现敏感信息样本|继续按数据保留周期执行清理|")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def mask_sensitive(value: str) -> str:
    text = str(value or "")
    text = re.sub(r"(?<!\d)(1[3-9]\d)(\d{4})(\d{4})(?!\d)", r"\1****\3", text)
    text = re.sub(r"((?:微信|vx|VX|V信|加我)[:：\s]*[A-Za-z])[-_A-Za-z0-9]{3,15}([-_A-Za-z0-9]{2})", r"\1***\2", text)
    text = re.sub(r"(?<![A-Z0-9])([A-Z0-9]{4})[A-Z0-9]{7,14}([A-Z0-9]{4})(?![A-Z0-9])", r"\1********\2", text)
    return " ".join(text.split())[:120]


def _load_messages(db: Database, days: int, limit: int) -> list[dict]:
    days = report_days(days, default=30)
    limit = report_limit(limit, default=300)
    rows = db.execute(
        """SELECT session_id, direction, content, source, intent, created_at
           FROM messages
           WHERE created_at >= datetime('now', ?)
           ORDER BY id DESC
           LIMIT ?""",
        (f"-{days} days", limit),
    ).fetchall()
    return [dict(row) for row in rows]


def _suggest_action(kind: str, source: str) -> str:
    if kind in {"phone", "wechat", "wechat_id"}:
        return "仅在CRM和人工接管场景查看完整联系方式，报告和看板使用脱敏展示。"
    if kind in {"address", "delivery_address"}:
        return "订单确认前由人工复核地址，避免在普通会话复述完整地址。"
    if kind in {"invoice", "tax_id", "invoice_requirement"}:
        return "发票信息进入订单交付清单，由人工确认抬头、税号和开票类型。"
    return "按最小必要原则保留，超出保留周期后执行清理。"


def _priority_rank(value: str) -> int:
    return {"P0": 0, "P1": 1, "P2": 2}.get(value, 9)


def _md(value) -> str:
    return str(value or "").replace("|", "｜").replace("\n", " ")


def main() -> int:
    parser = argparse.ArgumentParser(description="Export Smart Kefu privacy audit report.")
    parser.add_argument("--days", type=argparse_days, default=30)
    parser.add_argument("--limit", type=argparse_limit, default=300)
    args = parser.parse_args()
    print(export_privacy_audit(days=args.days, limit=args.limit))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
