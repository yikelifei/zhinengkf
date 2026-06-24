from scripts.web_console import (
    ConsoleHandler,
    ROOT,
    file_summary,
    generate_report_file,
    public_audit_events,
    parse_int_param,
    redact_provider_config,
    redact_settings_for_response,
    report_response,
    send_manual_reply,
    lock_manual_conversation,
    unlock_manual_conversation,
)
from core.database import Database


def test_provider_response_never_exposes_raw_api_key():
    result = redact_provider_config(
        {
            "enabled": True,
            "api_key": "sk-live-secret-1234567890",
            "base_url": "https://example.com/v1",
            "model": "demo-model",
        }
    )

    assert result["api_key"] == ""
    assert result["api_key_masked"] == "sk-l...7890"
    assert "sk-live-secret-1234567890" not in str(result)


def test_settings_response_redacts_nested_provider_keys():
    settings = {
        "ai_engine": {
            "primary": "geeknow",
            "providers": {
                "geeknow": {"api_key": "sk-secret-geeknow-0000", "model": "m1"},
                "backup": {"api_key": "${BACKUP_API_KEY}", "model": "m2"},
            },
        }
    }

    result = redact_settings_for_response(settings)

    providers = result["ai_engine"]["providers"]
    assert providers["geeknow"]["api_key"] == ""
    assert providers["backup"]["api_key"] == ""
    assert providers["geeknow"]["api_key_masked"] == "sk-s...0000"
    assert providers["backup"]["api_key_masked"] == "${BACKUP_API_KEY}"
    assert "sk-secret-geeknow-0000" not in str(result)


def test_file_summary_does_not_expose_local_path(tmp_path):
    report = tmp_path / "quality.md"
    report.write_text("ok", encoding="utf-8")

    result = file_summary(report, "reports")

    assert result == {
        "name": "quality.md",
        "url": "/reports/quality.md",
        "size": 2,
        "updated_at": result["updated_at"],
    }
    assert "path" not in result
    assert str(tmp_path) not in str(result)


def test_backup_summary_does_not_expose_download_url(tmp_path):
    backup = tmp_path / "smart_kefu_20260101_000000_web.zip"
    backup.write_bytes(b"zip")

    result = file_summary(backup, "backups", expose_url=False)

    assert result["name"] == "smart_kefu_20260101_000000_web.zip"
    assert result["size"] == 3
    assert "url" not in result
    assert "path" not in result
    assert str(tmp_path) not in str(result)


def test_report_http_response_uses_public_file_contract(tmp_path):
    report = tmp_path / "quality.md"
    report.write_text("ok", encoding="utf-8")

    result = report_response(
        {
            "ok": True,
            "type": "quality",
            "label": "质检报告",
            "path": str(report),
        }
    )

    assert result["ok"] is True
    assert result["label"] == "质检报告"
    assert result["file"]["url"] == "/reports/quality.md"
    assert "path" not in result
    assert str(tmp_path) not in str(result)


def test_public_audit_events_redact_local_paths():
    events = [
        {
            "id": 1,
            "event_type": "report_generate",
            "detail": r"质检报告: C:\Users\27808\Desktop\zhinengkefu\reports\quality.md",
            "created_at": "2026-01-01 10:00:00",
        }
    ]

    result = public_audit_events(events)

    assert result[0]["event_type"] == "report_generate"
    assert "C:\\Users\\" not in result[0]["detail"]
    assert "zhinengkefu" not in result[0]["detail"]


def test_parse_int_param_uses_default_and_accepts_bounds():
    assert parse_int_param(None, "limit", 20) == 20
    assert parse_int_param("", "limit", 20) == 20
    assert parse_int_param("1", "limit", 20, min_value=1, max_value=10) == 1
    assert parse_int_param("10", "limit", 20, min_value=1, max_value=10) == 10


def test_parse_int_param_rejects_invalid_or_out_of_range_values():
    for value in ("abc", "1.5", 0, -1, 11):
        try:
            parse_int_param(value, "limit", 20, min_value=1, max_value=10)
        except ValueError as exc:
            assert "limit" in str(exc)
        else:
            raise AssertionError(f"parse_int_param accepted {value!r}")


