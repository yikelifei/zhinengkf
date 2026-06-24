# -*- coding: utf-8 -*-
"""Human-like reply coaching for customer-service answers."""

from __future__ import annotations

from dataclasses import dataclass
import re

import yaml

from .paths import resource_path


@dataclass(frozen=True)
class ReplyFeatures:
    has_quantity: bool = False
    has_budget: bool = False
    has_due_date: bool = False
    has_city: bool = False
    has_contact: bool = False
    urgent: bool = False
    price_sensitive: bool = False
    wants_visuals: bool = False
    has_custom_item: bool = False
    has_festival: bool = False


class ReplyStyleCoach:
    """Turn factual KB answers into concise, warmer, sales-ready replies."""

    DEFAULT_MAX_CHARS = 170
    SAFE_BYPASS_TOPICS = {"transfer_human", "out_of_scope"}

    def __init__(self, config_path: str = "config/reply_style.yaml"):
        self.config_path = resource_path(config_path)
        self.config = self._load_config()
        try:
            self.max_chars = int(self.config.get("max_chars", self.DEFAULT_MAX_CHARS))
        except (TypeError, ValueError):
            self.max_chars = self.DEFAULT_MAX_CHARS
        if self.max_chars <= 0:
            self.max_chars = self.DEFAULT_MAX_CHARS

    def polish(self, topic: str, base_answer: str, customer_message: str = "", history=None) -> str:
        base_answer = self._clean(base_answer)
        if not base_answer or topic in self.SAFE_BYPASS_TOPICS:
            return base_answer

        features = self.detect_features(customer_message, history=history)
        core = self._core_reply(topic, base_answer, features)
        followup = self._best_followup(topic, features)
        answer = self._compose(core, followup)
        return self._finalize(answer)

    def detect_features(self, customer_message: str, history=None) -> ReplyFeatures:
        text = self._history_text(history)
        text = f"{text} {customer_message or ''}".strip()
        lower = text.lower()
        return ReplyFeatures(
            has_quantity=bool(re.search(r"\d{1,7}\s*(份|个|套|盒|箱|件|单)", text)),
            has_budget=bool(
                re.search(r"(预算|价位|单价|价格|成本).{0,10}\d+", text)
                or re.search(r"\d+(?:\.\d+)?\s*(元|块|rmb)", lower, re.I)
            ),
            has_due_date=bool(
                re.search(r"(\d{1,2}\s*[月/-]\s*\d{1,2}\s*(日|号)?|\d{4}[/-]\d{1,2}[/-]\d{1,2})", text)
                or any(word in text for word in ("今天", "明天", "后天", "本周", "下周", "月底", "节前", "周五", "周六", "周日"))
            ),
            has_city=bool(re.search(r"(发到|送到|收货|城市|地址).{0,12}[\u4e00-\u9fa5]{2,12}", text)),
            has_contact=bool(
                re.search(r"1[3-9]\d{9}", text)
                or re.search(r"(微信|vx|wechat|电话|手机)[:：\s]*[A-Za-z0-9_\-]{5,20}", text, re.I)
            ),
            urgent=any(word in text for word in ("急", "加急", "来得及", "马上", "今天", "明天", "后天", "下周")),
            price_sensitive=any(word in text for word in ("便宜", "贵", "划算", "预算", "性价比", "成本")),
            wants_visuals=any(word in text for word in ("案例", "图片", "照片", "效果图", "看看", "款式", "推荐")),
            has_custom_item=any(word in lower for word in ("logo", "贺卡", "腰封", "吊牌", "丝带", "印字", "设计")),
            has_festival=any(word in text for word in ("端午", "中秋", "春节", "年货", "女神节", "七夕", "国庆", "伴手礼")),
        )

    def _history_text(self, history) -> str:
        if not history:
            return ""
        chunks = []
        for item in history[-8:]:
            if isinstance(item, dict) and item.get("role") in {"user", "customer"}:
                chunks.append(str(item.get("content", "")))
        return " ".join(chunks)

    def _core_reply(self, topic: str, base_answer: str, features: ReplyFeatures) -> str:
        if topic == "pricing":
            if features.price_sensitive:
                return (
                    "可以先按预算控制方案。礼盒价格主要看数量、材质和定制项，"
                    "常规款大致 8-35 元/份，高端定制约 35-80 元/份。"
                )
            return (
                "礼盒价格主要看数量、材质和定制项，常规企业礼盒大致 8-35 元/份，"
                "高端定制约 35-80 元/份。"
            )
        if topic == "moq":
            return "可以做，小批量也能先看方案。常规建议 50 份起，100 份以上价格和工艺选择会更灵活。"
        if topic == "delivery":
            if features.urgent:
                return "时间要先看排期，我先帮您判断是否来得及。常规是确认方案和设计稿后 5-7 个工作日。"
            return "常规交期一般是确认方案和设计稿后 5-7 个工作日，加急、复杂工艺或节日前高峰需要人工确认。"
        if topic == "customization":
            return "可以，企业 LOGO、贺卡、腰封、吊牌、丝带和祝福语都能定制，设计稿确认后再生产。"
        if topic == "styles":
            return "可以按端午、中秋、春节、企业伴手礼、简约商务、国潮和高端定制几个方向给您推荐。"
        if topic == "process":
            return "定制流程是先确认用途、数量、预算和收货城市，再匹配方案、确认设计稿、生产质检、发货。"
        if topic == "shipping":
            return "配送要看数量、体积和收货城市，大批量通常走物流，小批量可走快递，运费按地址核算。"
        if topic == "quote_qualification":
            return "可以，我先帮您把需求整理清楚，方便人工客服后面直接核价。"
        return base_answer

    def _best_followup(self, topic: str, features: ReplyFeatures) -> str:
        if topic == "pricing":
            if not features.has_quantity and not features.has_budget:
                return "您先发我预计数量和预算，我就能帮您判断适合哪一档。"
            if not features.has_quantity:
                return "您预计做多少份？我好按数量档位帮您估。"
            if not features.has_budget:
                return "您有大概预算吗？我可以按预算筛合适方案。"
            if not features.has_due_date:
                return "您计划哪天使用？我再一起判断交期。"
            if not features.has_contact:
                return "需要精确报价的话，方便留个电话或微信让人工核价。"
        if topic == "moq":
            if not features.has_quantity:
                return "您预计做多少份？我先判断是否适合起做。"
            if not features.has_due_date:
                return "您计划哪天使用？我再帮您看排期。"
            return "如果要精确核价，您再补充预算就行。"
        if topic == "delivery":
            if not features.has_due_date:
                return "您计划哪天使用？我先帮您判断时间是否紧。"
            if not features.has_quantity:
                return "您预计做多少份？我好判断排期压力。"
            return "如果还有 LOGO 或特殊工艺，也请一起告诉我。"
        if topic == "customization":
            if not features.has_quantity:
                return "您预计做多少份？我好判断工艺和成本。"
            if not features.has_budget:
                return "您预算大概在哪个区间？我好搭配定制项。"
            return "后续把 LOGO 文件发给人工设计师确认就可以。"
        if topic == "styles":
            if not features.has_festival:
                return "您想看端午、中秋、春节还是企业伴手礼方向？"
            if not features.has_budget:
                return "您预算大概在哪个区间？我按价位推荐更准。"
            return "您更偏简约商务、国潮还是高端定制风格？"
        if topic == "process":
            if not features.has_quantity:
                return "您先说下预计数量，我就能继续帮您往下判断。"
            if not features.has_budget:
                return "您预算大概在哪个区间？我好匹配方案。"
            if not features.has_city:
                return "收货城市是哪边？我再一起判断配送。"
        if topic == "shipping":
            if not features.has_city:
                return "您把收货城市发我，我好先判断配送方式。"
            if not features.has_quantity:
                return "您预计做多少份？我好判断快递还是物流更合适。"
            return "如果有使用日期，也发我一起判断时效。"
        if topic == "quote_qualification":
            missing = []
            if not features.has_quantity:
                missing.append("数量")
            if not features.has_budget:
                missing.append("预算")
            if not features.has_due_date:
                missing.append("使用日期")
            if not features.has_city:
                missing.append("城市")
            if missing:
                return f"麻烦先补充{self._join_fields(missing[:3])}。"
            if not features.has_contact:
                return "方便留个电话或微信吗？人工客服可以继续核价。"
        return "您可以补充数量、预算和使用日期，我再帮您判断。"

    def _compose(self, core: str, followup: str) -> str:
        core = self._clean(core)
        followup = self._clean(followup)
        if not followup:
            return core
        if followup in core:
            return core
        if core.endswith(("。", "！", "？", "!", "?")):
            return f"{core}{followup}"
        return f"{core}。{followup}"

    def _finalize(self, answer: str) -> str:
        text = self._clean(answer)
        text = self._dedupe_sentences(text)
        text = re.sub(r"(吗？){2,}", "吗？", text)
        text = re.sub(r"(。){2,}", "。", text)
        if len(text) > self.max_chars:
            text = self._truncate_sentence(text, self.max_chars)
        return text

    def _dedupe_sentences(self, text: str) -> str:
        parts = re.findall(r"[^。！？!?]+[。！？!?]?", text)
        seen = set()
        kept = []
        for part in parts:
            normalized = part.strip("。！？!? ")
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            kept.append(part.strip())
        return "".join(kept) if kept else text

    def _truncate_sentence(self, text: str, max_len: int) -> str:
        marks = "。！？!?；;"
        cut = max(text.rfind(mark, 0, max_len) for mark in marks)
        if cut > 45:
            return text[:cut + 1].strip()
        return text[:max_len].rstrip("，,、；; ") + "。"

    def _join_fields(self, fields: list[str]) -> str:
        if len(fields) <= 1:
            return fields[0] if fields else "需求信息"
        if len(fields) == 2:
            return "和".join(fields)
        return "、".join(fields[:-1]) + "和" + fields[-1]

    def _clean(self, text: str) -> str:
        return re.sub(r"\s+", " ", str(text or "").strip())

    def _load_config(self) -> dict:
        try:
            with open(self.config_path, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            if not isinstance(data, dict):
                return {}
            config = data.get("reply_style", data)
            return config if isinstance(config, dict) else {}
        except FileNotFoundError:
            return {}
