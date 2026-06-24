# -*- coding: utf-8 -*-
"""High-value lead scoring and prioritization helpers."""

from __future__ import annotations

import re


FIELD_LABELS = {
    "phone_or_wechat": "联系方式",
    "quantity_estimate": "数量",
    "budget": "预算",
    "due_date": "使用日期",
    "city": "收货城市",
}

ADVANCED_STAGE_BONUS = {
    "info_collected": 5,
    "quotation_given": 10,
    "design_discussion": 10,
    "sample_sent": 15,
    "ready_to_order": 20,
    "ordered": 8,
    "closed_won": 8,
}

ADVANCED_HIGH_VALUE_STAGES = {
    "quotation_given",
    "design_discussion",
    "sample_sent",
    "ready_to_order",
    "ordered",
    "closed_won",
}


def evaluate_lead(lead: dict, rules: dict | None = None) -> dict:
    """Return a high-value assessment for one lead."""
    rules = rules or {}
    min_score = int(rules.get("high_value_min_score", rules.get("high_intent_score", 80)))
    min_deal_value = int(rules.get("high_value_min_deal_value", 10000))
    excluded_stages = set(rules.get("high_value_excluded_stages") or ["lost", "closed_lost"])
    required_fields = rules.get("required_fields") or [
        "phone_or_wechat", "quantity_estimate", "budget", "due_date", "city",
    ]

    stage = lead.get("stage") or "new_inquiry"
    lead_score = _to_int(lead.get("lead_score"))
    estimated_value, value_source = estimate_deal_value(lead)
    missing = missing_fields(lead, required_fields)
    has_contact = bool(lead.get("phone") or lead.get("wechat_id"))

    reasons = []
    if lead_score >= min_score:
        reasons.append(f"意向分 {lead_score} 达到高价值阈值 {min_score}")
    if estimated_value is not None and estimated_value >= min_deal_value:
        reasons.append(f"预计金额 {format_money(estimated_value)} 达到阈值 {format_money(min_deal_value)}")
    if stage in ADVANCED_HIGH_VALUE_STAGES:
        reasons.append("客户阶段已推进")
    if has_contact:
        reasons.append("已留联系方式")

    is_excluded = stage in excluded_stages
    is_high_value = (
        not is_excluded
        and (
            lead_score >= min_score
            or (estimated_value is not None and estimated_value >= min_deal_value)
            or stage in ADVANCED_HIGH_VALUE_STAGES
        )
    )

    priority_score = _priority_score(
        lead_score=lead_score,
        estimated_value=estimated_value,
        min_deal_value=min_deal_value,
        stage=stage,
        has_contact=has_contact,
        missing=missing,
        required_fields=required_fields,
    )

    if is_excluded:
        reasons.append("已排除阶段")
    if not reasons:
        reasons.append("暂未达到高价值条件")

    return {
        "is_high_value": is_high_value,
        "priority_score": priority_score,
        "lead_score": lead_score,
        "stage": stage,
        "estimated_deal_value": estimated_value,
        "estimated_value_source": value_source,
        "missing_fields": missing,
        "missing_labels": [FIELD_LABELS.get(item, item) for item in missing],
        "reasons": reasons,
        "suggested_action": suggest_action(lead, missing, is_high_value, estimated_value, min_deal_value),
    }


def estimate_deal_value(lead: dict) -> tuple[float | None, str]:
    """Estimate deal value from deal_value, or quantity times unit budget."""
    deal_value = amount_from_text(lead.get("deal_value"))
    if deal_value is not None:
        return deal_value, "deal_value"

    budget_text = str(lead.get("budget") or "")
    budget = amount_from_text(budget_text)
    quantity = quantity_from_text(lead.get("quantity_estimate"))
    if budget is None:
        return None, ""

    if quantity and _looks_like_unit_budget(budget_text, budget):
        return budget * quantity, "quantity_x_budget"

    return budget, "budget"


def amount_from_text(value) -> float | None:
    text = str(value or "").strip()
    if not text or text == "-":
        return None
    matches = re.findall(r"(\d+(?:\.\d+)?)\s*(万|w|W)?", text)
    amounts = []
    for raw, unit in matches:
        amount = float(raw)
        if unit:
            amount *= 10000
        amounts.append(amount)
    if not amounts:
        return None
    return max(amounts)


def quantity_from_text(value) -> int | None:
    text = str(value or "").strip()
    matches = re.findall(r"(\d{1,7})\s*(?:份|个|套|盒|箱|件|单)?", text)
    if not matches:
        return None
    return max(int(item) for item in matches)


def missing_fields(lead: dict, required_fields: list[str]) -> list[str]:
    missing = []
    for field in required_fields:
        if field == "phone_or_wechat":
            if not (lead.get("phone") or lead.get("wechat_id")):
                missing.append(field)
        elif not lead.get(field):
            missing.append(field)
    return missing


def suggest_action(
    lead: dict,
    missing: list[str],
    is_high_value: bool,
    estimated_value: float | None,
    min_deal_value: int,
) -> str:
    if not (lead.get("phone") or lead.get("wechat_id")):
        return "优先引导客户留下电话或微信，避免高价值线索流失。"
    if missing:
        labels = [FIELD_LABELS.get(item, item) for item in missing[:3]]
        return "补齐" + "、".join(labels) + "后安排人工核价。"
    if estimated_value is not None and estimated_value >= min_deal_value:
        return "当天优先人工核价，推进报价或方案确认。"
    if is_high_value:
        return "优先人工跟进，确认预算、方案和下单时间。"
    return "按普通线索继续培育。"


def format_money(value) -> str:
    if value is None:
        return "-"
    if value >= 10000:
        amount = f"{value / 10000:.1f}".rstrip("0").rstrip(".")
        return f"{amount}万元"
    return f"{int(value)}元" if float(value).is_integer() else f"{value:.2f}元"


def _looks_like_unit_budget(text: str, budget: float) -> bool:
    normalized = text.replace(" ", "")
    unit_markers = ("元/份", "/份", "每份", "单价", "一份", "一个", "每个")
    if any(marker in normalized for marker in unit_markers):
        return True
    return budget < 1000


def _priority_score(
    lead_score: int,
    estimated_value: float | None,
    min_deal_value: int,
    stage: str,
    has_contact: bool,
    missing: list[str],
    required_fields: list[str],
) -> int:
    score = min(lead_score, 100)
    if estimated_value is not None:
        if estimated_value >= min_deal_value:
            score += 20
        elif estimated_value >= min_deal_value * 0.5:
            score += 10
    score += ADVANCED_STAGE_BONUS.get(stage, 0)
    if has_contact:
        score += 10
    if required_fields:
        complete = max(0, len(required_fields) - len(missing))
        score += round(15 * complete / len(required_fields))
    return min(100, score)


def _to_int(value) -> int:
    try:
        return int(value or 0)
    except Exception:
        return 0
