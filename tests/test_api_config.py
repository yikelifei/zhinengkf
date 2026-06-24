import yaml

from core.api_config import (
    ensure_provider,
    load_settings,
    parse_max_tokens,
    parse_temperature,
    save_settings,
    update_provider,
    test_openai_compatible_provider as check_openai_compatible_provider,
    validate_provider_config,
)


def test_ensure_geeknow_provider_defaults():
    settings = {"ai_engine": {"providers": {}}}
    provider = ensure_provider(settings, "geeknow")

    assert provider["base_url"] == "https://api.geeknow.ai/v1"
    assert provider["model"] == "gpt-4o-mini"
    assert provider["request_format"] == "openai"


def test_save_settings_creates_backup(tmp_path):
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    settings_path = config_dir / "settings.yaml"
    settings_path.write_text("ai_engine:\n  enabled: true\n", encoding="utf-8")

    save_settings({"ai_engine": {"enabled": False}}, path=str(settings_path))

    backups = list((config_dir / "backups").glob("settings_*.yaml"))
    assert len(backups) == 1
    assert yaml.safe_load(settings_path.read_text(encoding="utf-8"))["ai_engine"]["enabled"] is False


def test_save_settings_creates_missing_parent_directories(tmp_path):
    settings_path = tmp_path / "tenant_a" / "config" / "settings.yaml"

    save_settings({"ai_engine": {"enabled": True}}, path=str(settings_path))

    assert settings_path.exists()
    assert (settings_path.parent / "backups").exists()
    assert yaml.safe_load(settings_path.read_text(encoding="utf-8"))["ai_engine"]["enabled"] is True


def test_load_settings_treats_malformed_yaml_as_empty(tmp_path):
    settings_path = tmp_path / "settings.yaml"
    settings_path.write_text("ai_engine: [broken\n", encoding="utf-8")

    assert load_settings(path=str(settings_path)) == {}


def test_load_settings_treats_malformed_root_as_empty(tmp_path):
    settings_path = tmp_path / "settings.yaml"
    settings_path.write_text("- broken\n", encoding="utf-8")

    assert load_settings(path=str(settings_path)) == {}


def test_ensure_provider_recovers_malformed_ai_engine_and_provider():
    settings = {"ai_engine": {"providers": {"geeknow": "broken"}}}

    provider = ensure_provider(settings, "geeknow")

    assert settings["ai_engine"]["providers"]["geeknow"] is provider
    assert provider["base_url"] == "https://api.geeknow.ai/v1"
    assert provider["enabled"] is False


def test_update_provider_sets_primary(tmp_path):
    settings_path = tmp_path / "settings.yaml"
    settings_path.write_text(
        yaml.safe_dump({"ai_engine": {"primary": "openai", "fallback_chain": ["geeknow"], "providers": {}}}),
        encoding="utf-8",
    )

    update_provider(
        "geeknow",
        enabled=True,
        api_key="${GEEKNOW_API_KEY}",
        base_url="https://api.geeknow.ai/v1",
        model="gpt-4o-mini",
        temperature=0.4,
        max_tokens=800,
        set_primary=True,
        path=str(settings_path),
    )

    settings = load_settings(path=str(settings_path))
    assert settings["ai_engine"]["primary"] == "geeknow"
    assert "geeknow" not in settings["ai_engine"]["fallback_chain"]
    assert settings["ai_engine"]["providers"]["geeknow"]["enabled"] is True


def test_update_provider_recovers_malformed_settings_shape(tmp_path):
    settings_path = tmp_path / "settings.yaml"
    settings_path.write_text(
        yaml.safe_dump({"ai_engine": "broken"}, allow_unicode=True),
        encoding="utf-8",
    )

    settings = update_provider(
        "geeknow",
        enabled=True,
        api_key="sk-test",
        base_url="https://api.geeknow.ai/v1/",
        model="gpt-4o-mini",
        temperature=0.4,
        max_tokens=800,
        set_primary=True,
        path=str(settings_path),
    )

    assert settings["ai_engine"]["primary"] == "geeknow"
    assert settings["ai_engine"]["fallback_chain"] == []
    assert settings["ai_engine"]["providers"]["geeknow"]["base_url"] == "https://api.geeknow.ai/v1"


