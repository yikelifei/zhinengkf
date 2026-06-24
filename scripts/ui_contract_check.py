#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check that the Web Console UI only calls supported backend contracts."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_CONSOLE = ROOT / "scripts" / "web_console.py"
UI_FILES = [
    ROOT / "docs" / "smart_customer_service_ui.html",
    ROOT / "docs" / "web_console.js",
]


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def normalize_api_path(path: str) -> str:
    return path.split("?", 1)[0].strip()


def backend_api_paths() -> set[str]:
    text = _read(WEB_CONSOLE)
    return set(re.findall(r'path\s*==\s*"(/api/[^"]+)"', text))


def frontend_api_paths() -> set[str]:
    paths: set[str] = set()
    for path in UI_FILES:
        if not path.exists():
            continue
        text = _read(path)
        for match in re.findall(r'["\'](/api/[^"\']+)["\']', text):
            paths.add(normalize_api_path(match))
    return paths


def backend_report_types() -> set[str]:
    text = _read(WEB_CONSOLE)
    return set(re.findall(r'report_type\s*==\s*"([^"]+)"', text))


def frontend_report_types() -> set[str]:
    types: set[str] = set()
    for path in UI_FILES:
        if not path.exists():
            continue
        text = _read(path)
        types.update(re.findall(r'data-report-type="([^"]+)"', text))
        types.update(item for item in re.findall(r'return\s+"([^"]+)"', text) if item)
        types.update(re.findall(r'generateReport\("([^"]+)"\)', text))
    return types


def function_body(text: str, name: str) -> str:
    marker = f"function {name}"
    start = text.find(marker)
    if start < 0:
        return ""
    next_function = text.find("\n  function ", start + len(marker))
    if next_function < 0:
        return text[start:]
    return text[start:next_function]


def frontend_security_issues() -> list[str]:
    issues: list[str] = []
    script = ROOT / "docs" / "web_console.js"
    if not script.exists():
        return issues
    text = _read(script)
    for name in ("setHealth", "setSidebarStatus"):
        body = function_body(text, name)
        if not body:
            issues.append(f"missing UI renderer: {name}")
        elif ".innerHTML" in body:
            issues.append(f"{name} must render dynamic status text with text nodes, not innerHTML")
    return issues


def run() -> list[str]:
    issues: list[str] = []
    backend_paths = backend_api_paths()
    frontend_paths = frontend_api_paths()
    missing_paths = sorted(frontend_paths - backend_paths)
    if missing_paths:
        issues.append("unsupported frontend API paths: " + ", ".join(missing_paths))

    backend_reports = backend_report_types()
    frontend_reports = frontend_report_types()
    missing_reports = sorted(frontend_reports - backend_reports)
    if missing_reports:
        issues.append("unsupported frontend report types: " + ", ".join(missing_reports))

    if not frontend_paths:
        issues.append("no frontend API paths found")
    if not backend_paths:
        issues.append("no backend API paths found")
    issues.extend(frontend_security_issues())

    return issues


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Check Web Console UI/backend contracts.")
    parser.parse_args(argv)
    issues = run()
    if issues:
        for issue in issues:
            print(f"[FAIL] {issue}")
        print(f"UI contract check failed: {len(issues)} issue(s)")
        return 1
    print("UI contract check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
