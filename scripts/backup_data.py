#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Create and inspect local backups for config and customer data."""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
import shutil
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[1]
BACKUP_DIR = ROOT / "backups"
INCLUDE_PATHS = [
    "config/settings.yaml",
    "config/customer_knowledge.yaml",
    "config/customer_skills.yaml",
    "config/templates.yaml",
    "config/prompts.yaml",
    "config/lead_pipeline.yaml",
    "config/customer_profile.yaml",
    "data/kefu.db",
]
ALLOWED_RESTORE_PATHS = set(INCLUDE_PATHS)
MAX_BACKUP_LABEL_LENGTH = 32


def create_backup(label="manual") -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_label = sanitize_backup_label(label)
    backup_path = BACKUP_DIR / f"smart_kefu_{stamp}_{safe_label}.zip"

    with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for rel in INCLUDE_PATHS:
            path = ROOT / rel
            if path.exists():
                zf.write(path, rel)

    return backup_path


def sanitize_backup_label(label="manual") -> str:
    safe_label = "".join(ch for ch in str(label or "") if ch.isalnum() or ch in ("-", "_"))
    safe_label = safe_label[:MAX_BACKUP_LABEL_LENGTH].strip("_-")
    return safe_label or "manual"


def list_backups() -> list[Path]:
    if not BACKUP_DIR.exists():
        return []
    return sorted(BACKUP_DIR.glob("smart_kefu_*.zip"), reverse=True)


def inspect_backup(path: Path) -> list[str]:
    with zipfile.ZipFile(path, "r") as zf:
        return zf.namelist()


def restore_backup(path: Path, *, apply=False) -> list[str]:
    with zipfile.ZipFile(path, "r") as zf:
        members = [_validate_backup_member(info.filename) for info in zf.infolist()]

        restored = []
        for info, name in zip(zf.infolist(), members):
            if name is None:
                continue
            target = (ROOT / name).resolve()
            if ROOT.resolve() not in target.parents and target != ROOT.resolve():
                raise ValueError(f"unsafe backup path: {name}")
            restored.append(name)
            if apply:
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as source, open(target, "wb") as dest:
                    shutil.copyfileobj(source, dest)
    return restored


def _validate_backup_member(name: str) -> str | None:
    raw = str(name or "").replace("\\", "/")
    if not raw or raw.endswith("/"):
        return None
    if raw.startswith("/"):
        raise ValueError(f"unsafe backup path: {name}")
    parts = [part for part in raw.split("/") if part]
    if any(part in {".", ".."} for part in parts):
        raise ValueError(f"unsafe backup path: {name}")
    normalized = "/".join(parts)
    if normalized not in ALLOWED_RESTORE_PATHS:
        raise ValueError(f"unexpected backup path: {name}")
    return normalized


def main(argv=None):
    parser = argparse.ArgumentParser(description="Smart Kefu backup utility")
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create", help="create a backup zip")
    create.add_argument("--label", default="manual", help="short label for the backup file")

    sub.add_parser("list", help="list backup files")

    inspect = sub.add_parser("inspect", help="show files inside a backup")
    inspect.add_argument("backup", help="backup zip path")

    restore = sub.add_parser("restore", help="restore a backup; dry-run by default")
    restore.add_argument("backup", help="backup zip path")
    restore.add_argument("--apply", action="store_true", help="actually overwrite files")

    args = parser.parse_args(argv)
    if args.command == "create":
        backup = create_backup(args.label)
        print(f"Created backup: {backup}")
        return 0

    if args.command == "list":
        backups = list_backups()
        if not backups:
            print("No backups found.")
            return 0
        for backup in backups:
            print(backup)
        return 0

    if args.command == "inspect":
        for name in inspect_backup(Path(args.backup)):
            print(name)
        return 0

    if args.command == "restore":
        restored = restore_backup(Path(args.backup), apply=args.apply)
        action = "Restored" if args.apply else "Dry-run restore"
        print(f"{action}: {Path(args.backup)}")
        for name in restored:
            print(f"  {name}")
        if not args.apply:
            print("No files were changed. Add --apply to restore.")
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
