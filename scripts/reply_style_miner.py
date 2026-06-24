#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mine human customer-service replies into reusable style samples."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime
from pathlib import Path
import re
import sys

import yaml


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / ".codex_deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.customer_agent import CustomerSupportAgent  # noqa: E402
from core.database import Database  # noqa: E402


def build_reply_style_samples(days: int = 90, limit: int = 300) -> dict:
    """Build paired samples: latest customer message -> human reply."""
    days = max(1, int(days))
    limit = max(1, int(limit))
    db = Database(str(ROOT / "data" / "kefu.db"))
    rows = db.execute(
        """SELECT id, session_id, direction, content, source, intent, created_at
           FROM messages
           WHERE created_at >= datetime('now', ?)
           ORDER BY id ASC
           LIMIT ?""",
        (f"-{days} days", min(limit * 12, 5000)),
    ).fetchall()

    agent = CustomerSupportAgent()
    manual_sources = _manual_sources()
    last_inbound_by_session: dict[str, dict] = {}
    samples: list[dict] = []

    for row in rows:
        message = dict(row)
        session_id = message.get("session_id") or ""
        if message.get("direction") == "inbound":
            last_inbound_by_session[session_id] = message
            continue
        if message.get("direction") != "outbound":
            continue
        source = (message.get("source") or "").strip()
        if source not in manual_sources and not source.startswith("manual"):
            continue
        customer = last_inbound_by_session.get(session_id)
        if not customer:
            continue
        topic = _classify_topic(agent, customer.get("content", ""))
        human_reply = _normalize(message.get("content"))
        if not human_reply:
            continue
        samples.append(
            {
                "session_id": session_id,
                "topic": topic,
                "customer_message": _mask_sensitive(customer.get("content", "")),
                "human_reply": _mask_sensitive(human_reply),
                "reply_length": len(human_reply),
                "style_tags": _style_tags(human_reply),
                "source": source,
                "created_at": message.get("created_at"),
            }
        )
        if len(samples) >= limit:
            break

    topic_counts = Counter(item["topic"] for item in samples)
    tag_counts = Counter(tag for item in samples for tag in item["style_tags"])
    question_count = sum(1 for item in samples if "has_question" in item["style_tags"])
    avg_length = round(sum(item["reply_length"] for item in samples) / len(samples), 1) if samples else 0
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "days": days,
        "manual_sources": sorted(manual_sources),
        "total_pairs": len(samples),
        "avg_reply_length": avg_length,
        "question_rate": round(question_count / len(samples), 4) if samples else 0,
        "topic_counts": dict(topic_counts.most_common()),
        "tag_counts": dict(tag_counts.most_common()),
        "samples": samples,
        "next_actions": _next_actions(samples),
    }


def export_reply_style_samples(days: int = 90, limit: int = 300, output: str | Path | None = None) -> Path:
    report = build_reply_style_samples(days=days, limit=limit)
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    if output:
        path = Path(output)
    else:
        path = reports_dir / f"reply_style_samples_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    path.write_text(render_markdown(report), encoding="utf-8")
    return path


