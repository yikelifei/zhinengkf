#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SLA monitor for response timeliness and unresolved sessions."""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
import statistics
import sys


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / ".codex_deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.database import Database  # noqa: E402
from scripts.handoff_queue import build_handoff_queue  # noqa: E402
from scripts.report_params import argparse_days, report_days  # noqa: E402


SLA_TARGETS = {
    "first_response_minutes": 5,
    "pending_reply_minutes": 15,
    "handoff_minutes": 10,
}


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


def build_sla_report(days: int = 7) -> dict:
    days = report_days(days, default=7)
    db = Database(str(ROOT / "data" / "kefu.db"))
    rows = db.execute(
        """SELECT id, session_id, direction, content, source, intent, created_at
           FROM messages
           WHERE created_at >= datetime('now', ?)
           ORDER BY session_id, id""",
        (f"-{days} days",),
    ).fetchall()

    sessions: dict[str, list[dict]] = {}
    for row in rows:
        item = dict(row)
        item["created_dt"] = _parse_time(item.get("created_at"))
        sessions.setdefault(item["session_id"], []).append(item)

    response_minutes: list[float] = []
    pending_sessions: list[dict] = []
    now = datetime.now()
    latest_activity = None

    for session_id, messages in sessions.items():
        inbound_waiting: list[dict] = []
        latest_message = None
        for message in messages:
            created = message.get("created_dt")
            if created and (latest_activity is None or created > latest_activity):
                latest_activity = created
            if created:
                latest_message = message
            if message.get("direction") == "inbound":
                inbound_waiting.append(message)
            elif message.get("direction") == "outbound" and inbound_waiting and created:
                first = inbound_waiting.pop(0)
                first_time = first.get("created_dt")
                if first_time:
                    response_minutes.append(max(0.0, (created - first_time).total_seconds() / 60))
                inbound_waiting.clear()

        if latest_message and latest_message.get("direction") == "inbound":
            created = latest_message.get("created_dt") or now
            wait_minutes = max(0, int((now - created).total_seconds() // 60))
            pending_sessions.append(
                {
                    "session_id": session_id,
                    "wait_minutes": wait_minutes,
                    "latest_inbound": latest_message.get("content") or "",
                    "created_at": latest_message.get("created_at") or "",
                }
            )

    handoff_items = build_handoff_queue(limit=100)
    overdue_handoff = [
        item for item in handoff_items
        if _safe_int(item.get("wait_minutes")) >= SLA_TARGETS["handoff_minutes"]
    ]
    overdue_pending = [
        item for item in pending_sessions
        if _safe_int(item.get("wait_minutes")) >= SLA_TARGETS["pending_reply_minutes"]
    ]
    target = SLA_TARGETS["first_response_minutes"]
    within_target = [item for item in response_minutes if item <= target]
    sla_rate = (len(within_target) / len(response_minutes)) if response_minutes else 1.0

    issues = []
    if overdue_pending:
        issues.append(
            {
                "severity": "blocker" if len(overdue_pending) >= 3 else "warning",
                "message": f"{len(overdue_pending)} 个会话超过 {SLA_TARGETS['pending_reply_minutes']} 分钟未回复",
                "action": "进入会话接管页优先处理最后一条为客户消息的会话。",
            }
        )
    if overdue_handoff:
        issues.append(
            {
                "severity": "blocker",
                "message": f"{len(overdue_handoff)} 个转人工会话超过 {SLA_TARGETS['handoff_minutes']} 分钟未处理",
                "action": "在风控质检页查看人工接管队列，并分配客服处理。",
            }
        )
    if response_minutes and sla_rate < 0.8:
        issues.append(
            {
                "severity": "warning",
                "message": f"首次响应 SLA 达标率为 {sla_rate * 100:.1f}%",
                "action": "检查微信后台是否在线、AI 接口是否稳定，并补充高频知识库。",
            }
        )

    status = "healthy"
    if any(item["severity"] == "blocker" for item in issues):
        status = "blocker"
    elif issues:
        status = "warning"

    return {
        "days": days,
        "targets": dict(SLA_TARGETS),
        "status": status,
        "response_count": len(response_minutes),
        "avg_response_minutes": round(statistics.mean(response_minutes), 2) if response_minutes else 0,
        "max_response_minutes": round(max(response_minutes), 2) if response_minutes else 0,
        "sla_rate": round(sla_rate, 4),
        "pending_customer_sessions": len(pending_sessions),
        "overdue_pending_sessions": len(overdue_pending),
        "handoff_sessions": len(handoff_items),
        "overdue_handoff_sessions": len(overdue_handoff),
        "latest_activity_at": latest_activity.strftime("%Y-%m-%d %H:%M:%S") if latest_activity else "",
        "pending_samples": sorted(pending_sessions, key=lambda item: item["wait_minutes"], reverse=True)[:10],
        "handoff_samples": overdue_handoff[:10],
        "issues": issues,
    }


def export_sla_report(days: int = 7) -> Path:
    report = build_sla_report(days=days)
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    path = reports_dir / f"sla_monitor_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"

    lines = [
        "# 智能客服 SLA 监控报告",
        "",
        f"- 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 统计周期：近 {report['days']} 天",
        f"- 状态：{report['status']}",
        f"- 首次响应达标率：{report['sla_rate'] * 100:.1f}%",
        f"- 平均响应：{report['avg_response_minutes']} 分钟",
        f"- 最长响应：{report['max_response_minutes']} 分钟",
        f"- 客户待回复：{report['pending_customer_sessions']} 个",
        f"- 待回复超时：{report['overdue_pending_sessions']} 个",
        f"- 人工接管：{report['handoff_sessions']} 个",
        f"- 人工接管超时：{report['overdue_handoff_sessions']} 个",
        "",
        "## 风险项",
        "",
    ]
    if report["issues"]:
        for item in report["issues"]:
            lines.append(f"- [{item['severity']}] {item['message']}；建议：{item['action']}")
    else:
        lines.append("- 暂无 SLA 风险项。")
    lines.extend(["", "## 待回复样本", ""])
    if report["pending_samples"]:
        lines.extend(["|会话|等待|最近客户消息|", "|---|---:|---|"])
        for item in report["pending_samples"]:
            lines.append(
                f"|{_md(item['session_id'])}|{item['wait_minutes']} 分钟|{_md(str(item['latest_inbound'])[:80])}|"
            )
    else:
        lines.append("暂无客户待回复样本。")
    lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def _md(value) -> str:
    return str(value or "").replace("|", "｜").replace("\n", " ")


def _safe_int(value, default: int = 0) -> int:
    try:
        return int(default if value in (None, "") else value)
    except Exception:
        return default


def main() -> int:
    parser = argparse.ArgumentParser(description="Export Smart Kefu SLA monitor report.")
    parser.add_argument("--days", type=argparse_days, default=7)
    args = parser.parse_args()
    path = export_sla_report(days=args.days)
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
