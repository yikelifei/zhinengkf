import yaml

from scripts.reply_style_miner import _manual_sources, _mask_sensitive, _style_tags, render_markdown


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


def test_render_markdown_keeps_readable_chinese_and_escapes_tables():
    report = {
        "generated_at": "2026-06-25 08:30:00",
        "days": 7,
        "total_pairs": 1,
        "avg_reply_length": 32.0,
        "question_rate": 1.0,
        "topic_counts": {"pricing": 1},
        "tag_counts": {"lead_collection": 1},
        "samples": [
            {
                "created_at": "2026-06-25 08:00:00",
                "topic": "pricing",
                "customer_message": "我想做礼盒|预算3000",
                "human_reply": "可以，您先发数量和使用日期，我帮您核价。",
                "style_tags": ["concise", "lead_collection"],
            }
        ],
        "next_actions": ["把高频价格样本沉淀为标准回复示例。"],
    }

    markdown = render_markdown(report)

    assert "# 真人客服风格样本报告" in markdown
    assert "统计周期：近 7 天" in markdown
    assert "我想做礼盒｜预算3000" in markdown
    assert "concise、lead_collection" in markdown
    assert "乱码" not in markdown


def test_style_tags_identify_sales_reply_traits():
    tags = _style_tags("收到，我帮您先看数量、预算和使用日期，最终报价需要人工确认，可以吗？")

    assert "has_question" in tags
    assert "concise" in tags
    assert "human_guidance" in tags
    assert "lead_collection" in tags
    assert "safe_boundary" in tags


def test_mask_sensitive_redacts_phone_and_wechat_ids():
    text = _mask_sensitive("电话 13812345678，微信号: customer_vx_2026")

    assert "13812345678" not in text
    assert "138****5678" in text
    assert "customer_vx_2026" not in text
    assert "微信号: cu" in text
