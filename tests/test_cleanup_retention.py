from contextlib import redirect_stderr
from io import StringIO

from scripts.cleanup_retention import build_cleanup_plan, main, validate_retention


def test_validate_retention_rejects_dangerous_values():
    for value in (0, -1, 3651, "abc", None):
        try:
            validate_retention({"reports": value})
        except ValueError as exc:
            assert "留存天数" in str(exc)
        else:
            raise AssertionError(f"validate_retention accepted {value!r}")


def test_validate_retention_accepts_normal_values():
    assert validate_retention({"logs": "30", "reports": 90}) == {
        "logs": 30,
        "reports": 90,
    }


def test_build_cleanup_plan_validates_custom_retention():
    try:
        build_cleanup_plan(retention={"reports": -1})
    except ValueError as exc:
        assert "reports 留存天数" in str(exc)
    else:
        raise AssertionError("build_cleanup_plan accepted negative retention")


def test_cli_reports_invalid_retention_without_traceback():
    stderr = StringIO()
    with redirect_stderr(stderr):
        rc = main(["--reports-days", "0"])

    assert rc == 2
    assert "ERROR:" in stderr.getvalue()
    assert "Traceback" not in stderr.getvalue()
