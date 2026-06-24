import yaml

from core.skill_config import delete_skill, load_skills, save_skills, upsert_skill


def test_upsert_and_delete_skill(tmp_path):
    path = tmp_path / "customer_skills.yaml"
    path.write_text("skills: []\n", encoding="utf-8")

    skill = upsert_skill(
        {
            "id": "invoice",
            "title": "发票税点",
            "enabled": True,
            "route": "direct_reply",
            "keywords": "发票, 专票",
            "answer": "可以开票。",
            "followup": "您需要普票还是专票？",
        },
        path=path,
    )

    assert skill["keywords"] == ["发票", "专票"]
    data = load_skills(path)
    assert data["skills"][0]["id"] == "invoice"

    assert delete_skill("invoice", path=path) is True
    assert load_skills(path)["skills"] == []


def test_invalid_skill_route(tmp_path):
    path = tmp_path / "customer_skills.yaml"
    path.write_text(yaml.safe_dump({"skills": []}, allow_unicode=True), encoding="utf-8")

    try:
        upsert_skill(
            {
                "id": "bad",
                "title": "Bad",
                "route": "unknown",
                "keywords": ["bad"],
                "answer": "bad",
            },
            path=path,
        )
    except ValueError as exc:
        assert "route" in str(exc)
    else:
        raise AssertionError("invalid route should fail")


def test_save_skills_backup_stays_next_to_custom_path(tmp_path):
    path = tmp_path / "nested" / "customer_skills.yaml"
    path.parent.mkdir()
    path.write_text(yaml.safe_dump({"skills": []}, allow_unicode=True), encoding="utf-8")

    save_skills({"skills": [{"id": "a", "title": "A", "keywords": ["a"], "answer": "A", "route": "direct_reply"}]}, path)

    backups = list((path.parent / "backups").glob("customer_skills_*.yaml"))
    assert backups
    assert all(item.parent == path.parent / "backups" for item in backups)
