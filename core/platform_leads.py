# -*- coding: utf-8 -*-
"""平台线索本地承接层。

这里不登录、不抓取、不调用抖音/小红书/淘宝等第三方平台接口。
它只保存人工录入或后续导入的来源线索，并把字段整理成项目里已有
高价值客户评分模块可以消费的格式。
"""

from __future__ import annotations

from collections import Counter
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
import json
import os
from pathlib import Path
import tempfile
import uuid

from .paths import resource_path


DATA_VERSION = 1
DEFAULT_STATUS = "new"
WECHAT_BOUND_STATUS = "wechat_bound"
DEFAULT_DATA_PATH = Path(resource_path("data/platform_leads.json"))

PLATFORM_LABELS = {
    "douyin": "抖音",
    "xiaohongshu": "小红书",
    "taobao": "淘宝",
    "pinduoduo": "拼多多",
    "kuaishou": "快手",
    "wechat": "微信",
}

CORE_FIELDS = {
    "id",
    "platform",
    "nickname",
    "source_url",
    "source_note",
    "need",
    "wechat_id",
    "phone",
    "status",
    "lead_score",
    "quantity_estimate",
    "budget",
    "due_date",
    "city",
    "deal_value",
    "owner",
    "tags",
    "notes",
    "created_at",
    "updated_at",
}

HIGH_VALUE_FIELDS = [
    "session_id",
    "company_name",
    "contact_person",
    "phone",
    "wechat_id",
    "quantity_estimate",
    "budget",
    "due_date",
    "city",
    "deal_value",
    "lead_score",
    "stage",
    "source",
    "notes",
]

SAMPLE_LEADS = [
    {
        "platform": "douyin",
        "nickname": "sample_douyin_user",
        "source_note": "示例：短视频评论区咨询礼盒价格",
        "need": "想做 300 份中秋礼盒，先问大概价格",
        "wechat_id": "",
        "status": DEFAULT_STATUS,
        "lead_score": 55,
    },
    {
        "platform": "xiaohongshu",
        "nickname": "sample_xhs_user",
        "source_note": "示例：小红书私信咨询企业福利",
        "need": "公司采购礼盒，有预算，但交期未确认",
        "wechat_id": "sample_wechat",
        "status": WECHAT_BOUND_STATUS,
        "lead_score": 75,
    },
]


