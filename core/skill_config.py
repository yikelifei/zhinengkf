# -*- coding: utf-8 -*-
"""Read and write configurable customer-service skills."""

from datetime import datetime
from pathlib import Path
import re

import yaml

from .paths import resource_path


SKILLS_PATH = Path(resource_path("config/customer_skills.yaml"))
VALID_ROUTES = {"direct_reply", "ask_clarifying", "transfer_human"}


def load_skills(path=SKILLS_PATH):
    path = Path(path)
    if not path.exists():
        return {"skills": []}
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        data = {}
    if not isinstance(data.get("skills"), list):
        data["skills"] = []
    return data


def save_skills(data, path=SKILLS_PATH):
    path = Path(path)
    if path.exists():
        backup_dir = path.parent / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup = backup_dir / f"{path.stem}_{stamp}{path.suffix}"
        backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    skills = data.get("skills") if isinstance(data, dict) else []
    normalized = {"skills": list(skills) if isinstance(skills, list) else []}
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(normalized, f, allow_unicode=True, sort_keys=False)


def normalize_keywords(value):
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in re.split(r"[,，\n\r]+", str(value or "")) if item.strip()]


def validate_skill(skill):
    required = ["id", "title", "keywords", "answer"]
    missing = [key for key in required if not skill.get(key)]
    if missing:
        raise ValueError("技能缺少字段：" + "、".join(missing))
    if skill.get("route") not in VALID_ROUTES:
        raise ValueError("route 只能是 direct_reply、ask_clarifying 或 transfer_human")


def upsert_skill(skill, path=SKILLS_PATH):
    data = load_skills(path)
    item = {
        "id": skill.get("id", "").strip(),
        "title": skill.get("title", "").strip(),
        "enabled": bool(skill.get("enabled", True)),
        "route": skill.get("route", "direct_reply").strip() or "direct_reply",
        "keywords": normalize_keywords(skill.get("keywords", [])),
        "answer": skill.get("answer", "").strip(),
        "followup": skill.get("followup", "").strip(),
    }
    validate_skill(item)
    skills = data["skills"]
    for index, existing in enumerate(skills):
        if existing.get("id") == item["id"]:
            skills[index] = item
            break
    else:
        skills.append(item)
    save_skills(data, path)
    return item


def delete_skill(skill_id, path=SKILLS_PATH):
    data = load_skills(path)
    original = len(data["skills"])
    data["skills"] = [
        skill for skill in data["skills"]
        if skill.get("id") != skill_id
    ]
    changed = len(data["skills"]) != original
    if changed:
        save_skills(data, path)
    return changed
