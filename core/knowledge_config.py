# -*- coding: utf-8 -*-
"""Knowledge-base configuration helpers for customer support answers."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re

import yaml

from .paths import resource_path


def _knowledge_path(path="config/customer_knowledge.yaml") -> Path:
    return Path(resource_path(path))


def load_knowledge(path="config/customer_knowledge.yaml") -> dict:
    knowledge_file = _knowledge_path(path)
    with open(knowledge_file, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        data = {}
    if not isinstance(data.get("documents"), list):
        data["documents"] = []
    return data


def save_knowledge(data: dict, path="config/customer_knowledge.yaml") -> Path:
    knowledge_file = _knowledge_path(path)
    backup_dir = knowledge_file.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    if knowledge_file.exists():
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = backup_dir / f"{knowledge_file.stem}_{stamp}.yaml"
        backup_file.write_text(knowledge_file.read_text(encoding="utf-8"), encoding="utf-8")

    knowledge_file.parent.mkdir(parents=True, exist_ok=True)
    documents = (data or {}).get("documents") if isinstance(data, dict) else []
    data = {"documents": list(documents) if isinstance(documents, list) else []}
    with open(knowledge_file, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)
    return knowledge_file


def normalize_keywords(keywords) -> list[str]:
    if isinstance(keywords, str):
        parts = re.split(r"[,，\n\r]+", keywords)
        return [part.strip() for part in parts if part.strip()]
    if isinstance(keywords, list):
        return [str(item).strip() for item in keywords if str(item).strip()]
    return []


def validate_document(doc: dict, existing_ids=None) -> list[str]:
    existing_ids = set(existing_ids or [])
    issues = []
    doc_id = str(doc.get("id", "")).strip()
    if not doc_id:
        issues.append("知识 ID 不能为空")
    if doc_id in existing_ids:
        issues.append("知识 ID 已存在")
    if not str(doc.get("title", "")).strip():
        issues.append("标题不能为空")
    if not normalize_keywords(doc.get("keywords", [])):
        issues.append("至少需要一个关键词")
    if not str(doc.get("answer", "")).strip():
        issues.append("标准回答不能为空")
    return issues


def upsert_document(doc: dict, path="config/customer_knowledge.yaml") -> dict:
    data = load_knowledge(path)
    documents = data["documents"]
    normalized = {
        "id": str(doc.get("id", "")).strip(),
        "title": str(doc.get("title", "")).strip(),
        "keywords": normalize_keywords(doc.get("keywords", [])),
        "answer": str(doc.get("answer", "")).strip(),
    }
    route = str(doc.get("route", "")).strip()
    if route:
        normalized["route"] = route

    existing_ids = {item.get("id") for item in documents if item.get("id") != normalized["id"]}
    issues = validate_document(normalized, existing_ids=existing_ids)
    if issues:
        raise ValueError("；".join(issues))

    for index, item in enumerate(documents):
        if item.get("id") == normalized["id"]:
            documents[index] = normalized
            save_knowledge(data, path)
            return normalized

    documents.append(normalized)
    save_knowledge(data, path)
    return normalized


def delete_document(doc_id: str, path="config/customer_knowledge.yaml") -> bool:
    data = load_knowledge(path)
    before = len(data["documents"])
    data["documents"] = [doc for doc in data["documents"] if doc.get("id") != doc_id]
    changed = len(data["documents"]) != before
    if changed:
        save_knowledge(data, path)
    return changed


def match_knowledge(message: str, path="config/customer_knowledge.yaml", limit=5) -> list[dict]:
    text = (message or "").strip()
    if not text:
        return []
    results = []
    for doc in load_knowledge(path).get("documents", []):
        score = 0
        matched_keywords = []
        for keyword in normalize_keywords(doc.get("keywords", [])):
            if keyword and keyword in text:
                score += 2
                matched_keywords.append(keyword)
        title = str(doc.get("title", ""))
        if title and title in text:
            score += 1
        if score:
            results.append(
                {
                    "id": doc.get("id", ""),
                    "title": doc.get("title", ""),
                    "score": score,
                    "matched_keywords": matched_keywords,
                    "answer": doc.get("answer", ""),
                    "route": doc.get("route", ""),
                }
            )
    results.sort(key=lambda item: item["score"], reverse=True)
    return results[:limit]
