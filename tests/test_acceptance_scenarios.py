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
