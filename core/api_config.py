# -*- coding: utf-8 -*-
"""API provider configuration helpers for the desktop console."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from pathlib import Path
import os

import yaml

from .env_loader import load_env
from .paths import resource_path


PROVIDER_PRESETS = {
    "geeknow": {
        "label": "GeekNow API",
        "base_url": "https://api.geeknow.ai/v1",
        "model": "gpt-4o-mini",
        "request_format": "openai",
    },
    "openai": {
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4.1-mini",
        "request_format": "openai",
    },
    "deepseek": {
        "label": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-chat",
        "request_format": "openai",
    },
    "dashscope": {
        "label": "通义千问 DashScope",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-plus",
        "request_format": "openai",
    },
    "zhipu": {
        "label": "智谱 GLM",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "model": "glm-4",
        "request_format": "openai",
    },
    "moonshot": {
        "label": "Kimi / Moonshot",
        "base_url": "https://api.moonshot.cn/v1",
        "model": "moonshot-v1-8k",
        "request_format": "openai",
    },
}


def load_env_file(path=".env") -> None:
    load_env(path)


def _settings_path(path="config/settings.yaml") -> Path:
    return Path(resource_path(path))


def _expand_env(value):
    if not isinstance(value, str):
        return value
    if value.startswith("${") and value.endswith("}"):
        key = value[2:-1].split(":", 1)[0]
        return os.environ.get(key, value)
    return os.path.expandvars(value)


def _looks_unset(value) -> bool:
    text = str(value or "").strip()
    lowered = text.lower()
    return (
        not text
        or "${" in text
        or lowered.startswith("sk-your-")
        or lowered.startswith("your-")
        or "example.com" in lowered
        or lowered in {"changeme", "change-me", "replace-me"}
    )


def load_settings(path="config/settings.yaml") -> dict:
    load_env_file()
    settings_file = _settings_path(path)
    with open(settings_file, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def save_settings(settings: dict, path="config/settings.yaml") -> Path:
    settings_file = _settings_path(path)
    backup_dir = settings_file.parent / "backups"
    backup_dir.mkdir(exist_ok=True)
    if settings_file.exists():
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = backup_dir / f"{settings_file.stem}_{stamp}.yaml"
        backup_file.write_text(settings_file.read_text(encoding="utf-8"), encoding="utf-8")

    with open(settings_file, "w", encoding="utf-8") as f:
        yaml.safe_dump(settings, f, allow_unicode=True, sort_keys=False)
    return settings_file


def ensure_provider(settings: dict, provider_name: str) -> dict:
    settings.setdefault("ai_engine", {})
    settings["ai_engine"].setdefault("providers", {})
    providers = settings["ai_engine"]["providers"]
    if provider_name not in providers:
        preset = deepcopy(PROVIDER_PRESETS.get(provider_name, PROVIDER_PRESETS["geeknow"]))
        providers[provider_name] = {
            "enabled": False,
            "api_key": "",
            "base_url": preset["base_url"],
            "model": preset["model"],
            "request_format": preset["request_format"],
            "temperature": 0.4,
            "max_tokens": 800,
        }
    return providers[provider_name]


def provider_display_name(provider_name: str) -> str:
    return PROVIDER_PRESETS.get(provider_name, {}).get("label", provider_name)


def validate_provider_config(provider: dict) -> list[str]:
    issues = []
    api_key = _expand_env(provider.get("api_key", ""))
    base_url = _expand_env(provider.get("base_url", ""))
    model = _expand_env(provider.get("model", ""))
    if not provider.get("enabled", False):
        issues.append("供应商未启用")
    if _looks_unset(api_key):
        issues.append("API Key 未配置或环境变量未生效")
    if not base_url:
        issues.append("Base URL 未配置")
    elif _looks_unset(base_url):
        issues.append("Base URL 未配置或仍是占位值")
    elif "${" in str(base_url):
        issues.append("Base URL 环境变量未生效")
    elif not str(base_url).startswith(("http://", "https://")):
        issues.append("Base URL 必须以 http:// 或 https:// 开头")
    if _looks_unset(model):
        issues.append("模型名称未配置或环境变量未生效")
    try:
        temperature = float(provider.get("temperature", 0.4))
        if not 0 <= temperature <= 2:
            issues.append("Temperature 应在 0 到 2 之间")
    except Exception:
        issues.append("Temperature 必须是数字")
    try:
        max_tokens = int(provider.get("max_tokens", 800))
        if max_tokens <= 0:
            issues.append("Max Tokens 必须大于 0")
    except Exception:
        issues.append("Max Tokens 必须是整数")
    return issues


def update_provider(
    provider_name: str,
    *,
    enabled: bool,
    api_key: str,
    base_url: str,
    model: str,
    temperature: float,
    max_tokens: int,
    set_primary: bool = False,
    path="config/settings.yaml",
) -> dict:
    settings = load_settings(path)
    provider = ensure_provider(settings, provider_name)
    provider.update(
        {
            "enabled": enabled,
            "api_key": api_key,
            "base_url": base_url.rstrip("/"),
            "model": model,
            "request_format": provider.get("request_format", "openai"),
            "temperature": float(temperature),
            "max_tokens": int(max_tokens),
        }
    )
    if set_primary:
        settings.setdefault("ai_engine", {})["primary"] = provider_name
        fallback = settings["ai_engine"].setdefault("fallback_chain", [])
        settings["ai_engine"]["fallback_chain"] = [p for p in fallback if p != provider_name]
    save_settings(settings, path)
    return settings


def test_openai_compatible_provider(provider: dict, timeout=15) -> tuple[bool, str]:
    import requests

    issues = [
        issue
        for issue in validate_provider_config({**provider, "enabled": True})
        if issue != "供应商未启用"
    ]
    if issues:
        return False, "；".join(issues)

    api_key = _expand_env(provider.get("api_key", ""))
    base_url = _expand_env(provider.get("base_url", "")).rstrip("/")
    model = _expand_env(provider.get("model", ""))
    if _looks_unset(api_key):
        return False, "API Key 未配置或环境变量未生效"
    if not base_url:
        return False, "Base URL 未配置"
    if not model:
        return False, "模型名称未配置"

    url = f"{base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "temperature": provider.get("temperature", 0.2),
        "max_tokens": min(int(provider.get("max_tokens", 100)), 100),
    }
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=timeout)
        if resp.status_code >= 400:
            return False, f"HTTP {resp.status_code}: {resp.text[:200]}"
        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return True, f"连接成功，模型返回：{content[:80] or 'OK'}"
    except Exception as exc:
        return False, f"连接失败：{exc}"
