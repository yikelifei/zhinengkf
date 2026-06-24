#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared validation for report and audit numeric parameters."""

from __future__ import annotations


MAX_REPORT_DAYS = 3650
MAX_REPORT_LIMIT = 1000


def positive_int(
    value,
    name: str,
    default: int,
    *,
    min_value: int = 1,
    max_value: int = MAX_REPORT_LIMIT,
) -> int:
    if value is None or value == "":
        number = default
    else:
        try:
            number = int(value)
        except (TypeError, ValueError):
            raise ValueError(f"{name} must be an integer") from None
    if number < min_value or number > max_value:
        raise ValueError(f"{name} must be between {min_value} and {max_value}")
    return number


def report_limit(value, default: int = 100) -> int:
    return positive_int(value, "limit", default, max_value=MAX_REPORT_LIMIT)


def report_days(value, default: int = 7) -> int:
    return positive_int(value, "days", default, max_value=MAX_REPORT_DAYS)


def argparse_limit(value: str) -> int:
    return report_limit(value)


def argparse_days(value: str) -> int:
    return report_days(value)
