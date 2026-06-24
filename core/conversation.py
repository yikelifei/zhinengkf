# -*- coding: utf-8 -*-
"""Conversation state and lead-information extraction."""

import re


class ConversationManager:
    MAX_AI_CONTEXT_ROUNDS = 6
    MAX_AI_CONTEXT_MESSAGES = MAX_AI_CONTEXT_ROUNDS * 2
    RECENT_CONTEXT_MESSAGES = 6
    MAX_CONTEXT_CHARS = 3600
    SUMMARY_MAX_CHARS = 1200
    SUMMARY_MESSAGE_CHARS = 180
    MAX_SINGLE_MESSAGE_CHARS = 900
    SUMMARY_PREFIX = "自动上下文压缩摘要："
    STAGES = [
        "new", "info_collected", "quotation_given",
        "design_discussion", "sample_sent",
        "ready_to_order", "ordered", "followup_needed",
    ]

    def __init__(self, db):
        self.db = db
        self.context_cache = {}
        self.context_summaries = {}

    def add_message(self, session_id, direction, content):
        """Save a message and keep the in-memory AI context in sync."""
        self.db.save_message(session_id, direction=direction, content=content)
        role = "user" if direction == "inbound" else "assistant"
        self.add_to_context(session_id, role, content)
        self.db.update_conversation_stage(session_id, "active")

    def add_to_context(self, session_id, role, content):
        """Add to context cache only, without touching the database."""
        if session_id not in self.context_cache:
            self.context_cache[session_id] = []
        self.context_cache[session_id].append({
            "role": role,
            "content": content,
        })
        self._compress_context_if_needed(session_id)

    def get_ai_context(self, session_id, exclude_latest_user_message=None):
        messages = list(self.context_cache.get(session_id, []))
        excluded_message = None
        if exclude_latest_user_message is not None:
            excluded_message = self._compact_text(
                exclude_latest_user_message,
                self.MAX_SINGLE_MESSAGE_CHARS,
            )
        if (
            excluded_message is not None
            and messages
            and isinstance(messages[-1], dict)
            and messages[-1].get("role") == "user"
            and messages[-1].get("content") in {exclude_latest_user_message, excluded_message}
        ):
            messages = messages[:-1]

        summary = self.context_summaries.get(session_id)
        if summary:
            return [{
                "role": "system",
                "content": f"{self.SUMMARY_PREFIX}\n{summary}",
            }] + messages
        return messages

    def clear_context(self, session_id):
        self.context_cache.pop(session_id, None)
        self.context_summaries.pop(session_id, None)

    def _compress_context_if_needed(self, session_id):
        messages = self.context_cache.get(session_id, [])
        if not messages:
            return

        self.context_cache[session_id] = [
            self._trim_message(message) for message in messages if isinstance(message, dict)
        ]
        messages = self.context_cache[session_id]

        while (
            len(messages) > self.MAX_AI_CONTEXT_MESSAGES
            or (
                self.context_summaries.get(session_id)
                and len(messages) > self.RECENT_CONTEXT_MESSAGES
            )
            or self._context_chars(session_id) > self.MAX_CONTEXT_CHARS
        ):
            keep_count = min(self.RECENT_CONTEXT_MESSAGES, max(2, len(messages) - 1))
            old_messages = messages[:-keep_count]
            if not old_messages:
                break

            self.context_summaries[session_id] = self._merge_summary(
                self.context_summaries.get(session_id, ""),
                old_messages,
            )
            self.context_cache[session_id] = messages[-keep_count:]
            messages = self.context_cache[session_id]

            if self._context_chars(session_id) <= self.MAX_CONTEXT_CHARS:
                break

            if len(messages) <= 2:
                break

    def _context_chars(self, session_id):
        total = len(self.context_summaries.get(session_id, ""))
        for message in self.context_cache.get(session_id, []):
            if isinstance(message, dict):
                total += len(str(message.get("role", ""))) + len(str(message.get("content", "")))
        return total

    def _merge_summary(self, existing, messages):
        lines = []
        if existing:
            lines.extend(line for line in existing.splitlines() if line.strip())
        for message in messages:
            if not isinstance(message, dict):
                continue
            role = "客户" if message.get("role") == "user" else "客服"
            content = self._compact_text(
                message.get("content", ""),
                self.SUMMARY_MESSAGE_CHARS,
            )
            if content:
                lines.append(f"{role}: {content}")

        merged = "\n".join(lines)
        if len(merged) <= self.SUMMARY_MAX_CHARS:
            return merged

        kept = []
        total = len("更早内容已压缩。")
        for line in reversed(merged.splitlines()):
            size = len(line) + 1
            if kept and total + size > self.SUMMARY_MAX_CHARS:
                break
            kept.append(line)
            total += size
        return "更早内容已压缩。\n" + "\n".join(reversed(kept))

    def _trim_message(self, message):
        return {
            "role": str(message.get("role") or "user").strip() or "user",
            "content": self._compact_text(
                message.get("content", ""),
                self.MAX_SINGLE_MESSAGE_CHARS,
            ),
        }

    def _compact_text(self, text, limit):
        value = re.sub(r"\s+", " ", str(text or "").strip())
        if len(value) <= limit:
            return value
        head = max(1, limit // 2 - 2)
        tail = max(1, limit - head - 5)
        return f"{value[:head]} ... {value[-tail:]}"

    def advance_stage(self, session_id, stage):
        if stage in self.STAGES:
            self.db.update_conversation_stage(session_id, stage)

    def extract_contact_info(self, message):
        """Extract lead fields from a customer message."""
        info = {}
        text = message or ""

        phone_match = re.search(r"(?<!\d)(1[3-9]\d{9})(?!\d)", text)
        if phone_match:
            info["phone"] = phone_match.group(1)

        wechat_match = re.search(
            r"(?:微信号|微信ID|wechat|vx|VX)[:：\s]*([a-zA-Z][\w\-]{5,19})",
            text,
            re.IGNORECASE,
        )
        if wechat_match:
            info["wechat_id"] = wechat_match.group(1).strip()

        company_match = re.search(
            r"([\u4e00-\u9fa5A-Za-z0-9（）()·]{2,30}(?:公司|集团|企业|工作室|工厂|商贸|贸易))",
            text,
        )
        if company_match:
            company = company_match.group(1)
            company = re.sub(r"^(我是|我们是|这里是|来自)", "", company)
            info["company_name"] = company
        else:
            simple_company = re.search(
                r"(?:我是|我们是|这里是|来自)[:：\s]*([\u4e00-\u9fa5A-Za-z0-9（）()·]{2,30}?)(?=，|,|。|\s|联系人|电话|$)",
                text,
            )
            if simple_company:
                info["company_name"] = simple_company.group(1).strip()

        name_match = re.search(
            r"(?:姓名|名字|称呼|联系人)[:：\s]*([\u4e00-\u9fa5A-Za-z]{1,20})",
            text,
        )
        if name_match:
            info["contact_person"] = name_match.group(1).strip()

        qty_match = re.search(r"(\d{1,7})\s*(份|个|套|盒|箱|件|单)", text)
        if qty_match:
            info["quantity_estimate"] = f"{qty_match.group(1)}{qty_match.group(2)}"

        budget_match = re.search(
            r"(?:预算|价位|单价|价格|成本).{0,8}?(\d+(?:\.\d+)?)\s*(?:元|块|RMB|rmb)?",
            text,
            re.IGNORECASE,
        )
        if budget_match:
            info["budget"] = f"{budget_match.group(1)}元"

        date_match = re.search(
            r"(\d{1,2}\s*[月/-]\s*\d{1,2}\s*(?:日|号)?|\d{4}[/-]\d{1,2}[/-]\d{1,2})",
            text,
        )
        if date_match:
            info["due_date"] = re.sub(r"\s+", "", date_match.group(1))

        city_match = re.search(
            r"(?:到|发到|收货|送到|地址|城市)[:：\s]*([\u4e00-\u9fa5]{2,12}?)(?:市|省|区|县|$)",
            text,
        )
        if city_match:
            info["city"] = city_match.group(1).strip()[:12]

        festival_keywords = {
            "端午": ["端午", "粽子"],
            "中秋": ["中秋", "月饼"],
            "春节": ["春节", "新年", "年货"],
            "女神节": ["三八", "女神", "妇女节"],
            "七夕": ["七夕"],
            "国庆": ["国庆"],
        }
        for festival, keywords in festival_keywords.items():
            if any(keyword in text for keyword in keywords):
                info["festival"] = festival
                break

        return info
