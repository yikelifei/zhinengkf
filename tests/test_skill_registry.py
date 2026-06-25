import yaml

from core.skill_registry import SkillRegistry


def test_skill_registry_treats_malformed_root_as_empty(tmp_path):
    path = tmp_path / "customer_skills.yaml"
    path.write_text("- broken\n", encoding="utf-8")

    registry = SkillRegistry(str(path))

    assert registry.skills == []


def test_skill_registry_treats_invalid_yaml_as_empty(tmp_path):
    path = tmp_path / "customer_skills.yaml"
    path.write_text("skills: [broken\n", encoding="utf-8")

    registry = SkillRegistry(str(path))

    assert registry.skills == []


def test_skill_registry_skips_malformed_entries_and_handles_dirty_fields(tmp_path):
    path = tmp_path / "customer_skills.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "skills": [
                    "broken",
                    {"id": "disabled", "enabled": False, "keywords": ["\u4e0d\u7528"]},
                    {
                        "id": "invoice",
                        "route": "direct_reply",
                        "keywords": "\u53d1\u7968, \u4e13\u7968",
                        "answer": 123,
                        "followup": None,
                    },
                ]
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )

    registry = SkillRegistry(str(path))

    assert [skill["id"] for skill in registry.skills] == ["invoice"]
    assert registry.match_topic("\u6211\u8981\u5f00\u4e13\u7968")["id"] == "invoice"
    assert registry.answer_for("invoice") == "123"
    assert registry.route_for("invoice") == "direct_reply"
