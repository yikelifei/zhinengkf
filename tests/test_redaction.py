from pathlib import Path

from core.redaction import redact_internal_paths


def test_redact_internal_paths_removes_project_root_variants():
    root = Path(r"C:\Users\27808\Desktop\zhinengkefu")

    text = (
        r"report: C:\Users\27808\Desktop\zhinengkefu\reports\quality.md "
        "mirror: C:/Users/27808/Desktop/zhinengkefu/reports/audit.md"
    )

    result = redact_internal_paths(text, project_root=root)

    assert "C:\\Users\\" not in result
    assert "C:/Users/" not in result
    assert "zhinengkefu" not in result
    assert "[project]" in result


def test_redact_internal_paths_removes_user_home_without_project_root():
    result = redact_internal_paths(r"backup: C:\Users\27808\Desktop\secret.zip")

    assert "C:\\Users\\" not in result
    assert "27808" not in result
    assert "[user]/" in result


def test_redact_internal_paths_handles_empty_values():
    assert redact_internal_paths(None) == ""
