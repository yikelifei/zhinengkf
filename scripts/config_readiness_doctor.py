#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Read-only configuration readiness doctor with secret-free output."""

from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

import yaml


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / ".codex_deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SCHEMA_VERSION = "smart_kefu_config_readiness_v1"
COMPONENT_ORDER = (
    "api",
    "web",
    "database",
    "personal_wechat_bridge",
    "wechat_work_customer_service",
    "design_platform",
    "model_chain",
)
SECRET_ENV_NAMES = {
    "DESIGN_PLATFORM_API_KEY",
    "DESIGN_PLATFORM_ACCESS_TOKEN",
    "DESIGN_PLATFORM_COOKIE",
    "DESIGN_PLATFORM_CALLBACK_API_KEY",
    "WECHAT_WORK_SECRET",
    "WECHAT_WORK_TOKEN",
    "WECHAT_WORK_ENCODING_AES_KEY",
}


def _dict_or_empty(value) -> dict:
    return value if isinstance(value, dict) else {}


def _text(value) -> str:
    return str(value or "").strip()


def _flag(value, default=False) -> bool:
    text = _text(value)
    if not text:
        return bool(default)
    return text.lower() not in {"0", "false", "no", "off"}


def _explicit_flag(value) -> bool:
    return _text(value) == "1"


def _port(value, default: int) -> tuple[int, bool]:
    raw = _text(value)
    if not raw:
        return default, True
    try:
        parsed = int(raw)
    except (TypeError, ValueError):
        return default, False
    return parsed, 1 <= parsed <= 65535


def _valid_http_url(value) -> bool:
    text = _text(value)
    if not text:
        return False
    try:
        parsed = urlsplit(text)
    except ValueError:
        return False
    return parsed.scheme in {"http", "https"} and bool(parsed.hostname)


def _looks_placeholder(value) -> bool:
    text = _text(value)
    lowered = text.lower()
    return (
        not text
        or "${" in text
        or lowered.startswith("sk-your-")
        or lowered.startswith("your-")
        or lowered.startswith("replace-")
        or lowered.startswith("replace-with-")
        or "example.com" in lowered
        or lowered in {"changeme", "change-me", "replace", "replace-me"}
    )


def _read_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    result: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            result[key] = value
    return result


def _read_settings(path: Path) -> tuple[dict, bool]:
    if not path.is_file():
        return {}, False
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, UnicodeError, yaml.YAMLError):
        return {}, False
    return (data, True) if isinstance(data, dict) else ({}, False)


def _read_runtime_json(path: Path) -> tuple[dict, bool]:
    if not path.is_file():
        return {}, True
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}, False
    return (data, True) if isinstance(data, dict) else ({}, False)


def _resolve_path(root: Path, value: str, default: Path) -> Path:
    text = _text(value)
    if not text:
        return default
    candidate = Path(text).expanduser()
    return candidate if candidate.is_absolute() else (root / candidate).resolve()


def _component(component_id: str, label: str, missing: list[str], details: dict) -> dict:
    unique_missing = list(dict.fromkeys(item for item in missing if item))
    return {
        "id": component_id,
        "label": label,
        "status": "blocked" if unique_missing else "ready",
        "missing": unique_missing,
        "details": details,
    }


def _check_api(env: dict[str, str]) -> tuple[dict, int]:
    port, valid = _port(env.get("API_PORT"), 3200)
    missing = [] if valid else ["API_PORT must be an integer from 1 to 65535"]
    return (
        _component(
            "api",
            "Nest API",
            missing,
            {"port": port, "healthPath": "/api/health", "bindHost": "127.0.0.1"},
        ),
        port,
    )


def _check_web(env: dict[str, str], api_port: int) -> dict:
    port, valid = _port(env.get("WEB_PORT"), 3100)
    missing = [] if valid else ["WEB_PORT must be an integer from 1 to 65535"]
    if valid and port == api_port:
        missing.append("WEB_PORT must differ from API_PORT")
    web_url = _text(env.get("WEB_URL"))
    if web_url and not _valid_http_url(web_url):
        missing.append("WEB_URL must be an http or https URL")
    return _component(
        "web",
        "Next.js Web",
        missing,
        {
            "port": port,
            "apiProxyPort": api_port,
            "electronUrlConfigured": bool(web_url),
        },
    )


