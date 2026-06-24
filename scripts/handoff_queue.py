#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build and export the manual handoff queue for operations."""

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
from scripts.report_params import argparse_limit, report_limit  # noqa: E402


def _parse_time(value) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()[:19].replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _latest_inbound(db: Database, session_id: str) -> str:
    messages = db.get_session_messages(session_id, limit=30)
    for message in reversed(messages):
        if message.get("direction") == "inbound":
            return str(message.get("content") or "")
    return ""


def _status_label(status: str, lock: dict | None) -> str:
    if lock:
        return "人工锁定"
    if status == "needs_human":
        return "待人工处理"
    if status == "manual_takeover":
        return "人工接管中"
    return status or "待处理"


def build_handoff_queue(limit: int = 50) -> list[dict]:
    """Return sessions that need human attention or are manually locked."""

    limit = report_limit(limit, default=50)
    db = Database(str(ROOT / "data" / "kefu.db"))
    now = datetime.now()
    items: list[dict] = []
    for row in db.list_conversations(limit=500):
        session_id = row.get("session_id") or ""
        status = row.get("status") or "active"
        lock = db.get_conversation_lock(session_id)
        if status not in {"needs_human", "manual_takeover"} and not lock:
            continue

        started_at = _parse_time(row.get("last_seen_at")) or _parse_time(row.get("first_seen_at")) or now
        wait_minutes = max(0, int((now - started_at).total_seconds() // 60))
        reason = ""
        if lock:
            reason = lock.get("manual_lock_reason") or ""
        reason = reason or row.get("manual_lock_reason") or ("客户要求人工/风险转接" if status == "needs_human" else "人工接管")
        lead_score = int(row.get("lead_score") or 0)

        items.append(
            {
                "session_id": session_id,
                "customer": row.get("friend_name") or row.get("company_name") or session_id,
                "company_name": row.get("company_name") or "",
                "contact_person": row.get("contact_person") or "",
                "phone": row.get("phone") or "",
                "status": status,
                "status_label": _status_label(status, lock),
                "reason": reason,
                "wait_minutes": wait_minutes,
                "lead_stage": row.get("lead_stage") or "",
                "lead_score": lead_score,
                "next_action": row.get("next_action") or "",
                "latest_inbound": _latest_inbound(db, session_id),
                "locked_until": lock.get("manual_lock_until") if lock else "",
                "priority": priority_label(status, wait_minutes, lead_score),
            }
        )

    items.sort(
        key=lambda item: (
            0 if item["status"] == "needs_human" else 1,
            0 if item["priority"] == "P0" else 1 if item["priority"] == "P1" else 2,
            -item["wait_minutes"],
            -item["lead_score"],
        )
    )
    return items[:limit]


def priority_label(status: str, wait_minutes: int, lead_score: int) -> str:
    if status == "needs_human" and (wait_minutes >= 10 or lead_score >= 80):
        return "P0"
    if status == "needs_human" or wait_minutes >= 5 or lead_score >= 60:
        return "P1"
    return "P2"


def export_handoff_queue(limit: int = 50) -> Path:
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    items = build_handoff_queue(limit=limit)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = reports_dir / f"handoff_queue_{timestamp}.md"

    lines = [
        "# 人工接管队列",
        "",
        f"- 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 队列数量：{len(items)}",
        "",
    ]
    if not items:
        lines.extend(["暂无待人工或人工锁定会话。", ""])
    else:
        lines.extend(
            [
                "|优先级|客户|状态|等待|原因|线索阶段|意向分|下一步|最近客户消息|",
                "|---|---|---|---:|---|---|---:|---|---|",
            ]
        )
        for item in items:
            latest = str(item.get("latest_inbound") or "").replace("\n", " ")[:80]
            lines.append(
                "|{priority}|{customer}|{status}|{wait} 分钟|{reason}|{stage}|{score}|{next_action}|{latest}|".format(
                    priority=item["priority"],
                    customer=_md(item["customer"]),
                    status=_md(item["status_label"]),
                    wait=item["wait_minutes"],
                    reason=_md(item["reason"]),
                    stage=_md(item["lead_stage"] or "-"),
                    score=item["lead_score"],
                    next_action=_md(item["next_action"] or "-"),
                    latest=_md(latest or "-"),
                )
            )
        lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def _md(value) -> str:
    return str(value or "").replace("|", "｜")


def main() -> int:
    parser = argparse.ArgumentParser(description="Export manual handoff queue.")
    parser.add_argument("--limit", type=argparse_limit, default=50)
    args = parser.parse_args()
    path = export_handoff_queue(limit=args.limit)
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
