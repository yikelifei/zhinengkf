#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check launch readiness for a customer deployment."""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / ".codex_deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.api_config import load_settings, provider_display_name, validate_provider_config  # noqa: E402
from core.customer_profile import load_profile, validate_profile  # noqa: E402
from core.knowledge_config import load_knowledge  # noqa: E402
from core.lead_pipeline import load_pipeline, validate_pipeline  # noqa: E402
from core.skill_config import load_skills  # noqa: E402


REQUIRED_FILES = [
    "run.bat",
    "run_web_console.bat",
    "tools/quality/run_health_check.bat",
    "tools/quality/run_smoke_tests.bat",
    "tools/quality/run_quality_audit.bat",
    "tools/quality/run_acceptance_pack.bat",
    "tools/reports/run_export_leads.bat",
    "tools/reports/run_export_report.bat",
    "tools/reports/run_followup_tasks.bat",
    "tools/operations/run_backup.bat",
]


def _item(severity: str, module: str, message: str, action: str) -> dict:
    return {
        "severity": severity,
        "module": module,
        "message": message,
        "action": action,
    }


def _count(items: list[dict], severity: str) -> int:
    return sum(1 for item in items if item["severity"] == severity)


def _check_files(items: list[dict]) -> None:
    for rel in REQUIRED_FILES:
        if not (ROOT / rel).exists():
            items.append(_item("blocker", "交付脚本", f"缺少 {rel}", "恢复脚本文件后重新运行检查"))

    for rel in ("data", "backups", "exports", "reports"):
        folder = ROOT / rel
        folder.mkdir(exist_ok=True)
        if not folder.exists():
            items.append(_item("blocker", "目录", f"缺少 {rel}/", "创建目录并确认程序有写入权限"))


def _check_profile(items: list[dict]) -> None:
    profile = load_profile()
    business = profile.get("business") or {}
    sales = profile.get("sales") or {}
    for issue in validate_profile(profile):
        items.append(_item("blocker", "客户资料", issue, "运行 init_customer.py 或编辑 config/customer_profile.yaml"))
    if not str(sales.get("default_owner", "")).strip():
        items.append(_item("warning", "客户资料", "默认负责人未填写", "为线索分配默认销售或客服负责人"))
    if not str(sales.get("hotline", "")).strip():
        items.append(_item("warning", "客户资料", "客服电话未填写", "填写热线或人工客服联系方式，便于转人工场景使用"))
    if len(business.get("service_scope") or []) < 3:
        items.append(_item("warning", "客户资料", "主营业务范围偏少", "至少配置 3 个服务方向，便于话术和交付报告更准确"))


def _check_ai(items: list[dict]) -> None:
    settings = load_settings()
    ai_engine = settings.get("ai_engine") or {}
    providers = ai_engine.get("providers") or {}
    enabled = {name: cfg for name, cfg in providers.items() if cfg.get("enabled", False)}
    if ai_engine.get("enabled", True) and not enabled:
        items.append(_item("blocker", "AI 配置", "未启用任何 AI 供应商", "至少启用一个可用供应商，或明确关闭 AI 兜底"))
        return

    primary = ai_engine.get("primary")
    if primary and primary not in providers:
        items.append(_item("blocker", "AI 配置", f"主供应商 {primary} 不存在", "修正 config/settings.yaml 的 ai_engine.primary"))
    if primary in providers and not providers[primary].get("enabled", False):
        items.append(_item("blocker", "AI 配置", f"主供应商 {primary} 未启用", "启用主供应商或切换 primary"))

    for name, provider in enabled.items():
        issues = validate_provider_config(provider)
        severity = "blocker" if name == primary else "warning"
        for issue in issues:
            items.append(
                _item(
                    severity,
                    "AI 配置",
                    f"{provider_display_name(name)}：{issue}",
                    "填写 .env 真实参数，并运行 tools\\quality\\run_health_check.bat 验证",
                )
            )