def _check_database(env: dict[str, str]) -> dict:
    use_local_store = _flag(env.get("USE_LOCAL_STORE"), True)
    if use_local_store:
        return _component(
            "database",
            "Database / local store",
            [],
            {"mode": "local-json", "databaseUrlConfigured": False},
        )

    database_url = _text(env.get("DATABASE_URL"))
    missing: list[str] = []
    if _looks_placeholder(database_url):
        missing.append("DATABASE_URL")
    elif not database_url.startswith(("postgresql://", "postgres://")):
        missing.append("DATABASE_URL must use the PostgreSQL Prisma provider")
    return _component(
        "database",
        "Database / local store",
        missing,
        {"mode": "prisma-postgresql", "databaseUrlConfigured": not _looks_placeholder(database_url)},
    )


def _check_personal_wechat(env: dict[str, str]) -> dict:
    adapter = _text(env.get("WECHAT_SEND_ADAPTER")) or "dry_run"
    required_flags = (
        "PERSONAL_WECHAT_BRIDGE",
        "PERSONAL_WECHAT_SEND",
        "PERSONAL_WECHAT_ALLOW_UNVERIFIED_WINDOW",
        "PERSONAL_WECHAT_AUTO_ENTER",
    )
    flags = {name: _explicit_flag(env.get(name)) for name in required_flags}
    missing: list[str] = []
    if adapter != "windows_bridge":
        missing.append("WECHAT_SEND_ADAPTER=windows_bridge")
    missing.extend(f"{name}=1" for name, enabled in flags.items() if not enabled)
    api_base = _text(env.get("PERSONAL_WECHAT_API_BASE") or env.get("BRIDGE_API_BASE"))
    if api_base and not _valid_http_url(api_base):
        missing.append("PERSONAL_WECHAT_API_BASE or BRIDGE_API_BASE must be an http or https URL")
    return _component(
        "personal_wechat_bridge",
        "Personal WeChat bridge",
        missing,
        {
            "sendAdapter": adapter,
            "managedStartEnabled": flags["PERSONAL_WECHAT_BRIDGE"],
            "sendEnabled": flags["PERSONAL_WECHAT_SEND"],
            "allowUnverifiedWindow": flags["PERSONAL_WECHAT_ALLOW_UNVERIFIED_WINDOW"],
            "autoEnter": flags["PERSONAL_WECHAT_AUTO_ENTER"],
            "apiBaseConfigured": bool(api_base),
        },
    )


def _valid_wechat_work_aes_key(value: str) -> bool:
    text = _text(value)
    if _looks_placeholder(text):
        return False
    try:
        decoded = base64.b64decode(f"{text}=", validate=True)
    except (ValueError, TypeError):
        return False
    return len(decoded) == 32


def _check_wechat_work(env: dict[str, str]) -> dict:
    checks = {
        "corpId": "WECHAT_WORK_CORP_ID",
        "agentId": "WECHAT_WORK_AGENT_ID",
        "secret": "WECHAT_WORK_SECRET",
        "token": "WECHAT_WORK_TOKEN",
        "encodingAesKey": "WECHAT_WORK_ENCODING_AES_KEY",
        "openKfid": "WECHAT_WORK_OPEN_KFID",
        "defaultConversation": "WECHAT_WORK_DEFAULT_CONVERSATION_ID",
    }
    configured = {name: not _looks_placeholder(env.get(env_name)) for name, env_name in checks.items()}
    configured["encodingAesKey"] = _valid_wechat_work_aes_key(env.get("WECHAT_WORK_ENCODING_AES_KEY", ""))
    missing = [env_name for name, env_name in checks.items() if not configured[name]]
    if _text(env.get("WECHAT_WORK_ENCODING_AES_KEY")) and not configured["encodingAesKey"]:
        missing[missing.index("WECHAT_WORK_ENCODING_AES_KEY")] = "WECHAT_WORK_ENCODING_AES_KEY must decode to 32 bytes"
    api_base = _text(env.get("WECHAT_WORK_API_BASE_URL")) or "https://qyapi.weixin.qq.com"
    if not _valid_http_url(api_base):
        missing.append("WECHAT_WORK_API_BASE_URL must be an http or https URL")
    return _component(
        "wechat_work_customer_service",
        "WeCom customer service",
        missing,
        {
            "configured": configured,
            "apiBaseConfigured": bool(_text(env.get("WECHAT_WORK_API_BASE_URL"))),
            "callbackPath": "/api/wechat-work/callback",
        },
    )


