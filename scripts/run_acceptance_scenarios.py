#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Run landing acceptance scenarios for the intelligent customer-service bot."""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
import sys

import yaml


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / ".codex_deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.conversation import ConversationManager  # noqa: E402
from core.answer_guard import AnswerGuard  # noqa: E402
from core.customer_agent import CustomerSupportAgent  # noqa: E402


def load_scenarios(path="config/acceptance_scenarios.yaml") -> list[dict]:
    with open(ROOT / path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data.get("scenarios", [])


def run_scenarios(path="config/acceptance_scenarios.yaml") -> dict:
    agent = CustomerSupportAgent()
    guard = AnswerGuard()
    manager = ConversationManager(db=None)
    results = []
    for scenario in load_scenarios(path):
        decision = agent.analyze(scenario.get("message", ""))
        extracted = manager.extract_contact_info(scenario.get("message", ""))
        issues = []
        if scenario.get("expected_route") and decision.route != scenario["expected_route"]:
            issues.append(f"route expected {scenario['expected_route']}, got {decision.route}")
        if scenario.get("expected_topic") and decision.topic != scenario["expected_topic"]:
            issues.append(f"topic expected {scenario['expected_topic']}, got {decision.topic}")
        for keyword in scenario.get("answer_must_include", []):
            if keyword not in decision.answer:
                issues.append(f"answer missing keyword: {keyword}")
        for field in scenario.get("expected_fields", []):
            if not extracted.get(field):
                issues.append(f"missing extracted field: {field}")
        for phrase in scenario.get("answer_must_not_include", []):
            if phrase in decision.answer:
                issues.append(f"answer contains forbidden phrase: {phrase}")
        for phrase in scenario.get("guard_must_block", []):
            guarded = guard.sanitize(scenario.get("unsafe_answer", ""))
            if phrase in guarded.answer or not guarded.changed:
                issues.append(f"guard did not block forbidden phrase: {phrase}")
        results.append(
            {
                "id": scenario.get("id", ""),
                "title": scenario.get("title", ""),
                "message": scenario.get("message", ""),
                "route": decision.route,
                "topic": decision.topic,
                "confidence": decision.confidence,
                "answer": decision.answer,
                "extracted": extracted,
                "passed": not issues,
                "issues": issues,
            }
        )
    passed = sum(1 for item in results if item["passed"])
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total": len(results),
        "passed": passed,
        "failed": len(results) - passed,
        "pass_rate": round(passed / len(results), 4) if results else 0,
        "results": results,
    }


def render_markdown(report: dict) -> str:
    lines = [
        "# 智能客服落地验收场景报告",
        "",
        f"- 生成时间：{report['generated_at']}",
        f"- 场景总数：{report['total']}",
        f"- 通过：{report['passed']}",
        f"- 失败：{report['failed']}",
        f"- 通过率：{report['pass_rate']:.1%}",
        "",
        "## 场景明细",
        "",
        "| 结果 | 场景 | 路由 | 主题 | 置信度 | 问题 |",
        "| --- | --- | --- | --- | ---: | --- |",
    ]
    for item in report["results"]:
        lines.append(
            f"| {'通过' if item['passed'] else '失败'} | {item['title']} | "
            f"{item['route']} | {item['topic']} | {item['confidence']:.2f} | {item['message']} |"
        )
    failures = [item for item in report["results"] if not item["passed"]]
    lines.extend(["", "## 失败项", ""])
    if failures:
        for item in failures:
            lines.append(f"- {item['id']}：{'；'.join(item['issues'])}")
    else:
        lines.append("- 暂无失败项")
    lines.extend(
        [
            "",
            "## 验收口径",
            "",
            "- 高频问题必须稳定命中：价格、起订量、交期、定制、流程、案例、物流。",
            "- 高风险问题必须转人工：发票、退款、投诉、售后、付款异常。",
            "- 留资消息必须能提取电话、公司、联系人、数量、预算、使用日期和城市。",
        ]
    )
    return "\n".join(lines) + "\n"


def export_acceptance_scenarios(output=None) -> Path:
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    if output is None:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = reports_dir / f"acceptance_scenarios_{stamp}.md"
    else:
        output = Path(output)
    output.write_text(render_markdown(run_scenarios()), encoding="utf-8")
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run Smart Kefu landing acceptance scenarios")
    parser.add_argument("--output", help="output Markdown path")
    parser.add_argument("--strict", action="store_true", help="return non-zero if any scenario fails")
    args = parser.parse_args(argv)

    report = run_scenarios()
    output = Path(args.output) if args.output else export_acceptance_scenarios()
    if args.output:
        output.write_text(render_markdown(report), encoding="utf-8")
    print(f"Acceptance scenario report: {output}")
    print(f"Passed: {report['passed']}/{report['total']} ({report['pass_rate']:.1%})")
    return 1 if args.strict and report["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
