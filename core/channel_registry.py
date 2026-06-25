"""Channel registry and unified channel hub."""

from __future__ import annotations

from typing import Any, Iterable

from core.channel_adapter import (
    ChannelAdapter,
    ChannelMessage,
    ChannelSpec,
    DisabledChannelAdapter,
    WeChatPcAdapter,
)
from core.logger import info, warning


SUPPORTED_CHANNELS: dict[str, ChannelSpec] = {
    "wechat": ChannelSpec(
        channel_id="wechat",
        display_name="微信",
        adapter_type="wechat_pc",
        status="available",
        recommended_access="PC 客户端自动化；后续可切企业微信/公众号官方接口",
        notes="当前已接入。",
    ),
    "xiaohongshu": ChannelSpec(
        channel_id="xiaohongshu",
        display_name="小红书",
        adapter_type="official_or_aggregator_api",
        status="planned",
        recommended_access="优先官方商家/客服接口；不可用时再评估合规聚合服务",
        notes="不建议逆向 App 或抓包私信接口。",
    ),
    "pinduoduo": ChannelSpec(
        channel_id="pinduoduo",
        display_name="拼多多",
        adapter_type="official_or_aggregator_api",
        status="planned",
        recommended_access="优先拼多多开放平台/商家后台授权接口",
        notes="订单、售后和客服消息要跟店铺授权绑定。",
    ),
    "taobao": ChannelSpec(
        channel_id="taobao",
        display_name="淘宝/天猫",
        adapter_type="official_or_aggregator_api",
        status="planned",
        recommended_access="优先阿里/淘宝开放平台、千牛商家服务能力",
        notes="适合先做订单上下文和售前咨询。",
    ),
    "douyin": ChannelSpec(
        channel_id="douyin",
        display_name="抖音/抖店",
        adapter_type="official_or_aggregator_api",
        status="planned",
        recommended_access="优先抖音开放平台/抖店开放能力",
        notes="要区分私信、抖店客服、线索留资和直播间线索。",
    ),
    "kuaishou": ChannelSpec(
        channel_id="kuaishou",
        display_name="快手/快手小店",
        adapter_type="official_or_aggregator_api",
        status="planned",
        recommended_access="优先快手电商开放平台/商家授权能力",
        notes="要区分短视频咨询、直播间咨询和小店订单咨询。",
    ),
}


def positive_int_setting(
    value: Any,
    name: str,
    default: int,
    *,
    min_value: int = 1,
    max_value: int = 3600,
) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        warning(f"[Channel] Invalid {name}: {value!r}; using default {default}.")
        return default
    if number < min_value or number > max_value:
        warning(
            f"[Channel] Out-of-range {name}: {number}; "
            f"using default {default}."
        )
        return default
    return number


class ChannelHub:
    """Route messages from multiple channel adapters through one bot core."""

    channel_id = "multi"
    display_name = "统一客服终端"

    def __init__(self, adapters: list[ChannelAdapter]):
        self.adapters = {adapter.channel_id: adapter for adapter in adapters}
        self.daily_count: dict[str, int] = {}
        self._sender_routes: dict[str, str] = {}
        self._seen_cache: set[str] = set()

    @property
    def _seen(self) -> set[str]:
        return self._seen_cache

    @_seen.setter
    def _seen(self, value: Iterable[str]) -> None:
        self._seen_cache = set(value)
        for adapter in self.adapters.values():
            if hasattr(adapter, "seen"):
                adapter.seen = self._seen_cache

    def get_new_messages(self) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        for channel_id, adapter in self.adapters.items():
            try:
                raw_messages = adapter.get_new_messages()
            except Exception as exc:
                warning(f"[Channel] {adapter.display_name} read failed: {exc}")
                continue

            for raw in raw_messages:
                msg = self._normalize_message(adapter, raw)
                self._sender_routes[msg.sender] = channel_id
                messages.append(msg.as_dict())
        return messages

    def send(self, text: str, who: str, platform: str | None = None) -> bool:
        adapter = self._resolve_adapter(who, platform)
        if not adapter:
            warning(f"[Channel] No adapter found for {who!r}, platform={platform!r}")
            return False
        return adapter.send(text, who)

    def send_image(self, image_path: str, who: str, platform: str | None = None) -> bool:
        adapter = self._resolve_adapter(who, platform)
        if not adapter:
            warning(f"[Channel] No adapter found for image send: {who!r}")
            return False
        return adapter.send_image(image_path, who)

    def is_connected(self) -> bool:
        if not self.adapters:
            return False
        return all(adapter.is_connected() for adapter in self.adapters.values())

    def reconnect(self) -> bool:
        ok = True
        for adapter in self.adapters.values():
            ok = adapter.reconnect() and ok
        return ok

    def mark_outgoing_seen(self, who: str, text: str, platform: str | None = None) -> None:
        adapter = self._resolve_adapter(who, platform)
        if adapter and hasattr(adapter, "mark_outgoing_seen"):
            adapter.mark_outgoing_seen(who, text)

    def list_status(self) -> list[dict[str, Any]]:
        rows = []
        for channel_id, spec in SUPPORTED_CHANNELS.items():
            adapter = self.adapters.get(channel_id)
            rows.append(
                {
                    "channel_id": channel_id,
                    "name": spec.display_name,
                    "status": "enabled" if adapter else spec.status,
                    "connected": bool(adapter and adapter.is_connected()),
                    "adapter_type": spec.adapter_type,
                    "recommended_access": spec.recommended_access,
                    "notes": spec.notes,
                }
            )
        return rows

    def _normalize_message(
        self, adapter: ChannelAdapter, raw: dict[str, Any]
    ) -> ChannelMessage:
        sender = str(raw.get("sender", "")).strip()
        content = str(raw.get("content", "")).strip()
        platform = str(raw.get("platform") or adapter.channel_id)
        channel_name = str(raw.get("channel_name") or adapter.display_name)
        return ChannelMessage(
            sender=sender,
            content=content,
            platform=platform,
            channel_name=channel_name,
            raw=raw,
        )

    def _resolve_adapter(
        self, who: str, platform: str | None = None
    ) -> ChannelAdapter | None:
        if platform and platform in self.adapters:
            return self.adapters[platform]
        routed = self._sender_routes.get(who)
        if routed and routed in self.adapters:
            return self.adapters[routed]
        if len(self.adapters) == 1:
            return next(iter(self.adapters.values()))
        return None


