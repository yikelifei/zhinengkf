# -*- coding: utf-8 -*-
"""Outbound answer guardrails for commercial customer service."""

from __future__ import annotations

from dataclasses import dataclass, field
import re

from .customer_profile import load_profile


@dataclass
class GuardResult:
    answer: str
    changed: bool = False
    blocked_phrases: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class AnswerGuard:
    """Remove risky promises before a reply reaches the customer."""

    DEFAULT_FORBIDDEN = (
        "保证当天发货",
        "保证最低价",
        "未核价直接给最终报价",
        "未确认排期承诺交期",
        "绝对没问题",
        "一定可以",
        "包退款",
        "包赔",
    )
    REPLACEMENTS = (
        (r"保证\s*当天\s*发货", "我们会根据数量、工艺和排期确认最快发货时间"),
        (r"保证\s*最低价", "我们会结合数量和配置给您核算合适方案"),
        (r"最终\s*报价", "参考报价"),
        (r"绝对\s*没问题", "需要先确认数量、工艺和排期"),
        (r"一定\s*可以", "需要先确认具体需求后判断"),
        (r"包\s*退款\s*包\s*赔|包\s*退\s*包\s*赔", "会由人工客服核实后处理"),
        (r"包\s*退款", "会由人工客服核实后处理"),
        (r"包\s*赔", "会由人工客服核实后处理"),
    )

    def __init__(self, profile: dict | None = None):
        self.profile = profile if profile is not None else load_profile()
        brand = self.profile.get("brand") or {}
        configured = [str(item).strip() for item in brand.get("forbidden_promises", []) if str(item).strip()]
        self.forbidden_phrases = configured or list(self.DEFAULT_FORBIDDEN)

    def sanitize(self, answer: str) -> GuardResult:
        text = str(answer or "").strip()
        original = text
        blocked: list[str] = []

        for pattern, replacement in self.REPLACEMENTS:
            if re.search(pattern, text, flags=re.I):
                text = re.sub(pattern, replacement, text, flags=re.I)
        text = self._dedupe_safe_after_sales_copy(text)

        compact = re.sub(r"\s+", "", text)
        for phrase in self.forbidden_phrases:
            if phrase and re.sub(r"\s+", "", phrase) in compact:
                blocked.append(phrase)

        if blocked:
            text = self._append_safe_disclaimer(text)

        warnings = []
        if re.search(r"\d+\s*元", text) and "参考" not in text and "预算" not in text and "核算" not in text:
            warnings.append("numeric_price_without_context")
            text = self._append_safe_disclaimer(text)
        if re.search(r"(今天|明天|当天).{0,8}(发货|到货)", text) and "确认" not in text:
            warnings.append("delivery_without_schedule_check")
            text = self._append_safe_disclaimer(text)

        text = re.sub(r"\s+", " ", text).strip()
        return GuardResult(
            answer=text,
            changed=text != original,
            blocked_phrases=blocked,
            warnings=warnings,
        )

    def audit_samples(self) -> list[dict]:
        samples = [
            "可以，保证当天发货，保证最低价。",
            "这个礼盒最终报价 29 元，绝对没问题。",
            "售后问题我们包退款包赔。",
            "标准定制一般 5-7 天，具体要看数量、工艺和排期。",
        ]
        rows = []
        for sample in samples:
            result = self.sanitize(sample)
            rows.append(
                {
                    "input": sample,
                    "output": result.answer,
                    "changed": result.changed,
                    "blocked_phrases": result.blocked_phrases,
                    "warnings": result.warnings,
                }
            )
        return rows

    def _append_safe_disclaimer(self, text: str) -> str:
        disclaimer = "具体价格和交期需按数量、工艺、库存和排期核实后确认。"
        if disclaimer in text:
            return text
        return text.rstrip("。；;，, ") + "。" + disclaimer

    def _dedupe_safe_after_sales_copy(self, text: str) -> str:
        safe_copy = "会由人工客服核实后处理"
        duplicate = f"{safe_copy}{safe_copy}"
        while duplicate in text:
            text = text.replace(duplicate, safe_copy)
        return text
