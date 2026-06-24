# -*- coding: utf-8 -*-
"""Config-driven customer-service skill registry."""

import yaml

from .paths import resource_path


class SkillRegistry:
    def __init__(self, skills_path="config/customer_skills.yaml"):
        self.skills_path = resource_path(skills_path)
        self.skills = self._load()

    def _load(self):
        try:
            with open(self.skills_path, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
        except FileNotFoundError:
            return []
        if not isinstance(data, dict):
            return []
        skills = data.get("skills") or []
        if not isinstance(skills, list):
            return []
        return [
            skill for skill in skills
            if isinstance(skill, dict) and skill.get("enabled", True)
        ]

    def match_topic(self, text):
        best = None
        best_score = 0
        for skill in self.skills:
            score = 0
            for keyword in self._keywords_for(skill):
                if keyword and keyword in text:
                    score += 1
            if score > best_score:
                best = skill
                best_score = score
        return best if best_score else None

    def answer_for(self, topic):
        skill = self.get(topic)
        if not skill:
            return ""
        answer = str(skill.get("answer") or "").strip()
        followup = str(skill.get("followup") or "").strip()
        if answer and followup and followup not in answer:
            return f"{answer}{followup}"
        return answer

    def route_for(self, topic):
        skill = self.get(topic)
        return skill.get("route", "") if skill else ""

    def get(self, topic):
        for skill in self.skills:
            if skill.get("id") == topic:
                return skill
        return None

    def _keywords_for(self, skill):
        keywords = skill.get("keywords") or []
        if isinstance(keywords, str):
            return [item.strip() for item in keywords.split(",") if item.strip()]
        if not isinstance(keywords, list):
            return []
        return [str(item).strip() for item in keywords if str(item).strip()]
