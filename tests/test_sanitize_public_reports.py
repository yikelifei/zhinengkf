from scripts.sanitize_public_reports import sanitize_public_reports


def test_sanitize_public_reports_redacts_public_text_files(tmp_path):
    report = tmp_path / "audit_log.md"
    report.write_text(r"path: C:\Users\27808\Desktop\zhinengkefu\reports\audit.md", encoding="utf-8")
    ignored = tmp_path / "backup.zip"
    ignored.write_bytes(b"C:\\Users\\27808")

    result = sanitize_public_reports(tmp_path)

    assert result["scanned"] == 1
    assert result["changed"] == 1
    assert result["skipped"] == 1
    sanitized = report.read_text(encoding="utf-8")
    assert "C:\\Users\\" not in sanitized
    assert "zhinengkefu" not in sanitized
    assert ignored.read_bytes() == b"C:\\Users\\27808"


def test_sanitize_public_reports_is_idempotent(tmp_path):
    report = tmp_path / "quality.md"
    report.write_text("ok\n", encoding="utf-8")

    result = sanitize_public_reports(tmp_path)

    assert result["scanned"] == 1
    assert result["changed"] == 0