def test_update_provider_rejects_invalid_numeric_values(tmp_path):
    settings_path = tmp_path / "settings.yaml"
    settings_path.write_text(
        yaml.safe_dump({"ai_engine": {"primary": "openai", "fallback_chain": [], "providers": {}}}),
        encoding="utf-8",
    )

    for field, value in (("temperature", "2.5"), ("max_tokens", "0"), ("max_tokens", "1.5")):
        kwargs = {
            "enabled": True,
            "api_key": "sk-test",
            "base_url": "https://api.geeknow.ai/v1",
            "model": "gpt-4o-mini",
            "temperature": 0.4,
            "max_tokens": 800,
            "path": str(settings_path),
        }
        kwargs[field] = value
        try:
            update_provider("geeknow", **kwargs)
        except ValueError:
            pass
        else:
            raise AssertionError(f"update_provider accepted invalid {field}: {value}")


def test_provider_numeric_parsers_use_defaults_and_reject_bad_values():
    assert parse_temperature("") == 0.4
    assert parse_temperature("2") == 2
    assert parse_max_tokens("") == 800
    assert parse_max_tokens("128") == 128

    for parser, value in ((parse_temperature, "2.1"), (parse_temperature, "abc"), (parse_max_tokens, "0")):
        try:
            parser(value)
        except ValueError:
            pass
        else:
            raise AssertionError(f"{parser.__name__} accepted invalid value: {value}")


def test_validate_provider_config_reports_missing_fields():
    issues = validate_provider_config(
        {
            "enabled": True,
            "api_key": "",
            "base_url": "api.geeknow.ai/v1",
            "model": "",
            "temperature": 3,
            "max_tokens": 0,
        }
    )

    assert any("API Key" in issue for issue in issues)
    assert any("Base URL" in issue for issue in issues)
    assert any("http://" in issue and "https://" in issue for issue in issues)
    assert any("型" in issue or "model" in issue.lower() for issue in issues)
    assert "Temperature must be between 0 and 2" in issues
    assert "Max Tokens must be greater than 0" in issues


def test_validate_provider_config_treats_non_dict_as_missing_provider():
    issues = validate_provider_config("broken")

    assert "供应商未启用" in issues
    assert any("API Key" in issue for issue in issues)
    assert any("Base URL" in issue for issue in issues)
    assert any("型" in issue or "model" in issue.lower() for issue in issues)


def test_test_provider_rejects_invalid_config_before_network_dependency():
    ok, message = check_openai_compatible_provider("broken", timeout=1)

    assert ok is False
    assert "API Key" in message


def test_validate_provider_config_accepts_geeknow_env(monkeypatch):
    monkeypatch.setenv("GEEKNOW_API_KEY", "sk-test")
    issues = validate_provider_config(
        {
            "enabled": True,
            "api_key": "${GEEKNOW_API_KEY}",
            "base_url": "https://api.geeknow.ai/v1",
            "model": "gpt-4o-mini",
            "temperature": 0.4,
            "max_tokens": 800,
        }
    )

    assert issues == []


def test_validate_provider_config_rejects_placeholder_values():
    issues = validate_provider_config(
        {
            "enabled": True,
            "api_key": "sk-your-key-here",
            "base_url": "https://api.example.com/v1",
            "model": "your-model-here",
            "temperature": 0.4,
            "max_tokens": 800,
        }
    )

    assert any("API Key" in issue for issue in issues)
    assert any("Base URL" in issue for issue in issues)
    assert any("型" in issue or "model" in issue.lower() for issue in issues)
