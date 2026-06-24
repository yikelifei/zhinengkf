#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Offline deployment health check for Smart Kefu."""

from __future__ import annotations

import importlib
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / ".codex_deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


class CheckResult:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.warnings = 0

    def ok(self, message):
        self.passed += 1
        print(f"[OK] {message}")

    def warn(self, message):
        self.warnings += 1
        print(f"[WARN] {message}")

    def fail(self, message):
        self.failed += 1
        print(f"[FAIL] {message}")


def check_imports(result):
    required = [
        "yaml",
        "core.api_config",
        "core.answer_guard",
        "core.business_hours",
        "core.customer_agent",
        "core.knowledge_config",
        "core.skill_config",
        "core.reply_style",
        "core.lead_pipeline",
        "core.conversation",
        "core.database",
    ]
    for module in required:
        try:
            importlib.import_module(module)
            result.ok(f"module import: {module}")
        except Exception as exc:
            result.fail(f"module import failed: {module}: {exc}")


def check_files(result):
    required = [
        "config/settings.yaml",
        "config/customer_knowledge.yaml",
        "config/customer_skills.yaml",
        "config/reply_style.yaml",
        "config/prompts.yaml",
        "config/lead_pipeline.yaml",
        "config/acceptance_scenarios.yaml",
        "config/customer_profile.yaml",
        "scripts/main.py",
        "scripts/web_console.py",
        "scripts/check_launch_readiness.py",
        "scripts/answer_guard_audit.py",
        "scripts/business_hours_audit.py",
        "scripts/cleanup_retention.py",
        "scripts/export_audit_log.py",
        "scripts/generate_acceptance_pack.py",
        "scripts/handoff_queue.py",
        "scripts/improvement_backlog.py",
        "scripts/order_handoff.py",
        "scripts/privacy_audit.py",
        "scripts/quote_readiness.py",
        "scripts/reply_style_miner.py",
        "scripts/run_acceptance_scenarios.py",
        "scripts/sla_monitor.py",
        "docs/web_console.js",
        "docs/smart_customer_service_ui.html",
        "run.bat",
        "run_web_console.bat",
        "tools/README.md",
        "tools/_run_python_task.bat",
        "tools/quality/run_launch_readiness.bat",
        "tools/quality/run_health_check.bat",
        "tools/quality/run_smoke_tests.bat",
        "tools/quality/run_tests.bat",
        "tools/quality/run_quality_audit.bat",
        "tools/quality/run_answer_guard_audit.bat",
        "tools/quality/run_business_hours_audit.bat",
        "tools/quality/run_acceptance_pack.bat",
        "tools/quality/run_acceptance_scenarios.bat",
        "tools/quality/run_sla_monitor.bat",
        "tools/reports/run_export_report.bat",
        "tools/reports/run_export_leads.bat",
        "tools/reports/run_followup_tasks.bat",
        "tools/reports/run_improvement_backlog.bat",
        "tools/reports/run_order_handoff.bat",
        "tools/reports/run_privacy_audit.bat",
        "tools/reports/run_quote_readiness.bat",
        "tools/reports/run_reply_style_miner.bat",
        "tools/operations/run_backup.bat",
        "tools/operations/run_cleanup_retention.bat",
        "tools/operations/run_audit_log.bat",
        "tools/operations/run_handoff_queue.bat",
        "installer/specs/smart_bot.spec",
        "installer/specs/smart_bot_console.spec",
        "installer/specs/smart_bot_sfx.spec",
    ]
    for rel in required:
        path = ROOT / rel
        if path.exists():
            result.ok(f"file exists: {rel}")
        else:
            result.fail(f"missing file: {rel}")

    for rel in ("data", "backups", "exports", "reports"):
        folder = ROOT / rel
        folder.mkdir(exist_ok=True)
        if os.access(folder, os.W_OK):
            result.ok(f"{rel} directory is writable")
        else:
            result.fail(f"{rel} directory is not writable")


def check_text_encoding(result):
    suspicious = ("�", "鏁", "鎴", "杩", "浠", "寮", "鍙", "锛", "鈥", "閺", "閹")
    targets = [
        "config/customer_knowledge.yaml",
        "config/customer_skills.yaml",
        "config/prompts.yaml",
        "config/lead_pipeline.yaml",
        "config/acceptance_scenarios.yaml",
        "core/customer_agent.py",
        "core/conversation.py",
        "core/api_config.py",
        "core/answer_guard.py",
        "core/business_hours.py",
        "core/knowledge_config.py",
        "core/skill_config.py",
        "core/reply_style.py",
        "core/lead_pipeline.py",
        "core/customer_profile.py",
        "scripts/web_console.py",
        "scripts/answer_guard_audit.py",
        "scripts/business_hours_audit.py",
        "scripts/followup_reminders.py",
        "scripts/export_report.py",
        "scripts/check_launch_readiness.py",
        "scripts/cleanup_retention.py",
        "scripts/export_audit_log.py",
        "scripts/generate_acceptance_pack.py",
        "scripts/handoff_queue.py",
        "scripts/improvement_backlog.py",
        "scripts/order_handoff.py",
        "scripts/privacy_audit.py",
        "scripts/quote_readiness.py",
        "scripts/reply_style_miner.py",
        "scripts/run_acceptance_scenarios.py",
        "scripts/sla_monitor.py",
        "docs/web_console.js",
        "docs/smart_customer_service_ui.html",
    ]
    bad = []
    for rel in targets:
        path = ROOT / rel
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        hits = sum(text.count(token) for token in suspicious)
        if hits:
            bad.append(f"{rel}({hits})")
    if bad:
        result.fail("suspicious mojibake found: " + ", ".join(bad))
    else:
        result.ok("core text encoding looks clean")


