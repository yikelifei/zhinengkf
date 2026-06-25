from scripts.health_check import check_ai_settings


class SilentResult:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.warnings = 0
        self.messages = []

    def ok(self, message):
        self.passed += 1
        self.messages.append(("ok", message))

    def warn(self, message):
        self.warnings += 1
        self.messages.append(("warn", message))

    def fail(self, message):
        self.failed += 1
        self.messages.append(("fail", message))


def no_provider_issues(provider):
    return []


def test_health_check_reports_malformed_ai_engine_without_crashing():
    result = SilentResult()

    check_ai_settings(result, {"ai_engine": "broken"}, no_provider_issues)

    assert result.failed == 1
    assert result.warnings == 0


def test_health_check_reports_malformed_providers_without_crashing():
    result = SilentResult()

    check_ai_settings(result, {"ai_engine": {"providers": "broken"}}, no_provider_issues)

    assert result.failed == 1
    assert result.warnings == 0


def test_health_check_skips_malformed_provider_entries_and_keeps_valid_enabled_provider():
    result = SilentResult()

    check_ai_settings(
        result,
        {
            "ai_engine": {
                "primary": "ok",
                "providers": {
                    "broken": "bad",
                    "ok": {"enabled": True, "api_key": "k", "base_url": "https://example.com", "model": "m"},
                },
            }
        },
        no_provider_issues,
    )

    assert result.failed == 1
    assert result.passed == 1
