import yaml

from scripts.reply_style_miner import _manual_sources


def test_manual_sources_falls_back_for_missing_or_malformed_config(tmp_path):
    missing = tmp_path / "missing.yaml"
    assert _manual_sources(missing) == {"manual"}

    config = tmp_path / "reply_style.yaml"
    config.write_text("reply_style: [broken\n", encoding="utf-8")
    assert _manual_sources(config) == {"manual"}

    config.write_text("- broken\n", encoding="utf-8")
    assert _manual_sources(config) == {"manual"}

    config.write_text(yaml.safe_dump({"reply_style": "broken"}), encoding="utf-8")
    assert _manual_sources(config) == {"manual"}

    config.write_text(
        yaml.safe_dump({"reply_style": {"manual_sources": "manual_ui"}}),
        encoding="utf-8",
    )
    assert _manual_sources(config) == {"manual"}


def test_manual_sources_filters_blank_entries(tmp_path):
    config = tmp_path / "reply_style.yaml"
    config.write_text(
        yaml.safe_dump({"reply_style": {"manual_sources": ["manual", "", " manual_ui "]}}),
        encoding="utf-8",
    )

    assert _manual_sources(config) == {"manual", "manual_ui"}
