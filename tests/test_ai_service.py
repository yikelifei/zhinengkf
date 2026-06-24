import yaml

from core.ai_service import AIError, AIService, AIServiceRouter


def test_ai_service_treats_malformed_settings_and_prompts_as_disabled(tmp_path):
    settings = tmp_path / "settings.yaml"
    prompts = tmp_path / "prompts.yaml"
    settings.write_text("- broken\n", encoding="utf-8")
    prompts.write_text("- broken\n", encoding="utf-8")

    service = AIService(settings_path=str(settings), prompts_path=str(prompts))

    assert service.router.disabled is True
    assert service.router.providers == {}
    assert service.prompt_key == "meiyi_system"
    assert service.system_prompt == ""
    try:
        service.generate_reply("\u4f60\u597d")
    except AIError as exc:
        assert "unavailable" in str(exc)
    else:
        raise AssertionError("malformed AI config should disable generation")


def test_ai_service_treats_invalid_yaml_syntax_as_disabled(tmp_path):
    settings = tmp_path / "settings.yaml"
    prompts = tmp_path / "prompts.yaml"
    settings.write_text("ai_engine: [broken\n", encoding="utf-8")
    prompts.write_text("meiyi_system: [broken\n", encoding="utf-8")

    service = AIService(settings_path=str(settings), prompts_path=str(prompts))

    assert service.router.disabled is True
    assert service.system_prompt == ""


def test_ai_service_uses_default_prompt_when_selected_prompt_is_dirty(tmp_path):
    settings = tmp_path / "settings.yaml"
    prompts = tmp_path / "prompts.yaml"
    settings.write_text(
        yaml.safe_dump(
            {"ai_engine": {"enabled": False, "prompt_key": "custom"}},
            allow_unicode=True,
        ),
        encoding="utf-8",
    )
    prompts.write_text(
        yaml.safe_dump(
            {"custom": {"broken": True}, "meiyi_system": "\u9ed8\u8ba4\u63d0\u793a\u8bcd"},
            allow_unicode=True,
        ),
        encoding="utf-8",
    )

    service = AIService(settings_path=str(settings), prompts_path=str(prompts))

    assert service.router.disabled is True
    assert service.prompt_key == "custom"
    assert service.system_prompt == "\u9ed8\u8ba4\u63d0\u793a\u8bcd"


def test_ai_router_skips_malformed_provider_config_without_type_errors():
    router = AIServiceRouter(
        {
            "enabled": True,
            "primary": "broken",
            "fallback_chain": "not-a-list",
            "max_retries": "bad",
            "providers": {
                "broken": "not-a-dict",
                "custom_api_1": {"enabled": True, "api_key": "${MISSING_KEY}"},
            },
        }
    )

    assert router.disabled is False
    assert router.max_retries == 2
    assert router.fallback_chain == []
    assert router.providers == {}
    try:
        router.chat([{"role": "user", "content": "ping"}])
    except AIError as exc:
        assert "\u672a\u542f\u7528\u6216\u672a\u914d\u7f6e" in str(exc)
    else:
        raise AssertionError("router without valid providers should raise AIError")


def test_ai_history_helpers_skip_dirty_entries_and_stringify_content():
    service = object.__new__(AIService)
    history = [
        "broken",
        {"role": "user", "content": 123},
        {"role": "assistant", "content": None},
        {"role": "unknown", "content": "ignored"},
    ]

    prepared = service._prepare_history(history)

    assert prepared == [{"role": "user", "content": "123"}]
    assert service._compact_text(12345, 3) == "1 ... 5"
    assert service._clean_reply(12345) == "12345"
