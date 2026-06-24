# -*- coding: utf-8 -*-
"""Small .env loader used when python-dotenv is unavailable."""

from pathlib import Path
import os

from .paths import resource_path


def load_env(path=".env") -> None:
    """Load environment variables from a .env file without overriding existing values."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        _load_env_fallback(path)
        return
    load_dotenv(resource_path(path), override=False)


def _load_env_fallback(path=".env") -> None:
    env_path = Path(resource_path(path))
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
