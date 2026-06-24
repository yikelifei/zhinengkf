from scripts.export_audit_log import format_audit_detail


def test_format_audit_detail_redacts_local_paths_and_table_pipes():
    detail = r"质检报告: C:\Users\27808\Desktop\zhinengkefu\reports\quality.md | ok"

    result = format_audit_detail(detail)

    assert "C:\\Users\\" not in result
    assert "zhinengkefu" not in result
    assert "|" not in result
    assert "[project]" in result


def test_format_audit_detail_uses_dash_for_empty_values():
    assert format_audit_detail("") == "-"
    assert format_audit_detail(None) == "-"
