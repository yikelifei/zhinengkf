# -*- coding: utf-8 -*-
"""Lightweight agentic RAG workflow for customer support."""

from dataclasses import dataclass, field
import re

import yaml

from .answer_guard import AnswerGuard
from .paths import resource_path
from .reply_style import ReplyStyleCoach
from .skill_registry import SkillRegistry


@dataclass
class AgentDecision:
    route: str
    topic: str = "general"
    confidence: float = 0.0
    answer: str = ""
    context: str = ""
    citations: list[str] = field(default_factory=list)
    reason: str = ""


class CustomerSupportAgent:
    """Question validation -> topic routing -> retrieval -> answer guard."""

    TRANSFER_KEYWORDS = (
        "人工", "客服", "电话", "语音", "投诉", "差评", "退款", "售后",
        "发票", "付款异常", "被骗", "举报", "工商", "律师", "合同",
    )
    OUT_OF_SCOPE_KEYWORDS = (
        "股票", "彩票", "贷款", "博彩", "色情", "违法", "破解", "外挂",
    )

    def __init__(self, knowledge_path="config/customer_knowledge.yaml"):
        self.knowledge_path = resource_path(knowledge_path)
        try:
            with open(self.knowledge_path, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
        except (FileNotFoundError, yaml.YAMLError):
            data = {}
        if not isinstance(data, dict):
            data = {}
        documents = data.get("documents") or []
        self.documents = (
            [doc for doc in documents if isinstance(doc, dict)]
            if isinstance(documents, list)
            else []
        )
        self.skill_registry = SkillRegistry()
        self.answer_guard = AnswerGuard()
        self.reply_style = ReplyStyleCoach()

    def analyze(self, message, history=None):
        text = self._normalize(message)
        valid, reason = self._validate_question(text)
        if not valid:
            return AgentDecision(route="ignore", reason=reason)

        topic = self._classify_topic(text)
        if topic == "transfer_human":
            return AgentDecision(
                route="direct_reply",
                topic=topic,
                confidence=1.0,
                answer="已为您转接人工客服，请稍等。",
                reason="handoff_keyword",
            )
        if topic == "out_of_scope":
            return AgentDecision(
                route="direct_reply",
                topic=topic,
                confidence=1.0,
                answer="这个问题超出礼盒定制服务范围，已为您转接人工客服，请稍等。",
                reason="out_of_scope",
            )

        skill_answer = self.skill_registry.answer_for(topic)
        skill_route = self.skill_registry.route_for(topic)
        if skill_answer and skill_route in {"ask_clarifying", "transfer_human"}:
            route_topic = "transfer_human" if skill_route == "transfer_human" else topic
            answer = skill_answer
            if skill_route != "transfer_human":
                answer = self.reply_style.polish(topic, skill_answer, text, history=history)
            return AgentDecision(
                route="direct_reply",
                topic=route_topic,
                confidence=0.8,
                answer=self.validate_answer(answer),
                reason="skill_registry",
            )

        docs = self._retrieve(text)
        relevant = self._grade_documents(text, docs)
        if not relevant:
            if skill_answer:
                route_topic = "transfer_human" if skill_route == "transfer_human" else topic
                answer = skill_answer
                if skill_route != "transfer_human":
                    answer = self.reply_style.polish(topic, skill_answer, text, history=history)
                return AgentDecision(
                    route="direct_reply",
                    topic=route_topic,
                    confidence=0.75,
                    answer=self.validate_answer(answer),
                    reason="skill_registry",
                )
            return AgentDecision(route="ai", topic=topic, confidence=0.3)

        if skill_answer and skill_route == "direct_reply" and not self._is_builtin_knowledge_topic(topic):
            answer = self.reply_style.polish(topic, skill_answer, text, history=history)
            return AgentDecision(
                route="direct_reply",
                topic=topic,
                confidence=0.75,
                answer=self.validate_answer(answer),
                context=self._build_context(relevant),
                citations=[d["doc"]["id"] for d in relevant],
                reason="skill_registry",
            )

        context = self._build_context(relevant)
        confidence = min(1.0, relevant[0]["score"] / 4.0)

        if confidence >= 0.5 and self._is_standard_question(topic, text):
            answer = self._direct_answer(topic, relevant[0]["doc"]["answer"], text, history=history)
            return AgentDecision(
                route="direct_reply",
                topic=topic,
                confidence=confidence,
                answer=self.validate_answer(answer),
                context=context,
                citations=[d["doc"]["id"] for d in relevant],
                reason="high_confidence_kb",
            )

        return AgentDecision(
            route="ai",
            topic=topic,
            confidence=confidence,
            context=context,
            citations=[d["doc"]["id"] for d in relevant],
            reason="rag_context",
        )

    def validate_answer(self, answer):
        text = self._normalize(answer)
        text = re.sub(r"<think>.*?</think>", "", text, flags=re.I | re.S)
        text = re.sub(r"<[^>]+>", "", text).strip()
        text = re.sub(r"\s+", " ", text)
        if any(k in text for k in self.TRANSFER_KEYWORDS[:8]) and "已为您转接人工客服" in text:
            return "已为您转接人工客服，请稍等。"
        if len(text) > 180:
            text = self._truncate_sentence(text, 180)
        return self.answer_guard.sanitize(text).answer

    def _validate_question(self, text):
        if not text:
            return False, "empty"
        if len(text) > 800:
            return False, "too_long"
        if re.search(r"https?://|www\.|\.com|\.cn|\.top", text, re.I):
            return False, "link_or_ad"
        return True, ""

    def _classify_topic(self, text):
        if self._needs_handoff(text):
            return "transfer_human"
        if any(k in text for k in self.OUT_OF_SCOPE_KEYWORDS):
            return "out_of_scope"

        topic_keywords = {
            "process": ("流程", "怎么做", "怎么下单", "购买", "订购", "合作"),
        }
        for topic, keywords in topic_keywords.items():
            if any(k in text for k in keywords):
                return topic

        skill = self.skill_registry.match_topic(text)
        if skill:
            if skill.get("route") == "transfer_human":
                return "transfer_human"
            return skill.get("id", "general")

        topic_keywords = {
            "pricing": ("价格", "多少钱", "报价", "费用", "预算", "单价", "成本"),
            "moq": ("起订", "起做", "最低", "最少", "多少份", "小批量", "几份"),
            "delivery": ("交期", "多久", "几天", "发货", "加急", "来得及", "什么时候要"),
            "customization": ("定制", "logo", "LOGO", "贺卡", "腰封", "吊牌", "丝带", "设计"),
            "styles": ("款式", "案例", "图片", "照片", "效果图", "推荐", "有哪些", "种类"),
            "shipping": ("物流", "快递", "运费", "配送", "收货", "城市"),
        }
        for topic, keywords in topic_keywords.items():
            if any(k in text for k in keywords):
                return topic
        return "general"

    def _needs_handoff(self, text):
        if "电话" in text and re.search(r"电话[:：\s]*1[3-9]\d{9}", text):
            text = re.sub(r"电话[:：\s]*1[3-9]\d{9}", "", text)
        return any(k in text for k in self.TRANSFER_KEYWORDS)

    def _retrieve(self, text):
        results = []
        for doc in self.documents:
            score = 0
            keywords = doc.get("keywords") or []
            if isinstance(keywords, str):
                keywords = [item.strip() for item in keywords.split(",") if item.strip()]
            elif not isinstance(keywords, list):
                keywords = []
            for kw in keywords:
                kw = str(kw).strip()
                if kw and kw in text:
                    score += 2
            title = str(doc.get("title") or "")
            if title and title in text:
                score += 1
            if doc.get("route") == "transfer_human" and score > 0:
                score += 5
            if score:
                results.append({"doc": doc, "score": score})
        results.sort(key=lambda item: item["score"], reverse=True)
        return results[:3]

    def _grade_documents(self, _text, docs):
        return [item for item in docs if item["score"] >= 2]

    def _build_context(self, docs):
        lines = []
        for item in docs:
            doc = item["doc"]
            lines.append(f"{doc.get('title')}: {doc.get('answer')}")
        return "\n".join(lines)

    def _is_standard_question(self, topic, text):
        if topic in {"pricing", "moq", "delivery", "process", "shipping"}:
            return True
        return len(text) <= 40 and topic in {"customization", "styles"}

    def _is_builtin_knowledge_topic(self, topic):
        return topic in {
            "pricing", "moq", "delivery", "process",
            "shipping", "customization", "styles",
        }

    def _direct_answer(self, topic, base_answer, customer_message="", history=None):
        base_answer = str(base_answer or "")
        skill_answer = self.skill_registry.answer_for(topic)
        if skill_answer:
            base_answer = skill_answer
        followups = {
            "pricing": "您方便说下预计数量、预算区间和使用日期吗？",
            "moq": "您预计要做多少份、什么时候使用？",
            "delivery": "您计划哪天使用、预计做多少份？",
            "process": "您先说下节日用途和预计数量就行。",
            "customization": "您是需要加 LOGO、贺卡、腰封还是吊牌？",
            "styles": "您想看端午、中秋、春节还是企业伴手礼方向？",
            "shipping": "您把收货城市和预计数量发我，我好帮您判断配送方式。",
        }
        tail = followups.get(topic, "您可以补充数量、预算和使用日期。")
        if tail in base_answer:
            answer = base_answer
        else:
            answer = f"{base_answer}{tail}"
        return self.reply_style.polish(topic, answer, customer_message, history=history)

    def _truncate_sentence(self, text, max_len):
        marks = "。！？!?"
        cut = max(text.rfind(mark, 0, max_len) for mark in marks)
        if cut > 40:
            return text[:cut + 1]
        return text[:max_len].rstrip("，、；; ") + "。"

    def _normalize(self, text):
        return re.sub(r"\s+", " ", str(text or "").strip())
