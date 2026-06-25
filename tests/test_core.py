""" Tests must not depend on WeChat, AI APIs, or SQLite.
All tests are pure-function unit tests with mocked dependencies. """

import sys
import types


if "win32gui" not in sys.modules:
    win32gui = types.ModuleType("win32gui")
    win32gui.EnumWindows = lambda callback, result: None
    win32gui.GetClassName = lambda hwnd: ""
    win32gui.GetWindowText = lambda hwnd: ""
    win32gui.IsWindowVisible = lambda hwnd: False
    sys.modules["win32gui"] = win32gui

from core.intent_classifier import IntentClassifier
from core.rule_engine import RuleEngine
from core.template_renderer import render
from core.conversation import ConversationManager
from core.ai_service import AIService
from scripts.main import SmartBot


class MockDB:
    """Minimal DB mock that tracks calls."""

    def __init__(self):
        self.sessions = {}
        self.calls = []
        self.stage_map = {}

    def create_or_get_session(self, friend_name):
        if friend_name not in self.sessions:
            sid = f"sess_{friend_name}"
            self.sessions[friend_name] = sid
        return self.sessions[friend_name]

    def save_message(self, session_id, direction, content, source="rule", intent=None):
        self.calls.append(("save_message", session_id, direction, content, source, intent))

    def update_conversation_stage(self, session_id, stage):
        self.stage_map[session_id] = stage
        self.calls.append(("update_stage", session_id, stage))

    def execute(self, sql, params=()):
        """Return mock row for stage queries."""
        sid = params[0] if params else None
        stage = self.stage_map.get(sid, "new")

        class Row(dict):
            pass

        r = Row()
        if "stage FROM conversations" in sql:
            r["stage"] = stage
        elif "session_id FROM conversations WHERE friend_name" in sql:
            # Already handled by create_or_get_session
            return None
        return r

    def log_event(self, event_type, detail=""):
        self.calls.append(("log_event", event_type, detail))

    def save_lead(self, session_id, info):
        self.calls.append(("save_lead", session_id, info))


# ── TestIntentClassifier ──────────────────────────────────────────


def test_classify_price():
    kw = {"price": {"keywords": ["价格", "多少钱"], "priority": 95}}
    clf = IntentClassifier(kw)
    result = clf.classify("这个多少钱？")
    assert result["intent"] == "price"
    assert "多少钱" in result["matched_keywords"]
    assert result["confidence"] == "medium"


def test_classify_multiple_matches_high_confidence():
    kw = {
        "price": {"keywords": ["价格", "多少钱"], "priority": 95},
        "min_order": {"keywords": ["最少", "起订量"], "priority": 90},
    }
    clf = IntentClassifier(kw)
    result = clf.classify("起订量和价格分别是多少")
    assert result["intent"] == "price"  # higher priority wins
    assert "价格" in result["matched_keywords"]  # price keywords matched
    assert result["confidence"] == "medium"  # only 1 keyword matched within price intent


def test_classify_unmatched_is_vague():
    kw = {"price": {"keywords": ["价格"], "priority": 95}}
    clf = IntentClassifier(kw)
    result = clf.classify("今天天气真好")
    assert result["intent"] == "vague"
    assert result["matched_keywords"] == []
    assert result["confidence"] == "low"


def test_classify_skips_malformed_keyword_rules():
    kw = {
        "broken": "bad",
        "empty": {"keywords": {"bad": "shape"}, "priority": 99},
        "price": {"keywords": "price", "priority": 10},
    }
    clf = IntentClassifier(kw)
    result = clf.classify("need price")
    assert result["intent"] == "price"
    assert result["matched_keywords"] == ["price"]


def test_classify_transfer_human():
    kw = {
        "transfer_human": {
            "keywords": ["找人工", "转人工"],
            "priority": 99,
            "action": "alert_human",
        }
    }
    clf = IntentClassifier(kw)
    result = clf.classify("太复杂了，我要找人工客服")
    assert result["intent"] == "transfer_human"
    assert result["action"] == "alert_human"


# ── TestRuleEngine ────────────────────────────────────────────────