def create_channel_hub(settings: dict[str, Any]) -> ChannelHub:
    settings = _dict_or_empty(settings)
    channel_settings = _dict_or_empty(settings.get("channels"))
    active = _string_list(channel_settings.get("active"), default=["wechat"])
    adapters_config = _dict_or_empty(channel_settings.get("adapters"))

    adapters: list[ChannelAdapter] = []
    for channel_id in active:
        spec = SUPPORTED_CHANNELS.get(channel_id)
        if not spec:
            warning(f"[Channel] Unsupported channel skipped: {channel_id}")
            continue
        config = _dict_or_empty(adapters_config.get(channel_id))
        if config.get("enabled") is False:
            continue
        if channel_id != "wechat":
            warning(
                f"[Channel] {spec.display_name} adapter is planned but not implemented; skipped."
            )
            continue
        adapters.append(_build_adapter(channel_id, settings, config, spec))

    if not adapters:
        raise RuntimeError("没有可用的客服渠道。请至少启用 wechat 或配置其他平台适配器。")

    info("[Channel] Enabled: " + ", ".join(a.display_name for a in adapters))
    return ChannelHub(adapters)


def list_supported_channels() -> list[dict[str, str]]:
    return [
        {
            "channel_id": spec.channel_id,
            "name": spec.display_name,
            "status": spec.status,
            "adapter_type": spec.adapter_type,
            "recommended_access": spec.recommended_access,
            "notes": spec.notes,
        }
        for spec in SUPPORTED_CHANNELS.values()
    ]


def _build_adapter(
    channel_id: str,
    settings: dict[str, Any],
    config: dict[str, Any],
    spec: ChannelSpec,
) -> ChannelAdapter:
    if channel_id == "wechat":
        legacy_wechat = _dict_or_empty(settings.get("wechat"))
        poll_interval = positive_int_setting(
            config.get("poll_interval", legacy_wechat.get("poll_interval", 3)),
            "wechat.poll_interval",
            3,
            min_value=1,
            max_value=300,
        )
        anti_flood_seconds = positive_int_setting(
            config.get(
                "anti_flood_seconds",
                legacy_wechat.get("anti_flood_seconds", 60),
            ),
            "wechat.anti_flood_seconds",
            60,
            min_value=1,
            max_value=86400,
        )
        return WeChatPcAdapter(
            poll_interval=poll_interval,
            anti_flood_seconds=anti_flood_seconds,
        )
    return DisabledChannelAdapter(spec, reason="adapter not implemented")


def _dict_or_empty(value) -> dict:
    return value if isinstance(value, dict) else {}


def _string_list(value, default: list[str]) -> list[str]:
    if value is None:
        return list(default)
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else list(default)
    if not isinstance(value, (list, tuple, set)):
        return list(default)
    items = [str(item).strip() for item in value if str(item).strip()]
    return items or list(default)
