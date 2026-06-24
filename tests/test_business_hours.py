from datetime import datetime, time

from core.business_hours import business_hours_status, parse_working_hours


def test_parse_working_hours_accepts_spaces_around_dash():
    assert parse_working_hours("09:00 - 18:00") == [(time(9, 0), time(18, 0))]


def test_parse_working_hours_accepts_multiple_ranges_with_common_separators():
    assert parse_working_hours("09:00-12:00，13:30 - 18:00") == [
        (time(9, 0), time(12, 0)),
        (time(13, 30), time(18, 0)),
    ]


def test_business_hours_status_uses_spaced_range_for_after_hours_decision():
    profile = {
        "business": {
            "working_hours": "09:00 - 18:00",
            "after_hours_message": "请留言",
        }
    }

    closed = business_hours_status(now=datetime(2026, 6, 25, 20, 0), profile=profile)
    open_now = business_hours_status(now=datetime(2026, 6, 25, 10, 0), profile=profile)

    assert closed.is_open is False
    assert closed.reason == "outside_working_hours"
    assert open_now.is_open is True
    assert open_now.reason == "inside_working_hours"


def test_business_hours_status_supports_overnight_ranges():
    profile = {"business": {"working_hours": "22:00 - 02:00"}}

    assert business_hours_status(now=datetime(2026, 6, 25, 23, 0), profile=profile).is_open is True
    assert business_hours_status(now=datetime(2026, 6, 26, 1, 30), profile=profile).is_open is True
    assert business_hours_status(now=datetime(2026, 6, 26, 15, 0), profile=profile).is_open is False


def test_business_hours_status_fails_open_for_unparsed_config():
    profile = {"business": {"working_hours": "全天人工在线"}}
    status = business_hours_status(now=datetime(2026, 6, 25, 20, 0), profile=profile)

    assert status.is_open is True
    assert status.reason == "working_hours_unparsed"
