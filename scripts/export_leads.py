#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export CRM leads to CSV for sales follow-up."""

from __future__ import annotations

import argparse
import csv
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


EXPORT_FIELDS = [
    "id",
    "session_id",
    "company_name",
    "contact_person",
    "phone",
    "wechat_id",
    "festival",
    "product_category",
    "quantity_estimate",
    "budget",
    "due_date",
    "city",
    "source",
    "lead_score",
    "stage",
    "owner",
    "next_action",
    "deal_value",
    "lost_reason",
    "notes",
    "created_at",
    "updated_at",
]


def export_leads(output=None, limit=1000) -> Path:
    output_dir = ROOT / "exports"
    output_dir.mkdir(exist_ok=True)
    if output is None:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = output_dir / f"leads_{stamp}.csv"
    else:
        output = Path(output)

    leads = Database(str(ROOT / "data" / "kefu.db")).list_leads(limit=limit)
    with open(output, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=EXPORT_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for lead in leads:
            writer.writerow(lead)
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description="Export Smart Kefu leads to CSV")
    parser.add_argument("--output", help="output CSV path")
    parser.add_argument("--limit", type=int, default=1000, help="maximum leads to export")
    args = parser.parse_args(argv)

    output = export_leads(args.output, args.limit)
    print(f"Exported leads: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
