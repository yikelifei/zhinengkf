import zipfile

from scripts.backup_data import restore_backup


def write_zip(path, entries):
    with zipfile.ZipFile(path, "w") as zf:
        for name, content in entries.items():
            zf.writestr(name, content)


def test_restore_backup_rejects_path_traversal(tmp_path):
    backup = tmp_path / "unsafe.zip"
    write_zip(backup, {"../outside.txt": "bad"})

    try:
        restore_backup(backup, apply=False)
    except ValueError as exc:
        assert "unsafe backup path" in str(exc)
    else:
        raise AssertionError("restore_backup accepted path traversal")


def test_restore_backup_rejects_project_files_outside_backup_contract(tmp_path):
    backup = tmp_path / "unexpected.zip"
    write_zip(backup, {"scripts/web_console.py": "bad"})

    try:
        restore_backup(backup, apply=False)
    except ValueError as exc:
        assert "unexpected backup path" in str(exc)
    else:
        raise AssertionError("restore_backup accepted non-backup project file")


def test_restore_backup_accepts_known_backup_members_in_dry_run(tmp_path):
    backup = tmp_path / "safe.zip"
    write_zip(
        backup,
        {
            "config/settings.yaml": "ai_engine: {}\n",
            "config/customer_profile.yaml": "business: {}\n",
        },
    )

    assert restore_backup(backup, apply=False) == [
        "config/settings.yaml",
        "config/customer_profile.yaml",
    ]
