# -*- coding: utf-8 -*-
"""Configurable lead pipeline helpers."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import yaml

from .paths import resource_path


DEFAULT_RULES = {
    "high_intent_score": 80,
    "medium_intent_score": 50,
    "high_value_min_score": 80,
    "high_value_min_deal_value": 10000,
    "high_value_excluded_stages": ["lost", "closed_lost"],
    "stale_days": 2,
    "required_fields": ["phone_or_wechat", "quantity_estimate", "budget", "due_date", "city"],
}


def _pipeline_path(path="config/lead_pipeline.yaml") -> Path:
    return Path(resource_path(path))


def load_pipeline(path="config/lead_pipeline.yaml") -> dict:
    pipeline_file = _pipeline_path(path)
    if not pipeline_file.exists():
        return {"stages": [], "rules": dict(DEFAULT_RULES)}
    with open(pipeline_file, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    data.setdefault("stages", [])
    rules = dict(DEFAULT_RULES)
    rules.update(data.get("rules") or {})
    data["rules"] = rules
    data["stages"] = sorted(data["stages"], key=lambda item: item.get("order", 999))
    return data


def save_pipeline(data: dict, path="config/lead_pipeline.yaml") -> Path:
    pipeline_file = _pipeline_path(path)
    pipeline_file.parent.mkdir(parents=True, exist_ok=True)
    backup_dir = pipeline_file.parent / "backups"
    backup_dir.mkdir(exist_ok=True)
    if pipeline_file.exists():
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = backup_dir / f"{pipeline_file.stem}_{stamp}.yaml"
        backup_file.write_text(pipeline_file.read_text(encoding="utf-8"), encoding="utf-8")

    stages = list((data or {}).get("stages") or [])
    rules = dict(DEFAULT_RULES)
    rules.update((data or {}).get("rules") or {})
    normalized = {"stages": stages, "rules": rules}
    issues = validate_pipeline(normalized)
    if issues:
        raise ValueError("；".join(issues))
    with open(pipeline_file, "w", encoding="utf-8") as f:
        yaml.safe_dump(normalized, f, allow_unicode=True, sort_keys=False)
    return pipeline_file


def validate_pipeline(data: dict) -> list[str]:
    issues = []
    stages = data.get("stages") or []
    seen = set()
    if not stages:
        issues.append("至少需要一个线索阶段")
    for stage in stages:
        stage_id = str(stage.get("id", "")).strip()
        if not stage_id:
            issues.append("阶段 id 不能为空")
            continue
        if stage_id in seen:
            issues.append(f"阶段 id 重复：{stage_id}")
        seen.add(stage_id)
        if not str(stage.get("label", "")).strip():
            issues.append(f"阶段 {stage_id} 缺少 label")
    rules = data.get("rules") or {}
    for key in (
        "high_intent_score",
        "medium_intent_score",
        "high_value_min_score",
        "high_value_min_deal_value",
        "stale_days",
    ):
        try:
            value = int(rules.get(key, DEFAULT_RULES[key]))
            if value < 0:
                issues.append(f"{key} 不能小于 0")
        except Exception:
            issues.append(f"{key} 必须是整数")
    return issues


def stage_map(path="config/lead_pipeline.yaml") -> dict:
    return {stage["id"]: stage for stage in load_pipeline(path).get("stages", [])}


def stage_label(stage_id: str, path="config/lead_pipeline.yaml") -> str:
    return stage_map(path).get(stage_id, {}).get("label", stage_id or "未分阶段")


def default_next_action(stage_id: str, path="config/lead_pipeline.yaml") -> str:
    return stage_map(path).get(stage_id, {}).get("default_next_action", "")


def pipeline_rules(path="config/lead_pipeline.yaml") -> dict:
    return load_pipeline(path).get("rules", dict(DEFAULT_RULES))