def test_rule_engine_match():
    kw = {
        "price": {
            "keywords": ["价格", "多少钱"],
            "priority": 95,
            "reply_template": "我们的价格是{{price_range}}",
        }
    }
    engine = RuleEngine(kw)
    intent, template = engine.match("你们价格多少？")
    assert intent == "price"
    assert "价格是" in template


def test_rule_engine_no_match():
    kw = {"price": {"keywords": ["价格"], "priority": 95}}
    engine = RuleEngine(kw)
    intent, template = engine.match("随便聊聊")
    assert intent is None
    assert template is None


def test_rule_engine_skips_malformed_keyword_rules():
    kw = {
        "broken": "bad",
        "empty": {"keywords": {"bad": "shape"}, "priority": 99},
        "price": {"keywords": "price", "priority": 10, "reply_template": "ok"},
    }
    engine = RuleEngine(kw)
    intent, template = engine.match("need price")
    assert intent == "price"
    assert template == "ok"


def test_rule_engine_prioritization():
    kw = {
        "low_pri": {
            "keywords": ["便宜"],
            "priority": 10,
            "reply_template": "low",
        },
        "high_pri": {
            "keywords": ["便宜", "划算"],
            "priority": 90,
            "reply_template": "high",
        },
    }
    engine = RuleEngine(kw)
    intent, _ = engine.match("这个真划算")
    assert intent == "high_pri"


# ── TestTemplateRenderer ──────────────────────────────────────────


def test_render_basic():
    t = "你好 {{name}}，你的订单是 {{order_id}}"
    ctx = {"name": "张三", "order_id": "ORD-1234"}
    assert render(t, ctx) == "你好 张三，你的订单是 ORD-1234"


def test_render_missing_var():
    t = "{{name}} 您好，{{greeting}}"
    ctx = {"name": "李四"}
    result = render(t, ctx)
    assert "李四" in result
    assert "{{greeting}}" in result


def test_render_empty_context():
    t = "Hello world"
    assert render(t, {}) == "Hello world"


def test_render_reply_variants():
    t = "方案一：{{name}}[or]方案二：{{name}}"
    ctx = {"name": "Alice"}
    assert render(t, ctx, chooser=lambda variants: variants[1]) == "方案二：Alice"


def test_render_random_marker_removed_or_replaced():
    result = render("可以的[~]", {})
    assert "[~]" not in result
    assert result.startswith("可以的")


class FakeChannelAdapter:
    def __init__(self, channel_id, display_name, messages=None):
        self.channel_id = channel_id
        self.display_name = display_name
        self.messages = messages or []
        self.sent = []

    def get_new_messages(self):
        return list(self.messages)

    def send(self, text, who):
        self.sent.append((who, text))
        return True

    def send_image(self, image_path, who):
        self.sent.append((who, image_path))
        return True

    def is_connected(self):
        return True

    def reconnect(self):
        return True


def test_channel_hub_normalizes_platform_fields():
    from core.channel_registry import ChannelHub

    hub = ChannelHub(
        [
            FakeChannelAdapter(
                "xiaohongshu",
                "小红书",
                [{"sender": "客户A", "content": "想定制礼盒"}],
            )
        ]
    )
    msg = hub.get_new_messages()[0]
    assert msg["platform"] == "xiaohongshu"
    assert msg["channel_name"] == "小红书"
    assert msg["sender"] == "客户A"


def test_channel_hub_routes_reply_to_source_channel():
    from core.channel_registry import ChannelHub

    xhs = FakeChannelAdapter(
        "xiaohongshu",
        "小红书",
        [{"sender": "同名客户", "content": "要报价"}],
    )
    hub = ChannelHub([xhs, FakeChannelAdapter("douyin", "抖音")])
    hub.get_new_messages()
    assert hub.send("好的，我先了解下数量", "同名客户") is True
    assert xhs.sent == [("同名客户", "好的，我先了解下数量")]


# ── TestConversationManager ──────────────────────────────────────


