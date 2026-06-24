#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Run the test suite with pytest when available, otherwise use the local runner."""

from __future__ import annotations

import subprocess
import sys


def main() -> int:
    try:
        import pytest  # noqa: F401
    except ImportError:
        print("pytest is unavailable. Running local unit test fallback...")
        return subprocess.call([sys.executable, "scripts/run_unit_tests.py"])

    return subprocess.call([sys.executable, "-m", "pytest", "tests", "-q"])


if __name__ == "__main__":
    raise SystemExit(main())