def _runtime_string(env: dict[str, str], env_name: str, runtime: dict, runtime_key: str, fallback: str) -> str:
    env_value = _text(env.get(env_name))
    if env_value:
        return env_value
    runtime_value = runtime.get(runtime_key)
    if isinstance(runtime_value, str) and runtime_value.strip():
        return runtime_value.strip()
    return fallback


def _check_design_platform(root: Path, env: dict[str, str]) -> tuple[dict, dict]:
    desktop_root = root / "desktop"
    runtime_dir = _resolve_path(desktop_root, env.get("DESKTOP_RUNTIME_DIR", ""), desktop_root / ".runtime")
    runtime_path = _resolve_path(
        desktop_root,
        env.get("DESIGN_PLATFORM_RUNTIME_CONFIG", ""),
        runtime_dir / "design-platform-config.json",
    )
    runtime, runtime_valid = _read_runtime_json(runtime_path)
    adapter = _runtime_string(env, "DESIGN_PLATFORM_ADAPTER", runtime, "designPlatformAdapter", "standard_v1")
    default_base = "http://127.0.0.1:3000" if adapter == "art_image_local" else "http://127.0.0.1:3700"
    base_url = _runtime_string(env, "DESIGN_PLATFORM_BASE_URL", runtime, "designPlatformBaseUrl", default_base)
    access_token = _runtime_string(env, "DESIGN_PLATFORM_ACCESS_TOKEN", runtime, "designPlatformAccessToken", "")
    cookie = _runtime_string(env, "DESIGN_PLATFORM_COOKIE", runtime, "designPlatformCookie", "")
    device_id = _runtime_string(env, "DESIGN_PLATFORM_DEVICE_ID", runtime, "designPlatformDeviceId", "")
    api_key = _text(env.get("DESIGN_PLATFORM_API_KEY"))

    missing: list[str] = []
    if not runtime_valid:
        missing.append("DESIGN_PLATFORM_RUNTIME_CONFIG must contain a JSON object")
    if adapter not in {"standard_v1", "art_image_local"}:
        missing.append("DESIGN_PLATFORM_ADAPTER must be standard_v1 or art_image_local")
    if not _valid_http_url(base_url):
        missing.append("DESIGN_PLATFORM_BASE_URL")
    credential_configured = any(not _looks_placeholder(value) for value in (access_token, cookie, api_key))
    device_configured = not _looks_placeholder(device_id)
    if adapter == "art_image_local":
        if not credential_configured:
            missing.append("DESIGN_PLATFORM_ACCESS_TOKEN or DESIGN_PLATFORM_COOKIE or DESIGN_PLATFORM_API_KEY")
        if not device_configured:
            missing.append("DESIGN_PLATFORM_DEVICE_ID")

    component = _component(
        "design_platform",
        "Design platform",
        missing,
        {
            "adapter": adapter if adapter in {"standard_v1", "art_image_local"} else "invalid",
            "baseUrlConfigured": _valid_http_url(base_url),
            "credentialConfigured": credential_configured,
            "deviceIdConfigured": device_configured,
            "runtimeConfigPresent": runtime_path.is_file(),
            "runtimeConfigValid": runtime_valid,
            "liveCheckRequired": adapter == "art_image_local",
        },
    )
    source = {"present": runtime_path.is_file(), "valid": runtime_valid}
    return component, source


