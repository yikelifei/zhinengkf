#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""HTTP-level smoke test for the local Web Console."""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / ".codex_deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.web_console import ConsoleHandler  # noqa: E402


FRONTEND_GET_PATHS = {
    "/api/status",
    "/api/reports/readiness",
    "/api/high-value-leads?limit=50",
    "/api/followup-tasks?limit=10",
    "/api/handoff-queue?limit=10",
    "/api/quote-readiness?limit=50",
    "/api/improvement-backlog?days=7&limit=50",
    "/api/reports/files?limit=8",
}
FRONTEND_POST_PATHS = {
    "/api/reports/generate": {"type": "quality", "limit": 5},
    "/api/backups/create": {"label": "web_smoke"},
    "/api/backend/start": {},
    "/api/backend/stop": {},
}


def _request(base_url: str, method: str, path: str, body: dict | None = None):
    payload = None
    headers = {}
    if body is not None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(base_url + path, data=payload, headers=headers, method=method)
    try:
        with urlopen(request, timeout=8) as response:
            raw = response.read()
            return response.status, response.headers.get("Content-Type", ""), raw
    except HTTPError as exc:
        return exc.code, exc.headers.get("Content-Type", ""), exc.read()


def _json(base_url: str, method: str, path: str, body: dict | None = None):
    status, content_type, raw = _request(base_url, method, path, body)
    assert "application/json" in content_type, f"{path} returned {content_type}"
    data = json.loads(raw.decode("utf-8"))
    return status, data


def _assert_no_private_paths(data) -> None:
    text = json.dumps(data, ensure_ascii=False)
    _assert_no_private_path_text(text)


def _assert_no_private_path_text(text: str) -> None:
    assert str(ROOT) not in text, "HTTP response leaked project root path"
    assert "C:\\Users\\" not in text, "HTTP response leaked Windows user path"


def _frontend_api_paths() -> set[str]:
    text = (ROOT / "docs" / "web_console.js").read_text(encoding="utf-8")
    return set(re.findall(r"['\"](/api/[^'\"]+)['\"]", text))


def _assert_frontend_contract_covered() -> None:
    expected = FRONTEND_GET_PATHS | set(FRONTEND_POST_PATHS)
    actual = _frontend_api_paths()
    missing = actual - expected
    stale = expected - actual
    assert not missing, f"frontend API paths are not covered by HTTP smoke: {sorted(missing)}"
    assert not stale, f"HTTP smoke covers API paths no longer used by frontend: {sorted(stale)}"


