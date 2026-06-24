from scripts.audit_quality import build_quality_audit
from scripts.export_audit_log import build_audit_log_report
from scripts.export_leads import export_leads
from scripts.export_report import build_report
from scripts.followup_reminders import build_followup_tasks
from scripts.handoff_queue import build_handoff_queue
from scripts.high_value_leads import build_high_value_leads
from scripts.image_prompt_jobs import build_image_prompt_jobs
from scripts.improvement_backlog import build_improvement_backlog
from scripts.order_handoff import build_order_handoff
from scripts.privacy_audit import build_privacy_audit
from scripts.quote_readiness import build_quote_readiness
from scripts.reply_style_miner import build_reply_style_samples
from scripts.report_params import report_days, report_limit
from scripts.sla_monitor import build_sla_report


def _assert_value_error(fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except ValueError as exc:
        message = str(exc)
        assert "must" in message or "必须" in message
    else:
        raise AssertionError(f"{fn.__name__} accepted invalid params")


def test_report_param_helpers_accept_defaults_and_bounds():
    assert report_limit(None, default=20) == 20
    assert report_limit("", default=20) == 20
    assert report_limit("1") == 1
    assert report_limit("1000") == 1000
    assert report_days("1") == 1
    assert report_days("3650") == 3650


def test_report_param_helpers_reject_invalid_values():
    for value in ("abc", "1.5", 0, -1, 1001):
        _assert_value_error(report_limit, value)
    for value in ("abc", "1.5", 0, -1, 3651):
        _assert_value_error(report_days, value)


def test_report_builders_reject_invalid_numeric_bounds_before_querying():
    cases = [
        (build_report, {"days": 0}),
        (build_report, {"limit": 1001}),
        (build_quality_audit, {"days": 0}),
        (build_quality_audit, {"limit": 1001}),
        (build_followup_tasks, {"limit": 0}),
        (build_handoff_queue, {"limit": 0}),
        (build_high_value_leads, {"limit": -1}),
        (build_image_prompt_jobs, {"limit": 1001}),
        (build_improvement_backlog, {"days": 3651}),
        (build_order_handoff, {"limit": "abc"}),
        (build_privacy_audit, {"limit": 1001}),
        (build_quote_readiness, {"limit": 0}),
        (build_reply_style_samples, {"days": -1}),
        (build_sla_report, {"days": 0}),
        (build_audit_log_report, {"limit": 1001}),
        (export_leads, {"limit": 0}),
    ]
    for fn, kwargs in cases:
        _assert_value_error(fn, **kwargs)

