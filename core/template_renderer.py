""" 话术模板渲染器 — 支持 {{variable}} 变量替换 """

import re


def render(template: str, context: dict) -> str:
    """将模板中的 {{variable}} 替换为 context 中的值"""
    def replacer(match):
        var = match.group(1).strip()
        value = context.get(var)
        if value is None:
            return match.group(0)  # 找不到就保留原样
        return str(value)

    return re.sub(r'\{\{(\w+)\}\}', replacer, template)
