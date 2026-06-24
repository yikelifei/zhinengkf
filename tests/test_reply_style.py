import yaml

from core.reply_style import ReplyStyleCoach


def test_reply_style_uses_defaults_for_malformed_config_root(tmp_path):
    path = tmp_path / "reply_style.yaml"
    path.write_text("- broken\n", encoding="utf-8")

    coach = ReplyStyleCoach(str(path))

    assert coach.max_chars == coach.DEFAULT_MAX_CHARS
    assert "\u6570\u91cf" in coach.polish(
        "pricing",
        123,
        "\u7aef\u5348\u793c\u76d2\u591a\u5c11\u94b1",
    )


def test_reply_style_uses_defaults_for_invalid_max_chars(tmp_path):
    path = tmp_path / "reply_style.yaml"
    path.write_text(
        yaml.safe_dump({"reply_style": {"max_chars": "bad"}}, allow_unicode=True),
        encoding="utf-8",
    )

    coach = ReplyStyleCoach(str(path))

    assert coach.max_chars == coach.DEFAULT_MAX_CHARS
