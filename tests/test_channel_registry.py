from core import channel_registry


def test_positive_int_setting_uses_default_for_invalid_or_out_of_range_values():
    assert channel_registry.positive_int_setting("5", "x", 3, min_value=1, max_value=10) == 5
    assert channel_registry.positive_int_setting("abc", "x", 3, min_value=1, max_value=10) == 3
    assert channel_registry.positive_int_setting(0, "x", 3, min_value=1, max_value=10) == 3
    assert channel_registry.positive_int_setting(11, "x", 3, min_value=1, max_value=10) == 3


def test_create_channel_hub_falls_back_when_wechat_timing_config_is_dirty():
    class FakeWeChatPcAdapter:
        channel_id = "wechat"
        display_name = "微信"

        def __init__(self, poll_interval=3, anti_flood_seconds=60):
            self.poll_interval = poll_interval
            self.anti_flood_seconds = anti_flood_seconds

        def is_connected(self):
            return True

    original = channel_registry.WeChatPcAdapter
    try:
        channel_registry.WeChatPcAdapter = FakeWeChatPcAdapter
        hub = channel_registry.create_channel_hub(
            {
                "wechat": {
                    "poll_interval": "bad",
                    "anti_flood_seconds": -1,
                },
                "channels": {
                    "active": ["wechat"],
                    "adapters": {"wechat": {"enabled": True}},
                },
            }
        )
    finally:
        channel_registry.WeChatPcAdapter = original

    adapter = hub.adapters["wechat"]
    assert adapter.poll_interval == 3
    assert adapter.anti_flood_seconds == 60
