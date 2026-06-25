from scripts import followup_reminders, handoff_queue, order_handoff, quote_readiness, sla_monitor


class FollowupDB:
    def __init__(self, path):
        self.path = path

    def get_followup_leads(self, limit):
        return [
            {
                "id": 1,
                "session_id": "s1",
                "company_name": "Dirty score customer",
                "lead_score": "bad",
                "stage": "new_inquiry",
            }
        ]


class HandoffDB:
    def __init__(self, path):
        self.path = path

    def list_conversations(self, limit):
        return [
            {
                "session_id": "s1",
                "friend_name": "Dirty handoff",
                "status": "needs_human",
                "lead_score": "bad",
                "last_seen_at": "2026-06-25 08:00:00",
            }
        ]

    def get_conversation_lock(self, session_id):
        return None

    def get_session_messages(self, session_id, limit):
        return [{"direction": "inbound", "content": "need human"}]


class OrderDB:
    def __init__(self, path):
        self.path = path

    def list_leads(self, limit):
        return [
            {
                "id": 1,
                "session_id": "s1",
                "company_name": "Dirty order",
                "lead_score": "bad",
                "stage": "ready_to_order",
            }
        ]


class QuoteDB:
    def __init__(self, path):
        self.path = path

    def list_leads(self, limit):
        return [
            {
                "id": 1,
                "session_id": "s1",
                "company_name": "Dirty quote",
                "lead_score": "bad",
                "stage": "quotation_given",
                "phone": "13800138000",
                "quantity_estimate": "100",
                "budget": "1000",
                "due_date": "tomorrow",
                "city": "Shanghai",
            }
        ]


class EmptyCursor:
    def fetchall(self):
        return []


class SlaDB:
    def __init__(self, path):
        self.path = path

    def execute(self, *args, **kwargs):
        return EmptyCursor()


def test_followup_tasks_treat_dirty_scores_as_zero():
    original = followup_reminders.Database
    try:
        followup_reminders.Database = FollowupDB
        tasks = followup_reminders.build_followup_tasks(limit=10)
    finally:
        followup_reminders.Database = original

    assert tasks[0]["score"] == 0
    assert tasks[0]["customer"] == "Dirty score customer"


def test_handoff_queue_treats_dirty_scores_as_zero():
    original = handoff_queue.Database
    try:
        handoff_queue.Database = HandoffDB
        items = handoff_queue.build_handoff_queue(limit=10)
    finally:
        handoff_queue.Database = original

    assert items[0]["lead_score"] == 0
    assert items[0]["customer"] == "Dirty handoff"


def test_order_handoff_treats_dirty_scores_as_zero():
    original = order_handoff.Database
    try:
        order_handoff.Database = OrderDB
        report = order_handoff.build_order_handoff(limit=10)
    finally:
        order_handoff.Database = original

    assert report["items"][0]["lead_score"] == 0
    assert report["items"][0]["customer"] == "Dirty order"


def test_quote_readiness_treats_dirty_scores_and_rules_as_safe_defaults():
    original_db = quote_readiness.Database
    original_rules = quote_readiness.pipeline_rules
    try:
        quote_readiness.Database = QuoteDB
        quote_readiness.pipeline_rules = lambda: "bad"
        report = quote_readiness.build_quote_readiness(limit=10)
    finally:
        quote_readiness.Database = original_db
        quote_readiness.pipeline_rules = original_rules

    assert report["items"][0]["lead_score"] == 0
    assert report["items"][0]["customer"] == "Dirty quote"
    assert report["required_fields"] == [
        "phone_or_wechat", "quantity_estimate", "budget", "due_date", "city",
    ]


def test_sla_monitor_treats_dirty_handoff_wait_minutes_as_zero():
    original_db = sla_monitor.Database
    original_handoff = sla_monitor.build_handoff_queue
    try:
        sla_monitor.Database = SlaDB
        sla_monitor.build_handoff_queue = lambda limit: [{"session_id": "s1", "wait_minutes": "bad"}]
        report = sla_monitor.build_sla_report(days=7)
    finally:
        sla_monitor.Database = original_db
        sla_monitor.build_handoff_queue = original_handoff

    assert report["handoff_sessions"] == 1
    assert report["overdue_handoff_sessions"] == 0