def test_send_manual_reply_saves_message_and_locks_even_if_seen_marker_fails(tmp_path):
    db = Database(str(tmp_path / "kefu.db"))
    session_id = db.create_or_get_session("客户A")

    import core.wechat as wechat

    original = wechat.ChatListener
    sent = []

    class FakeListener:
        def send(self, text, who):
            sent.append((who, text))
            return True

        def mark_outgoing_seen(self, friend_name, text):
            raise RuntimeError("cache unavailable")

    wechat.ChatListener = FakeListener
    try:
        result = send_manual_reply(db, {"session_id": session_id, "text": "您好，报价稍后发您。"})
    finally:
        wechat.ChatListener = original

    assert result["ok"] is True
    assert sent == [("客户A", "您好，报价稍后发您。")]
    messages = db.get_session_messages(session_id)
    assert messages[-1]["direction"] == "outbound"
    assert messages[-1]["source"] == "manual"
    assert db.get_conversation_lock(session_id)["manual_lock_reason"] == "manual_send"


def test_send_manual_reply_rejects_missing_session_without_wechat(tmp_path):
    db = Database(str(tmp_path / "kefu.db"))

    try:
        send_manual_reply(db, {"session_id": "missing", "text": "hello"})
    except ValueError as exc:
        assert "未找到会话" in str(exc)
    else:
        raise AssertionError("send_manual_reply accepted missing session")


def test_manual_lock_requires_existing_session(tmp_path):
    db = Database(str(tmp_path / "kefu.db"))

    try:
        lock_manual_conversation(db, {"session_id": "missing", "minutes": 10})
    except ValueError as exc:
        assert "未找到会话" in str(exc)
    else:
        raise AssertionError("lock_manual_conversation accepted missing session")


def test_manual_lock_rejects_invalid_minutes(tmp_path):
    db = Database(str(tmp_path / "kefu.db"))
    session_id = db.create_or_get_session("客户B")

    for minutes in (0, -1, 1441):
        try:
            lock_manual_conversation(db, {"session_id": session_id, "minutes": minutes})
        except ValueError as exc:
            assert "锁定时长" in str(exc)
        else:
            raise AssertionError(f"lock_manual_conversation accepted minutes={minutes}")


def test_manual_lock_and_unlock_update_database(tmp_path):
    db = Database(str(tmp_path / "kefu.db"))
    session_id = db.create_or_get_session("客户C")

    locked = lock_manual_conversation(db, {"session_id": session_id, "minutes": 5, "reason": "test"})
    assert locked["ok"] is True
    assert db.get_conversation_lock(session_id)["manual_lock_reason"] == "test"

    unlocked = unlock_manual_conversation(db, {"session_id": session_id})
    assert unlocked["ok"] is True
    assert db.get_conversation_lock(session_id) is None


def test_static_file_whitelist_blocks_private_project_files():
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    report = reports_dir / "_web_console_static_contract_test.md"
    archive = reports_dir / "_web_console_static_contract_test.zip"
    report.write_text("ok", encoding="utf-8")
    archive.write_bytes(b"zip")
    assert ConsoleHandler._is_allowed_static_path("/docs/web_console.js") is True
    try:
        assert ConsoleHandler._is_allowed_static_path("/config/settings.yaml") is False
        assert ConsoleHandler._is_allowed_static_path("/data/kefu.db") is False
        assert ConsoleHandler._is_allowed_static_path("/scripts/web_console.py") is False
        assert ConsoleHandler._is_allowed_static_path("/backups/smart_kefu_sensitive.zip") is False
        assert ConsoleHandler._is_allowed_static_path("/exports/leads.csv") is False
        assert ConsoleHandler._is_allowed_static_path("/reports/_web_console_static_contract_test.md") is True
        assert ConsoleHandler._is_allowed_static_path("/reports/_web_console_static_contract_test.zip") is False
        assert ConsoleHandler._is_allowed_static_path("/reports/archive/old.md") is False
        assert ConsoleHandler._is_allowed_static_path("/.git/config") is False
        assert ConsoleHandler._is_allowed_static_path("/docs/../config/settings.yaml") is False
        assert ConsoleHandler._is_allowed_static_path("/docs/%2E%2E/config/settings.yaml") is False
    finally:
        report.unlink(missing_ok=True)
        archive.unlink(missing_ok=True)
