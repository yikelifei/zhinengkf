# -*- coding: utf-8 -*-
""" 结构化日志系统 """

import logging
import os
import sys
from datetime import datetime


def setup_logger(
    name="smart_bot",
    log_dir="logs",
    level=logging.INFO,
    max_bytes=5 * 1024 * 1024,
    backup_count=5,
):
    """创建并配置日志记录器。

    双输出：文件（按大小轮转） + stderr（彩色区分级别）。
    调用方只需 from utils.logger import log 即可使用。
    """
    os.makedirs(log_dir, exist_ok=True)
    now = datetime.now().strftime("%Y%m%d")
    log_file = os.path.join(log_dir, f"{name}_{now}.log")

    logger = logging.getLogger(name)
    logger.setLevel(level)

    if logger.handlers:
        return logger

    # ── Formatter ──
    detailed_fmt = logging.Formatter(
        "%(asctime)s [%(levelname)-8s] %(name)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    simple_fmt = logging.Formatter("[%(levelname)s] %(message)s", datefmt="%H:%M:%S")

    # ── Rotating file handler ──
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setLevel(level)
    fh.setFormatter(detailed_fmt)
    logger.addHandler(fh)

    # ── Colored stderr handler ──
    class UTF8StreamHandler(logging.Handler):
        def emit(self, record):
            msg = simple_fmt.format(record) + "\n"
            try:
                if hasattr(sys.stderr, "buffer"):
                    sys.stderr.buffer.write(msg.encode("utf-8", errors="replace"))
                    sys.stderr.buffer.flush()
                else:
                    sys.stderr.write(msg)
                    sys.stderr.flush()
            except Exception:
                pass

    try:
        from colorama import Fore, Style, init as colorama_init
        colorama_init()

        class ColorHandler(UTF8StreamHandler):
            COLORS = {
                logging.DEBUG: Fore.CYAN,
                logging.INFO: Fore.WHITE,
                logging.WARNING: Fore.YELLOW,
                logging.ERROR: Fore.RED,
                logging.CRITICAL: Fore.RED + Style.BRIGHT,
            }

            def emit(self, record):
                color = self.COLORS.get(record.levelno, "")
                msg = simple_fmt.format(record)
                output = f"{color}{msg}{Style.RESET_ALL}\n"
                try:
                    if hasattr(sys.stderr, "buffer"):
                        sys.stderr.buffer.write(output.encode("utf-8", errors="replace"))
                        sys.stderr.buffer.flush()
                    else:
                        sys.stderr.write(output)
                        sys.stderr.flush()
                except Exception:
                    pass

        ch = ColorHandler()
        ch.setLevel(level)
        logger.addHandler(ch)
    except ImportError:
        ch = UTF8StreamHandler()
        ch.setLevel(level)
        logger.addHandler(ch)

    return logger


# Convenience imports
_log = None


def _get_log():
    global _log
    if _log is None:
        _log = setup_logger()
    return _log


def log(msg, level="INFO", **kwargs):
    """便捷函数：直接输出到所有已配置的日志器。"""
    _get_log().log(getattr(logging, level.upper(), logging.INFO), msg, extra=kwargs)


def debug(msg, **kwargs):
    log(msg, "DEBUG", **kwargs)


def info(msg, **kwargs):
    log(msg, "INFO", **kwargs)


def warning(msg, **kwargs):
    log(msg, "WARNING", **kwargs)


def error(msg, **kwargs):
    log(msg, "ERROR", **kwargs)


def critical(msg, **kwargs):
    log(msg, "CRITICAL", **kwargs)
