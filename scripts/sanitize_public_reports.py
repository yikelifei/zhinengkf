#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Redact local machine paths from publicly downloadable report files."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / ".codex_deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.redaction import redact_internal_paths  # noqa: E402


PUBLIC_REPORT_SUFFIXES = {".md", ".csv", ".json"}


def sanitize_report_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8-sig")
    redacted = redact_internal_paths(text, project_root=ROOT)
    if redacted == text:
        return False
    path.write_text(redacted, encoding="utf-8")
    return True


def sanitize_public_reports(reports_dir: Path | None = None) -> dict:
    reports_dir = reports_dir or ROOT / "reports"
    result = {"scanned": 0, "changed": 0, "skipped": 0}
    if not reports_dir.exists():
        return result

    for path in sorted(reports_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in PUBLIC_REPORT_SUFFIXES:
            result["skipped"] += 1
            continue
        result["scanned"] += 1
        try:
            if sanitize_report_file(path):
                result["changed"] += 1
        except UnicodeDecodeError:
            result["skipped"] += 1
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Sanitize public report files.")
    parser.add_argument("--reports-dir", help="optional reports directory")
    args = parser.parse_args(argv)

    reports_dir = Path(args.reports_dir) if args.reports_dir else None
    result = sanitize_public_reports(reports_dir)
    print(
        "Sanitized public reports: "
        f"scanned={result['scanned']}, changed={result['changed']}, skipped={result['skipped']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
