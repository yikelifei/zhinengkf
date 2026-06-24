#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Clean old runtime artifacts according to retention rules."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / ".codex_deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.database import Database  # noqa: E402


DEFAULT_RETENTION = {
    "logs": 30,
    "reports": 90,
    "exports": 90,
    "backups": 180,
}
MIN_RETENTION_DAYS = 1
MAX_RETENTION_DAYS = 3650


def _safe_files(folder: Path) -> list[Path]:
    if not folder.exists():
        return []
    root = ROOT.resolve()
    files = []
    for path in folder.iterdir():
        resolved = path.resolve()
        if not path.is_file():
            continue
        if root not in resolved.parents:
            continue
        files.append(path)
    return files


def build_cleanup_plan(retention=None, now=None) -> dict:
    retention = {**DEFAULT_RETENTION, **(retention or {})}
    retention = validate_retention(retention)
    now = now or datetime.now()
    items = []
    for folder_name, days in retention.items():
        folder = ROOT / folder_name
        cutoff = now - timedelta(days=int(days))
        for path in _safe_files(folder):
            mtime = datetime.fromtimestamp(path.stat().st_mtime)
            if mtime < cutoff:
                items.append(
                    {
                        "folder": folder_name,
                        "name": path.name,
                        "path": str(path),
                        "size": path.stat().st_size,
                        "updated_at": mtime.strftime("%Y-%m-%d %H:%M:%S"),
                        "retention_days": int(days),
                    }
                )
    items.sort(key=lambda item: (item["folder"], item["updated_at"], item["name"]))
    return {
        "generated_at": now.strftime("%Y-%m-%d %H:%M:%S"),
        "retention": retention,
        "items": items,
        "total_files": len(items),
        "total_bytes": sum(item["size"] for item in items),
    }


def validate_retention(retention: dict) -> dict:
    normalized = {}
    for folder_name, days in retention.items():
        try:
            value = int(days)
        except (TypeError, ValueError):
            raise ValueError(f"{folder_name} 留存天数必须是整数") from None
        if value < MIN_RETENTION_DAYS or value > MAX_RETENTION_DAYS:
            raise ValueError(
                f"{folder_name} 留存天数必须在 "
                f"{MIN_RETENTION_DAYS} 到 {MAX_RETENTION_DAYS} 天之间"
            )
        normalized[folder_name] = value
    return normalized


def render_markdown(plan: dict, applied=False) -> str:
    lines = [
        "# 智能客服数据留存清理报告",
        "",
        f"- 生成时间：{plan['generated_at']}",
        f"- 执行动作：{'已删除' if applied else '仅预览，未删除'}",
        f"- 待清理文件：{plan['total_files']}",
        f"- 待清理大小：{round(plan['total_bytes'] / 1024 / 1024, 2)} MB",
        "",
        "## 保留策略",
        "",
    ]
    for folder, days in plan["retention"].items():
        lines.append(f"- {folder}/：保留最近 {days} 天")

    lines.extend(["", "## 文件清单", ""])
    if plan["items"]:
        lines.append("| 目录 | 文件 | 更新时间 | 大小 KB | 保留天数 |")
        lines.append("| --- | --- | --- | ---: | ---: |")
        for item in plan["items"]:
            lines.append(
                f"| {item['folder']} | {item['name']} | {item['updated_at']} | "
                f"{max(1, round(item['size'] / 1024))} | {item['retention_days']} |"
            )
    else:
        lines.append("- 暂无过期文件")
    return "\n".join(lines) + "\n"


def export_cleanup_report(plan: dict, applied=False, output=None) -> Path:
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    if output is None:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = reports_dir / f"cleanup_retention_{stamp}.md"
    else:
        output = Path(output)
    output.write_text(render_markdown(plan, applied=applied), encoding="utf-8")
    return output


def apply_cleanup(plan: dict) -> list[str]:
    deleted = []
    root = ROOT.resolve()
    for item in plan["items"]:
        path = Path(item["path"]).resolve()
        if root not in path.parents:
            raise ValueError(f"unsafe cleanup path: {path}")
        if path.exists() and path.is_file():
            path.unlink()
            deleted.append(str(path))
    return deleted


def cleanup_retention(retention=None, apply=False, output=None) -> dict:
    plan = build_cleanup_plan(retention=retention)
    deleted = apply_cleanup(plan) if apply else []
    report_path = export_cleanup_report(plan, applied=apply, output=output)
    db = Database(str(ROOT / "data" / "kefu.db"))
    db.log_event(
        "retention_cleanup",
        f"{'applied' if apply else 'dry-run'}: {len(deleted) or plan['total_files']} files, report={report_path}",
    )
    return {"plan": plan, "deleted": deleted, "report_path": report_path}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Clean old Smart Kefu runtime artifacts")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="delete matched files")
    mode.add_argument("--dry-run", action="store_true", help="preview only; this is the default")
    parser.add_argument("--logs-days", type=int, default=DEFAULT_RETENTION["logs"])
    parser.add_argument("--reports-days", type=int, default=DEFAULT_RETENTION["reports"])
    parser.add_argument("--exports-days", type=int, default=DEFAULT_RETENTION["exports"])
    parser.add_argument("--backups-days", type=int, default=DEFAULT_RETENTION["backups"])
    parser.add_argument("--output", help="output Markdown report path")
    args = parser.parse_args(argv)

    retention = {
        "logs": args.logs_days,
        "reports": args.reports_days,
        "exports": args.exports_days,
        "backups": args.backups_days,
    }
    try:
        result = cleanup_retention(retention=retention, apply=args.apply, output=args.output)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(f"Cleanup report: {result['report_path']}")
    print(f"Matched files: {result['plan']['total_files']}")
    if args.apply:
        print(f"Deleted files: {len(result['deleted'])}")
    else:
        print("Dry-run only. Add --apply to delete matched files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
