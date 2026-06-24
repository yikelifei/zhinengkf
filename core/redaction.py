#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Helpers for removing local machine paths from user-facing output."""

from __future__ import annotations

from pathlib import Path
import re


def redact_internal_paths(value, *, project_root: str | Path | None = None) -> str:
    text = str(value or "")
    if project_root:
        root = Path(project_root).resolve()
        for candidate in {str(root), root.as_posix()}:
            if candidate:
                text = text.replace(candidate, "[project]")

    text = re.sub(r"[A-Za-z]:[\\/]+Users[\\/]+[^\\/|\s:]+[\\/]+", "[user]/", text)
    text = re.sub(r"/(?:Users|home)/[^/\s|:]+/", "[user]/", text)
    return text
