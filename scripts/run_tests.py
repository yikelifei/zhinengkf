#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Run the test suite with pytest when available, otherwise use the local runner."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path


def pytest_arguments() -> list[str]:
    args = ["-m", "pytest", "tests", "-q"]
    temp_root = os.environ.get("SMART_KEFU_TASK_TEMP", "").strip()
    if temp_root:
        base_temp = Path(temp_root) / f"pytest-basetemp-{os.getpid()}-{uuid.uuid4().hex}"
        args.extend(["--basetemp", str(base_temp)])
    return args


def main() -> int:
    try:
        import pytest  # noqa: F401
    except ImportError:
        print("pytest is unavailable. Running local unit test fallback...")
        return subprocess.call([sys.executable, "scripts/run_unit_tests.py"])

    return subprocess.call([sys.executable, *pytest_arguments()])


if __name__ == "__main__":
    raise SystemExit(main())
