# -*- coding: utf-8 -*-
"""Shared path helpers for source and PyInstaller builds."""

import os
import sys


def app_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def bundled_dir():
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", app_dir())
    return app_dir()


def _candidate_roots():
    roots = [
        os.getcwd(),
        app_dir(),
        os.path.abspath(os.path.join(app_dir(), "..")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..")),
        bundled_dir(),
    ]

    seen = set()
    for root in roots:
        root = os.path.abspath(root)
        key = os.path.normcase(root)
        if key in seen:
            continue
        seen.add(key)
        yield root


def resource_path(relative_path):
    if os.path.isabs(relative_path):
        return relative_path

    for root in _candidate_roots():
        candidate = os.path.join(root, relative_path)
        if os.path.exists(candidate):
            return candidate

    return os.path.join(app_dir(), relative_path)
