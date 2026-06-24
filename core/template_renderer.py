"""Reply template renderer.

Supported syntax:
- ``{{variable}}``: replace with the value from context.
- ``[or]``: split reply variants and pick one.
- ``[~]``: insert a small random tone marker, controlled by the template author.
"""

from __future__ import annotations

import random
import re
from typing import Callable, Sequence


ChoiceFn = Callable[[Sequence[str]], str]

_VARIABLE_RE = re.compile(r"\{\{(\w+)\}\}")
_RANDOM_MARKER_RE = re.compile(r"\[\~\]")
_RANDOM_TONE_MARKERS = ("", "", "呀", "呢", "哈")


def render(template: str, context: dict, chooser: ChoiceFn | None = None) -> str:
    """Render a customer-service reply template."""
    text = _replace_variables(template, context)
    text = choose_variant(text, chooser=chooser)
    return replace_random_markers(text)


def _replace_variables(template: str, context: dict) -> str:
    def replacer(match):
        var = match.group(1).strip()
        value = context.get(var)
        if value is None:
            return match.group(0)
        return str(value)

    return _VARIABLE_RE.sub(replacer, template)


def choose_variant(text: str, chooser: ChoiceFn | None = None) -> str:
    """Choose one reply variant separated by ``[or]``."""
    if "[or]" not in text:
        return text

    variants = [part.strip() for part in text.split("[or]") if part.strip()]
    if not variants:
        return ""
    if len(variants) == 1:
        return variants[0]

    pick = chooser or random.choice
    return pick(variants)


def replace_random_markers(text: str) -> str:
    """Replace every ``[~]`` marker with a light tone marker."""
    return _RANDOM_MARKER_RE.sub(lambda _: random.choice(_RANDOM_TONE_MARKERS), text)
