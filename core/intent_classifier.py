""" 意图分类器 — 三级漏斗式分类 """


class IntentClassifier:
    def __init__(self, keywords_config):
        self.keywords = keywords_config if isinstance(keywords_config, dict) else {}
        # 预定义意图列表
        self.intents = {
            'welcome': {'name': '首次欢迎', 'handled_by': 'rule'},
            'greeting': {'name': '打招呼', 'handled_by': 'rule'},
            'price': {'name': '询价', 'handled_by': 'rule'},
            'min_order': {'name': '起订量', 'handled_by': 'rule'},
            'custom_process': {'name': '定制流程', 'handled_by': 'rule'},
            'card_custom': {'name': '贺卡定制', 'handled_by': 'rule'},
            'waistband_custom': {'name': '腰封定制', 'handled_by': 'rule'},
            'tag_custom': {'name': '吊牌定制', 'handled_by': 'rule'},
            'delivery_time': {'name': '交期', 'handled_by': 'rule'},
            'case_study': {'name': '案例/样品', 'handled_by': 'rule'},
            'quality_concern': {'name': '质量顾虑', 'handled_by': 'rule'},
            'competition': {'name': '竞品比较', 'handled_by': 'rule'},
            'order_confirm': {'name': '确定要买', 'handled_by': 'rule'},
            'transfer_human': {'name': '转人工', 'handled_by': 'rule'},
            'goodbye': {'name': '结束语', 'handled_by': 'rule'},
        }

    def classify(self, message_text: str) -> dict:
        """
        返回: {
            'intent': 'price',          # 意图ID
            'confidence': 'high',       # high / medium / low
            'matched_keywords': [...],  # 命中的关键词
            'is_welcome': False,        # 是否为欢迎语触发
            'action': None,             # 特殊动作（capture_lead_and_alert 等）
        }
        """
        text_lower = message_text.lower()
        candidates = []

        for intent_id, rule in self.keywords.items():
            if not isinstance(rule, dict):
                continue
            if intent_id == 'welcome':
                continue  # 欢迎语不由消息内容匹配

            raw_keywords = rule.get('keywords')
            if isinstance(raw_keywords, str):
                kw_list = [raw_keywords.strip()] if raw_keywords.strip() else []
            elif isinstance(raw_keywords, (list, tuple, set)):
                kw_list = [str(kw).strip() for kw in raw_keywords if str(kw).strip()]
            else:
                kw_list = []
            matched = [kw for kw in kw_list if kw in message_text or kw.lower() in text_lower]

            if matched:
                priority = rule.get('priority', 0)
                action = rule.get('action')
                candidates.append((priority, intent_id, matched, action))

        if not candidates:
            return {
                'intent': 'vague',
                'confidence': 'low',
                'matched_keywords': [],
                'is_welcome': False,
                'action': None,
            }

        # 按优先级排序，取最高分
        candidates.sort(key=lambda x: x[0], reverse=True)
        _, intent_id, matched_kw, action = candidates[0]

        # 判断置信度
        if len(matched_kw) >= 2:
            confidence = 'high'
        elif len(matched_kw) >= 1:
            confidence = 'medium'
        else:
            confidence = 'low'

        return {
            'intent': intent_id,
            'confidence': confidence,
            'matched_keywords': matched_kw,
            'is_welcome': False,
            'action': action,
        }

    def get_intent_info(self, intent_id: str) -> dict:
        """获取意图的元信息（名称、处理方式）"""
        return self.intents.get(intent_id, {'name': '未知', 'handled_by': 'ai'})
