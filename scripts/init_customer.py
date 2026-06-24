#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Initialize customer profile for a new deployment."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

import yaml


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def init_customer(
    company_name,
    assistant_name="小礼",
    industry="企业礼盒定制",
    hotline="",
    owner="",
    path=None,
) -> Path:
    output = Path(path) if path else ROOT / "config" / "customer_profile.yaml"
    output.parent.mkdir(parents=True, exist_ok=True)
    profile = {
        "business": {
            "company_name": company_name,
            "assistant_name": assistant_name,
            "industry": industry,
            "service_scope": [
                "企业节日礼盒",
                "定制包装",
                "LOGO 定制",
                "贺卡、腰封、吊牌、丝带",
                "礼品组合方案",
            ],
            "working_hours": "09:00-18:00",
            "after_hours_message": "您好，当前可能不在人工客服工作时间。您的需求已记录，人工客服会尽快跟进。",
        },
        "sales": {
            "default_owner": owner,
            "hotline": hotline,
            "quote_required_fields": ["用途", "数量", "预算", "使用日期", "收货城市", "联系方式"],
        },
        "brand": {
            "tone": "专业、简洁、自然、可信",
            "forbidden_promises": [
                "保证当天发货",
                "保证最低价",
                "未核价直接给最终报价",
                "未确认排期承诺交期",
            ],
        },
    }
    with open(output, "w", encoding="utf-8") as f:
        yaml.safe_dump(profile, f, allow_unicode=True, sort_keys=False)
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description="Initialize Smart Kefu customer profile")
    parser.add_argument("--company", required=True, help="customer company name")
    parser.add_argument("--assistant", default="小礼", help="assistant display name")
    parser.add_argument("--industry", default="企业礼盒定制", help="customer industry")
    parser.add_argument("--hotline", default="", help="sales/service hotline")
    parser.add_argument("--owner", default="", help="default sales owner")
    parser.add_argument("--output", help="output profile path")
    args = parser.parse_args(argv)

    output = init_customer(
        company_name=args.company,
        assistant_name=args.assistant,
        industry=args.industry,
        hotline=args.hotline,
        owner=args.owner,
        path=args.output,
    )
    print(f"Initialized customer profile: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
