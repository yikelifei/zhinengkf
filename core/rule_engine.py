""" 规则引擎 — 关键词匹配 → 话术模板 → 回复 """


class RuleEngine:
    def __init__(self, keywords_config):
        self.keywords = keywords_config

    def match(self, message_text: str):
        """
        返回 (intent_id, reply_text) 或 (None, None)
        """
        candidates = []
        for intent_id, rule in self.keywords.items():
            if intent_id == 'welcome':
                continue

            kw_list = rule.get('keywords', [])
            for kw in kw_list:
                if kw in message_text:
                    priority = rule.get('priority', 0)
                    candidates.append((priority, intent_id, rule))

        if not candidates:
            return None, None

        # 按优先级降序排列，取最高分
        candidates.sort(key=lambda x: x[0], reverse=True)
        _, intent_id, rule = candidates[0]

        template = rule.get('reply_template', '')
        return intent_id, template
