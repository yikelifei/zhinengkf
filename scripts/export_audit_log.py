#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export operation audit events for delivery and support traceability."""

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
from core.redaction import redact_internal_paths  # noqa: E402
from scripts.report_params import argparse_limit, report_limit  # noqa: E402


def format_audit_detail(value) -> str:
    detail = redact_internal_paths(value, project_root=ROOT).replace("|", "/")
    return detail or "-"


def build_audit_log_report(limit=200) -> str:
    limit = report_limit(limit, default=200)
    db = Database(str(ROOT / "data" / "kefu.db"))
    events = db.get_audit_events(limit=limit)
    counter = Counter(event.get("event_type") or "unknown" for event in events)

    lines = [
        "# 智能客服操作审计报告",
        "",
        f"- 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 审计事件数：{len(events)}",
        "",
        "## 事件类型分布",
        "",
    ]

    if counter:
        for event_type, count in counter.most_common():
            lines.append(f"- {event_type}：{count}")
    else:
        lines.append("- 暂无审计事件")

    lines.extend(["", "## 最近操作记录", ""])
    if events:
        lines.append("| 时间 | 类型 | 明细 |")
        lines.append("| --- | --- | --- |")
        for event in events:
            lines.append(
                f"| {event.get('created_at', '-')} | "
                f"{event.get('event_type', '-')} | "
                f"{format_audit_detail(event.get('detail'))} |"
            )
    else:
        lines.append("- 暂无操作记录")

    lines.extend(
        [
            "",
            "## 审计说明",
            "",
            "- 配置保存、知识库和 skills 变更、报告生成、备份创建、人工接管等关键动作会进入审计记录。",
            "- 审计报告用于交付验收、售后排查和客户争议追溯。",
            "- 若审计记录为空，说明系统尚未发生需要追踪的后台操作。",
        ]
    )
    return "\n".join(lines) + "\n"


def export_audit_log(output=None, limit=200) -> Path:
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    if output is None:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = reports_dir / f"audit_log_{stamp}.md"
    else:
        output = Path(output)
    output.write_text(build_audit_log_report(limit=limit), encoding="utf-8")
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description="Export Smart Kefu audit log report")
    parser.add_argument("--output", help="output Markdown path")
    parser.add_argument("--limit", type=argparse_limit, default=200, help="maximum audit events to export")
    args = parser.parse_args(argv)

    output = export_audit_log(args.output, limit=args.limit)
    print(f"Exported audit log: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
