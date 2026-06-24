#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Run core smoke tests without requiring pytest."""

from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / ".codex_deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def test_customer_agent():
    from core.answer_guard import AnswerGuard
    from core.business_hours import business_hours_status, parse_working_hours
    from core.customer_agent import CustomerSupportAgent
    from core.reply_style import ReplyStyleCoach

    agent = CustomerSupportAgent()
    pricing = agent.analyze("端午礼盒多少钱，100份")
    delivery = agent.analyze("什么时候能发货")
    handoff = agent.analyze("我要投诉退款")

    assert_true(pricing.topic == "pricing", "pricing topic should be detected")
    assert_true(pricing.route == "direct_reply", "pricing should reply directly")
    assert_true("预算" in pricing.answer, "pricing should ask for budget")
    assert_true(len(pricing.answer) <= 180, "pricing answer should stay concise")
    assert_true("机器人" not in pricing.answer and "AI" not in pricing.answer, "pricing answer should be customer-facing")
    assert_true(delivery.topic == "delivery", "delivery topic should be detected")
    assert_true("5-7" in delivery.answer, "delivery should mention standard lead time")
    assert_true(handoff.topic == "transfer_human", "complaints should transfer to human")
    styled = ReplyStyleCoach().polish("pricing", "礼盒价格需要结合数量、材质和定制内容核算。", "端午礼盒多少钱，100份")
    assert_true("预算" in styled, "reply style coach should ask for missing budget")
    assert_true(len(styled) <= 180, "reply style coach should keep copy concise")
    guarded = AnswerGuard().sanitize("可以，保证当天发货，保证最低价。")
    assert_true(guarded.changed, "answer guard should rewrite risky promises")
    assert_true("保证当天发货" not in guarded.answer, "answer guard should remove same-day guarantee")
    assert_true("保证最低价" not in guarded.answer, "answer guard should remove lowest-price guarantee")
    assert_true(parse_working_hours("09:00-18:00"), "business hours should parse standard range")
    assert_true(
        not business_hours_status(
            profile={"business": {"working_hours": "09:00-18:00", "after_hours_message": "非工作时间留言已记录。"}},
            now=__import__("datetime").datetime(2026, 1, 1, 20, 0),
        ).is_open,
        "business hours should detect after-hours",
    )


def test_lead_extraction():
    from core.conversation import ConversationManager

    manager = ConversationManager(db=None)
    info = manager.extract_contact_info(
        "我是ABC科技公司，联系人 张三，电话13812345678，预算30元，做100份，6月18日送到上海"
    )
    expected = {
        "company_name": "ABC科技公司",
        "contact_person": "张三",
        "phone": "13812345678",
        "budget": "30元",
        "quantity_estimate": "100份",
        "due_date": "6月18日",
        "city": "上海",
    }
    for key, value in expected.items():
        assert_true(info.get(key) == value, f"{key} should be {value}, got {info.get(key)}")


def test_config_helpers():
    from core.customer_profile import load_profile, validate_profile
    from core.knowledge_config import match_knowledge
    from core.lead_pipeline import load_pipeline, save_pipeline, validate_pipeline
    from core.skill_config import load_skills
    from scripts.static_sanity import run as run_static_sanity

    matches = match_knowledge("这个礼盒多少钱")
    assert_true(matches, "knowledge matching should return at least one item")
    assert_true(matches[0]["id"] == "pricing", "pricing knowledge should match price questions")

    skills = load_skills().get("skills", [])
    enabled = [skill for skill in skills if skill.get("enabled", True)]
    assert_true(len(enabled) >= 6, "at least six customer-service skills should be enabled")

    pipeline = load_pipeline()
    assert_true(not validate_pipeline(pipeline), "lead pipeline should be valid")
    assert_true(len(pipeline.get("stages", [])) >= 6, "lead pipeline should include commercial stages")
    save_pipeline(pipeline)
    assert_true(not validate_pipeline(load_pipeline()), "lead pipeline should remain valid after save")

    profile = load_profile()
    assert_true(not validate_profile(profile), "customer profile should be valid")
    assert_true(not run_static_sanity(), "static sanity checks should pass")