def _check_knowledge_and_skills(items: list[dict]) -> None:
    documents = load_knowledge().get("documents", [])
    enabled_skills = [skill for skill in load_skills().get("skills", []) if skill.get("enabled", True)]
    transfer_docs = [doc for doc in documents if doc.get("route") == "transfer_human"]
    transfer_skills = [skill for skill in enabled_skills if skill.get("route") == "transfer_human"]

    if len(documents) < 6:
        items.append(_item("blocker", "知识库", f"知识库仅 {len(documents)} 条", "补齐价格、起订量、交期、定制、案例、物流、售后等知识"))
    elif len(documents) < 12:
        items.append(_item("warning", "知识库", f"知识库 {len(documents)} 条，商业覆盖仍可提升", "补充真实产品、套餐、案例、节日场景和常见异议"))
    if len(transfer_docs) < 2:
        items.append(_item("warning", "知识库", "转人工知识条目偏少", "补充投诉、退款、发票、付款、合同等风险条目"))

    if len(enabled_skills) < 6:
        items.append(_item("blocker", "客服技能", f"已启用 skills 仅 {len(enabled_skills)} 个", "补齐报价、交期、案例、留资、转人工和售后技能"))
    if len(transfer_skills) < 3:
        items.append(_item("warning", "客服技能", "风险转人工 skills 偏少", "至少覆盖售后、发票、付款异常、投诉退款"))


def _check_pipeline(items: list[dict]) -> None:
    pipeline = load_pipeline()
    for issue in validate_pipeline(pipeline):
        items.append(_item("blocker", "线索管道", issue, "修正 config/lead_pipeline.yaml"))

    stages = pipeline.get("stages", [])
    stage_ids = {stage.get("id") for stage in stages}
    for required in ("new_inquiry", "quotation_given", "ordered", "lost"):
        if required not in stage_ids:
            items.append(_item("warning", "线索管道", f"缺少建议阶段 {required}", "补齐从新咨询到成交/流失的阶段"))

    rules = pipeline.get("rules") or {}
    if not rules.get("required_fields"):
        items.append(_item("blocker", "线索管道", "未配置必填线索字段", "配置 required_fields 以驱动跟进提醒"))


def build_readiness_report() -> dict:
    items: list[dict] = []
    _check_files(items)
    _check_profile(items)
    _check_ai(items)
    _check_knowledge_and_skills(items)
    _check_pipeline(items)
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "items": items,
        "blockers": _count(items, "blocker"),
        "warnings": _count(items, "warning"),
        "passed": not any(item["severity"] == "blocker" for item in items),
    }


def render_markdown(report: dict) -> str:
    status = "可以试运行" if report["passed"] else "暂不建议上线"
    lines = [
        "# 智能客服上线缺口检查",
        "",
        f"- 生成时间：{report['generated_at']}",
        f"- 上线判断：{status}",
        f"- 阻塞项：{report['blockers']}",
        f"- 建议项：{report['warnings']}",
        "",
        "## 缺口清单",
        "",
    ]

    if report["items"]:
        lines.append("| 级别 | 模块 | 问题 | 建议动作 |")
        lines.append("| --- | --- | --- | --- |")
        for item in report["items"]:
            label = "阻塞" if item["severity"] == "blocker" else "建议"
            lines.append(f"| {label} | {item['module']} | {item['message']} | {item['action']} |")
    else:
        lines.append("- 未发现配置缺口，可以进入微信实机试运行。")

    lines.extend(
        [
            "",
            "## 上线前固定动作",
            "",
            "- 运行 `tools/operations/run_backup.bat` 生成部署前备份。",
            "- 运行 `tools/quality/run_health_check.bat`，确认 failed 为 0。",
            "- 运行 `tools/quality/run_smoke_tests.bat`，确认核心业务逻辑通过。",
            "- 运行 `tools/quality/run_acceptance_pack.bat`，生成客户验收材料。",
            "- 用真实微信小号完成 5 类问题实测：价格、起订量、交期、定制、投诉退款。",
        ]
    )
    return "\n".join(lines) + "\n"


def export_readiness_report(output=None) -> Path:
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    if output is None:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = reports_dir / f"launch_readiness_{stamp}.md"
    else:
        output = Path(output)
    output.write_text(render_markdown(build_readiness_report()), encoding="utf-8")
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check Smart Kefu launch readiness")
    parser.add_argument("--output", help="output Markdown path")
    parser.add_argument("--strict", action="store_true", help="return non-zero when blockers exist")
    args = parser.parse_args(argv)

    report = build_readiness_report()
    output = export_readiness_report(args.output)
    print(f"Generated launch readiness report: {output}")
    print(f"Blockers: {report['blockers']}, warnings: {report['warnings']}")
    if args.strict and report["blockers"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
