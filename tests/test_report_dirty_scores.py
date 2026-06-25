from scripts import followup_reminders, handoff_queue, order_handoff


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
