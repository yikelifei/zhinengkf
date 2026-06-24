"""Unified customer-message channel adapters.

The bot core should not know whether a message came from WeChat, Taobao,
Douyin, or another platform.  Every adapter exposes the same small surface:
poll new messages, send text, send image, check health, and reconnect.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Protocol


@dataclass(frozen=True)
class ChannelSpec:
    channel_id: str
    display_name: str
    adapter_type: str
    status: str
    recommended_access: str
    notes: str = ""


@dataclass
class ChannelMessage:
    sender: str
    content: str
    platform: str
    channel_name: str
    raw: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        data = dict(self.raw or {})
        data.update(
            {
                "sender": self.sender,
                "content": self.content,
                "platform": self.platform,
                "channel_id": self.platform,
                "channel_name": self.channel_name,
            }
        )
        return data


class ChannelAdapter(Protocol):
    channel_id: str
    display_name: str

    def get_new_messages(self) -> list[dict[str, Any]]:
        ...

    def send(self, text: str, who: str) -> bool:
        ...

    def send_image(self, image_path: str, who: str) -> bool:
        ...

    def is_connected(self) -> bool:
        ...

    def reconnect(self) -> bool:
        ...


class DisabledChannelAdapter:
    """Registered but inactive channel.

    This makes planned channels visible to the console and docs without
    pretending that platform messaging is already connected.
    """

    def __init__(self, spec: ChannelSpec, reason: str = "not enabled"):
        self.channel_id = spec.channel_id
        self.display_name = spec.display_name
        self.spec = spec
        self.reason = reason

    def get_new_messages(self) -> list[dict[str, Any]]:
        return []

    def send(self, text: str, who: str) -> bool:
        return False

    def send_image(self, image_path: str, who: str) -> bool:
        return False

    def is_connected(self) -> bool:
        return False

    def reconnect(self) -> bool:
        return False


class WeChatPcAdapter:
    """Adapter around the existing WeChat PC automation implementation."""

    channel_id = "wechat"
    display_name = "微信"

    def __init__(self, poll_interval: int = 3, anti_flood_seconds: int = 60):
        from core.wechat import ChatListener

        self.client = ChatListener(
            poll_interval=poll_interval,
            anti_flood_seconds=anti_flood_seconds,
        )

    def get_new_messages(self) -> list[dict[str, Any]]:
        return self.client.get_new_messages()

    def send(self, text: str, who: str) -> bool:
        return self.client.send(text, who)

    def send_image(self, image_path: str, who: str) -> bool:
        return self.client.send_image(image_path, who)

    def is_connected(self) -> bool:
        return self.client.is_connected()

    def reconnect(self) -> bool:
        return self.client.reconnect()

    def mark_outgoing_seen(self, who: str, text: str) -> None:
        if hasattr(self.client, "mark_outgoing_seen"):
            self.client.mark_outgoing_seen(who, text)

    @property
    def seen(self) -> set[str]:
        if not hasattr(self.client, "_seen"):
            self.client._seen = set()
        return self.client._seen

    @seen.setter
    def seen(self, value: Iterable[str]) -> None:
        self.client._seen = set(value)
