from core.conversation import ConversationManager


def test_context_helpers_skip_malformed_cached_messages():
    manager = ConversationManager(db=None)
    session_id = "dirty"
    manager.context_cache[session_id] = [
        "broken",
        {"role": "user", "content": 123},
        {"role": None, "content": None},
    ]

    manager._compress_context_if_needed(session_id)
    context = manager.get_ai_context(session_id, exclude_latest_user_message="ignored")

    assert context == [
        {"role": "user", "content": "123"},
        {"role": "user", "content": ""},
    ]
    assert manager._context_chars(session_id) >= 4


def test_context_merge_summary_skips_malformed_messages():
    manager = ConversationManager(db=None)
    summary = manager._merge_summary(
        "existing",
        [
            "broken",
            {"role": "user", "content": 123},
            {"role": "assistant", "content": None},
        ],
    )

    assert "existing" in summary
    assert "123" in summary
