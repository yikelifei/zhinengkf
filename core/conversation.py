# -*- coding: utf-8 -*-
"""Conversation state and lead-information extraction."""

import re


class ConversationManager:
    MAX_AI_CONTEXT_ROUNDS = 6
    STAGES = [
        "new", "info_collected", "quotation_given",
        "design_discussion", "sample_sent",
        "ready_to_order", "ordered", "followup_needed",
    ]

    def __init__(self, db):
        self.db = db
        self.context_cache = {}

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
        max_rounds = self.MAX_AI_CONTEXT_ROUNDS * 2
        if len(self.context_cache[session_id]) > max_rounds:
            self.context_cache[session_id] = self.context_cache[session_id][-max_rounds:]

    def get_ai_context(self, session_id):
        return self.context_cache.get(session_id, [])

    def clear_context(self, session_id):
        self.context_cache.pop(session_id, None)

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
