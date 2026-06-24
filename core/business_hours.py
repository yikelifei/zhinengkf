# -*- coding: utf-8 -*-
"""Business-hours helpers for after-hours customer-service handling."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time
import re

from .customer_profile import load_profile


@dataclass
class BusinessHoursStatus:
    is_open: bool
    working_hours: str
    after_hours_message: str
    reason: str = ""


DEFAULT_WORKING_HOURS = "09:00-18:00"
DEFAULT_AFTER_HOURS_MESSAGE = "您好，当前不在人工客服工作时间。您的需求已记录，人工客服会尽快跟进。"


def business_hours_status(now: datetime | None = None, profile: dict | None = None) -> BusinessHoursStatus:
    profile = profile if profile is not None else load_profile()
    business = profile.get("business") or {}
    working_hours = str(business.get("working_hours") or DEFAULT_WORKING_HOURS).strip()
    after_hours_message = str(business.get("after_hours_message") or DEFAULT_AFTER_HOURS_MESSAGE).strip()
    now = now or datetime.now()
    ranges = parse_working_hours(working_hours)
    if not ranges:
        return BusinessHoursStatus(
            is_open=True,
            working_hours=working_hours,
            after_hours_message=after_hours_message,
            reason="working_hours_unparsed",
        )
    current = now.time()
    is_open = any(_in_range(current, start, end) for start, end in ranges)
    return BusinessHoursStatus(
        is_open=is_open,
        working_hours=working_hours,
        after_hours_message=after_hours_message,
        reason="inside_working_hours" if is_open else "outside_working_hours",
    )


def parse_working_hours(value: str) -> list[tuple[time, time]]:
    ranges: list[tuple[time, time]] = []
    pattern = r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})"
    for match in re.finditer(pattern, str(value or "")):
        start = _parse_clock(match.group(1))
        end = _parse_clock(match.group(2))
        if start and end:
            ranges.append((start, end))
    return ranges


def _parse_clock(value: str) -> time | None:
    match = re.match(r"^(\d{1,2}):(\d{2})$", value)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2))
    if hour > 23 or minute > 59:
        return None
    return time(hour, minute)


def _in_range(current: time, start: time, end: time) -> bool:
    if start <= end:
        return start <= current <= end
    return current >= start or current <= end
