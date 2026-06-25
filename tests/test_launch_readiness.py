import scripts.check_launch_readiness as readiness


def run_ai_check_with_settings(settings):
    original = readiness.load_settings
    try:
        readiness.load_settings = lambda: settings
        items = []
        readiness._check_ai(items)
        return items
    finally:
        readiness.load_settings = original


def test_launch_readiness_reports_malformed_ai_engine_without_crashing():
    items = run_ai_check_with_settings({"ai_engine": "broken"})

    assert items
    assert items[0]["severity"] == "blocker"
    assert "ai_engine" in items[0]["message"]


def test_launch_readiness_reports_malformed_providers_without_crashing():
    items = run_ai_check_with_settings({"ai_engine": {"providers": "broken"}})

    assert items
    assert items[0]["severity"] == "blocker"
    assert "providers" in items[0]["message"]


def test_launch_readiness_reports_malformed_primary_provider():
    items = run_ai_check_with_settings(
        {
            "ai_engine": {
                "enabled": True,
                "primary": "geeknow",
                "providers": {"geeknow": "broken"},
            }
        }
    )

    assert any(item["severity"] == "blocker" and "geeknow" in item["message"] for item in items)
