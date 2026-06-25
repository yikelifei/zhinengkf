import yaml

from core.lead_pipeline import (
    default_next_action,
    load_pipeline,
    pipeline_rules,
    save_pipeline,
    stage_label,
    validate_pipeline,
)


def test_load_pipeline_sorts_stages_and_merges_rules(tmp_path):
    path = tmp_path / "lead_pipeline.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "stages": [
                    {"id": "b", "label": "B", "order": 20},
                    {"id": "a", "label": "A", "order": 10, "default_next_action": "Do A"},
                ],
                "rules": {"high_intent_score": 90},
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )

    pipeline = load_pipeline(str(path))
    assert [stage["id"] for stage in pipeline["stages"]] == ["a", "b"]
    assert pipeline["rules"]["high_intent_score"] == 90
    assert pipeline["rules"]["medium_intent_score"] == 50
    assert stage_label("a", str(path)) == "A"
    assert default_next_action("a", str(path)) == "Do A"
    assert pipeline_rules(str(path))["stale_days"] == 2


def test_load_pipeline_treats_malformed_stages_and_rules_as_defaults(tmp_path):
    path = tmp_path / "lead_pipeline.yaml"
    path.write_text("stages: broken\nrules: also-broken\n", encoding="utf-8")

    pipeline = load_pipeline(str(path))

    assert pipeline["stages"] == []
    assert pipeline["rules"]["high_intent_score"] == 80


def test_load_pipeline_treats_invalid_yaml_as_defaults(tmp_path):
    path = tmp_path / "lead_pipeline.yaml"
    path.write_text("stages: [broken\n", encoding="utf-8")

    pipeline = load_pipeline(str(path))

    assert pipeline["stages"] == []
    assert pipeline["rules"]["high_intent_score"] == 80


def test_validate_pipeline_rejects_bad_config():
    issues = validate_pipeline(
        {
            "stages": [
                "not-a-stage",
                {"id": "new", "label": ""},
                {"id": "new", "label": "重复"},
            ],
            "rules": {"high_intent_score": "bad"},
        }
    )

    assert "阶段配置必须是对象" in issues
    assert "阶段 new 缺少 label" in issues
    assert "阶段 id 重复：new" in issues
    assert "high_intent_score 必须是整数" in issues


def test_save_pipeline_rejects_malformed_stages_without_crashing(tmp_path):
    path = tmp_path / "lead_pipeline.yaml"

    try:
        save_pipeline({"stages": "broken", "rules": "also-broken"}, str(path))
    except ValueError as exc:
        assert "至少需要一个线索阶段" in str(exc)
    else:
        raise AssertionError("malformed stages should fail validation")


def test_save_pipeline_validates_and_creates_backup(tmp_path):
    path = tmp_path / "lead_pipeline.yaml"
    save_pipeline(
        {
            "stages": [{"id": "new", "label": "新咨询", "order": 10}],
            "rules": {"high_intent_score": 88, "required_fields": ["phone"]},
        },
        str(path),
    )
    save_pipeline(
        {
            "stages": [{"id": "new", "label": "新咨询", "order": 10}],
            "rules": {"high_intent_score": 90, "required_fields": ["phone", "budget"]},
        },
        str(path),
    )

    pipeline = load_pipeline(str(path))
    assert pipeline["rules"]["high_intent_score"] == 90
    assert pipeline["rules"]["medium_intent_score"] == 50
    assert (path.parent / "backups").exists()
