#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""导出本地出图提示词任务报表。"""

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
from core.image_prompt_jobs import (  # noqa: E402
    FIELD_LABELS,
    create_image_prompt_job,
    looks_like_image_request,
)
from scripts.report_params import argparse_limit, report_limit  # noqa: E402


SAMPLE_REQUIREMENT = (
    "帮我做一张中秋礼盒朋友圈海报，国潮高端风格，红金配色，"
    "文字写“中秋团圆礼”，需要放企业logo，尺寸1080x1920，"
    "不要卡通人物，注意突出礼盒质感。"
)


def build_image_prompt_jobs(
    limit: int = 100,
    include_all: bool = False,
    include_sample: bool = True,
) -> dict:
    limit = report_limit(limit, default=100)
    db = Database(str(ROOT / "data" / "kefu.db"))
    jobs = []
    scanned = 0
    for lead in db.list_leads(limit=limit):
        scanned += 1
        source_text = lead_source_text(db, lead)
        if not source_text.strip():
            continue
        if not include_all and not looks_like_image_request(source_text):
            continue
        jobs.append(create_image_prompt_job(source_text, lead=lead, status="prompt_ready"))

    jobs.sort(key=lambda item: (len(item.get("missing_fields") or []), item.get("customer") or ""))
    sample_job = None
    if include_sample and not jobs:
        sample_job = create_image_prompt_job(
            SAMPLE_REQUIREMENT,
            lead={"source_type": "example", "session_id": "sample", "company_name": "示例客户"},
            job_id="img_sample",
            status="prompt_ready",
        )

    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "scanned_leads": scanned,
        "total": len(jobs),
        "jobs": jobs,
        "sample_job": sample_job,
        "include_all": include_all,
    }


def render_markdown(report: dict) -> str:
    lines = [
        "# 出图提示词和任务队列",
        "",
        f"- 生成时间：{report['generated_at']}",
        f"- 扫描线索数：{report['scanned_leads']}",
        f"- 本地出图任务数：{report['total']}",
        "- 外部出图软件：未接入，本报表只输出可审计的本地提示词和队列状态。",
        "",
    ]

    jobs = report.get("jobs") or []
    if jobs:
        lines.extend(
            [
                "## 队列概览",
                "",
                "| 任务ID | 状态 | 客户 | 品类 | 场景 | 风格 | 颜色 | 尺寸 | Logo | 待确认 |",
                "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
            ]
        )
        for job in jobs:
            fields = job.get("fields") or {}
            logo = fields.get("logo") or {}
            lines.append(
                "| {job_id} | {status} | {customer} | {category} | {scene} | {style} | "
                "{colors} | {size} | {logo} | {missing} |".format(
                    job_id=md(job.get("job_id")),
                    status=md(job.get("status")),
                    customer=md(job.get("customer")),
                    category=md(fields.get("product_category") or "-"),
                    scene=md(fields.get("scene") or "-"),
                    style=md(join_value(fields.get("style")) or "-"),
                    colors=md(join_value(fields.get("colors")) or "-"),
                    size=md(fields.get("size") or "-"),
                    logo=md(logo.get("note") or "-"),
                    missing=md(missing_labels(job.get("missing_fields") or []) or "-"),
                )
            )
        lines.append("")
        lines.extend(["## 任务明细", ""])
        for job in jobs:
            lines.extend(job_detail_lines(job))
    else:
        lines.extend(
            [
                "## 空状态",
                "",
                "当前本地线索中没有识别到明确的出图需求。可以先在客户需求里记录品类、场景、风格、颜色、文字、Logo、尺寸和禁忌事项。",
                "",
            ]
        )

    sample_job = report.get("sample_job")
    if sample_job:
        lines.extend(["## 示例任务（未入队）", ""])
        lines.extend(job_detail_lines(sample_job))

    return "\n".join(lines).rstrip() + "\n"


def export_image_prompt_jobs(
    output: str | Path | None = None,
    limit: int = 100,
    include_all: bool = False,
    include_sample: bool = True,
) -> Path:
    report = build_image_prompt_jobs(limit=limit, include_all=include_all, include_sample=include_sample)
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    if output is None:
        output = reports_dir / f"image_prompt_jobs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    else:
        output = Path(output)
        output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(render_markdown(report), encoding="utf-8")
    return output


def lead_source_text(db: Database, lead: dict) -> str:
    parts = []
    for label, key in [
        ("品类", "product_category"),
        ("节日/场景", "festival"),
        ("数量", "quantity_estimate"),
        ("预算", "budget"),
        ("备注", "notes"),
    ]:
        value = lead.get(key)
        if value:
            parts.append(f"{label}：{value}")

    session_id = lead.get("session_id")
    if session_id:
        inbound = [
            str(message.get("content") or "")
            for message in db.get_session_messages(session_id, limit=20)
            if message.get("direction") == "inbound" and message.get("content")
        ]
        parts.extend(inbound[-3:])
    return "\n".join(parts)


def job_detail_lines(job: dict) -> list[str]:
    fields = job.get("fields") or {}
    return [
        f"### {job.get('job_id')} - {md(job.get('customer'))}",
        "",
        f"- 状态：{job.get('status')}",
        f"- 会话：{job.get('session_id') or '-'}",
        f"- 待确认字段：{missing_labels(job.get('missing_fields') or []) or '-'}",
        f"- 禁忌/注意事项：{join_value(fields.get('restrictions')) or '-'}",
        f"- 修改意见：{join_value(fields.get('revision_notes')) or '-'}",
        "",
        "```text",
        job.get("prompt") or "",
        "```",
        "",
    ]


def missing_labels(fields: list[str]) -> str:
    return "、".join(FIELD_LABELS.get(field, field) for field in fields)


def join_value(value) -> str:
    if isinstance(value, list):
        return " / ".join(str(item) for item in value if str(item).strip())
    return str(value or "")


def md(value) -> str:
    return str(value or "").replace("|", "\\|").replace("\n", " ")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Export local image prompt jobs.")
    parser.add_argument("--output", help="output Markdown path")
    parser.add_argument("--limit", type=argparse_limit, default=100)
    parser.add_argument("--include-all", action="store_true", help="include leads even when image intent is weak")
    parser.add_argument("--no-sample", action="store_true", help="do not include a sample prompt when the queue is empty")
    args = parser.parse_args(argv)

    output = export_image_prompt_jobs(
        output=args.output,
        limit=args.limit,
        include_all=args.include_all,
        include_sample=not args.no_sample,
    )
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
