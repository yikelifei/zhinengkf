from core.database import Database


def test_database_creates_missing_parent_directory(tmp_path):
    db_path = tmp_path / "nested" / "data" / "kefu.db"

    db = Database(str(db_path))
    session_id = db.create_or_get_session("客户A")

    assert db_path.exists()
    assert session_id


def test_save_lead_preserves_existing_stage(tmp_path):
    db = Database(str(tmp_path / "kefu.db"))
    session_id = "sess_1"

    db.save_lead(
        session_id,
        {
            "company_name": "ABC科技公司",
            "phone": "13812345678",
            "stage": "new_inquiry",
            "budget": "50元",
            "lead_score": 80,
        },
    )
    lead = db.list_leads()[0]
    db.update_lead(lead["id"], {"stage": "quotation_given", "owner": "李静"})

    db.save_lead(
        session_id,
        {
            "company_name": "ABC科技公司",
            "phone": "13812345678",
            "budget": "60元",
            "lead_score": 90,
        },
    )

    updated = db.list_leads()[0]
    assert updated["stage"] == "quotation_given"
    assert updated["budget"] == "60元"
    assert updated["owner"] == "李静"


def test_update_lead_stage_and_next_action(tmp_path):
    db = Database(str(tmp_path / "kefu.db"))
    db.save_lead("sess_2", {"company_name": "测试公司"})
    lead = db.list_leads()[0]

    changed = db.update_lead(
        lead["id"],
        {"stage": "info_collected", "owner": "王芳", "next_action": "明天报价"},
    )

    assert changed is True
    updated = db.list_leads()[0]
    assert updated["stage"] == "info_collected"
    assert updated["owner"] == "王芳"
    assert updated["next_action"] == "明天报价"


def test_update_lead_reports_missing_or_invalid_update_as_false(tmp_path):
    db = Database(str(tmp_path / "kefu.db"))
    db.save_lead("sess_missing_update", {"company_name": "测试公司"})
    lead = db.list_leads()[0]

    assert db.update_lead(99999, {"stage": "info_collected"}) is False
    assert db.update_lead(lead["id"], {"unsupported": "value"}) is False
    assert db.update_lead(lead["id"], "broken") is False

    unchanged = db.list_leads()[0]
    assert unchanged["stage"] == "new_inquiry"


def test_update_lead_commercial_fields(tmp_path):
    db = Database(str(tmp_path / "kefu.db"))
    db.save_lead("sess_commercial", {"company_name": "商业客户"})
    lead = db.list_leads()[0]

    changed = db.update_lead(
        lead["id"],
        {
            "budget": "30元/份",
            "quantity_estimate": "500份",
            "due_date": "9月10日",
            "city": "杭州",
            "lead_score": 95,
            "deal_value": "15000",
            "lost_reason": "",
            "notes": "需要中秋礼盒方案",
        },
    )

    assert changed is True
    updated = db.list_leads()[0]
    assert updated["budget"] == "30元/份"
    assert updated["quantity_estimate"] == "500份"
    assert updated["deal_value"] == "15000"
    assert updated["lead_score"] == 95


def test_list_conversations_and_session_messages(tmp_path):
    db = Database(str(tmp_path / "kefu.db"))
    session_id = db.create_or_get_session("客户A")
    db.save_message(session_id, "inbound", "你好，想做礼盒", source="user")
    db.save_message(session_id, "outbound", "您好，可以先说下数量吗", source="ai")
    db.save_lead(session_id, {"company_name": "客户A公司", "lead_score": 70})

    conversations = db.list_conversations()
    assert conversations[0]["session_id"] == session_id
    assert conversations[0]["company_name"] == "客户A公司"

    messages = db.get_session_messages(session_id)
    assert [m["direction"] for m in messages] == ["inbound", "outbound"]

    lead = db.get_lead_by_session(session_id)
    assert lead["lead_score"] == 70


def test_database_query_limits_fall_back_for_dirty_values(tmp_path):
    db = Database(str(tmp_path / "kefu.db"))
    session_id = db.create_or_get_session("客户A")
    db.save_message(session_id, "inbound", "hello", source="user")
    db.save_message(session_id, "outbound", "ok", source="rule")
    db.save_lead(session_id, {"company_name": "客户A公司", "lead_score": 70})
    db.log_event("config_update", "updated")

    assert len(db.list_conversations(limit=-1)) == 1
    assert len(db.list_conversations(limit="bad")) == 1
    assert len(db.get_session_messages(session_id, limit=0)) == 2
    assert len(db.list_leads(limit="bad")) == 1
    assert len(db.get_followup_leads(limit=-5)) == 1
    assert db.query_pending_leads(days="bad")
    assert db.get_daily_metrics(days=0)
    assert len(db.get_audit_events(limit="bad")) == 1


def test_conversation_manual_lock_lifecycle(tmp_path):
    db = Database(str(tmp_path / "kefu.db"))
    session_id = db.create_or_get_session("客户B")

    locked_until = db.lock_conversation(session_id, minutes=10, reason="manual_send")
    lock = db.get_conversation_lock(session_id)

    assert lock["manual_lock_until"] == locked_until
    assert lock["manual_lock_reason"] == "manual_send"

    db.clear_conversation_lock(session_id)
    assert db.get_conversation_lock(session_id) is None


def test_conversation_human_needed_priority(tmp_path):
    db = Database(str(tmp_path / "kefu.db"))
    active_id = db.create_or_get_session("普通客户")
    human_id = db.create_or_get_session("待人工客户")

    db.mark_human_needed(human_id, reason="complaint")

    conversations = db.list_conversations()
    assert conversations[0]["session_id"] == human_id
    assert conversations[0]["status"] == "needs_human"

    db.mark_conversation_active(human_id)
    refreshed = {
        item["session_id"]: item["status"]
        for item in db.list_conversations()
    }
    assert refreshed[human_id] == "active"
    assert refreshed[active_id] == "active"


def test_report_metrics_and_followups(tmp_path):
    db = Database(str(tmp_path / "kefu.db"))
    sid1 = db.create_or_get_session("高意向客户")
    sid2 = db.create_or_get_session("已成交客户")
    db.save_message(sid1, "inbound", "想做100份礼盒", source="user")
    db.save_message(sid1, "outbound", "请补充预算", source="rule")
    db.save_lead(sid1, {"company_name": "高意向公司", "lead_score": 90, "stage": "new_inquiry"})
    db.save_lead(sid2, {"company_name": "成交公司", "lead_score": 80, "stage": "ordered"})

    lead_metrics = db.get_lead_metrics()
    stage_metrics = {row["stage"]: row["count"] for row in db.get_stage_metrics()}
    daily_metrics = db.get_daily_metrics(days=7)
    followups = db.get_followup_leads()

    assert lead_metrics["total"] == 2
    assert lead_metrics["high_intent"] == 2
    assert lead_metrics["won"] == 1
    assert stage_metrics["new_inquiry"] == 1
    assert stage_metrics["ordered"] == 1
    assert daily_metrics[0]["inbound_messages"] == 1
    assert daily_metrics[0]["outbound_messages"] == 1
    assert followups[0]["company_name"] == "高意向公司"


def test_audit_log_query(tmp_path):
    db = Database(str(tmp_path / "kefu.db"))
    db.log_event("config_update", "updated profile")
    db.log_event("report_generate", "operation report")

    events = db.get_audit_events(limit=10)

    assert events[0]["event_type"] == "report_generate"
    assert events[1]["detail"] == "updated profile"
