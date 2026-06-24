#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export business-hours and after-hours handling audit report."""

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

from core.business_hours import business_hours_status, parse_working_hours  # noqa: E402
from core.customer_profile import load_profile  # noqa: E402


def build_business_hours_audit(now: datetime | None = None) -> dict:
    profile = load_profile()
    status = business_hours_status(now=now, profile=profile)
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "is_open": status.is_open,
        "working_hours": status.working_hours,
        "after_hours_message": status.after_hours_message,
        "reason": status.reason,
        "parsed_ranges": [
            {"start": start.strftime("%H:%M"), "end": end.strftime("%H:%M")}
            for start, end in parse_working_hours(status.working_hours)
        ],
    }


def export_business_hours_audit() -> Path:
    report = build_business_hours_audit()
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    path = reports_dir / f"business_hours_audit_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    lines = [
        "# 非工作时间兜底审计报告",
        "",
        f"- 生成时间：{report['generated_at']}",
        f"- 当前状态：{'工作时间内' if report['is_open'] else '非工作时间'}",
        f"- 工作时间：{report['working_hours']}",
        f"- 判断原因：{report['reason']}",
        "",
        "## 非工作时间回复",
        "",
        report["after_hours_message"],
        "",
        "## 已解析时间段",
        "",
    ]
    if report["parsed_ranges"]:
        lines.extend(f"- {item['start']}-{item['end']}" for item in report["parsed_ranges"])
    else:
        lines.append("- 未解析到有效时间段，系统会按工作时间内处理，避免误伤客户咨询。")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="Export after-hours audit report.")
    parser.parse_args()
    print(export_business_hours_audit())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
