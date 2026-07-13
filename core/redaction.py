#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Helpers for removing local machine paths from user-facing output."""

from __future__ import annotations

from pathlib import Path
import re


def _path_pattern(value: str | Path) -> str:
    """Return a case-insensitive regex body accepting either path separator."""
    parts = [part for part in re.split(r"[\\/]+", str(value).rstrip("\\/")) if part]
    return r"[\\/]+".join(re.escape(part) for part in parts)


def redact_internal_paths(value, *, project_root: str | Path | None = None) -> str:
    text = str(value or "")
    if project_root:
        raw_root = Path(project_root)
        resolved_root = raw_root.resolve()
        roots = {str(raw_root), str(resolved_root)}
        project_names = {raw_root.name, resolved_root.name}

        for candidate in roots:
            pattern = _path_pattern(candidate)
            if pattern:
                text = re.sub(pattern, "[project]", text, flags=re.IGNORECASE)

        # Old public reports can contain a previous checkout path whose drive or
        # parent directories no longer match the current resolved project root.
        # Redact only when the project name is a segment of an absolute Windows
        # path so ordinary prose mentioning the project remains untouched.
        for project_name in project_names:
            if not project_name:
                continue
            text = re.sub(
                rf"(?<!\w)[A-Za-z]:(?:[\\/]+[^\\/\r\n|<>:\"?*]+)*"
                rf"[\\/]+{re.escape(project_name)}(?=[\\/]|\s|$)",
                "[project]",
                text,
                flags=re.IGNORECASE,
            )

    text = re.sub(r"[A-Za-z]:[\\/]+Users[\\/]+[^\\/|\s:]+[\\/]+", "[user]/", text)
    text = re.sub(r"/(?:Users|home)/[^/\s|:]+/", "[user]/", text)
    return text