@dataclass
class PlatformLeadStore:
    """JSON-backed local store for manually captured platform leads."""

    path: Path | str = field(default_factory=lambda: DEFAULT_DATA_PATH)

    def __post_init__(self) -> None:
        self.path = Path(self.path)

    def add_lead(self, lead: dict | None = None, **fields) -> dict:
        payload = {}
        if lead:
            payload.update(lead)
        payload.update(fields)
        normalized = normalize_lead(payload, now=_now())

        data = self._load()
        data["leads"].append(normalized)
        self._save(data)
        return deepcopy(normalized)

    def list_leads(
        self,
        platform: str | None = None,
        status: str | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        leads = list(self._load()["leads"])
        if platform:
            platform_key = normalize_platform(platform)
            leads = [item for item in leads if item.get("platform") == platform_key]
        if status:
            status_key = normalize_text(status)
            leads = [item for item in leads if item.get("status") == status_key]
        leads.sort(
            key=lambda item: item.get("updated_at") or item.get("created_at") or "",
            reverse=True,
        )
        if limit is not None:
            leads = leads[: max(0, int(limit))]
        return deepcopy(leads)

    def get_lead(self, lead_id: str) -> dict | None:
        for lead in self._load()["leads"]:
            if lead.get("id") == lead_id:
                return deepcopy(lead)
        return None

    def update_lead(self, lead_id: str, fields: dict) -> dict:
        if not fields:
            raise ValueError("fields must not be empty")
        unknown = set(fields) - CORE_FIELDS
        if unknown:
            raise ValueError(f"unsupported platform lead fields: {', '.join(sorted(unknown))}")

        data = self._load()
        now = _now()
        for index, lead in enumerate(data["leads"]):
            if lead.get("id") != lead_id:
                continue
            updated = dict(lead)
            updated.update(_clean_update_fields(fields))
            updated["updated_at"] = now
            data["leads"][index] = normalize_lead(updated, now=now, preserve_id=True)
            self._save(data)
            return deepcopy(data["leads"][index])
        raise KeyError(f"platform lead not found: {lead_id}")

    def bind_wechat(
        self,
        lead_id: str,
        wechat_id: str,
        status: str = WECHAT_BOUND_STATUS,
    ) -> dict:
        wechat_id = normalize_text(wechat_id)
        if not wechat_id:
            raise ValueError("wechat_id must not be empty")
        return self.update_lead(lead_id, {"wechat_id": wechat_id, "status": status})

    def stats_by_platform(self) -> list[dict]:
        leads = self._load()["leads"]
        by_platform: dict[str, list[dict]] = {}
        for lead in leads:
            platform = normalize_platform(lead.get("platform")) or "unknown"
            by_platform.setdefault(platform, []).append(lead)

        stats = []
        for platform, items in sorted(by_platform.items()):
            status_counts = Counter(item.get("status") or DEFAULT_STATUS for item in items)
            bound_count = sum(1 for item in items if normalize_text(item.get("wechat_id")))
            stats.append(
                {
                    "platform": platform,
                    "platform_label": platform_label(platform),
                    "total": len(items),
                    "wechat_bound": bound_count,
                    "wechat_missing": len(items) - bound_count,
                    "status_counts": dict(sorted(status_counts.items())),
                }
            )
        return stats

    def high_value_inputs(self, limit: int | None = None) -> list[dict]:
        return [to_high_value_input(lead) for lead in self.list_leads(limit=limit)]

    def _load(self) -> dict:
        if not self.path.exists():
            return {"version": DATA_VERSION, "leads": []}
        raw = self.path.read_text(encoding="utf-8").strip()
        if not raw:
            return {"version": DATA_VERSION, "leads": []}
        data = json.loads(raw) or {}
        leads = data.get("leads") or []
        if not isinstance(leads, list):
            raise ValueError(f"invalid platform lead store: {self.path}")
        return {
            "version": int(data.get("version") or DATA_VERSION),
            "leads": [normalize_lead(item, now=_now(), preserve_id=True) for item in leads],
        }

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": DATA_VERSION, "leads": data.get("leads") or []}
        fd, tmp_name = tempfile.mkstemp(
            prefix=f".{self.path.name}.",
            suffix=".tmp",
            dir=str(self.path.parent),
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
                f.write("\n")
            os.replace(tmp_name, self.path)
        except Exception:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise


def normalize_lead(
    lead: dict,
    now: str | None = None,
    preserve_id: bool = False,
) -> dict:
    now = now or _now()
    platform = normalize_platform(lead.get("platform"))
    nickname = normalize_text(lead.get("nickname"))
    if not platform:
        raise ValueError("platform must not be empty")
    if not nickname:
        raise ValueError("nickname must not be empty")

    wechat_id = normalize_text(lead.get("wechat_id"))
    explicit_status = normalize_text(lead.get("status"))
    status = explicit_status or (WECHAT_BOUND_STATUS if wechat_id else DEFAULT_STATUS)
    lead_id = normalize_text(lead.get("id")) if preserve_id else ""
    if not lead_id:
        lead_id = f"pl_{uuid.uuid4().hex[:12]}"

    tags = lead.get("tags") or []
    if isinstance(tags, str):
        tags = [item.strip() for item in tags.split(",") if item.strip()]
    elif not isinstance(tags, list):
        tags = []

    created_at = normalize_text(lead.get("created_at")) or now
    updated_at = normalize_text(lead.get("updated_at")) or created_at

    return {
        "id": lead_id,
        "platform": platform,
        "nickname": nickname,
        "source_url": normalize_text(lead.get("source_url")),
        "source_note": normalize_text(lead.get("source_note")),
        "need": normalize_text(lead.get("need")),
        "wechat_id": wechat_id,
        "phone": normalize_text(lead.get("phone")),
        "status": status,
        "lead_score": to_int(lead.get("lead_score")),
        "quantity_estimate": normalize_text(lead.get("quantity_estimate")),
        "budget": normalize_text(lead.get("budget")),
        "due_date": normalize_text(lead.get("due_date")),
        "city": normalize_text(lead.get("city")),
        "deal_value": normalize_text(lead.get("deal_value")),
        "owner": normalize_text(lead.get("owner")),
        "tags": tags,
        "notes": normalize_text(lead.get("notes")),
        "created_at": created_at,
        "updated_at": updated_at,
    }


def to_high_value_input(lead: dict) -> dict:
    normalized = normalize_lead(lead, preserve_id=True)
    source_parts = [platform_label(normalized["platform"])]
    if normalized["source_url"]:
        source_parts.append(normalized["source_url"])
    elif normalized["source_note"]:
        source_parts.append(normalized["source_note"])

    payload = {
        "session_id": f"platform:{normalized['id']}",
        "company_name": normalized["nickname"],
        "contact_person": normalized["nickname"],
        "phone": normalized["phone"],
        "wechat_id": normalized["wechat_id"],
        "quantity_estimate": normalized["quantity_estimate"],
        "budget": normalized["budget"],
        "due_date": normalized["due_date"],
        "city": normalized["city"],
        "deal_value": normalized["deal_value"],
        "lead_score": normalized["lead_score"],
        "stage": stage_for_scoring(normalized["status"]),
        "source": " | ".join(item for item in source_parts if item),
        "notes": join_notes(normalized),
    }
    return {key: payload.get(key, "") for key in HIGH_VALUE_FIELDS}


def build_platform_report(
    store: PlatformLeadStore,
    limit: int = 200,
    include_samples_when_empty: bool = True,
) -> dict:
    leads = store.list_leads(limit=limit)
    return {
        "generated_at": _now(),
        "data_path": str(store.path),
        "total": len(leads),
        "items": leads,
        "stats": store.stats_by_platform(),
        "samples": deepcopy(SAMPLE_LEADS) if include_samples_when_empty and not leads else [],
    }


def render_platform_report(report: dict) -> str:
    lines = [
        "# 平台线索承接报表",
        "",
        f"- 生成时间：{report.get('generated_at', '')}",
        f"- 数据文件：`{report.get('data_path', '')}`",
        f"- 本次展示线索数：{report.get('total', 0)}",
        "",
        "## 按平台统计",
        "",
        "| 平台 | 线索数 | 已绑定微信 | 待绑定微信 | 状态分布 |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    stats = report.get("stats") or []
    if not stats:
        lines.append("| 暂无 | 0 | 0 | 0 | - |")
    else:
        for item in stats:
            status_text = ", ".join(
                f"{status}:{count}" for status, count in (item.get("status_counts") or {}).items()
            )
            lines.append(
                f"| {md(item.get('platform_label'))} | {item.get('total', 0)} | "
                f"{item.get('wechat_bound', 0)} | {item.get('wechat_missing', 0)} | "
                f"{md(status_text or '-')} |"
            )

    lines.extend(
        [
            "",
            "## 线索明细",
            "",
            "| 平台 | 昵称 | 状态 | 微信 | 需求 | 来源 | 线索分 | 更新时间 |",
            "| --- | --- | --- | --- | --- | --- | ---: | --- |",
        ]
    )
    items = report.get("items") or []
    if not items:
        lines.append("| 暂无真实平台线索 | - | - | - | - | - | 0 | - |")
    else:
        for lead in items:
            source = lead.get("source_url") or lead.get("source_note") or "-"
            lines.append(
                f"| {md(platform_label(lead.get('platform')))} | {md(lead.get('nickname'))} | "
                f"{md(lead.get('status'))} | {md(lead.get('wechat_id') or '-')} | "
                f"{md(lead.get('need') or '-')} | {md(source)} | "
                f"{to_int(lead.get('lead_score'))} | {md(lead.get('updated_at'))} |"
            )

    samples = report.get("samples") or []
    if samples:
        lines.extend(
            [
                "",
                "## 空状态说明",
                "",
                "当前没有本地平台线索数据。该模块只承接人工录入或导入的来源信息，不登录、不抓取第三方平台。",
                "",
                "| 平台 | 昵称 | 来源说明 | 需求 | 微信 | 状态 | 线索分 |",
                "| --- | --- | --- | --- | --- | --- | ---: |",
            ]
        )
        for lead in samples:
            lines.append(
                f"| {md(platform_label(lead.get('platform')))} | {md(lead.get('nickname'))} | "
                f"{md(lead.get('source_note'))} | {md(lead.get('need'))} | "
                f"{md(lead.get('wechat_id') or '-')} | {md(lead.get('status'))} | "
                f"{to_int(lead.get('lead_score'))} |"
            )

    lines.extend(
        [
            "",
            "## 高价值评分输入",
            "",
            "`to_high_value_input()` 会把平台线索转换成 `core.high_value.evaluate_lead()` 可消费字段。",
            "本报表不调用任何第三方平台接口，也不自动抓取平台数据。",
            "",
        ]
    )
    return "\n".join(lines)


def normalize_platform(value) -> str:
    text = normalize_text(value).lower()
    aliases = {
        "抖音": "douyin",
        "douyin": "douyin",
        "小红书": "xiaohongshu",
        "xhs": "xiaohongshu",
        "xiaohongshu": "xiaohongshu",
        "淘宝": "taobao",
        "taobao": "taobao",
        "拼多多": "pinduoduo",
        "pinduoduo": "pinduoduo",
        "快手": "kuaishou",
        "kuaishou": "kuaishou",
        "微信": "wechat",
        "wechat": "wechat",
    }
    return aliases.get(text, text)


def platform_label(platform) -> str:
    key = normalize_platform(platform)
    return PLATFORM_LABELS.get(key, key or "未知")


def normalize_text(value) -> str:
    return str(value or "").strip()


def stage_for_scoring(status: str) -> str:
    if status in {"lost", "closed_lost"}:
        return "closed_lost"
    if status in {"converted", "ordered", "closed_won"}:
        return "ordered"
    return "new_inquiry"


def join_notes(lead: dict) -> str:
    parts = []
    if lead.get("need"):
        parts.append(f"需求：{lead['need']}")
    if lead.get("source_note"):
        parts.append(f"来源说明：{lead['source_note']}")
    if lead.get("notes"):
        parts.append(lead["notes"])
    return "\n".join(parts)


def _clean_update_fields(fields: dict) -> dict:
    blocked = {"id", "created_at", "updated_at"}
    return {key: value for key, value in fields.items() if key in CORE_FIELDS and key not in blocked}


def to_int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def md(value) -> str:
    return str(value or "").replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
