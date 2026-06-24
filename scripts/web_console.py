#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local web console that connects the HTML UI to real project data."""

import json
import mimetypes
import os
import subprocess
import sys
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / ".codex_deps"
BACKEND_PID_FILE = ROOT / ".smart_bot_backend.pid"
PUBLIC_STATIC_DIRS = {"docs", "reports", "assets"}
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.api_config import (  # noqa: E402
    PROVIDER_PRESETS,
    ensure_provider,
    load_settings,
    provider_display_name,
    test_openai_compatible_provider,
    update_provider,
    validate_provider_config,
)
from core.customer_agent import CustomerSupportAgent  # noqa: E402
from core.customer_profile import load_profile, save_profile, validate_profile  # noqa: E402
from core.database import Database  # noqa: E402
from core.channel_registry import list_supported_channels  # noqa: E402
from core.redaction import redact_internal_paths  # noqa: E402
from core.knowledge_config import (  # noqa: E402
    delete_document,
    load_knowledge,
    match_knowledge,
    upsert_document,
)
from core.lead_pipeline import load_pipeline, save_pipeline, validate_pipeline  # noqa: E402
from core.skill_config import delete_skill, load_skills, upsert_skill  # noqa: E402
from scripts.audit_quality import build_quality_audit  # noqa: E402
from scripts.audit_quality import export_quality_audit  # noqa: E402
from scripts.answer_guard_audit import build_answer_guard_audit  # noqa: E402
from scripts.answer_guard_audit import export_answer_guard_audit  # noqa: E402
from scripts.backup_data import create_backup, list_backups  # noqa: E402
from scripts.business_hours_audit import build_business_hours_audit  # noqa: E402
from scripts.business_hours_audit import export_business_hours_audit  # noqa: E402
from scripts.check_launch_readiness import build_readiness_report  # noqa: E402
from scripts.check_launch_readiness import export_readiness_report  # noqa: E402
from scripts.cleanup_retention import cleanup_retention  # noqa: E402
from scripts.export_audit_log import export_audit_log  # noqa: E402
from scripts.export_report import export_report  # noqa: E402
from scripts.followup_reminders import build_followup_tasks  # noqa: E402
from scripts.followup_reminders import export_followup_tasks  # noqa: E402
from scripts.generate_acceptance_pack import build_acceptance_pack  # noqa: E402
from scripts.generate_acceptance_pack import export_acceptance_pack  # noqa: E402
from scripts.handoff_queue import build_handoff_queue  # noqa: E402
from scripts.handoff_queue import export_handoff_queue  # noqa: E402
from scripts.high_value_leads import build_high_value_leads  # noqa: E402
from scripts.high_value_leads import export_high_value_leads  # noqa: E402
from scripts.improvement_backlog import build_improvement_backlog  # noqa: E402
from scripts.improvement_backlog import export_improvement_backlog  # noqa: E402
from scripts.order_handoff import build_order_handoff  # noqa: E402
from scripts.order_handoff import export_order_handoff  # noqa: E402
from scripts.privacy_audit import build_privacy_audit  # noqa: E402
from scripts.privacy_audit import export_privacy_audit  # noqa: E402
from scripts.quote_readiness import build_quote_readiness  # noqa: E402
from scripts.quote_readiness import export_quote_readiness  # noqa: E402
from scripts.reply_style_miner import export_reply_style_samples  # noqa: E402
from scripts.run_acceptance_scenarios import export_acceptance_scenarios  # noqa: E402
from scripts.sla_monitor import build_sla_report  # noqa: E402
from scripts.sla_monitor import export_sla_report  # noqa: E402


