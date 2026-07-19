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


def _linked_repository_name(project_root: Path) -> str | None:
    """Return the main repository name for a linked Git worktree, if present."""
    git_marker = project_root / ".git"
    if not git_marker.is_file():
        return None

    try:
        marker = git_marker.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        return None

    prefix = "gitdir:"
    if not marker.lower().startswith(prefix):
        return None

    git_dir = Path(marker[len(prefix) :].strip())
    if not git_dir.is_absolute():
        git_dir = (project_root / git_dir).resolve()

    for candidate in (git_dir, *git_dir.parents):
        if candidate.name.lower() == ".git":
            return candidate.parent.name or None
    return None


def redact_internal_paths(value, *, project_root: str | Path | None = None) -> str:
    text = str(value or "")
    if project_root:
        raw_root = Path(project_root)
        resolved_root = raw_root.resolve()
        roots = {str(raw_root), str(resolved_root)}
        project_names = {
            raw_root.name,
            resolved_root.name,
            _linked_repository_name(resolved_root),
        }

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
