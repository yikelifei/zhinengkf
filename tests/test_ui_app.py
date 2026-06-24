from scripts.ui_app import (
    parse_max_tokens,
    parse_positive_pid,
    parse_temperature,
    read_lock_pid,
)


def test_parse_positive_pid_accepts_only_positive_integer_text():
    assert parse_positive_pid("1234") == 1234
    assert parse_positive_pid("  56  ") == 56
    assert parse_positive_pid("0") is None
    assert parse_positive_pid("-1") is None
    assert parse_positive_pid("1; Stop-Process -Name smart_bot") is None
    assert parse_positive_pid("") is None


def test_read_lock_pid_ignores_missing_or_malformed_lock_files(tmp_path):
    missing = tmp_path / ".smart_bot_console.lock"
    assert read_lock_pid(missing) is None

    missing.write_text("not-a-pid", encoding="utf-8")
    assert read_lock_pid(missing) is None

    missing.write_text("9012", encoding="utf-8")
    assert read_lock_pid(missing) == 9012


def test_parse_provider_numeric_fields_use_defaults_and_bounds():
    assert parse_temperature("") == 0.4
    assert parse_temperature("0") == 0
    assert parse_temperature("2") == 2
    assert parse_temperature("0.8") == 0.8

    assert parse_max_tokens("") == 800
    assert parse_max_tokens("1") == 1
    assert parse_max_tokens("1600") == 1600


def test_parse_provider_numeric_fields_reject_invalid_values():
    for value in ("abc", "-0.1", "2.1"):
        try:
            parse_temperature(value)
        except ValueError:
            pass
        else:
            raise AssertionError(f"temperature value should be rejected: {value}")

    for value in ("abc", "0", "-1", "1.5"):
        try:
            parse_max_tokens(value)
        except ValueError:
            pass
        else:
            raise AssertionError(f"max_tokens value should be rejected: {value}")