def _placeholder_name(value) -> str:
    match = re.fullmatch(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}", _text(value))
    return match.group(1) if match else ""


def _provider_missing(name: str, provider: dict) -> list[str]:
    from core.api_config import _expand_env, _looks_unset, parse_max_tokens, parse_temperature

    missing: list[str] = []
    for field, label in (("api_key", "api_key"), ("base_url", "base_url"), ("model", "model")):
        raw_value = provider.get(field, "")
        value = _expand_env(raw_value)
        if _looks_unset(value):
            missing.append(_placeholder_name(raw_value) or f"ai_engine.providers.{name}.{label}")
    base_url = _expand_env(provider.get("base_url", ""))
    if not _looks_unset(base_url) and not _valid_http_url(base_url):
        missing.append(f"ai_engine.providers.{name}.base_url must be an http or https URL")
    try:
        parse_temperature(provider.get("temperature", 0.4))
    except ValueError:
        missing.append(f"ai_engine.providers.{name}.temperature")
    try:
        parse_max_tokens(provider.get("max_tokens", 800))
    except ValueError:
        missing.append(f"ai_engine.providers.{name}.max_tokens")
    request_format = _text(provider.get("request_format")) or "openai"
    supported = name in {"openai", "zhipu", "deepseek"} or name.startswith("custom_api") or request_format == "openai"
    if not supported:
        missing.append(f"ai_engine.providers.{name}.request_format")
    return list(dict.fromkeys(missing))


def _check_model_chain(settings: dict, settings_valid: bool) -> dict:
    from core.api_config import validate_provider_config

    ai_engine = _dict_or_empty(settings.get("ai_engine"))
    providers = ai_engine.get("providers")
    missing: list[str] = []
    if not settings_valid:
        missing.append("config/settings.yaml must contain valid YAML mapping data")
    if not ai_engine:
        missing.append("config/settings.yaml: ai_engine")
    if not isinstance(providers, dict):
        missing.append("config/settings.yaml: ai_engine.providers")
        providers = {}

    engine_enabled = bool(ai_engine.get("enabled", True))
    if not engine_enabled:
        missing.append("ai_engine.enabled=true")

    primary = _text(ai_engine.get("primary"))
    fallback = ai_engine.get("fallback_chain")
    fallback_chain = [_text(item) for item in fallback if _text(item)] if isinstance(fallback, list) else []
    provider_states: list[dict] = []
    ready_names: list[str] = []

    for index, (raw_name, raw_provider) in enumerate(providers.items()):
        name = _text(raw_name) or f"provider_{index + 1}"
        roles: list[str] = []
        if name == primary:
            roles.append("primary")
        if name in fallback_chain:
            roles.append("fallback")
        if not isinstance(raw_provider, dict):
            provider_states.append(
                {"name": name, "status": "blocked", "roles": roles, "missing": [f"ai_engine.providers.{name}"]}
            )
            continue
        enabled = bool(raw_provider.get("enabled", False))
        if not enabled:
            provider_states.append({"name": name, "status": "disabled", "roles": roles, "missing": []})
            continue
        provider_missing = _provider_missing(name, raw_provider)
        validation_issues = validate_provider_config(raw_provider)
        status = "ready" if not provider_missing and not validation_issues else "blocked"
        if status == "ready":
            ready_names.append(name)
        provider_states.append({"name": name, "status": status, "roles": roles, "missing": provider_missing})

    if primary and primary not in providers:
        missing.append(f"ai_engine.primary provider '{primary}'")
    configured_order = ([primary] if primary else []) + fallback_chain
    attempt_order = [name for name in configured_order if name in ready_names]
    if not attempt_order:
        attempt_order = list(ready_names)
    if engine_enabled and not attempt_order:
        missing.append("at least one enabled AI provider with api_key, base_url and model")

    return _component(
        "model_chain",
        "AI model chain",
        missing,
        {
            "enabled": engine_enabled,
            "primary": primary or None,
            "fallbackChain": fallback_chain,
            "attemptOrder": attempt_order,
            "providers": provider_states,
        },
    )