def check_yaml_and_business_rules(result):
    try:
        from core.api_config import load_settings, validate_provider_config
        from core.knowledge_config import load_knowledge, match_knowledge
        from core.lead_pipeline import load_pipeline, validate_pipeline
        from core.customer_profile import load_profile, validate_profile
        from core.skill_config import load_skills
        from core.answer_guard import AnswerGuard
        from core.business_hours import business_hours_status, parse_working_hours
        from core.customer_agent import CustomerSupportAgent
        from core.conversation import ConversationManager
        from core.reply_style import ReplyStyleCoach
    except Exception as exc:
        result.fail(f"cannot load core helpers: {exc}")
        return

    try:
        settings = load_settings()
        result.ok("settings.yaml loads")
        ai_engine = settings.get("ai_engine", {})
        providers = ai_engine.get("providers", {})
        enabled = {
            name: cfg
            for name, cfg in providers.items()
            if cfg.get("enabled", False)
        }
        if not enabled:
            result.warn("no AI provider is enabled; rule and knowledge replies still work")
        else:
            result.ok(f"enabled AI providers: {', '.join(enabled)}")
            primary = ai_engine.get("primary")
            if primary not in providers:
                result.warn(f"primary provider '{primary}' is not configured")
            for name, cfg in enabled.items():
                issues = validate_provider_config(cfg)
                if issues:
                    result.warn(f"provider {name}: {'；'.join(issues)}")
    except Exception as exc:
        result.fail(f"settings.yaml failed to load: {exc}")

    try:
        profile = load_profile()
        issues = validate_profile(profile)
        if issues:
            result.fail("customer profile invalid: " + "；".join(issues))
        else:
            result.ok("customer profile config is valid")
    except Exception as exc:
        result.fail(f"customer profile check failed: {exc}")

    try:
        pipeline = load_pipeline()
        issues = validate_pipeline(pipeline)
        if issues:
            result.fail("lead pipeline config invalid: " + "；".join(issues))
        else:
            result.ok(f"lead pipeline stages: {len(pipeline.get('stages', []))}")
    except Exception as exc:
        result.fail(f"lead pipeline check failed: {exc}")

    try:
        knowledge = load_knowledge()
        documents = knowledge.get("documents", [])
        if len(documents) >= 6:
            result.ok(f"knowledge documents: {len(documents)}")
        else:
            result.warn(f"knowledge documents are low: {len(documents)}")
        matches = match_knowledge("礼盒多少钱")
        if matches:
            result.ok("knowledge keyword matching works")
        else:
            result.fail("knowledge keyword matching returned no result")
    except Exception as exc:
        result.fail(f"knowledge check failed: {exc}")

    try:
        skills = load_skills().get("skills", [])
        enabled_skills = [s for s in skills if s.get("enabled", True)]
        if len(enabled_skills) >= 6:
            result.ok(f"enabled skills: {len(enabled_skills)}")
        else:
            result.warn(f"enabled skills are low: {len(enabled_skills)}")
    except Exception as exc:
        result.fail(f"skills check failed: {exc}")

    try:
        agent = CustomerSupportAgent()
        pricing = agent.analyze("端午礼盒多少钱，100份")
        handoff = agent.analyze("我要投诉退款")
        if pricing.route == "direct_reply" and pricing.topic == "pricing":
            result.ok("agent pricing route works")
        else:
            result.fail(f"agent pricing route unexpected: {pricing}")
        if handoff.topic == "transfer_human" and "人工客服" in handoff.answer:
            result.ok("agent risk handoff works")
        else:
            result.fail(f"agent handoff route unexpected: {handoff}")
        styled = ReplyStyleCoach().polish("pricing", "礼盒价格需要结合数量和材质核算。", "端午礼盒多少钱，100份")
        if "预算" in styled and len(styled) <= 180:
            result.ok("reply style coach produces concise sales-ready copy")
        else:
            result.fail(f"reply style coach output unexpected: {styled}")
        guarded = AnswerGuard().sanitize("可以，保证当天发货，保证最低价。")
        if guarded.changed and "保证当天发货" not in guarded.answer and "保证最低价" not in guarded.answer:
            result.ok("answer guard blocks forbidden promises")
        else:
            result.fail(f"answer guard did not block forbidden promises: {guarded}")
        if parse_working_hours(profile.get("business", {}).get("working_hours", "")):
            result.ok("business hours config parses")
        else:
            result.fail("business hours config cannot be parsed")
        status = business_hours_status(profile=profile)
        if status.after_hours_message:
            result.ok("after-hours fallback copy is configured")
        else:
            result.fail("after-hours fallback copy is empty")
    except Exception as exc:
        result.fail(f"agent behavior check failed: {exc}")

    try:
        manager = ConversationManager(db=None)
        info = manager.extract_contact_info(
            "我是ABC科技公司，联系人 张三，电话13812345678，预算30元，做100份，6月18日送到上海"
        )
        required = {"company_name", "contact_person", "phone", "budget", "quantity_estimate", "due_date", "city"}
        missing = sorted(required - set(info))
        if missing:
            result.fail(f"lead extraction missing fields: {', '.join(missing)}")
        else:
            result.ok("lead extraction works")
    except Exception as exc:
        result.fail(f"lead extraction check failed: {exc}")


def main():
    print("Smart Kefu health check")
    print(f"Project: {ROOT}")
    print("")

    result = CheckResult()
    check_files(result)
    check_text_encoding(result)
    check_imports(result)
    check_yaml_and_business_rules(result)

    print("")
    print(
        f"Summary: {result.passed} passed, "
        f"{result.warnings} warnings, {result.failed} failed"
    )
    return 1 if result.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