def test_add_message_updates_cache():
    db = MockDB()
    mgr = ConversationManager(db)
    sid = db.create_or_get_session("Alice")
    mgr.add_message(sid, "inbound", "你好")
    # Should have saved to DB AND updated context
    assert len(db.calls) >= 2  # save_message + update_stage (or combined)
    ctx = mgr.get_ai_context(sid)
    assert len(ctx) == 1
    assert ctx[0]["role"] == "user"
    assert ctx[0]["content"] == "你好"


def test_advance_stage():
    db = MockDB()
    mgr = ConversationManager(db)
    sid = db.create_or_get_session("Bob")
    mgr.advance_stage(sid, "info_collected")
    assert db.stage_map[sid] == "info_collected"


def test_extract_phone():
    db = MockDB()
    mgr = ConversationManager(db)
    info = mgr.extract_contact_info("我的电话是13812345678")
    assert info["phone"] == "13812345678"


def test_extract_company():
    db = MockDB()
    mgr = ConversationManager(db)
    info = mgr.extract_contact_info("我是ABC科技有限公司的采购")
    assert info["company_name"] == "ABC科技有限" or "ABC科技" in info.get(
        "company_name", ""
    )


def test_extract_festival():
    db = MockDB()
    mgr = ConversationManager(db)
    info = mgr.extract_contact_info("想做一批端午粽子礼盒")
    assert info.get("festival") == "端午"


def test_context_trimming():
    db = MockDB()
    mgr = ConversationManager(db)
    sid = db.create_or_get_session("Tester")
    # Add more messages than MAX_AI_CONTEXT_ROUNDS * 2
    for i in range(20):
        mgr.add_to_context(sid, "user", f"msg {i}")
        mgr.add_to_context(sid, "assistant", f"resp {i}")
    ctx = mgr.get_ai_context(sid)
    max_rounds = ConversationManager.MAX_AI_CONTEXT_ROUNDS * 2
    assert len(ctx) <= max_rounds


def test_context_auto_compression_adds_summary():
    db = MockDB()
    mgr = ConversationManager(db)
    sid = db.create_or_get_session("Compress")
    for i in range(18):
        mgr.add_to_context(sid, "user", f"old question {i} " + "x" * 120)
        mgr.add_to_context(sid, "assistant", f"old answer {i} " + "y" * 120)

    ctx = mgr.get_ai_context(sid)

    assert ctx[0]["role"] == "system"
    assert "自动上下文压缩摘要" in ctx[0]["content"]
    assert len(ctx) <= ConversationManager.RECENT_CONTEXT_MESSAGES + 1


def test_get_ai_context_can_exclude_current_user_message():
    db = MockDB()
    mgr = ConversationManager(db)
    sid = db.create_or_get_session("Current")
    mgr.add_to_context(sid, "assistant", "previous answer")
    mgr.add_to_context(sid, "user", "current question")

    ctx = mgr.get_ai_context(sid, exclude_latest_user_message="current question")

    assert [message["content"] for message in ctx] == ["previous answer"]


def test_ai_service_prepares_long_history_with_summary():
    service = object.__new__(AIService)
    history = []
    for i in range(10):
        history.append({"role": "user", "content": f"question {i} " + "x" * 500})
        history.append({"role": "assistant", "content": f"answer {i} " + "y" * 500})

    prepared = service._prepare_history(history)

    assert prepared[0]["role"] == "system"
    assert "Compressed previous conversation" in prepared[0]["content"]
    assert len(prepared) <= AIService.RECENT_HISTORY_MESSAGES + 1


def test_clear_context():
    db = MockDB()
    mgr = ConversationManager(db)
    sid = db.create_or_get_session("ClearTest")
    mgr.add_to_context(sid, "user", "hello")
    assert len(mgr.get_ai_context(sid)) == 1
    mgr.clear_context(sid)
    assert len(mgr.get_ai_context(sid)) == 0


# ── Test _is_worthy_of_reply ──────────────────────────────────────


def _get_bot():
    """Create a bot instance without WeChat (skips connection)."""
    class PartialBot(SmartBot):
        def __init__(self):
            # Skip parent init — don't load configs or connect
            self._initialized = True

        def run(self):
            pass  # no-op
    bot = PartialBot()
    return bot


