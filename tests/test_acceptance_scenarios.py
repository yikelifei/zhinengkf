import yaml

from scripts import run_acceptance_scenarios


def test_load_scenarios_treats_malformed_config_as_empty(tmp_path):
    path = tmp_path / "acceptance_scenarios.yaml"

    path.write_text("scenarios: [broken\n", encoding="utf-8")
    assert run_acceptance_scenarios.load_scenarios(str(path)) == []

    path.write_text("- broken\n", encoding="utf-8")
    assert run_acceptance_scenarios.load_scenarios(str(path)) == []

    path.write_text(
        yaml.safe_dump({"scenarios": "broken"}, allow_unicode=True),
        encoding="utf-8",
    )
    assert run_acceptance_scenarios.load_scenarios(str(path)) == []


def test_load_scenarios_skips_malformed_entries(tmp_path):
    path = tmp_path / "acceptance_scenarios.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "scenarios": [
                    "broken",
                    {"id": "ok", "message": "\u4f60\u597d"},
                ]
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )

    assert run_acceptance_scenarios.load_scenarios(str(path)) == [
        {"id": "ok", "message": "\u4f60\u597d"}
    ]


def test_run_scenarios_tolerates_scalar_and_non_string_expectations(tmp_path):
    path = tmp_path / "acceptance_scenarios.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "scenarios": [
                    {
                        "id": "dirty_expectations",
                        "title": "dirty expectations",
                        "message": "\u4f60\u597d",
                        "answer_must_include": 123,
                        "answer_must_not_include": [456],
                        "expected_fields": "phone",
                        "guard_must_block": "\u5148\u884c\u8d54\u4ed8",
                        "unsafe_answer": "\u6211\u4eec\u5148\u884c\u8d54\u4ed8",
                    }
                ]
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )

    report = run_acceptance_scenarios.run_scenarios(str(path))

    assert report["total"] == 1
    assert report["failed"] == 1
    assert report["results"][0]["issues"]