def run() -> list[str]:
    issues: list[str] = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), ConsoleHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        try:
            _assert_frontend_contract_covered()

            status, content_type, raw = _request(base_url, "GET", "/")
            assert status == 200, f"/ status {status}"
            assert "text/html" in content_type, f"/ content type {content_type}"
            assert "智能客服" in raw.decode("utf-8", errors="ignore")

            status, content_type, raw = _request(base_url, "GET", "/docs/web_console.js")
            assert status == 200, f"/docs/web_console.js status {status}"
            assert "javascript" in content_type or "text/plain" in content_type
            assert "refreshLiveStatus" in raw.decode("utf-8", errors="ignore")

            for path in sorted(
                FRONTEND_GET_PATHS
                | {
                    "/api/channels",
                    "/api/providers",
                    "/api/backups?limit=5",
                    "/api/audit?limit=20",
                }
            ):
                status, data = _json(base_url, "GET", path)
                assert status == 200, f"{path} status {status}"
                assert isinstance(data, dict), f"{path} did not return an object"
                _assert_no_private_paths(data)

            _, providers = _json(base_url, "GET", "/api/providers")
            _assert_no_private_paths(providers)
            for provider in providers.get("providers", []):
                assert provider.get("api_key", "") == "", "provider API key leaked in HTTP response"

            _, backups = _json(base_url, "GET", "/api/backups?limit=5")
            _assert_no_private_paths(backups)
            backup_files = backups.get("files", [])
            for backup in backup_files:
                assert "url" not in backup, "backup file exposed a public download URL"
            if backup_files:
                status, _, _ = _request(base_url, "GET", f"/backups/{backup_files[0]['name']}")
                assert status == 404, "backup archive should not be publicly downloadable"

            legacy_report = ROOT / "reports" / "_web_console_legacy_path_leak_test.md"
            legacy_report.parent.mkdir(exist_ok=True)
            legacy_report.write_text(r"old report: C:\Users\27808\Desktop\zhinengkefu\reports\old.md", encoding="utf-8")
            try:
                status, content_type, raw = _request(base_url, "GET", f"/reports/{legacy_report.name}")
                assert status == 200, f"legacy report download status {status}"
                _assert_no_private_path_text(raw.decode("utf-8", errors="ignore"))
            finally:
                legacy_report.unlink(missing_ok=True)

            status, backup = _json(base_url, "POST", "/api/backups/create", FRONTEND_POST_PATHS["/api/backups/create"])
            assert status == 200, f"backup generation status {status}"
            assert backup.get("ok") is True
            _assert_no_private_paths(backup)
            assert "url" not in backup.get("file", {}), "created backup exposed a public download URL"

            status, report = _json(base_url, "POST", "/api/reports/generate", FRONTEND_POST_PATHS["/api/reports/generate"])
            assert status == 200, f"report generation status {status}"
            assert report.get("ok") is True
            _assert_no_private_paths(report)
            assert "path" not in report, "report generation leaked local path"
            assert report.get("file", {}).get("url", "").startswith("/reports/")
            status, content_type, raw = _request(base_url, "GET", report["file"]["url"])
            assert status == 200, f"generated report download status {status}"
            assert raw, "generated report download is empty"
            _assert_no_private_path_text(raw.decode("utf-8", errors="ignore"))

            status, audit_report = _json(base_url, "POST", "/api/reports/generate", {"type": "audit", "limit": 50})
            assert status == 200, f"audit report generation status {status}"
            assert audit_report.get("ok") is True
            _assert_no_private_paths(audit_report)
            status, content_type, raw = _request(base_url, "GET", audit_report["file"]["url"])
            assert status == 200, f"audit report download status {status}"
            _assert_no_private_path_text(raw.decode("utf-8", errors="ignore"))

            status, error = _json(base_url, "GET", "/api/messages")
            assert status == 400, f"/api/messages without session_id should be 400, got {status}"
            assert error.get("ok") is False

            status, before_backend = _json(base_url, "GET", "/api/backend/status")
            assert status == 200, f"backend status status {status}"
            backend_started_by_smoke = False
            try:
                status, started = _json(base_url, "POST", "/api/backend/start", FRONTEND_POST_PATHS["/api/backend/start"])
                assert status == 200, f"backend start status {status}"
                assert started.get("ok") is True
                backend_started_by_smoke = not before_backend.get("running", False)
                if backend_started_by_smoke:
                    status, after_start = _json(base_url, "GET", "/api/backend/status")
                    assert status == 200, f"backend status after start status {status}"
                    assert after_start.get("running") is True, "backend did not report running after start"
            finally:
                if backend_started_by_smoke:
                    status, stopped = _json(base_url, "POST", "/api/backend/stop", FRONTEND_POST_PATHS["/api/backend/stop"])
                    assert status == 200, f"backend stop status {status}"
                    assert stopped.get("ok") is True
                    status, after_stop = _json(base_url, "GET", "/api/backend/status")
                    assert status == 200, f"backend status after stop status {status}"
                    assert after_stop.get("running") is False, "backend still reported running after stop"
        except AssertionError as exc:
            issues.append(str(exc))
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    return issues


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Run Web Console HTTP smoke checks.")
    parser.parse_args(argv)
    issues = run()
    if issues:
        for issue in issues:
            print(f"[FAIL] {issue}")
        print(f"Web console HTTP smoke failed: {len(issues)} issue(s)")
        return 1
    print("Web console HTTP smoke passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