class ConsoleHandler(SimpleHTTPRequestHandler):
    server_version = "SmartKefuWebConsole/0.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        sys.stdout.write("[web] " + fmt % args + "\n")

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api_get(parsed.path, parse_qs(parsed.query))
            return
        if parsed.path in {"/", "/console", "/console/"}:
            self.path = "/docs/smart_customer_service_ui.html"
        else:
            target = self._allowed_static_target(parsed.path)
            if target is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Not found")
                return
            if target.parent == (ROOT / "reports").resolve():
                return self._send_public_report(target)
            self.path = parsed.path
        return super().do_GET()

    @staticmethod
    def _allowed_static_target(path):
        decoded = unquote(path or "").replace("\\", "/")
        parts = [part for part in decoded.split("/") if part]
        if not parts or parts[0] not in PUBLIC_STATIC_DIRS:
            return None
        if any(part in {".", ".."} or part.startswith(".") for part in parts):
            return None

        base = (ROOT / parts[0]).resolve()
        target = ROOT.joinpath(*parts).resolve()
        if target == base or base not in target.parents:
            return None
        if not target.is_file():
            return None
        if parts[0] == "reports":
            if len(parts) != 2 or target.suffix.lower() not in {".md", ".csv", ".json"}:
                return None
        return target

    @staticmethod
    def _is_allowed_static_path(path):
        return ConsoleHandler._allowed_static_target(path) is not None

    def _send_public_report(self, target: Path):
        try:
            text = target.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        payload = redact_internal_paths(text, project_root=ROOT).encode("utf-8")
        content_type = mimetypes.guess_type(str(target))[0] or "text/plain"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api_post(parsed.path)
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api_delete(parsed.path, parse_qs(parsed.query))
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def _json_body(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def _send_json(self, data, status=HTTPStatus.OK):
        payload = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _send_error_json(self, message, status=HTTPStatus.BAD_REQUEST):
        self._send_json({"ok": False, "error": str(message)}, status)

    def _db(self):
        return Database(str(ROOT / "data" / "kefu.db"))

    def _handle_api_get(self, path, query):
        try:
            if path == "/api/status":
                return self._send_json(api_status(self._db()))
            if path == "/api/channels":
                return self._send_json(api_channels())
            if path == "/api/providers":
                return self._send_json(api_providers())
            if path == "/api/profile":
                profile = load_profile()
                return self._send_json({"profile": profile, "issues": validate_profile(profile)})
            if path == "/api/skills":
                return self._send_json(load_skills())
            if path == "/api/knowledge":
                return self._send_json(load_knowledge())
            if path == "/api/pipeline":
                pipeline = load_pipeline()
                return self._send_json({"pipeline": pipeline, "issues": validate_pipeline(pipeline)})
            if path == "/api/knowledge/match":
                message = (query.get("q") or [""])[0]
                return self._send_json({"matches": match_knowledge(message)})
            if path == "/api/leads":
                limit = int((query.get("limit") or [100])[0])
                return self._send_json({"leads": self._db().list_leads(limit=limit)})
            if path == "/api/followups":
                limit = int((query.get("limit") or [100])[0])
                return self._send_json({"leads": self._db().get_followup_leads(limit=limit)})
            if path == "/api/followup-tasks":
                limit = int((query.get("limit") or [50])[0])
                return self._send_json({"tasks": build_followup_tasks(limit=limit)})
            if path == "/api/high-value-leads":
                limit = int((query.get("limit") or [200])[0])
                include_all = (query.get("include_all") or ["false"])[0].lower() in {"1", "true", "yes"}
                return self._send_json(build_high_value_leads(limit=limit, include_all=include_all))
            if path == "/api/handoff-queue":
                limit = int((query.get("limit") or [50])[0])
                return self._send_json({"items": build_handoff_queue(limit=limit)})
            if path == "/api/sla":
                days = int((query.get("days") or [7])[0])
                return self._send_json(build_sla_report(days=days))
            if path == "/api/answer-guard":
                return self._send_json(build_answer_guard_audit())
            if path == "/api/business-hours":
                return self._send_json(build_business_hours_audit())
            if path == "/api/improvement-backlog":
                days = int((query.get("days") or [7])[0])
                limit = int((query.get("limit") or [200])[0])
                return self._send_json(build_improvement_backlog(days=days, limit=limit))
            if path == "/api/quote-readiness":
                limit = int((query.get("limit") or [100])[0])
                return self._send_json(build_quote_readiness(limit=limit))
            if path == "/api/order-handoff":
                limit = int((query.get("limit") or [100])[0])
                return self._send_json(build_order_handoff(limit=limit))
            if path == "/api/privacy-audit":
                days = int((query.get("days") or [30])[0])
                limit = int((query.get("limit") or [300])[0])
                return self._send_json(build_privacy_audit(days=days, limit=limit))
            if path == "/api/reports":
                limit = int((query.get("limit") or [30])[0])
                return self._send_json({"files": list_report_files(limit=limit)})
            if path == "/api/reports/summary":
                days = int((query.get("days") or [7])[0])
                db = self._db()
                return self._send_json(
                    {
                        "lead_metrics": db.get_lead_metrics(),
                        "stage_metrics": db.get_stage_metrics(),
                        "daily_metrics": db.get_daily_metrics(days=days),
                        "followups": db.get_followup_leads(limit=20),
                    }
                )
            if path == "/api/reports/quality":
                days = int((query.get("days") or [7])[0])
                limit = int((query.get("limit") or [200])[0])
                return self._send_json(build_quality_audit(days=days, limit=limit))
            if path == "/api/reports/readiness":
                return self._send_json(build_readiness_report())
            if path == "/api/reports/acceptance":
                return self._send_json({"markdown": build_acceptance_pack()})
            if path == "/api/reports/files":
                limit = int((query.get("limit") or [30])[0])
                return self._send_json({"files": list_report_files(limit=limit)})
            if path == "/api/backups":
                limit = int((query.get("limit") or [20])[0])
                return self._send_json({"files": list_backup_files(limit=limit)})
            if path == "/api/audit":
                limit = int((query.get("limit") or [100])[0])
                return self._send_json({"events": public_audit_events(self._db().get_audit_events(limit=limit))})
            if path == "/api/conversations":
                limit = int((query.get("limit") or [100])[0])
                db = self._db()
                rows = db.list_conversations(limit=limit)
                for row in rows:
                    row["lock"] = db.get_conversation_lock(row["session_id"])
                return self._send_json({"conversations": rows})
            if path == "/api/messages":
                session_id = (query.get("session_id") or [""])[0]
                if not session_id:
                    return self._send_error_json("session_id is required")
                db = self._db()
                return self._send_json(
                    {
                        "messages": db.get_session_messages(session_id, limit=80),
                        "lead": db.get_lead_by_session(session_id),
                        "lock": db.get_conversation_lock(session_id),
                    }
                )
            if path == "/api/backend/status":
                return self._send_json(backend_status())
            self._send_error_json("Unknown API endpoint", HTTPStatus.NOT_FOUND)
        except (KeyError, TypeError, ValueError) as exc:
            self._send_error_json(exc, HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            self._send_error_json(exc, HTTPStatus.INTERNAL_SERVER_ERROR)

    def _handle_api_post(self, path):
        try:
            body = self._json_body()
            if path == "/api/providers":
                provider_name = body.pop("name")
                settings = update_provider(provider_name, **body)
                self._db().log_event("config_update", f"API provider saved: {provider_name}")
                return self._send_json({"ok": True, "settings": redact_settings_for_response(settings)})
            if path == "/api/providers/test":
                ok, message = test_openai_compatible_provider(body)
                return self._send_json({"ok": ok, "message": message})
            if path == "/api/profile":
                save_profile(body)
                profile = load_profile()
                self._db().log_event("config_update", "customer profile saved from web console")
                return self._send_json({"ok": True, "profile": profile, "issues": validate_profile(profile)})
            if path == "/api/pipeline":
                save_pipeline(body)
                pipeline = load_pipeline()
                self._db().log_event("config_update", "lead pipeline saved from web console")
                return self._send_json({"ok": True, "pipeline": pipeline, "issues": validate_pipeline(pipeline)})
            if path == "/api/skills":
                skill = upsert_skill(body)
                self._db().log_event("skill_update", f"skill saved: {skill.get('id', '')}")
                return self._send_json({"ok": True, "skill": skill})
            if path == "/api/knowledge":
                document = upsert_document(body)
                self._db().log_event("knowledge_update", f"knowledge saved: {document.get('id', '')}")
                return self._send_json({"ok": True, "document": document})
            if path == "/api/leads/update":
                lead_id = int(body.pop("id"))
                changed = self._db().update_lead(lead_id, body)
                if changed:
                    self._db().log_event("lead_update", f"lead updated: #{lead_id}")
                return self._send_json({"ok": changed})
            if path == "/api/chat/suggest":
                session_id = body.get("session_id", "")
                db = self._db()
                messages = db.get_session_messages(session_id, limit=12)
                inbound = [m for m in messages if m.get("direction") == "inbound"]
                if not inbound:
                    return self._send_error_json("该会话暂无客户消息")
                history = [
                    {
                        "role": "user" if m.get("direction") == "inbound" else "assistant",
                        "content": m.get("content", ""),
                    }
                    for m in messages[-8:]
                ]
                decision = CustomerSupportAgent().analyze(inbound[-1]["content"], history=history)
                suggestion = decision.answer or "建议人工补充客户数量、预算、城市和使用日期后再报价。"
                return self._send_json(
                    {
                        "ok": True,
                        "suggestion": suggestion,
                        "topic": decision.topic,
                        "confidence": decision.confidence,
                        "reason": decision.reason,
                        "citations": decision.citations,
                    }
                )
            if path == "/api/chat/lock":
                db = self._db()
                return self._send_json(lock_manual_conversation(db, body))
            if path == "/api/chat/unlock":
                db = self._db()
                return self._send_json(unlock_manual_conversation(db, body))
            if path == "/api/chat/send":
                return self._send_json(send_manual_reply(self._db(), body))
            if path == "/api/reports/generate":
                result = generate_report_file(body)
                self._db().log_event("report_generate", f"{result['label']}: {Path(result['path']).name}")
                return self._send_json(report_response(result))
            if path == "/api/backups/create":
                backup = create_backup(body.get("label", "web"))
                self._db().log_event("backup_create", backup.name)
                return self._send_json({"ok": True, "file": file_summary(backup, "backups", expose_url=False)})
            if path == "/api/maintenance/cleanup":
                result = cleanup_retention(
                    retention=body.get("retention") or None,
                    apply=bool(body.get("apply", False)),
                )
                return self._send_json(
                    {
                        "ok": True,
                        "report": file_summary(result["report_path"], "reports"),
                        "matched_files": result["plan"]["total_files"],
                        "deleted_files": len(result["deleted"]),
                        "applied": bool(body.get("apply", False)),
                    }
                )
            if path == "/api/backend/start":
                return self._send_json(start_backend())
            if path == "/api/backend/stop":
                return self._send_json(stop_backend())
            self._send_error_json("Unknown API endpoint", HTTPStatus.NOT_FOUND)
        except (KeyError, TypeError, ValueError) as exc:
            self._send_error_json(exc, HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            self._send_error_json(exc, HTTPStatus.INTERNAL_SERVER_ERROR)

    def _handle_api_delete(self, path, query):
        try:
            if path == "/api/skills":
                skill_id = (query.get("id") or [""])[0]
                ok = delete_skill(skill_id)
                if ok:
                    self._db().log_event("skill_delete", f"skill deleted: {skill_id}")
                return self._send_json({"ok": ok})
            if path == "/api/knowledge":
                doc_id = (query.get("id") or [""])[0]
                ok = delete_document(doc_id)
                if ok:
                    self._db().log_event("knowledge_delete", f"knowledge deleted: {doc_id}")
                return self._send_json({"ok": ok})
            self._send_error_json("Unknown API endpoint", HTTPStatus.NOT_FOUND)
        except (KeyError, TypeError, ValueError) as exc:
            self._send_error_json(exc, HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            self._send_error_json(exc, HTTPStatus.INTERNAL_SERVER_ERROR)


def api_status(db):
    settings = load_settings()
    providers = settings.get("ai_engine", {}).get("providers", {})
    primary = settings.get("ai_engine", {}).get("primary", "-")
    conversations = db.list_conversations(limit=500)
    leads = db.list_leads(limit=500)
    needs_human = sum(1 for item in conversations if item.get("status") == "needs_human")
    locked = sum(1 for item in conversations if db.get_conversation_lock(item["session_id"]))
    return {
        "ok": True,
        "primary_provider": primary,
        "primary_model": display_config_value(providers.get(primary, {}).get("model", "-")),
        "providers_enabled": sum(1 for item in providers.values() if item.get("enabled")),
        "backend": backend_status(),
        "skills": len(load_skills().get("skills", [])),
        "knowledge": len(load_knowledge().get("documents", [])),
        "conversations": len(conversations),
        "needs_human": needs_human,
        "locked": locked,
        "leads": len(leads),
    }


def api_providers():
    settings = load_settings()
    providers = settings.get("ai_engine", {}).get("providers", {})
    primary = settings.get("ai_engine", {}).get("primary")
    names = list(PROVIDER_PRESETS.keys()) + [name for name in providers if name not in PROVIDER_PRESETS]
    items = []
    for name in names:
        provider = ensure_provider(settings, name)
        item = redact_provider_config(provider)
        item["name"] = name
        item["label"] = provider_display_name(name)
        item["is_primary"] = name == primary
        item["issues"] = validate_provider_config(provider)
        items.append(item)
    return {"primary": primary, "providers": items}


def redact_provider_config(provider: dict) -> dict:
    item = dict(provider or {})
    api_key = str(item.get("api_key") or "")
    if api_key:
        item["api_key_masked"] = mask_secret(api_key)
    item["api_key"] = ""
    return item


def redact_settings_for_response(settings: dict) -> dict:
    safe = dict(settings or {})
    ai_engine = dict(safe.get("ai_engine") or {})
    providers = ai_engine.get("providers") or {}
    ai_engine["providers"] = {
        name: redact_provider_config(provider)
        for name, provider in providers.items()
    }
    safe["ai_engine"] = ai_engine
    return safe


def api_channels():
    settings = load_settings()
    channel_settings = settings.get("channels", {})
    active = set(channel_settings.get("active") or ["wechat"])
    adapters = channel_settings.get("adapters") or {}
    rows = []
    for item in list_supported_channels():
        channel_id = item["channel_id"]
        config = adapters.get(channel_id, {})
        rows.append(
            {
                **item,
                "enabled": channel_id in active and config.get("enabled", True),
                "configured": bool(config),
                "config_type": config.get("type", item["adapter_type"]),
            }
        )
    return {"active": sorted(active), "channels": rows}


def generate_report_file(body):
    report_type = body.get("type", "")
    if report_type == "readiness":
        path = export_readiness_report()
        label = "上线缺口检查"
    elif report_type == "acceptance":
        path = export_acceptance_pack()
        label = "商业交付验收包"
    elif report_type == "operation":
        path = export_report(days=int(body.get("days", 7)), limit=int(body.get("limit", 20)))
        label = "运营报告"
    elif report_type == "quality":
        path = export_quality_audit(days=int(body.get("days", 7)), limit=int(body.get("limit", 200)))
        label = "质检报告"
    elif report_type == "followups":
        path = export_followup_tasks(limit=int(body.get("limit", 50)))
        label = "跟进任务"
    elif report_type == "high_value_leads":
        path = export_high_value_leads(
            limit=int(body.get("limit", 200)),
            include_all=bool(body.get("include_all", False)),
        )
        label = "高价值客户筛选清单"
    elif report_type == "handoff":
        path = export_handoff_queue(limit=int(body.get("limit", 50)))
        label = "人工接管队列"
    elif report_type == "sla":
        path = export_sla_report(days=int(body.get("days", 7)))
        label = "SLA 监控报告"
    elif report_type == "answer_guard":
        path = export_answer_guard_audit()
        label = "回复安全护栏审计报告"
    elif report_type == "business_hours":
        path = export_business_hours_audit()
        label = "非工作时间兜底审计报告"
    elif report_type == "improvement_backlog":
        path = export_improvement_backlog(days=int(body.get("days", 7)), limit=int(body.get("limit", 200)))
        label = "智能客服优化待办"
    elif report_type == "quote_readiness":
        path = export_quote_readiness(limit=int(body.get("limit", 100)))
        label = "报价准备清单"
    elif report_type == "reply_style":
        path = export_reply_style_samples(days=int(body.get("days", 90)), limit=int(body.get("limit", 300)))
        label = "真人客服风格样本报告"
    elif report_type == "order_handoff":
        path = export_order_handoff(limit=int(body.get("limit", 100)))
        label = "订单交付清单"
    elif report_type == "privacy_audit":
        path = export_privacy_audit(days=int(body.get("days", 30)), limit=int(body.get("limit", 300)))
        label = "隐私合规审计报告"
    elif report_type == "audit":
        path = export_audit_log(limit=int(body.get("limit", 200)))
        label = "操作审计报告"
    elif report_type == "scenarios":
        path = export_acceptance_scenarios()
        label = "落地验收场景报告"
    else:
        raise ValueError("未知报告类型")
    return {"ok": True, "type": report_type, "label": label, "path": str(path)}


def report_response(result: dict) -> dict:
    path = Path(result["path"])
    return {
        "ok": True,
        "type": result.get("type", ""),
        "label": result.get("label", ""),
        "file": file_summary(path, "reports"),
    }


def public_audit_events(events: list[dict]) -> list[dict]:
    return [
        {**event, "detail": redact_internal_paths(event.get("detail", ""), project_root=ROOT)}
        for event in events
    ]


def file_summary(path: Path, folder_name: str, *, expose_url: bool = True) -> dict:
    stat = path.stat()
    summary = {
        "name": path.name,
        "size": stat.st_size,
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stat.st_mtime)),
    }
    if expose_url:
        summary["url"] = f"/{folder_name}/{path.name}"
    return summary


def list_report_files(limit=30) -> list[dict]:
    reports_dir = ROOT / "reports"
    if not reports_dir.exists():
        return []
    files = [path for path in reports_dir.iterdir() if path.is_file() and path.suffix.lower() in {".md", ".csv", ".json"}]
    files.sort(key=lambda item: item.stat().st_mtime, reverse=True)
    return [file_summary(path, "reports") for path in files[:limit]]


def list_backup_files(limit=20) -> list[dict]:
    return [file_summary(path, "backups", expose_url=False) for path in list_backups()[:limit]]


def mask_secret(value):
    if value.startswith("${"):
        return value
    if len(value) <= 8:
        return "********"
    return value[:4] + "..." + value[-4:]


def display_config_value(value, fallback="按环境变量配置"):
    text = str(value or "").strip()
    if not text:
        return "-"
    if text.startswith("${") and text.endswith("}"):
        key = text[2:-1].split(":", 1)[0]
        return os.environ.get(key) or fallback
    if "${" in text:
        return fallback
    return text


def start_backend():
    status = backend_status()
    if status["running"]:
        return {"ok": True, "message": f"后台客服已在运行，PID={status['pid']}", **status}
    script = ROOT / "scripts" / "main.py"
    python = Path(sys.executable)
    proc = subprocess.Popen(
        [str(python), str(script)],
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    BACKEND_PID_FILE.write_text(str(proc.pid), encoding="utf-8")
    return {
        "ok": True,
        "message": f"后台客服已启动，PID={proc.pid}。请确认微信已登录。",
        "running": True,
        "pid": str(proc.pid),
    }


def stop_backend():
    status = backend_status()
    if not status["running"]:
        return {"ok": True, "message": "后台客服未运行。", **status}
    try:
        subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                f"Stop-Process -Id {int(status['pid'])} -Force",
            ],
            cwd=str(ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception as exc:
        return {"ok": False, "message": str(exc), **status}
    try:
        BACKEND_PID_FILE.unlink(missing_ok=True)
    except Exception:
        pass
    return {"ok": True, "message": "后台客服已停止。", "running": False, "pid": "-"}


def backend_status():
    pid = ""
    try:
        if BACKEND_PID_FILE.exists():
            pid = BACKEND_PID_FILE.read_text(encoding="utf-8").strip()
    except Exception:
        pid = ""
    if pid:
        try:
            result = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    f"Get-Process -Id {int(pid)} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id",
                ],
                cwd=str(ROOT),
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            found = result.stdout.strip()
            if found:
                return {"running": True, "pid": found}
        except Exception:
            pass
        try:
            BACKEND_PID_FILE.unlink(missing_ok=True)
        except Exception:
            pass
    try:
        out = subprocess.check_output(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "Get-Process smart_bot -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id",
            ],
            cwd=str(ROOT),
            text=True,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).strip()
        return {"running": bool(out), "pid": out or "-"}
    except Exception:
        return {"running": False, "pid": "-"}


def send_manual_reply(db, body):
    session_id = body.get("session_id", "")
    text = (body.get("text") or "").strip()
    if not session_id:
        raise ValueError("session_id is required")
    if not text:
        raise ValueError("发送内容不能为空")
    row = db.execute(
        "SELECT friend_name FROM conversations WHERE session_id = ?",
        (session_id,),
    ).fetchone()
    if not row:
        raise ValueError("未找到会话")
    friend_name = row["friend_name"]

    from core.wechat import ChatListener

    listener = ChatListener()
    ok = listener.send(text, friend_name)
    if not ok:
        raise RuntimeError("微信发送失败，请确认微信已登录并停留在聊天主界面。")
    if hasattr(listener, "mark_outgoing_seen"):
        try:
            listener.mark_outgoing_seen(friend_name, text)
        except Exception:
            pass
    db.save_message(
        session_id,
        direction="outbound",
        content=text,
        source="manual",
        intent="manual_takeover",
    )
    locked_until = db.lock_conversation(session_id, minutes=10, reason="manual_send")
    db.log_event("manual_reply", f"{friend_name}: locked until {locked_until}")
    return {
        "ok": True,
        "message": f"已发送给 {friend_name}，并锁定自动回复 10 分钟。",
        "locked_until": locked_until,
    }


def require_conversation(db, session_id: str) -> dict:
    session_id = str(session_id or "").strip()
    if not session_id:
        raise ValueError("session_id is required")
    row = db.execute(
        "SELECT session_id, friend_name FROM conversations WHERE session_id = ?",
        (session_id,),
    ).fetchone()
    if not row:
        raise ValueError("未找到会话")
    return dict(row)


def parse_lock_minutes(value) -> int:
    minutes = 10 if value is None or value == "" else int(value)
    if minutes < 1 or minutes > 1440:
        raise ValueError("锁定时长必须在 1 到 1440 分钟之间")
    return minutes


def lock_manual_conversation(db, body):
    session = require_conversation(db, body.get("session_id", ""))
    minutes = parse_lock_minutes(body.get("minutes", 10))
    reason = body.get("reason", "manual_takeover")
    until = db.lock_conversation(session["session_id"], minutes=minutes, reason=reason)
    db.log_event("manual_lock", f"{session['session_id']}: locked until {until}")
    return {"ok": True, "locked_until": until}


def unlock_manual_conversation(db, body):
    session = require_conversation(db, body.get("session_id", ""))
    db.clear_conversation_lock(session["session_id"])
    db.log_event("manual_unlock", session["session_id"])
    return {"ok": True}


def main():
    os.chdir(ROOT)
    port = int(os.environ.get("SMART_KEFU_WEB_PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), ConsoleHandler)
    url = f"http://127.0.0.1:{port}/"
    print(f"Smart customer service web console: {url}")
    try:
        import webbrowser

        if os.environ.get("SMART_KEFU_NO_BROWSER", "").lower() not in {"1", "true", "yes"}:
            time.sleep(0.3)
            webbrowser.open(url)
    except Exception:
        pass
    server.serve_forever()


if __name__ == "__main__":
    main()
