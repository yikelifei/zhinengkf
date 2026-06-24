#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export answer guardrail audit report."""

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

from core.answer_guard import AnswerGuard  # noqa: E402


def build_answer_guard_audit() -> dict:
    guard = AnswerGuard()
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "forbidden_phrases": guard.forbidden_phrases,
        "samples": guard.audit_samples(),
    }


def export_answer_guard_audit() -> Path:
    report = build_answer_guard_audit()
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    path = reports_dir / f"answer_guard_audit_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    lines = [
        "# 回复安全护栏审计报告",
        "",
        f"- 生成时间：{report['generated_at']}",
        f"- 禁用承诺数量：{len(report['forbidden_phrases'])}",
        "",
        "## 禁用承诺",
        "",
    ]
    lines.extend(f"- {item}" for item in report["forbidden_phrases"])
    lines.extend(["", "## 样本检查", "", "|输入|输出|结果|", "|---|---|---|"])
    for item in report["samples"]:
        status = "已拦截" if item["changed"] else "通过"
        lines.append(f"|{_md(item['input'])}|{_md(item['output'])}|{status}|")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def _md(value) -> str:
    return str(value or "").replace("|", "｜").replace("\n", " ")


def main() -> int:
    parser = argparse.ArgumentParser(description="Export answer guardrail audit report.")
    parser.parse_args()
    print(export_answer_guard_audit())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