def test_backup_and_export_helpers():
    from scripts.backup_data import create_backup, inspect_backup
    from scripts.answer_guard_audit import build_answer_guard_audit, export_answer_guard_audit
    from scripts.audit_quality import export_quality_audit
    from scripts.export_leads import export_leads
    from scripts.export_audit_log import export_audit_log
    from scripts.export_report import export_report
    from scripts.business_hours_audit import build_business_hours_audit, export_business_hours_audit
    from scripts.followup_reminders import export_followup_tasks
    from scripts.generate_acceptance_pack import export_acceptance_pack
    from scripts.handoff_queue import build_handoff_queue, export_handoff_queue
    from scripts.improvement_backlog import build_improvement_backlog, export_improvement_backlog
    from scripts.order_handoff import build_order_handoff, export_order_handoff
    from scripts.quote_readiness import build_quote_readiness, export_quote_readiness
    from scripts.reply_style_miner import build_reply_style_samples, export_reply_style_samples
    from scripts.run_acceptance_scenarios import export_acceptance_scenarios, run_scenarios
    from scripts.sla_monitor import build_sla_report, export_sla_report
    from scripts.check_launch_readiness import export_readiness_report
    from scripts.cleanup_retention import cleanup_retention
    from core.database import Database
    from scripts.web_console import generate_report_file, list_backup_files, list_report_files

    backup = create_backup("smoke")
    names = inspect_backup(backup)
    assert_true("config/customer_knowledge.yaml" in names, "backup should include knowledge config")
    assert_true("config/customer_skills.yaml" in names, "backup should include skills config")

    csv_path = export_leads(limit=10)
    assert_true(csv_path.exists(), "lead export csv should exist")
    assert_true("company_name" in csv_path.read_text(encoding="utf-8-sig"), "lead export should include headers")

    report_path = export_report(days=7, limit=10)
    assert_true(report_path.exists(), "operation report should exist")
    assert_true("智能客服运营报告" in report_path.read_text(encoding="utf-8"), "report should include title")

    audit_path = export_quality_audit(days=7, limit=50)
    assert_true(audit_path.exists(), "quality audit should exist")
    assert_true("智能客服质检报告" in audit_path.read_text(encoding="utf-8"), "audit should include title")

    audit_log_path = export_audit_log(limit=50)
    assert_true(audit_log_path.exists(), "audit log report should exist")
    assert_true("操作审计报告" in audit_log_path.read_text(encoding="utf-8"), "audit log should include title")

    followup_path = export_followup_tasks(limit=10)
    assert_true(followup_path.exists(), "follow-up task report should exist")
    assert_true("今日跟进任务" in followup_path.read_text(encoding="utf-8"), "follow-up report should include title")

    handoff_items = build_handoff_queue(limit=10)
    assert_true(isinstance(handoff_items, list), "handoff queue should return a list")
    handoff_path = export_handoff_queue(limit=10)
    assert_true(handoff_path.exists(), "handoff queue report should exist")
    assert_true("人工接管队列" in handoff_path.read_text(encoding="utf-8"), "handoff report should include title")

    sla_report = build_sla_report(days=7)
    assert_true("sla_rate" in sla_report, "SLA report should include SLA rate")
    sla_path = export_sla_report(days=7)
    assert_true(sla_path.exists(), "SLA monitor report should exist")
    assert_true("智能客服 SLA 监控报告" in sla_path.read_text(encoding="utf-8"), "SLA report should include title")

    guard_audit = build_answer_guard_audit()
    assert_true(guard_audit["forbidden_phrases"], "answer guard audit should include forbidden phrases")
    guard_path = export_answer_guard_audit()
    assert_true(guard_path.exists(), "answer guard audit report should exist")
    assert_true("回复安全护栏审计报告" in guard_path.read_text(encoding="utf-8"), "answer guard audit should include title")

    hours_audit = build_business_hours_audit()
    assert_true(hours_audit["working_hours"], "business hours audit should include working hours")
    hours_path = export_business_hours_audit()
    assert_true(hours_path.exists(), "business hours audit report should exist")
    assert_true("非工作时间兜底审计报告" in hours_path.read_text(encoding="utf-8"), "business hours audit should include title")

    backlog = build_improvement_backlog(days=7, limit=50)
    assert_true("items" in backlog, "improvement backlog should include items")
    backlog_path = export_improvement_backlog(days=7, limit=50)
    assert_true(backlog_path.exists(), "improvement backlog report should exist")
    assert_true("智能客服优化待办" in backlog_path.read_text(encoding="utf-8"), "improvement backlog should include title")

    quote = build_quote_readiness(limit=50)
    assert_true("ready_rate" in quote, "quote readiness should include ready rate")
    quote_path = export_quote_readiness(limit=50)
    assert_true(quote_path.exists(), "quote readiness report should exist")
    assert_true("报价准备清单" in quote_path.read_text(encoding="utf-8"), "quote readiness should include title")

    order = build_order_handoff(limit=50)
    assert_true("ready_rate" in order, "order handoff should include ready rate")
    order_path = export_order_handoff(limit=50)
    assert_true(order_path.exists(), "order handoff report should exist")
    assert_true("订单交付清单" in order_path.read_text(encoding="utf-8"), "order handoff should include title")

    reply_style = build_reply_style_samples(days=90, limit=20)
    assert_true("total_pairs" in reply_style, "reply style mining should include total pairs")
    reply_style_path = export_reply_style_samples(days=90, limit=20)
    assert_true(reply_style_path.exists(), "reply style sample report should exist")
    assert_true("真人客服风格样本报告" in reply_style_path.read_text(encoding="utf-8"), "reply style report should include title")

    acceptance_path = export_acceptance_pack()
    assert_true(acceptance_path.exists(), "acceptance pack should exist")
    assert_true("商业交付验收包" in acceptance_path.read_text(encoding="utf-8"), "acceptance pack should include title")

    readiness_path = export_readiness_report()
    assert_true(readiness_path.exists(), "launch readiness report should exist")
    assert_true("上线缺口检查" in readiness_path.read_text(encoding="utf-8"), "launch readiness should include title")

    scenario_report = run_scenarios()
    assert_true(scenario_report["failed"] == 0, "acceptance scenarios should all pass")
    scenario_path = export_acceptance_scenarios()
    assert_true("落地验收场景报告" in scenario_path.read_text(encoding="utf-8"), "scenario report should include title")

    generated = generate_report_file({"type": "acceptance"})
    assert_true(generated["ok"], "web console report generation should return ok")
    assert_true("商业交付验收包" == generated["label"], "web console should generate acceptance pack")
    audit_generated = generate_report_file({"type": "audit"})
    assert_true(audit_generated["label"] == "操作审计报告", "web console should generate audit log report")
    scenario_generated = generate_report_file({"type": "scenarios"})
    assert_true(scenario_generated["label"] == "落地验收场景报告", "web console should generate scenario report")
    handoff_generated = generate_report_file({"type": "handoff"})
    assert_true(handoff_generated["label"] == "人工接管队列", "web console should generate handoff report")
    sla_generated = generate_report_file({"type": "sla"})
    assert_true(sla_generated["label"] == "SLA 监控报告", "web console should generate SLA report")
    guard_generated = generate_report_file({"type": "answer_guard"})
    assert_true(guard_generated["label"] == "回复安全护栏审计报告", "web console should generate answer guard audit")
    hours_generated = generate_report_file({"type": "business_hours"})
    assert_true(hours_generated["label"] == "非工作时间兜底审计报告", "web console should generate business-hours audit")
    backlog_generated = generate_report_file({"type": "improvement_backlog"})
    assert_true(backlog_generated["label"] == "智能客服优化待办", "web console should generate improvement backlog")
    quote_generated = generate_report_file({"type": "quote_readiness"})
    assert_true(quote_generated["label"] == "报价准备清单", "web console should generate quote readiness")
    reply_style_generated = generate_report_file({"type": "reply_style"})
    assert_true(reply_style_generated["label"] == "真人客服风格样本报告", "web console should generate reply style samples")
    order_generated = generate_report_file({"type": "order_handoff"})
    assert_true(order_generated["label"] == "订单交付清单", "web console should generate order handoff")
    assert_true(list_report_files(limit=5), "web console should list generated reports")
    assert_true(list_backup_files(limit=5), "web console should list generated backups")

    cleanup = cleanup_retention(apply=False)
    assert_true(cleanup["report_path"].exists(), "cleanup dry-run report should exist")
    assert_true("数据留存清理报告" in cleanup["report_path"].read_text(encoding="utf-8"), "cleanup report should include title")

    db = Database(str(ROOT / "data" / "kefu.db"))
    db.log_event("smoke_audit", "web audit smoke event")
    assert_true(db.get_audit_events(limit=1)[0]["event_type"] == "smoke_audit", "audit events should be queryable")


def main():
    tests = [
        test_customer_agent,
        test_lead_extraction,
        test_config_helpers,
        test_backup_and_export_helpers,
    ]
    failed = 0
    for test in tests:
        try:
            test()
            print(f"[OK] {test.__name__}")
        except Exception as exc:
            failed += 1
            print(f"[FAIL] {test.__name__}: {exc}")

    if failed:
        print(f"\nSmoke tests failed: {failed}")
        return 1
    print("\nSmoke tests passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
