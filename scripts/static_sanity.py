#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Static sanity checks that do not require third-party linters."""

from __future__ import annotations

import argparse
import ast
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TARGETS = ["core", "scripts", "tests"]
TERMINATORS = (ast.Return, ast.Raise, ast.Break, ast.Continue)


def python_files(paths: list[str] | None = None) -> list[Path]:
    raw_paths = paths or DEFAULT_TARGETS
    files: list[Path] = []
    for raw in raw_paths:
        path = Path(raw)
        if not path.is_absolute():
            path = ROOT / path
        if path.is_file() and path.suffix == ".py":
            files.append(path)
        elif path.is_dir():
            files.extend(
                item
                for item in path.rglob("*.py")
                if "__pycache__" not in item.parts and ".codex_deps" not in item.parts
            )
    return sorted(dict.fromkeys(files))


def find_unreachable(path: Path) -> list[dict]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
    except SyntaxError as exc:
        return [{"file": path, "line": exc.lineno or 0, "message": f"syntax error: {exc.msg}"}]
    issues: list[dict] = []
    _scan_node(tree, path, issues)
    return issues


def _scan_node(node: ast.AST, path: Path, issues: list[dict]) -> None:
    body = getattr(node, "body", None)
    if isinstance(body, list):
        _scan_body(body, path, issues)
    for child in ast.iter_child_nodes(node):
        if child is node:
            continue
        child_body = getattr(child, "body", None)
        if isinstance(child_body, list):
            _scan_node(child, path, issues)


def _scan_body(body: list[ast.stmt], path: Path, issues: list[dict]) -> None:
    terminated_at = None
    for stmt in body:
        if terminated_at is not None and not isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            issues.append(
                {
                    "file": path,
                    "line": getattr(stmt, "lineno", 0),
                    "message": f"unreachable code after line {terminated_at}",
                }
            )
            break
        _scan_nested_statement(stmt, path, issues)
        if isinstance(stmt, TERMINATORS):
            terminated_at = getattr(stmt, "lineno", 0)


def _scan_nested_statement(stmt: ast.stmt, path: Path, issues: list[dict]) -> None:
    for field in ("body", "orelse", "finalbody"):
        nested = getattr(stmt, field, None)
        if isinstance(nested, list):
            _scan_body(nested, path, issues)
    handlers = getattr(stmt, "handlers", None)
    if handlers:
        for handler in handlers:
            _scan_body(handler.body, path, issues)


def run(paths: list[str] | None = None) -> list[dict]:
    issues: list[dict] = []
    for path in python_files(paths):
        issues.extend(find_unreachable(path))
    return issues


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Run lightweight static sanity checks.")
    parser.add_argument("paths", nargs="*", help="optional files or directories")
    args = parser.parse_args(argv)
    issues = run(args.paths)
    if issues:
        for issue in issues:
            rel = Path(issue["file"]).relative_to(ROOT)
            print(f"[FAIL] {rel}:{issue['line']} {issue['message']}")
        print(f"Static sanity failed: {len(issues)} issue(s)")
        return 1
    print("Static sanity passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
