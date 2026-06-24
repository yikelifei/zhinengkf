#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export an operating report for owners and sales follow-up."""

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


def _fmt(value):
    if value is None:
        return "-"
    return str(value)


def build_report(days=7, limit=20) -> str:
    db = Database(str(ROOT / "data" / "kefu.db"))
    lead_metrics = db.get_lead_metrics()
    stage_metrics = db.get_stage_metrics()
    daily_metrics = db.get_daily_metrics(days=days)
    followups = db.get_followup_leads(limit=limit)

    lines = [
        "# 智能客服运营报告",
        "",
        f"- 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 统计周期：最近 {days} 天",
        "",
        "## 线索总览",
        "",
        f"- 线索总数：{int(lead_metrics.get('total') or 0)}",
        f"- 高意向线索：{int(lead_metrics.get('high_intent') or 0)}",
        f"- 已成交：{int(lead_metrics.get('won') or 0)}",
        f"- 已流失：{int(lead_metrics.get('lost') or 0)}",
        f"- 平均意向分：{round(float(lead_metrics.get('avg_score') or 0), 1)}",
        "",
        "## 阶段分布",
        "",
    ]

    if stage_metrics:
        for row in stage_metrics:
            stage = _fmt(row.get("stage"))
            lines.append(f"- {stage_label(stage)}（{stage}）：{row.get('count', 0)}")
    else:
        lines.append("- 暂无线索阶段数据")

    lines.extend(["", "## 最近消息量", ""])
    if daily_metrics:
        lines.append("| 日期 | 客户消息 | 系统回复 | 活跃会话 |")
        lines.append("| --- | ---: | ---: | ---: |")
        for row in daily_metrics:
            lines.append(
                f"| {_fmt(row.get('day'))} | "
                f"{int(row.get('inbound_messages') or 0)} | "
                f"{int(row.get('outbound_messages') or 0)} | "
                f"{int(row.get('active_sessions') or 0)} |"
            )
    else:
        lines.append("- 暂无消息数据")

    lines.extend(["", "## 待跟进线索", ""])
    if followups:
        lines.append("| 客户/公司 | 联系人 | 电话 | 数量 | 预算 | 日期 | 城市 | 意向分 | 下一步 |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- | ---: | --- |")
        for lead in followups:
            lines.append(
                f"| {_fmt(lead.get('company_name') or lead.get('session_id'))} | "
                f"{_fmt(lead.get('contact_person'))} | "
                f"{_fmt(lead.get('phone') or lead.get('wechat_id'))} | "
                f"{_fmt(lead.get('quantity_estimate'))} | "
                f"{_fmt(lead.get('budget'))} | "
                f"{_fmt(lead.get('due_date'))} | "
                f"{_fmt(lead.get('city'))} | "
                f"{int(lead.get('lead_score') or 0)} | "
                f"{_fmt(lead.get('next_action'))} |"
            )
    else:
        lines.append("- 暂无待跟进线索")

    lines.extend(
        [
            "",
            "## 建议动作",
            "",
            "- 优先跟进高意向且缺少下一步动作的客户。",
            "- 对未成交或流失客户补充原因，反哺知识库和话术。",
            "- 每周复盘高频未命中问题，补充到知识库或 skills。",
        ]
    )
    return "\n".join(lines) + "\n"


def export_report(output=None, days=7, limit=20) -> Path:
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    if output is None:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = reports_dir / f"operation_report_{stamp}.md"
    else:
        output = Path(output)
    output.write_text(build_report(days=days, limit=limit), encoding="utf-8")
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description="Export Smart Kefu operating report")
    parser.add_argument("--output", help="output Markdown path")
    parser.add_argument("--days", type=int, default=7, help="report period in days")
    parser.add_argument("--limit", type=int, default=20, help="follow-up lead limit")
    args = parser.parse_args(argv)

    output = export_report(args.output, days=args.days, limit=args.limit)
    print(f"Exported report: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