def test_reply_worthy_business_keywords():
    bot = _get_bot()
    assert bot._is_worthy_of_reply("最低订多少") is True
    assert bot._is_worthy_of_reply("中秋礼盒怎么买") is True
    assert bot._is_worthy_of_reply("交期多久") is True
    assert bot._is_worthy_of_reply("推荐一下你们的产品") is True


def test_reply_ignored_short_greetings():
    bot = _get_bot()
    assert bot._is_worthy_of_reply("你好") is False
    assert bot._is_worthy_of_reply("您好") is False
    assert bot._is_worthy_of_reply("嗨") is False
    assert bot._is_worthy_of_reply("在吗") is False
    assert bot._is_worthy_of_reply("嗯") is False
    assert bot._is_worthy_of_reply("好") is False


def test_reply_ignored_non_chinese_short():
    bot = _get_bot()
    assert bot._is_worthy_of_reply("abc") is False
    assert bot._is_worthy_of_reply("ok") is False
    assert bot._is_worthy_of_reply("asdfghjkl") is False


def test_reply_ignored_emoji_only():
    bot = _get_bot()
    assert bot._is_worthy_of_reply("😀😃😄") is False
    assert bot._is_worthy_of_reply("[图片]") is False


def test_reply_long_chinese_sentence():
    bot = _get_bot()
    assert bot._is_worthy_of_reply(
        "请问你们端午节有哪些款式的粽子礼盒可以定制呢"
    ) is True


# ── Run all tests ────────────────────────────────────────────────

if __name__ == "__main__":
    import traceback

    tests = [
        ("test_classify_price", test_classify_price),
        ("test_classify_multiple", test_classify_multiple_matches_high_confidence),
        ("test_classify_vague", test_classify_unmatched_is_vague),
        ("test_classify_malformed_rules", test_classify_skips_malformed_keyword_rules),
        ("test_classify_transfer", test_classify_transfer_human),
        ("test_rule_engine_match", test_rule_engine_match),
        ("test_rule_engine_no_match", test_rule_engine_no_match),
        ("test_rule_engine_malformed_rules", test_rule_engine_skips_malformed_keyword_rules),
        ("test_rule_engine_priority", test_rule_engine_prioritization),
        ("test_render_basic", test_render_basic),
        ("test_render_missing", test_render_missing_var),
        ("test_render_empty", test_render_empty_context),
        ("test_render_variants", test_render_reply_variants),
        ("test_render_random_marker", test_render_random_marker_removed_or_replaced),
        ("test_channel_hub_fields", test_channel_hub_normalizes_platform_fields),
        ("test_channel_hub_routes", test_channel_hub_routes_reply_to_source_channel),
        ("test_add_message", test_add_message_updates_cache),
        ("test_advance_stage", test_advance_stage),
        ("test_extract_phone", test_extract_phone),
        ("test_extract_company", test_extract_company),
        ("test_extract_festival", test_extract_festival),
        ("test_context_trim", test_context_trimming),
        ("test_context_auto_compression", test_context_auto_compression_adds_summary),
        ("test_context_exclude_current", test_get_ai_context_can_exclude_current_user_message),
        ("test_ai_history_summary", test_ai_service_prepares_long_history_with_summary),
        ("test_clear_context", test_clear_context),
        ("test_worthy_keywords", test_reply_worthy_business_keywords),
        ("test_worthy_greetings", test_reply_ignored_short_greetings),
        ("test_worthy_non_cn", test_reply_ignored_non_chinese_short),
        ("test_worthy_emoji", test_reply_ignored_emoji_only),
        ("test_worthy_chinese", test_reply_long_chinese_sentence),
    ]

    passed = 0
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"[OK]   {name}")
            passed += 1
        except Exception as e:
            print(f"[FAIL] {name}: {e}")
            traceback.print_exc()
            failed += 1

    print(f"\n{passed} passed, {failed} failed out of {len(tests)} tests.")
    if failed:
        exit(1)
