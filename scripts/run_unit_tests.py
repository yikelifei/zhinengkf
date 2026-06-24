#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tiny fallback runner for pytest-style tests used by this project."""

from __future__ import annotations

import importlib.util
import inspect
import os
from pathlib import Path
import shutil
import sys
import tempfile
import traceback
import argparse


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / ".codex_deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


class MonkeyPatch:
    """Minimal subset of pytest's monkeypatch fixture used in local tests."""

    def __init__(self):
        self._env: list[tuple[str, str | None]] = []

    def setenv(self, name: str, value: str) -> None:
        if not any(item[0] == name for item in self._env):
            self._env.append((name, os.environ.get(name)))
        os.environ[name] = str(value)

    def delenv(self, name: str, raising: bool = True) -> None:
        if name not in os.environ:
            if raising:
                raise KeyError(name)
            if not any(item[0] == name for item in self._env):
                self._env.append((name, None))
            return
        if not any(item[0] == name for item in self._env):
            self._env.append((name, os.environ.get(name)))
        del os.environ[name]

    def undo(self) -> None:
        for name, old_value in reversed(self._env):
            if old_value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = old_value
        self._env.clear()


def load_module(path: Path):
    module_name = f"_local_tests_{path.stem}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_kwargs(test_func):
    signature = inspect.signature(test_func)
    kwargs = {}
    tmp_dirs = []
    monkeypatch = None
    for name in signature.parameters:
        if name == "tmp_path":
            tmp = Path(tempfile.mkdtemp(prefix="smart_kefu_test_"))
            kwargs[name] = tmp
            tmp_dirs.append(tmp)
        elif name == "monkeypatch":
            monkeypatch = MonkeyPatch()
            kwargs[name] = monkeypatch
        else:
            raise TypeError(f"Unsupported fixture: {name}")
    return kwargs, tmp_dirs, monkeypatch


def cleanup(tmp_dirs: list[Path], monkeypatch: MonkeyPatch | None) -> None:
    if monkeypatch is not None:
        monkeypatch.undo()
    for tmp in tmp_dirs:
        shutil.rmtree(tmp, ignore_errors=True)


def resolve_test_files(paths: list[str] | None = None) -> list[Path]:
    tests_dir = ROOT / "tests"
    if not paths:
        return sorted(tests_dir.glob("test_*.py"))
    files = []
    for raw in paths:
        path = Path(raw)
        if not path.is_absolute():
            path = ROOT / path
        if path.is_dir():
            files.extend(sorted(path.glob("test_*.py")))
        else:
            files.append(path)
    return sorted(dict.fromkeys(files))


def run_tests(paths: list[str] | None = None) -> tuple[int, int]:
    files = resolve_test_files(paths)
    passed = 0
    failed = 0
    for path in files:
        if not path.exists():
            failed += 1
            print(f"[FAIL] {path}: file not found")
            continue
        try:
            module = load_module(path)
        except Exception:
            failed += 1
            print(f"[FAIL] {path.name}: import failed")
            traceback.print_exc()
            continue
        for name in sorted(dir(module)):
            if not name.startswith("test_"):
                continue
            test_func = getattr(module, name)
            if not callable(test_func):
                continue
            tmp_dirs: list[Path] = []
            monkeypatch = None
            try:
                kwargs, tmp_dirs, monkeypatch = build_kwargs(test_func)
                test_func(**kwargs)
                passed += 1
                print(f"[OK] {path.name}::{name}")
            except Exception:
                failed += 1
                print(f"[FAIL] {path.name}::{name}")
                traceback.print_exc()
            finally:
                cleanup(tmp_dirs, monkeypatch)
    return passed, failed


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Run local pytest-style unit tests without pytest.")
    parser.add_argument("paths", nargs="*", help="optional test files or directories")
    args = parser.parse_args(argv)
    passed, failed = run_tests(args.paths)
    print("")
    print(f"Unit tests: {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
