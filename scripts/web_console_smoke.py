#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Smoke-test the local web console data builders and report generators."""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / ".codex_deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.database import Database  # noqa: E402
from scripts.web_console import api_channels, api_status, generate_report_file  # noqa: E402
from scripts.followup_reminders import build_followup_tasks  # noqa: E402
from scripts.handoff_queue import build_handoff_queue  # noqa: E402
from scripts.high_value_leads import build_high_value_leads  # noqa: E402
from scripts.improvement_backlog import build_improvement_backlog  # noqa: E402
from scripts.quote_readiness import build_quote_readiness  # noqa: E402
from scripts.ui_contract_check import run as run_ui_contract_check  # noqa: E402
from scripts.web_console_http_smoke import run as run_web_console_http_smoke  # noqa: E402


REPORT_TYPES = [
    "readiness",
    "followups",
    "high_value_leads",
    "handoff",
    "quote_readiness",
    "improvement_backlog",
    "order_handoff",
    "privacy_audit",
    "audit",
]


def main() -> int:
    db = Database(str(ROOT / "data" / "kefu.db"))
    status = api_status(db)
    assert status.get("ok") is True
    channels = api_channels()
    channel_ids = {item["channel_id"] for item in channels.get("channels", [])}
    assert "wechat" in channel_ids
    assert {"xiaohongshu", "pinduoduo", "taobao", "douyin", "kuaishou"}.issubset(
        channel_ids
    )

    checks = {
        "high_value": build_high_value_leads(limit=20),
        "followups": build_followup_tasks(limit=20),
        "handoff": build_handoff_queue(limit=20),
        "quote": build_quote_readiness(limit=20),
        "backlog": build_improvement_backlog(days=7, limit=20),
    }
    assert isinstance(checks["high_value"].get("items"), list)
    assert isinstance(checks["followups"], list)
    assert isinstance(checks["handoff"], list)
    assert isinstance(checks["quote"].get("items"), list)
    assert isinstance(checks["backlog"].get("items"), list)

    for report_type in REPORT_TYPES:
        result = generate_report_file({"type": report_type, "limit": 20, "days": 7})
        path = Path(result["path"])
        assert path.exists(), f"missing report: {path}"
        assert path.stat().st_size > 0, f"empty report: {path}"

    contract_issues = run_ui_contract_check()
    assert not contract_issues, "\n".join(contract_issues)

    http_issues = run_web_console_http_smoke()
    assert not http_issues, "\n".join(http_issues)

    js_path = ROOT / "docs" / "web_console.js"
    node = _node_executable()
    if node:
        result = subprocess.run(
            [node, "--check", str(js_path)],
            cwd=str(ROOT),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        assert result.returncode == 0, result.stderr or result.stdout

    print("Web console smoke passed.")
    return 0


def _node_executable() -> str:
    for command in ("node", "node.exe"):
        try:
            result = subprocess.run(
                [command, "--version"],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            if result.returncode == 0:
                return command
        except Exception:
            continue
    return ""


if __name__ == "__main__":
    raise SystemExit(main())
