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
        return [
            skill for skill in data.get("skills", [])
            if skill.get("enabled", True)
        ]

    def match_topic(self, text):
        best = None
        best_score = 0
        for skill in self.skills:
            score = 0
            for keyword in skill.get("keywords", []):
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
        answer = skill.get("answer", "").strip()
        followup = skill.get("followup", "").strip()
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