@contextmanager
def _effective_environment(root: Path, environment: dict[str, str] | None):
    root_env = _read_env_file(root / ".env")
    desktop_env = _read_env_file(root / "desktop" / ".env")
    inherited = dict(os.environ if environment is None else environment)
    effective = {**root_env, **desktop_env, **inherited}
    old_environment = dict(os.environ)
    os.environ.clear()
    os.environ.update(effective)
    try:
        yield effective, root_env, desktop_env
    finally:
        os.environ.clear()
        os.environ.update(old_environment)


def build_report(root: Path = ROOT, environment: dict[str, str] | None = None) -> dict:
    root = Path(root).resolve()
    settings_path = root / "config" / "settings.yaml"
    settings, settings_valid = _read_settings(settings_path)
    root_example = _read_env_file(root / ".env.example")
    desktop_example = _read_env_file(root / "desktop" / ".env.example")

    with _effective_environment(root, environment) as (env, root_env, desktop_env):
        api, api_port = _check_api(env)
        design, design_runtime_source = _check_design_platform(root, env)
        components = [
            api,
            _check_web(env, api_port),
            _check_database(env),
            _check_personal_wechat(env),
            _check_wechat_work(env),
            design,
            _check_model_chain(settings, settings_valid),
        ]

    by_id = {item["id"]: item for item in components}
    components = [by_id[item] for item in COMPONENT_ORDER]
    ready_count = sum(item["status"] == "ready" for item in components)
    blocked_count = len(components) - ready_count
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "scope": "configuration-only",
        "liveChecksPerformed": False,
        "overall": "blocked" if blocked_count else "ready",
        "summary": {"ready": ready_count, "blocked": blocked_count, "total": len(components)},
        "sources": {
            "settingsYaml": {"present": settings_path.is_file(), "valid": settings_valid},
            "rootEnv": {"present": (root / ".env").is_file(), "configuredKeyCount": len(root_env)},
            "desktopEnv": {"present": (root / "desktop" / ".env").is_file(), "configuredKeyCount": len(desktop_env)},
            "rootEnvExample": {"present": (root / ".env.example").is_file(), "declaredKeyCount": len(root_example)},
            "desktopEnvExample": {
                "present": (root / "desktop" / ".env.example").is_file(),
                "declaredKeyCount": len(desktop_example),
            },
            "designPlatformRuntimeConfig": design_runtime_source,
        },
        "components": components,
    }
    _assert_report_is_secret_free(report, env)
    return report


def _assert_report_is_secret_free(report: dict, environment: dict[str, str]) -> None:
    payload = json.dumps(report, ensure_ascii=False)
    for name, value in environment.items():
        text = _text(value)
        if name in SECRET_ENV_NAMES or any(marker in name.upper() for marker in ("SECRET", "TOKEN", "PASSWORD", "COOKIE", "API_KEY")):
            if len(text) >= 6 and text in payload:
                raise RuntimeError("doctor report contains a secret value")


def _print_human(report: dict) -> None:
    print("Smart Kefu configuration readiness doctor")
    print(f"Overall: {report['overall']} ({report['summary']['ready']} ready, {report['summary']['blocked']} blocked)")
    print("Live endpoints were not called; this report checks configuration only.")
    print("")
    for component in report["components"]:
        print(f"[{component['status'].upper()}] {component['label']}")
        for item in component["missing"]:
            print(f"  - missing: {item}")


def _parse_args(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(description="Check Smart Kefu configuration readiness without printing secrets.")
    parser.add_argument("--json", action="store_true", help="print the redacted JSON report")
    parser.add_argument("--output", help="write the redacted JSON report to this file")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    report = build_report()
    payload = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        output_path = Path(args.output).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(payload, encoding="utf-8")
    if args.json:
        sys.stdout.write(payload)
    else:
        _print_human(report)
        if args.output:
            print(f"\nRedacted JSON report written to: {Path(args.output).expanduser().resolve()}")
    return 2 if report["overall"] == "blocked" else 0


if __name__ == "__main__":
    raise SystemExit(main())
