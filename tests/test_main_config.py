from scripts.main import _load_yaml_dict, load_config


def test_load_yaml_dict_treats_missing_malformed_and_non_dict_as_empty(tmp_path):
    missing = tmp_path / "missing.yaml"
    assert _load_yaml_dict(str(missing)) == {}

    malformed = tmp_path / "malformed.yaml"
    malformed.write_text("settings: [broken\n", encoding="utf-8")
    assert _load_yaml_dict(str(malformed)) == {}

    non_dict = tmp_path / "list.yaml"
    non_dict.write_text("- broken\n", encoding="utf-8")
    assert _load_yaml_dict(str(non_dict)) == {}


def test_load_config_returns_dict_for_valid_settings(tmp_path):
    settings = tmp_path / "settings.yaml"
    settings.write_text("ai_engine:\n  enabled: false\n", encoding="utf-8")

    assert load_config(str(settings)) == {"ai_engine": {"enabled": False}}
