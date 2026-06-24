#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Audit customer-service quality and knowledge gaps."""

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


def _normalize_question(text):
    text = " ".join((text or "").split())
    return text[:80]


def build_quality_audit(days=7, limit=200) -> dict:
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
    source_counter = Counter(m.get("source") or "unknown" for m in outbound)
    intent_counter = Counter(m.get("intent") or "unknown" for m in outbound)

    knowledge_gaps = []
    for msg in inbound:
        question = _normalize_question(msg.get("content", ""))
        if not question:
            continue
        if not match_knowledge(question):
            knowledge_gaps.append(
                {
                    "session_id": msg.get("session_id"),
                    "question": question,
                    "created_at": msg.get("created_at"),
                }
            )

    gap_counter = Counter(item["question"] for item in knowledge_gaps)
    repeated_gaps = [
        {"question": question, "count": count}
        for question, count in gap_counter.most_common(20)
    ]

    total_outbound = len(outbound)
    ai_fallback = sum(count for source, count in source_counter.items() if "ai" in source)
    transfer = sum(count for intent, count in intent_counter.items() if "transfer" in intent)

    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "days": days,
        "message_count": len(messages),
        "inbound_count": len(inbound),
        "outbound_count": total_outbound,
        "ai_fallback_count": ai_fallback,
        "ai_fallback_rate": round(ai_fallback / total_outbound, 4) if total_outbound else 0,
        "transfer_count": transfer,
        "transfer_rate": round(transfer / total_outbound, 4) if total_outbound else 0,
        "reply_sources": dict(source_counter),
        "reply_intents": dict(intent_counter),
        "knowledge_gap_count": len(knowledge_gaps),
        "repeated_knowledge_gaps": repeated_gaps,
        "sample_knowledge_gaps": knowledge_gaps[:20],
    }


def render_markdown(audit: dict) -> str:
    lines = [
        "# 智能客服质检报告",
        "",
        f"- 生成时间：{audit['generated_at']}",
        f"- 统计周期：最近 {audit['days']} 天",
        f"- 客户消息：{audit['inbound_count']}",
        f"- 系统回复：{audit['outbound_count']}",
        f"- AI 兜底次数：{audit['ai_fallback_count']}（{audit['ai_fallback_rate']:.1%}）",
        f"- 转人工次数：{audit['transfer_count']}（{audit['transfer_rate']:.1%}）",
        f"- 知识缺口样本：{audit['knowledge_gap_count']}",
        "",
        "## 回复来源",
        "",
    ]
    if audit["reply_sources"]:
        for source, count in sorted(audit["reply_sources"].items(), key=lambda x: x[1], reverse=True):
            lines.append(f"- {source}：{count}")
    else:
        lines.append("- 暂无回复数据")

    lines.extend(["", "## 高频知识缺口", ""])
    if audit["repeated_knowledge_gaps"]:
        for item in audit["repeated_knowledge_gaps"]:
            lines.append(f"- {item['question']}：{item['count']}")
    else:
        lines.append("- 暂无知识缺口")

    lines.extend(["", "## 知识缺口样本", ""])
    if audit["sample_knowledge_gaps"]:
        for item in audit["sample_knowledge_gaps"]:
            lines.append(f"- [{item['created_at']}] {item['question']}（session: {item['session_id']}）")
    else:
        lines.append("- 暂无样本")

    lines.extend(
        [
            "",
            "## 优化建议",
            "",
            "- 将重复出现的知识缺口补充到 `config/customer_knowledge.yaml`。",
            "- AI 兜底率过高时，优先补关键词和固定话术。",
            "- 转人工率过高时，区分正常风险转人工和知识不足导致的转人工。",
        ]
    )
    return "\n".join(lines) + "\n"


def export_quality_audit(output=None, days=7, limit=200) -> Path:
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    if output is None:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = reports_dir / f"quality_audit_{stamp}.md"
    else:
        output = Path(output)
    output.write_text(render_markdown(build_quality_audit(days=days, limit=limit)), encoding="utf-8")
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description="Export Smart Kefu quality audit")
    parser.add_argument("--output", help="output Markdown path")
    parser.add_argument("--days", type=argparse_days, default=7, help="audit period in days")
    parser.add_argument("--limit", type=argparse_limit, default=200, help="maximum messages to audit")
    args = parser.parse_args(argv)

    output = export_quality_audit(args.output, days=args.days, limit=args.limit)
    print(f"Exported quality audit: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
