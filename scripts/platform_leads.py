#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate a Markdown report for manually captured platform leads."""

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

from core.platform_leads import (  # noqa: E402
    DEFAULT_DATA_PATH,
    PlatformLeadStore,
    build_platform_report,
    render_platform_report,
)


def export_platform_leads_report(
    data_path: str | Path | None = None,
    output: str | Path | None = None,
    limit: int = 200,
    include_samples_when_empty: bool = True,
) -> Path:
    """Write the platform lead capture report and return its path."""
    store = PlatformLeadStore(Path(data_path) if data_path else DEFAULT_DATA_PATH)
    report = build_platform_report(
        store,
        limit=limit,
        include_samples_when_empty=include_samples_when_empty,
    )
    if output is None:
        reports_dir = ROOT / "reports"
        reports_dir.mkdir(exist_ok=True)
        output = reports_dir / f"platform_leads_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    else:
        output = Path(output)
        output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(render_platform_report(report), encoding="utf-8")
    return output


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate a local Markdown report for manually captured platform leads."
    )
    parser.add_argument(
        "--data",
        default=str(DEFAULT_DATA_PATH),
        help="platform lead JSON data path",
    )
    parser.add_argument("--output", help="output Markdown path")
    parser.add_argument("--limit", type=int, default=200, help="maximum leads to show")
    parser.add_argument(
        "--no-samples",
        action="store_true",
        help="do not render sample rows when the data file has no leads",
    )
    args = parser.parse_args(argv)

    output = export_platform_leads_report(
        data_path=args.data,
        output=args.output,
        limit=args.limit,
        include_samples_when_empty=not args.no_samples,
    )
    print(f"Platform lead report: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
