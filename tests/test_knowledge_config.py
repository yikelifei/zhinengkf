import yaml

from core.knowledge_config import (
    delete_document,
    load_knowledge,
    match_knowledge,
    save_knowledge,
    upsert_document,
    validate_document,
)


def test_upsert_document_and_match(tmp_path):
    path = tmp_path / "customer_knowledge.yaml"
    save_knowledge({"documents": []}, path=str(path))

    upsert_document(
        {
            "id": "pricing",
            "title": "价格",
            "keywords": "价格, 多少钱, 报价",
            "answer": "价格取决于数量和定制内容。",
        },
        path=str(path),
    )

    data = load_knowledge(path=str(path))
    assert data["documents"][0]["keywords"] == ["价格", "多少钱", "报价"]

    matches = match_knowledge("这个多少钱", path=str(path))
    assert matches[0]["id"] == "pricing"
    assert matches[0]["score"] >= 2


def test_save_knowledge_creates_missing_parent_directories(tmp_path):
    path = tmp_path / "tenant_a" / "config" / "customer_knowledge.yaml"

    save_knowledge({"documents": []}, path=str(path))

    assert path.exists()
    assert (path.parent / "backups").exists()
    assert load_knowledge(path=str(path))["documents"] == []


def test_load_knowledge_treats_malformed_documents_as_empty(tmp_path):
    path = tmp_path / "customer_knowledge.yaml"
    path.write_text("documents: broken\n", encoding="utf-8")

    assert load_knowledge(path=str(path))["documents"] == []


def test_save_knowledge_does_not_split_malformed_documents_string(tmp_path):
    path = tmp_path / "customer_knowledge.yaml"

    save_knowledge({"documents": "broken"}, path=str(path))

    assert load_knowledge(path=str(path))["documents"] == []


def test_delete_document_creates_change(tmp_path):
    path = tmp_path / "customer_knowledge.yaml"
    path.write_text(
        yaml.safe_dump({"documents": [{"id": "a", "title": "A", "keywords": ["a"], "answer": "A"}]}, allow_unicode=True),
        encoding="utf-8",
    )

    assert delete_document("a", path=str(path)) is True
    assert load_knowledge(path=str(path))["documents"] == []


def test_validate_document_requires_core_fields():
    issues = validate_document({"id": "", "title": "", "keywords": "", "answer": ""})

    assert "知识 ID 不能为空" in issues
    assert "标题不能为空" in issues
    assert "至少需要一个关键词" in issues
    assert "标准回答不能为空" in issues