def render_markdown(report: dict) -> str:
    lines = [
        "# 真人客服风格样本报告",
        "",
        f"- 生成时间：{report['generated_at']}",
        f"- 统计周期：近 {report['days']} 天",
        f"- 样本对数：{report['total_pairs']}",
        f"- 平均回复长度：{report['avg_reply_length']} 字",
        f"- 带追问回复占比：{report['question_rate']:.1%}",
        "",
        "## 意图分布",
        "",
        "|意图|样本数|",
        "|---|---:|",
    ]
    if report["topic_counts"]:
        for topic, count in report["topic_counts"].items():
            lines.append(f"|{_md(topic)}|{count}|")
    else:
        lines.append("|暂无|0|")

    lines.extend(["", "## 话术特征", "", "|特征|次数|", "|---|---:|"])
    if report["tag_counts"]:
        for tag, count in report["tag_counts"].items():
            lines.append(f"|{_md(tag)}|{count}|")
    else:
        lines.append("|暂无|0|")

    lines.extend(
        [
            "",
            "## 可沉淀样本",
            "",
            "|时间|意图|客户上一句|真人回复|特征|",
            "|---|---|---|---|---|",
        ]
    )
    for item in report["samples"][:80]:
        lines.append(
            f"|{_md(item.get('created_at') or '-')}|{_md(item['topic'])}|"
            f"{_md(item['customer_message'])}|{_md(item['human_reply'])}|"
            f"{_md('、'.join(item['style_tags']) or '-')}|"
        )
    if not report["samples"]:
        lines.append("|-|暂无|还没有可用的真人回复样本|请先通过人工接管发送几轮高质量回复|-|")

    lines.extend(["", "## 下一步", ""])
    for action in report["next_actions"]:
        lines.append(f"- {action}")
    lines.append("")
    return "\n".join(lines)


def _manual_sources() -> set[str]:
    path = ROOT / "config" / "reply_style.yaml"
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        values = data.get("reply_style", {}).get("manual_sources", [])
    except FileNotFoundError:
        values = []
    return set(values or ["manual"])


def _classify_topic(agent: CustomerSupportAgent, text: str) -> str:
    try:
        decision = agent.analyze(text)
        return decision.topic or "general"
    except Exception:
        return "general"


def _style_tags(reply: str) -> list[str]:
    tags = []
    if re.search(r"[？?]", reply):
        tags.append("has_question")
    if len(reply) <= 90:
        tags.append("concise")
    if any(word in reply for word in ("可以", "收到", "明白", "我先", "我帮您", "给您")):
        tags.append("human_guidance")
    if any(word in reply for word in ("数量", "预算", "使用日期", "收货城市", "电话", "微信")):
        tags.append("lead_collection")
    if any(word in reply for word in ("最终报价", "核价", "按需求", "人工确认")):
        tags.append("safe_boundary")
    if any(word in reply for word in ("来得及", "排期", "加急", "工作日")):
        tags.append("delivery_judgement")
    return tags


def _next_actions(samples: list[dict]) -> list[str]:
    if not samples:
        return [
            "先积累人工接管回复：让真人客服在高意向、复杂报价、设计确认场景里发送标准回复。",
            "积累 50 条以上样本后，再把高质量回复补进知识库或 few-shot 示例。",
            "导入历史聊天记录时先做手机号、微信号等隐私脱敏，再进入训练或评估流程。",
        ]
    return [
        "优先挑选价格、交期、定制、下单流程四类高频样本，沉淀为标准回复示例。",
        "把过长、连续追问、缺少报价边界的人工回复标出来，后续不进入训练集。",
        "保留客户上一句和真人回复成对样本，用于后续微调、RAG 示例库或客服质检评估。",
    ]


def _mask_sensitive(value) -> str:
    text = _normalize(value)
    text = re.sub(r"(?<!\d)(1[3-9]\d{2})\d{4}(\d{4})(?!\d)", r"\1****\2", text)
    text = re.sub(
        r"((?:微信号|微信ID|wechat|vx|VX)[:：\s]*)([A-Za-z][\w\-]{2,19})",
        lambda m: m.group(1) + _mask_token(m.group(2)),
        text,
        flags=re.I,
    )
    return text


def _mask_token(value: str) -> str:
    if len(value) <= 4:
        return "*" * len(value)
    return value[:2] + "*" * max(2, len(value) - 4) + value[-2:]


def _normalize(value) -> str:
    return " ".join(str(value or "").split())


def _md(value) -> str:
    return str(value or "").replace("|", "｜").replace("\n", " ")[:220]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Export human reply style samples.")
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--limit", type=int, default=300)
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    print(export_reply_style_samples(days=args.days, limit=args.limit, output=args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
