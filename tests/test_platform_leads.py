# -*- coding: utf-8 -*-

from core.platform_leads import (
    PlatformLeadStore,
    build_platform_report,
    render_platform_report,
    to_high_value_input,
)
from scripts.platform_leads import export_platform_leads_report


def test_add_lead_normalizes_and_persists(tmp_path):
    path = tmp_path / "platform_leads.json"
    store = PlatformLeadStore(path)

    lead = store.add_lead(
        platform="抖音",
        nickname="  user_a  ",
        source_url="https://example.test/share",
        need="300 gift boxes",
        lead_score="62",
        tags="gift, urgent",
    )

    assert lead["platform"] == "douyin"
    assert lead["nickname"] == "user_a"
    assert lead["status"] == "new"
    assert lead["lead_score"] == 62
    assert lead["tags"] == ["gift", "urgent"]

    reloaded = PlatformLeadStore(path).list_leads()
    assert reloaded[0]["id"] == lead["id"]
    assert reloaded[0]["need"] == "300 gift boxes"


def test_store_treats_malformed_json_shape_as_empty(tmp_path):
    path = tmp_path / "platform_leads.json"
    path.write_text('["broken"]', encoding="utf-8")

    assert PlatformLeadStore(path).list_leads() == []


def test_store_treats_invalid_json_as_empty(tmp_path):
    path = tmp_path / "platform_leads.json"
    path.write_text('{"leads": [', encoding="utf-8")

    assert PlatformLeadStore(path).list_leads() == []


def test_store_skips_malformed_leads_and_bad_version(tmp_path):
    path = tmp_path / "platform_leads.json"
    path.write_text(
        """
{
  "version": "bad",
  "leads": [
    "broken",
    {"platform": "douyin", "nickname": ""},
    {"platform": "douyin", "nickname": "user_ok"}
  ]
}
""".strip(),
        encoding="utf-8",
    )

    leads = PlatformLeadStore(path).list_leads()

    assert [lead["nickname"] for lead in leads] == ["user_ok"]


def test_store_save_does_not_split_malformed_leads_string(tmp_path):
    path = tmp_path / "platform_leads.json"
    store = PlatformLeadStore(path)

    store._save({"leads": "broken"})

    assert PlatformLeadStore(path).list_leads() == []


def test_store_list_leads_tolerates_dirty_limit(tmp_path):
    store = PlatformLeadStore(tmp_path / "platform_leads.json")
    store.add_lead(platform="douyin", nickname="user_a")
    store.add_lead(platform="wechat", nickname="user_b")

    assert len(store.list_leads(limit="bad")) == 2
    assert store.list_leads(limit=-1) == []


def test_bind_wechat_updates_status_and_stats(tmp_path):
    store = PlatformLeadStore(tmp_path / "platform_leads.json")
    lead = store.add_lead(platform="xiaohongshu", nickname="user_b")

    updated = store.bind_wechat(lead["id"], "wx_user_b")
    stats = store.stats_by_platform()

    assert updated["wechat_id"] == "wx_user_b"
    assert updated["status"] == "wechat_bound"
    assert stats == [
        {
            "platform": "xiaohongshu",
            "platform_label": "小红书",
            "total": 1,
            "wechat_bound": 1,
            "wechat_missing": 0,
            "status_counts": {"wechat_bound": 1},
        }
    ]


def test_high_value_input_uses_existing_lead_contract(tmp_path):
    store = PlatformLeadStore(tmp_path / "platform_leads.json")
    lead = store.add_lead(
        platform="douyin",
        nickname="user_c",
        source_note="comment under video",
        need="needs 500 boxes",
        wechat_id="wx_c",
        lead_score=88,
        quantity_estimate="500",
        budget="30",
        due_date="2026-09-01",
        city="Hangzhou",
        deal_value="15000",
    )

    payload = to_high_value_input(lead)

    assert payload["session_id"] == f"platform:{lead['id']}"
    assert payload["company_name"] == "user_c"
    assert payload["contact_person"] == "user_c"
    assert payload["wechat_id"] == "wx_c"
    assert payload["lead_score"] == 88
    assert payload["stage"] == "new_inquiry"
    assert payload["source"] == "抖音 | comment under video"
    assert "needs 500 boxes" in payload["notes"]


def test_report_empty_state_includes_samples_without_creating_data(tmp_path):
    path = tmp_path / "missing_platform_leads.json"
    store = PlatformLeadStore(path)

    report = build_platform_report(store)
    markdown = render_platform_report(report)

    assert report["items"] == []
    assert report["samples"]
    assert "暂无真实平台线索" in markdown
    assert "sample_douyin_user" in markdown
    assert not path.exists()


def test_cli_exports_markdown_report_for_custom_data_path(tmp_path):
    data_path = tmp_path / "platform_leads.json"
    output = tmp_path / "report.md"
    store = PlatformLeadStore(data_path)
    store.add_lead(platform="douyin", nickname="user_d", need="asks for quote")

    result = export_platform_leads_report(data_path=data_path, output=output)

    assert result == output
    markdown = output.read_text(encoding="utf-8")
    assert "平台线索承接报表" in markdown
    assert "user_d" in markdown
