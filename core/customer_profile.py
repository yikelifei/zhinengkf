# -*- coding: utf-8 -*-
"""Customer/business profile configuration helpers."""

from pathlib import Path
from datetime import datetime

import yaml

from .paths import resource_path


def _profile_path(path="config/customer_profile.yaml") -> Path:
    return Path(resource_path(path))


def load_profile(path="config/customer_profile.yaml") -> dict:
    profile_file = _profile_path(path)
    if not profile_file.exists():
        return {"business": {}, "sales": {}, "brand": {}}
    try:
        with open(profile_file, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    except yaml.YAMLError:
        data = {}
    return _normalize_profile(data)


def save_profile(profile: dict, path="config/customer_profile.yaml") -> Path:
    profile_file = _profile_path(path)
    profile_file.parent.mkdir(parents=True, exist_ok=True)
    backup_dir = profile_file.parent / "backups"
    backup_dir.mkdir(exist_ok=True)
    if profile_file.exists():
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = backup_dir / f"{profile_file.stem}_{stamp}.yaml"
        backup_file.write_text(profile_file.read_text(encoding="utf-8"), encoding="utf-8")

    data = _normalize_profile(profile)
    with open(profile_file, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)
    return profile_file


def validate_profile(profile: dict) -> list[str]:
    issues = []
    profile = _normalize_profile(profile)
    business = profile.get("business") or {}
    if not str(business.get("company_name", "")).strip():
        issues.append("company_name 不能为空")
    if not str(business.get("assistant_name", "")).strip():
        issues.append("assistant_name 不能为空")
    if not business.get("service_scope"):
        issues.append("service_scope 至少需要一项")
    sales = profile.get("sales") or {}
    if not sales.get("quote_required_fields"):
        issues.append("quote_required_fields 至少需要一项")
    return issues


def business_summary(path="config/customer_profile.yaml") -> str:
    profile = load_profile(path)
    business = profile.get("business", {})
    scope = "、".join(str(item) for item in business.get("service_scope", []))
    return (
        f"{business.get('company_name', '礼盒定制公司')}，"
        f"客服名：{business.get('assistant_name', '小礼')}，"
        f"业务范围：{scope or '礼盒定制'}。"
    )


def _normalize_profile(profile) -> dict:
    source = profile if isinstance(profile, dict) else {}
    business = dict(source.get("business") if isinstance(source.get("business"), dict) else {})
    sales = dict(source.get("sales") if isinstance(source.get("sales"), dict) else {})
    brand = dict(source.get("brand") if isinstance(source.get("brand"), dict) else {})
    if "service_scope" in business:
        business["service_scope"] = _string_list(business.get("service_scope"))
    if "quote_required_fields" in sales:
        sales["quote_required_fields"] = _string_list(sales.get("quote_required_fields"))
    if "forbidden_promises" in brand:
        brand["forbidden_promises"] = _string_list(brand.get("forbidden_promises"))
    return {
        "business": business,
        "sales": sales,
        "brand": brand,
    }


def _string_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if not isinstance(value, (list, tuple, set)):
        return []
    return [str(item).strip() for item in value if str(item).strip()]
