#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build product improvement backlog from real customer-service data."""

from __future__ import annotations

import argparse
from collections import Counter
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
from core.knowledge_config import match_knowledge  # noqa: E402
from scripts.report_params import argparse_days, argparse_limit, report_days, report_limit  # noqa: E402


def build_improvement_backlog(days: int = 7, limit: int = 200) -> dict:
    days = report_days(days, default=7)
    limit = report_limit(limit, default=200)
    db = Database(str(ROOT / "data" / "kefu.db"))
    rows = db.execute(
        """SELECT session_id, direction, content, source, intent, created_at
           FROM messages
           WHERE created_at >= datetime('now', ?)
           ORDER BY id DESC
           LIMIT ?""",
        (f"-{days} days", limit),
    ).fetchall()
    messages = [dict(row) for row in rows]
    inbound = [m for m in messages if m.get("direction") == "inbound"]
    outbound = [m for m in messages if m.get("direction") == "outbound"]

    gap_counter: Counter[str] = Counter()
    gap_samples: dict[str, dict] = {}
    for message in inbound:
        question = _normalize(message.get("content"))
        if not question or match_knowledge(question):
            continue
        gap_counter[question] += 1
        gap_samples.setdefault(question, message)

    items: list[dict] = []
    for question, count in gap_counter.most_common(20):
        sample = gap_samples[question]
        items.append(
            {
                "type": "knowledge_gap",
                "priority": "P0" if count >= 3 else "P1",
                "title": f"补充知识库：{question}",
                "evidence": question,
                "count": count,
                "session_id": sample.get("session_id"),
                "created_at": sample.get("created_at"),
                "suggested_action": "新增或更新知识库条目，补充关键词和标准回答。",
            }
        )

    for message in outbound:
        source = message.get("source") or ""
        intent = message.get("intent") or ""
        if "ai" in source:
            items.append(
                {
                    "type": "ai_fallback",
                    "priority": "P1",
                    "title": f"降低 AI 兜底：{intent or 'unknown'}",
                    "evidence": _normalize(message.get("content")),
                    "count": 1,
                    "session_id": message.get("session_id"),
                    "created_at": message.get("created_at"),
                    "suggested_action": "把该回复沉淀为 Skill 或知识库标准话术，减少线上不确定性。",
                }
            )
        if source == "manual":
            items.append(
                {
                    "type": "manual_reply",
                    "priority": "P2",
                    "title": "人工回复可沉淀",
                    "evidence": _normalize(message.get("content")),
                    "count": 1,
                    "session_id": message.get("session_id"),
                    "created_at": message.get("created_at"),
                    "suggested_action": "评估是否把人工高质量回复补充为标准话术或客服 Skill。",
                }
            )
        if "transfer" in intent:
            items.append(
                {
                    "type": "handoff_reason",
                    "priority": "P1",
                    "title": f"复盘转人工原因：{intent}",
                    "evidence": _normalize(message.get("content")),
                    "count": 1,
                    "session_id": message.get("session_id"),
                    "created_at": message.get("created_at"),
                    "suggested_action": "区分风险转人工和知识不足转人工，后者应补知识库。",
                }
            )

    items.sort(key=lambda item: (_priority_rank(item["priority"]), -int(item.get("count") or 1), item.get("created_at") or ""), reverse=False)
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "days": days,
        "total": len(items),
        "p0": sum(1 for item in items if item["priority"] == "P0"),
        "p1": sum(1 for item in items if item["priority"] == "P1"),
        "p2": sum(1 for item in items if item["priority"] == "P2"),
        "items": items[:50],
    }


def export_improvement_backlog(days: int = 7, limit: int = 200) -> Path:
    report = build_improvement_backlog(days=days, limit=limit)
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    path = reports_dir / f"improvement_backlog_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    lines = [
        "# 智能客服优化待办",
        "",
        f"- 生成时间：{report['generated_at']}",
        f"- 统计周期：近 {report['days']} 天",
        f"- 待办总数：{report['total']}",
        f"- P0：{report['p0']}，P1：{report['p1']}，P2：{report['p2']}",
        "",
        "|优先级|类型|标题|证据|建议动作|",
        "|---|---|---|---|---|",
    ]
    if report["items"]:
        for item in report["items"]:
            lines.append(
                f"|{item['priority']}|{item['type']}|{_md(item['title'])}|{_md(item['evidence'])}|{_md(item['suggested_action'])}|"
            )
    else:
        lines.append("|-|暂无|暂无优化待办|当前样本未发现需要沉淀的知识缺口或人工回复|继续观察|")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def _normalize(value) -> str:
    return " ".join(str(value or "").split())[:100]


def _md(value) -> str:
    return str(value or "").replace("|", "｜").replace("\n", " ")


def _priority_rank(value: str) -> int:
    return {"P0": 0, "P1": 1, "P2": 2}.get(value, 9)


def main() -> int:
    parser = argparse.ArgumentParser(description="Export Smart Kefu improvement backlog.")
    parser.add_argument("--days", type=argparse_days, default=7)
    parser.add_argument("--limit", type=argparse_limit, default=200)
    args = parser.parse_args()
    print(export_improvement_backlog(days=args.days, limit=args.limit))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
