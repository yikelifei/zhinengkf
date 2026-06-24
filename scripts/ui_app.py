#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Smart customer service desktop console."""

import os
import subprocess
import sys
import threading
import tkinter as tk
from datetime import datetime
from pathlib import Path
from tkinter import messagebox
from tkinter import ttk

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
_LOCAL_DEPS = _PROJECT_ROOT / ".codex_deps"
if _LOCAL_DEPS.exists():
    deps_path = str(_LOCAL_DEPS)
    if deps_path not in sys.path:
        sys.path.insert(0, deps_path)
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from core.api_config import (
    PROVIDER_PRESETS,
    ensure_provider,
    load_settings,
    provider_display_name,
    test_openai_compatible_provider,
    update_provider,
    validate_provider_config,
)
from core.knowledge_config import (
    delete_document,
    load_knowledge,
    match_knowledge,
    upsert_document,
)
from core.skill_config import delete_skill, load_skills, upsert_skill
from core.database import Database
from core.ai_service import AIService, AIError
from core.customer_agent import CustomerSupportAgent


APP_TITLE = "智能客服智能体控制台"
BG = "#f5f5f7"
PANEL = "#ffffff"
PANEL_2 = "#fbfbfd"
BORDER = "#d2d2d7"
TEXT = "#1d1d1f"
MUTED = "#6e6e73"
ACCENT = "#0071e3"
ACCENT_2 = "#5856d6"
ACCENT_TINT = "#eef6ff"
DANGER = "#ff3b30"
DANGER_TEXT = "#d70015"
DANGER_TINT = "#fff2f2"
DANGER_TINT_HOVER = "#ffd7d7"
WARN = "#ff9f0a"
SIDEBAR = "#f2f2f7"
SIDEBAR_ACTIVE = "#e8e8ed"
FIELD_BG = "#ffffff"
FIELD_SOFT = "#f5f5f7"
SECONDARY = "#e8e8ed"
SECONDARY_HOVER = "#dcdce3"
SELECT_BG = "#007aff"
SUCCESS_TEXT = "#1f7a3a"
LOG_BG = "#1d1d1f"


def app_root():
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        if exe_dir.name.lower() in {"smart_bot_console", "dist"}:
            return exe_dir.parent
        return exe_dir
    return Path(__file__).resolve().parents[1]


ROOT = app_root()
BACKEND_EXE = ROOT / "smart_bot" / "smart_bot.exe"
if not BACKEND_EXE.exists():
    BACKEND_EXE = ROOT / "dist" / "smart_bot" / "smart_bot.exe"
LOG_DIR = ROOT / "logs"
CONFIG_DIR = ROOT / "config"
LOCK_FILE = ROOT / ".smart_bot_console.lock"


def ensure_single_instance():
    try:
        if LOCK_FILE.exists():
            old_pid = LOCK_FILE.read_text(encoding="utf-8", errors="ignore").strip()
            if old_pid:
                result = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", f"Get-Process -Id {old_pid} -ErrorAction SilentlyContinue"],
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                if result.returncode == 0:
                    messagebox.showinfo("已在运行", "智能客服控制台已经打开。")
                    return False
        LOCK_FILE.write_text(str(os.getpid()), encoding="utf-8")
        return True
    except Exception:
        return True


class SmartBotConsole(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(APP_TITLE)
        self.geometry("1180x760")
        self.minsize(1040, 680)
        self.configure(bg=BG)
        self.backend_process = None
        self.status_var = tk.StringVar(value="未启动")
        self.pid_var = tk.StringVar(value="-")
        self.wechat_var = tk.StringVar(value="检测中")
        self.mode_var = tk.StringVar(value="后台引擎")
        self.last_log_size = 0
        self.settings = load_settings()
        self.provider_var = tk.StringVar(value=self.settings.get("ai_engine", {}).get("primary", "custom_api_1"))
        self.api_enabled_var = tk.BooleanVar(value=True)
        self.api_primary_var = tk.BooleanVar(value=True)
        self.api_key_var = tk.StringVar()
        self.base_url_var = tk.StringVar()
        self.model_var = tk.StringVar()
        self.temperature_var = tk.StringVar(value="0.4")
        self.max_tokens_var = tk.StringVar(value="800")
        self.api_status_var = tk.StringVar(value="选择供应商后可测试连接")
        self.knowledge_docs = []
        self.knowledge_id_var = tk.StringVar()
        self.knowledge_title_var = tk.StringVar()
        self.knowledge_keywords_var = tk.StringVar()
        self.knowledge_route_var = tk.StringVar()
        self.knowledge_test_var = tk.StringVar()
        self.knowledge_status_var = tk.StringVar(value="知识库未加载")
        self.skill_docs = []
        self.skill_id_var = tk.StringVar()
        self.skill_title_var = tk.StringVar()
        self.skill_route_var = tk.StringVar(value="direct_reply")
        self.skill_enabled_var = tk.BooleanVar(value=True)
        self.skill_keywords_var = tk.StringVar()
        self.skill_followup_var = tk.StringVar()
        self.skill_status_var = tk.StringVar(value="Skills 未加载")
        self.db = Database()
        self.crm_leads = []
        self.crm_selected_id = None
        self.crm_stage_var = tk.StringVar(value="new_inquiry")
        self.crm_owner_var = tk.StringVar()
        self.crm_next_action_var = tk.StringVar()
        self.chat_sessions = []
        self.chat_selected_session = None
        self.chat_status_var = tk.StringVar(value="会话未加载")
        self.crm_status_var = tk.StringVar(value="线索未加载")

        self._setup_style()
        self._build_ui()
        self._polish_static_controls()
        self.load_provider_form()
        self.load_knowledge_list()
        self.load_skill_list()
        self.load_crm_leads()
        self.load_chat_sessions()
        self.after(500, self.refresh_status)
        self.after(1000, self.refresh_logs)
        self.protocol("WM_DELETE_WINDOW", self.on_close)

    def _setup_style(self):
        self.option_add("*Font", ("Microsoft YaHei UI", 10))
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("TFrame", background=BG)
        style.configure("Panel.TFrame", background=PANEL, relief="flat")
        style.configure("Card.TFrame", background=PANEL_2, relief="flat")
        style.configure("TLabel", background=BG, foreground=TEXT, font=("Microsoft YaHei UI", 10))
        style.configure("Muted.TLabel", foreground=MUTED, background=PANEL)
        style.configure("CardTitle.TLabel", foreground=TEXT, background=PANEL_2, font=("Microsoft YaHei UI", 11, "bold"))
        style.configure("Hero.TLabel", foreground=TEXT, background=BG, font=("Microsoft YaHei UI", 24, "bold"))
        style.configure("Sub.TLabel", foreground=MUTED, background=BG, font=("Microsoft YaHei UI", 10))
        style.configure("Accent.TButton", font=("Microsoft YaHei UI", 10, "bold"), padding=(18, 10))
        style.configure("TButton", font=("Microsoft YaHei UI", 10), padding=(14, 8))
        style.configure(
            "TCombobox",
            fieldbackground=FIELD_BG,
            background=FIELD_BG,
            foreground=TEXT,
            bordercolor=BORDER,
            lightcolor=BORDER,
            darkcolor=BORDER,
            arrowcolor=MUTED,
            padding=(8, 5),
        )
        style.map(
            "TCombobox",
            fieldbackground=[("readonly", FIELD_BG), ("focus", FIELD_BG)],
            selectbackground=[("readonly", FIELD_BG)],
            selectforeground=[("readonly", TEXT)],
            bordercolor=[("focus", ACCENT)],
        )
        style.configure(
            "Vertical.TScrollbar",
            background=FIELD_SOFT,
            troughcolor=BG,
            bordercolor=BG,
            arrowcolor=MUTED,
            relief="flat",
        )

    def _build_ui(self):
        self.columnconfigure(1, weight=1)
        self.rowconfigure(0, weight=1)

        sidebar = tk.Frame(self, bg=SIDEBAR, width=236, highlightbackground=BORDER, highlightthickness=1)
        sidebar.grid(row=0, column=0, sticky="ns")
        sidebar.grid_propagate(False)

        brand_wrap = tk.Frame(sidebar, bg=SIDEBAR)
        brand_wrap.pack(fill="x", padx=20, pady=(24, 14))
        app_icon = tk.Canvas(brand_wrap, width=42, height=42, bg=SIDEBAR, highlightthickness=0)
        app_icon.create_rectangle(10, 3, 32, 39, fill=TEXT, outline=TEXT)
        app_icon.create_rectangle(3, 10, 39, 32, fill=TEXT, outline=TEXT)
        app_icon.create_oval(3, 3, 17, 17, fill=TEXT, outline=TEXT)
        app_icon.create_oval(25, 3, 39, 17, fill=TEXT, outline=TEXT)
        app_icon.create_oval(3, 25, 17, 39, fill=TEXT, outline=TEXT)
        app_icon.create_oval(25, 25, 39, 39, fill=TEXT, outline=TEXT)
        app_icon.create_line(13, 27, 21, 17, 29, 27, fill="#ffffff", width=3, capstyle="round", joinstyle="round")
        app_icon.create_line(15, 23, 27, 23, fill="#ffffff", width=3, capstyle="round")
        app_icon.create_oval(30, 10, 36, 16, fill=ACCENT, outline=ACCENT)
        app_icon.pack(side="left")
        brand_text = tk.Frame(brand_wrap, bg=SIDEBAR)
        brand_text.pack(side="left", padx=(12, 0))
        tk.Label(brand_text, text="Smart Agent", bg=SIDEBAR, fg=TEXT, font=("Microsoft YaHei UI", 18, "bold")).pack(anchor="w")
        tk.Label(brand_text, text="微信智能客服后台", bg=SIDEBAR, fg=MUTED, font=("Microsoft YaHei UI", 10)).pack(anchor="w", pady=(2, 0))

        nav_items = [("总览", "●"), ("后台引擎", "◆"), ("运行日志", "▣"), ("配置", "◈")]
        for text, icon in nav_items:
            row = tk.Frame(sidebar, bg=SIDEBAR_ACTIVE if text == "总览" else SIDEBAR)
            row.pack(fill="x", padx=14, pady=(18 if text == "总览" else 6, 0), ipady=8)
            tk.Label(row, text=icon, bg=row["bg"], fg=ACCENT if text == "总览" else MUTED, font=("Microsoft YaHei UI", 12)).pack(side="left", padx=(10, 10))
            tk.Label(row, text=text, bg=row["bg"], fg=TEXT, font=("Microsoft YaHei UI", 10, "bold")).pack(side="left")

        tk.Label(sidebar, text="后端隐藏运行\n界面负责控制和监控", justify="left", bg=SIDEBAR, fg=MUTED, font=("Microsoft YaHei UI", 9)).pack(anchor="w", padx=24, pady=(72, 0))

        main_canvas = tk.Canvas(self, bg=BG, highlightthickness=0)
        main_canvas.grid(row=0, column=1, sticky="nsew")
        main_scrollbar = ttk.Scrollbar(self, orient="vertical", command=main_canvas.yview)
        main_scrollbar.grid(row=0, column=2, sticky="ns")
        main_canvas.configure(yscrollcommand=main_scrollbar.set)

        main = tk.Frame(main_canvas, bg=BG)
        main_window = main_canvas.create_window((0, 0), window=main, anchor="nw")

        def _sync_scroll(_event=None):
            main_canvas.configure(scrollregion=main_canvas.bbox("all"))
            main_canvas.itemconfigure(main_window, width=main_canvas.winfo_width())

        main.bind("<Configure>", _sync_scroll)
        main_canvas.bind("<Configure>", _sync_scroll)

        main.columnconfigure(0, weight=1)
        main.rowconfigure(7, weight=1)

        header = tk.Frame(main, bg=BG)
        header.grid(row=0, column=0, sticky="ew", padx=24, pady=(24, 0))
        header.columnconfigure(0, weight=1)
        chrome = tk.Frame(header, bg=BG)
        chrome.grid(row=0, column=0, sticky="w", pady=(0, 10))
        for color in ("#ff5f57", "#ffbd2e", "#28c840"):
            dot = tk.Canvas(chrome, width=12, height=12, bg=BG, highlightthickness=0)
            dot.create_oval(1, 1, 11, 11, fill=color, outline=color)
            dot.pack(side="left", padx=(0, 6))
        tk.Label(chrome, text="智服增长台", bg=BG, fg=MUTED, font=("Microsoft YaHei UI", 9, "bold")).pack(side="left", padx=(6, 0))
        ttk.Label(header, text="智能客服智能体", style="Hero.TLabel").grid(row=1, column=0, sticky="w")
        ttk.Label(header, text="前台控制台 + 后台微信客服引擎", style="Sub.TLabel").grid(row=2, column=0, sticky="w", pady=(6, 0))

        action_bar = tk.Frame(header, bg=BG)
        action_bar.grid(row=0, column=1, rowspan=3, sticky="e")
        tk.Button(action_bar, text="启动", command=self.start_backend, bg=ACCENT, fg="#ffffff", bd=0, padx=24, pady=10, font=("Microsoft YaHei UI", 10, "bold"), activebackground="#005bb5", activeforeground="#ffffff").pack(side="left", padx=6)
        tk.Button(action_bar, text="停止", command=self.stop_backend, bg=DANGER_TINT, fg=DANGER_TEXT, bd=0, padx=24, pady=10, font=("Microsoft YaHei UI", 10, "bold"), activebackground=DANGER_TINT_HOVER, activeforeground=DANGER_TEXT).pack(side="left", padx=6)
        tk.Button(action_bar, text="重启", command=self.restart_backend, bg=SECONDARY, fg=TEXT, bd=0, padx=22, pady=10, font=("Microsoft YaHei UI", 10, "bold"), activebackground=SECONDARY_HOVER, activeforeground=TEXT).pack(side="left", padx=6)

        cards = tk.Frame(main, bg=BG)
        cards.grid(row=1, column=0, sticky="ew", padx=24, pady=(24, 16))
        for i in range(4):
            cards.columnconfigure(i, weight=1)

        self._card(cards, 0, "运行状态", self.status_var, ACCENT)
        self._card(cards, 1, "微信状态", self.wechat_var, ACCENT_2)
        self._card(cards, 2, "后台进程", self.pid_var, WARN)
        self._card(cards, 3, "模式", self.mode_var, ACCENT_2)

        config_panel = tk.Frame(main, bg=PANEL, highlightbackground=BORDER, highlightthickness=1)
        config_panel.grid(row=2, column=0, sticky="ew", padx=24, pady=(0, 16))
        config_panel.columnconfigure(1, weight=1)
        tk.Label(config_panel, text="快速配置", bg=PANEL, fg=TEXT, font=("Microsoft YaHei UI", 12, "bold")).grid(row=0, column=0, sticky="w", padx=18, pady=(14, 8))
        tk.Label(config_panel, text="当前技能：commercial_customer_service_skill    知识库：customer_knowledge.yaml", bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", 10)).grid(row=1, column=0, sticky="w", padx=18, pady=(0, 14))
        tk.Button(config_panel, text="打开配置目录", command=self.open_config_dir, bg=SECONDARY, fg=TEXT, bd=0, padx=14, pady=8, activebackground=SECONDARY_HOVER, activeforeground=TEXT).grid(row=0, column=2, rowspan=2, padx=18)

        api_panel = tk.Frame(main, bg=PANEL, highlightbackground=BORDER, highlightthickness=1)
        api_panel.grid(row=3, column=0, sticky="ew", padx=24, pady=(0, 16))
        for i in range(4):
            api_panel.columnconfigure(i, weight=1)

        tk.Label(api_panel, text="系统设置 · API 接口", bg=PANEL, fg=TEXT, font=("Microsoft YaHei UI", 12, "bold")).grid(row=0, column=0, sticky="w", padx=18, pady=(14, 8))
        tk.Label(api_panel, textvariable=self.api_status_var, bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", 9)).grid(row=0, column=1, columnspan=3, sticky="e", padx=18, pady=(14, 8))

        provider_names = list(PROVIDER_PRESETS.keys()) + ["custom_api_1", "custom_api_2"]
        provider_box = ttk.Combobox(api_panel, textvariable=self.provider_var, values=provider_names, state="readonly")
        provider_box.grid(row=1, column=0, sticky="ew", padx=(18, 8), pady=6)
        provider_box.bind("<<ComboboxSelected>>", lambda _event: self.load_provider_form())

        tk.Checkbutton(api_panel, text="启用", variable=self.api_enabled_var, bg=PANEL, fg=TEXT, selectcolor=FIELD_SOFT, activebackground=PANEL, activeforeground=TEXT).grid(row=1, column=1, sticky="w", padx=8, pady=6)
        tk.Checkbutton(api_panel, text="设为默认", variable=self.api_primary_var, bg=PANEL, fg=TEXT, selectcolor=FIELD_SOFT, activebackground=PANEL, activeforeground=TEXT).grid(row=1, column=2, sticky="w", padx=8, pady=6)

        self._api_field(api_panel, 2, 0, "Base URL", self.base_url_var, columnspan=2)
        self._api_field(api_panel, 2, 2, "模型", self.model_var)
        self._api_field(api_panel, 3, 0, "API Key", self.api_key_var, show="*", columnspan=2)
        self._api_field(api_panel, 3, 2, "Temperature", self.temperature_var)
        self._api_field(api_panel, 3, 3, "Max Tokens", self.max_tokens_var)

        api_actions = tk.Frame(api_panel, bg=PANEL)
        api_actions.grid(row=4, column=0, columnspan=4, sticky="e", padx=18, pady=(8, 14))
        tk.Button(api_actions, text="测试连接", command=self.test_api_connection, bg=SECONDARY, fg=TEXT, bd=0, padx=14, pady=8, activebackground=SECONDARY_HOVER, activeforeground=TEXT).pack(side="left", padx=6)
        tk.Button(api_actions, text="保存配置", command=self.save_api_provider, bg=ACCENT, fg="#ffffff", bd=0, padx=14, pady=8, font=("Microsoft YaHei UI", 10, "bold"), activebackground="#005bb5", activeforeground="#ffffff").pack(side="left", padx=6)

        knowledge_panel = tk.Frame(main, bg=PANEL, highlightbackground=BORDER, highlightthickness=1)
        knowledge_panel.grid(row=4, column=0, sticky="ew", padx=24, pady=(0, 16))
        knowledge_panel.columnconfigure(1, weight=1)
        tk.Label(knowledge_panel, text="知识库编辑", bg=PANEL, fg=TEXT, font=("Microsoft YaHei UI", 12, "bold")).grid(row=0, column=0, sticky="w", padx=18, pady=(14, 8))
        tk.Label(knowledge_panel, textvariable=self.knowledge_status_var, bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", 9)).grid(row=0, column=1, columnspan=3, sticky="e", padx=18, pady=(14, 8))

        self.knowledge_listbox = tk.Listbox(knowledge_panel, bg=FIELD_BG, fg=TEXT, selectbackground=SELECT_BG, selectforeground="#ffffff", highlightbackground=BORDER, highlightcolor=ACCENT, highlightthickness=1, bd=0, height=7, relief="flat", exportselection=False)
        self.knowledge_listbox.grid(row=1, column=0, rowspan=5, sticky="nsew", padx=(18, 10), pady=(0, 14))
        self.knowledge_listbox.bind("<<ListboxSelect>>", lambda _event: self.load_selected_knowledge())

        self._api_field(knowledge_panel, 1, 1, "知识 ID", self.knowledge_id_var)
        self._api_field(knowledge_panel, 1, 2, "标题", self.knowledge_title_var)
        self._api_field(knowledge_panel, 1, 3, "路由(可选)", self.knowledge_route_var)
        self._api_field(knowledge_panel, 2, 1, "关键词(逗号分隔)", self.knowledge_keywords_var, columnspan=3)

        answer_wrapper = tk.Frame(knowledge_panel, bg=PANEL)
        answer_wrapper.grid(row=3, column=1, columnspan=3, sticky="ew", padx=(8, 18), pady=6)
        answer_wrapper.columnconfigure(0, weight=1)
        tk.Label(answer_wrapper, text="标准回答", bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", 9)).grid(row=0, column=0, sticky="w")
        self.knowledge_answer_text = tk.Text(answer_wrapper, bg=FIELD_BG, fg=TEXT, insertbackground=ACCENT, highlightbackground=BORDER, highlightcolor=ACCENT, highlightthickness=1, bd=0, relief="flat", height=4, wrap="word")
        self.knowledge_answer_text.grid(row=1, column=0, sticky="ew")

        self._api_field(knowledge_panel, 4, 1, "测试客户问题", self.knowledge_test_var, columnspan=2)
        knowledge_actions = tk.Frame(knowledge_panel, bg=PANEL)
        knowledge_actions.grid(row=4, column=3, sticky="e", padx=18, pady=6)
        tk.Button(knowledge_actions, text="测试命中", command=self.test_knowledge_match, bg=SECONDARY, fg=TEXT, bd=0, padx=12, pady=7, activebackground=SECONDARY_HOVER, activeforeground=TEXT).pack(side="left", padx=4)
        tk.Button(knowledge_actions, text="保存知识", command=self.save_knowledge_doc, bg=ACCENT, fg="#ffffff", bd=0, padx=12, pady=7, font=("Microsoft YaHei UI", 10, "bold"), activebackground="#005bb5", activeforeground="#ffffff").pack(side="left", padx=4)
        tk.Button(knowledge_actions, text="删除", command=self.delete_knowledge_doc, bg=DANGER_TINT, fg=DANGER_TEXT, bd=0, padx=12, pady=7, activebackground=DANGER_TINT_HOVER, activeforeground=DANGER_TEXT).pack(side="left", padx=4)

        skill_panel = tk.Frame(main, bg=PANEL, highlightbackground=BORDER, highlightthickness=1)
        skill_panel.grid(row=5, column=0, sticky="ew", padx=24, pady=(0, 16))
        skill_panel.columnconfigure(1, weight=1)
        tk.Label(skill_panel, text="客服 Skills", bg=PANEL, fg=TEXT, font=("Microsoft YaHei UI", 12, "bold")).grid(row=0, column=0, sticky="w", padx=18, pady=(14, 8))
        tk.Label(skill_panel, textvariable=self.skill_status_var, bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", 9)).grid(row=0, column=1, columnspan=3, sticky="e", padx=18, pady=(14, 8))

        self.skill_listbox = tk.Listbox(skill_panel, bg=FIELD_BG, fg=TEXT, selectbackground=SELECT_BG, selectforeground="#ffffff", highlightbackground=BORDER, highlightcolor=ACCENT, highlightthickness=1, bd=0, height=6, relief="flat", exportselection=False)
        self.skill_listbox.grid(row=1, column=0, rowspan=5, sticky="nsew", padx=(18, 10), pady=(0, 14))
        self.skill_listbox.bind("<<ListboxSelect>>", lambda _event: self.load_selected_skill())

        self._api_field(skill_panel, 1, 1, "Skill ID", self.skill_id_var)
        self._api_field(skill_panel, 1, 2, "标题", self.skill_title_var)
        route_wrap = tk.Frame(skill_panel, bg=PANEL)
        route_wrap.grid(row=1, column=3, sticky="ew", padx=(8, 18), pady=6)
        tk.Label(route_wrap, text="路由", bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", 9)).grid(row=0, column=0, sticky="w")
        ttk.Combobox(route_wrap, textvariable=self.skill_route_var, values=["direct_reply", "ask_clarifying", "transfer_human"], state="readonly").grid(row=1, column=0, sticky="ew")
        tk.Checkbutton(skill_panel, text="启用", variable=self.skill_enabled_var, bg=PANEL, fg=TEXT, selectcolor=FIELD_SOFT, activebackground=PANEL, activeforeground=TEXT).grid(row=2, column=3, sticky="w", padx=8, pady=6)
        self._api_field(skill_panel, 2, 1, "关键词(逗号分隔)", self.skill_keywords_var, columnspan=2)
        self._api_field(skill_panel, 3, 1, "追问话术", self.skill_followup_var, columnspan=3)

        skill_answer_wrap = tk.Frame(skill_panel, bg=PANEL)
        skill_answer_wrap.grid(row=4, column=1, columnspan=3, sticky="ew", padx=(8, 18), pady=6)
        skill_answer_wrap.columnconfigure(0, weight=1)
        tk.Label(skill_answer_wrap, text="标准回答", bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", 9)).grid(row=0, column=0, sticky="w")
        self.skill_answer_text = tk.Text(skill_answer_wrap, bg=FIELD_BG, fg=TEXT, insertbackground=ACCENT, highlightbackground=BORDER, highlightcolor=ACCENT, highlightthickness=1, bd=0, relief="flat", height=3, wrap="word")
        self.skill_answer_text.grid(row=1, column=0, sticky="ew")

        skill_actions = tk.Frame(skill_panel, bg=PANEL)
        skill_actions.grid(row=5, column=1, columnspan=3, sticky="e", padx=18, pady=(0, 14))
        tk.Button(skill_actions, text="刷新 Skills", command=self.load_skill_list, bg=SECONDARY, fg=TEXT, bd=0, padx=12, pady=7, activebackground=SECONDARY_HOVER, activeforeground=TEXT).pack(side="left", padx=4)
        tk.Button(skill_actions, text="保存 Skill", command=self.save_skill_doc, bg=ACCENT, fg="#ffffff", bd=0, padx=12, pady=7, font=("Microsoft YaHei UI", 10, "bold"), activebackground="#005bb5", activeforeground="#ffffff").pack(side="left", padx=4)
        tk.Button(skill_actions, text="删除", command=self.delete_skill_doc, bg=DANGER_TINT, fg=DANGER_TEXT, bd=0, padx=12, pady=7, activebackground=DANGER_TINT_HOVER, activeforeground=DANGER_TEXT).pack(side="left", padx=4)

        takeover_panel = tk.Frame(main, bg=PANEL, highlightbackground=BORDER, highlightthickness=1)
        takeover_panel.grid(row=6, column=0, sticky="ew", padx=24, pady=(0, 16))
        takeover_panel.columnconfigure(1, weight=1)
        takeover_panel.columnconfigure(2, weight=1)
        tk.Label(takeover_panel, text="会话接管", bg=PANEL, fg=TEXT, font=("Microsoft YaHei UI", 12, "bold")).grid(row=0, column=0, sticky="w", padx=18, pady=(14, 8))
        tk.Label(takeover_panel, textvariable=self.chat_status_var, bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", 9)).grid(row=0, column=1, columnspan=2, sticky="e", padx=18, pady=(14, 8))

        self.chat_session_listbox = tk.Listbox(takeover_panel, bg=FIELD_BG, fg=TEXT, selectbackground=SELECT_BG, selectforeground="#ffffff", highlightbackground=BORDER, highlightcolor=ACCENT, highlightthickness=1, bd=0, height=8, relief="flat", exportselection=False)
        self.chat_session_listbox.grid(row=1, column=0, rowspan=3, sticky="nsew", padx=(18, 10), pady=(0, 14))
        self.chat_session_listbox.bind("<<ListboxSelect>>", lambda _event: self.load_selected_chat_session())

        self.chat_history_text = tk.Text(takeover_panel, bg=FIELD_BG, fg=TEXT, insertbackground=ACCENT, highlightbackground=BORDER, highlightcolor=ACCENT, highlightthickness=1, bd=0, relief="flat", height=9, wrap="word")
        self.chat_history_text.grid(row=1, column=1, sticky="nsew", padx=8, pady=(0, 14))

        self.chat_ai_text = tk.Text(takeover_panel, bg=ACCENT_TINT, fg=TEXT, insertbackground=ACCENT, highlightbackground="#c7dcf6", highlightcolor=ACCENT, highlightthickness=1, bd=0, relief="flat", height=9, wrap="word")
        self.chat_ai_text.grid(row=1, column=2, sticky="nsew", padx=(8, 18), pady=(0, 14))

        chat_actions = tk.Frame(takeover_panel, bg=PANEL)
        chat_actions.grid(row=2, column=1, columnspan=2, sticky="e", padx=18, pady=(0, 14))
        tk.Button(chat_actions, text="刷新会话", command=self.load_chat_sessions, bg=SECONDARY, fg=TEXT, bd=0, padx=12, pady=7, activebackground=SECONDARY_HOVER, activeforeground=TEXT).pack(side="left", padx=4)
        tk.Button(chat_actions, text="生成 AI 建议", command=self.generate_chat_suggestion, bg=ACCENT, fg="#ffffff", bd=0, padx=12, pady=7, font=("Microsoft YaHei UI", 10, "bold"), activebackground="#005bb5", activeforeground="#ffffff").pack(side="left", padx=4)
        tk.Button(chat_actions, text="人工发送并锁定10分钟", command=self.send_manual_reply, bg=ACCENT_2, fg="#ffffff", bd=0, padx=12, pady=7, font=("Microsoft YaHei UI", 10, "bold"), activebackground="#4745c4", activeforeground="#ffffff").pack(side="left", padx=4)
        tk.Button(chat_actions, text="解除锁定", command=self.clear_chat_lock, bg=SECONDARY, fg=TEXT, bd=0, padx=12, pady=7, activebackground=SECONDARY_HOVER, activeforeground=TEXT).pack(side="left", padx=4)

        crm_panel = tk.Frame(main, bg=PANEL, highlightbackground=BORDER, highlightthickness=1)
        crm_panel.grid(row=7, column=0, sticky="ew", padx=24, pady=(0, 16))
        crm_panel.columnconfigure(1, weight=1)
        tk.Label(crm_panel, text="线索 CRM", bg=PANEL, fg=TEXT, font=("Microsoft YaHei UI", 12, "bold")).grid(row=0, column=0, sticky="w", padx=18, pady=(14, 8))
        tk.Label(crm_panel, textvariable=self.crm_status_var, bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", 9)).grid(row=0, column=1, columnspan=3, sticky="e", padx=18, pady=(14, 8))

        self.crm_listbox = tk.Listbox(crm_panel, bg=FIELD_BG, fg=TEXT, selectbackground=SELECT_BG, selectforeground="#ffffff", highlightbackground=BORDER, highlightcolor=ACCENT, highlightthickness=1, bd=0, height=6, relief="flat", exportselection=False)
        self.crm_listbox.grid(row=1, column=0, rowspan=4, sticky="nsew", padx=(18, 10), pady=(0, 14))
        self.crm_listbox.bind("<<ListboxSelect>>", lambda _event: self.load_selected_lead())

        stage_values = ["new_inquiry", "info_collected", "quotation_given", "design_discussion", "sample_sent", "ready_to_order", "ordered", "lost", "followup_needed"]
        tk.Label(crm_panel, text="销售阶段", bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", 9)).grid(row=1, column=1, sticky="w", padx=8)
        ttk.Combobox(crm_panel, textvariable=self.crm_stage_var, values=stage_values, state="readonly").grid(row=2, column=1, sticky="ew", padx=8, pady=(0, 8))
        self._api_field(crm_panel, 1, 2, "负责人", self.crm_owner_var)
        self._api_field(crm_panel, 1, 3, "下一步动作", self.crm_next_action_var)

        self.crm_detail_text = tk.Text(crm_panel, bg=FIELD_BG, fg=TEXT, insertbackground=ACCENT, highlightbackground=BORDER, highlightcolor=ACCENT, highlightthickness=1, bd=0, relief="flat", height=5, wrap="word")
        self.crm_detail_text.grid(row=3, column=1, columnspan=3, sticky="ew", padx=(8, 18), pady=6)

        crm_actions = tk.Frame(crm_panel, bg=PANEL)
        crm_actions.grid(row=4, column=1, columnspan=3, sticky="e", padx=18, pady=(0, 14))
        tk.Button(crm_actions, text="刷新线索", command=self.load_crm_leads, bg=SECONDARY, fg=TEXT, bd=0, padx=12, pady=7, activebackground=SECONDARY_HOVER, activeforeground=TEXT).pack(side="left", padx=4)
        tk.Button(crm_actions, text="保存阶段", command=self.save_crm_lead, bg=ACCENT, fg="#ffffff", bd=0, padx=12, pady=7, font=("Microsoft YaHei UI", 10, "bold"), activebackground="#005bb5", activeforeground="#ffffff").pack(side="left", padx=4)

        log_panel = tk.Frame(main, bg=PANEL, highlightbackground=BORDER, highlightthickness=1)
        log_panel.grid(row=8, column=0, sticky="nsew", padx=24, pady=(0, 24))
        log_panel.rowconfigure(1, weight=1)
        log_panel.columnconfigure(0, weight=1)
        log_header = tk.Frame(log_panel, bg=PANEL)
        log_header.grid(row=0, column=0, sticky="ew", padx=16, pady=(14, 8))
        tk.Label(log_header, text="实时运行日志", bg=PANEL, fg=TEXT, font=("Microsoft YaHei UI", 12, "bold")).pack(side="left")
        tk.Button(log_header, text="清屏", command=self.clear_log_view, bg=SECONDARY, fg=TEXT, bd=0, padx=12, pady=6, activebackground=SECONDARY_HOVER, activeforeground=TEXT).pack(side="right")

        self.log_text = tk.Text(log_panel, bg=LOG_BG, fg="#f5f5f7", insertbackground="#ffffff", bd=0, padx=14, pady=12, font=("Consolas", 10), wrap="word")
        self.log_text.grid(row=1, column=0, sticky="nsew", padx=16, pady=(0, 16))
        self.log_text.tag_config("ERROR", foreground="#ff6961")
        self.log_text.tag_config("WARNING", foreground="#ffd60a")
        self.log_text.tag_config("INFO", foreground="#64d2ff")

    def _polish_static_controls(self):
        def walk(widget):
            if isinstance(widget, tk.Button):
                widget.configure(relief="flat", bd=0, highlightthickness=0, cursor="hand2")
            elif isinstance(widget, tk.Checkbutton):
                widget.configure(relief="flat", highlightthickness=0, cursor="hand2")
            elif isinstance(widget, (tk.Entry, tk.Text, tk.Listbox)):
                widget.configure(relief="flat", bd=0)
            for child in widget.winfo_children():
                walk(child)

        walk(self)

    def _card(self, parent, col, title, value_var, color):
        frame = tk.Frame(parent, bg=PANEL_2, highlightbackground=BORDER, highlightthickness=1)
        frame.grid(row=0, column=col, sticky="ew", padx=(0 if col == 0 else 10, 0))
        tk.Label(frame, text=title, bg=PANEL_2, fg=MUTED, font=("Microsoft YaHei UI", 9, "bold")).pack(anchor="w", padx=16, pady=(14, 4))
        tk.Label(frame, textvariable=value_var, bg=PANEL_2, fg=color, font=("Microsoft YaHei UI", 17, "bold")).pack(anchor="w", padx=16, pady=(0, 16))

    def _api_field(self, parent, row, col, label, variable, show=None, columnspan=1):
        wrapper = tk.Frame(parent, bg=PANEL)
        wrapper.grid(row=row, column=col, columnspan=columnspan, sticky="ew", padx=(18 if col == 0 else 8, 8), pady=6)
        wrapper.columnconfigure(0, weight=1)
        tk.Label(wrapper, text=label, bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", 9)).grid(row=0, column=0, sticky="w")
        entry = tk.Entry(
            wrapper,
            textvariable=variable,
            show=show,
            bg=FIELD_BG,
            fg=TEXT,
            insertbackground=ACCENT,
            relief="flat",
            bd=0,
            highlightbackground=BORDER,
            highlightcolor=ACCENT,
            highlightthickness=1,
        )
        entry.grid(row=1, column=0, sticky="ew", ipady=7)
        return entry

    def load_provider_form(self):
        try:
            self.settings = load_settings()
            provider_name = self.provider_var.get()
            provider = ensure_provider(self.settings, provider_name)
            self.api_enabled_var.set(bool(provider.get("enabled", False)))
            self.api_primary_var.set(provider_name == self.settings.get("ai_engine", {}).get("primary"))
            self.api_key_var.set(provider.get("api_key", ""))
            self.base_url_var.set(provider.get("base_url", ""))
            self.model_var.set(provider.get("model", ""))
            self.temperature_var.set(str(provider.get("temperature", 0.4)))
            self.max_tokens_var.set(str(provider.get("max_tokens", 800)))
            issues = validate_provider_config(provider)
            suffix = "；".join(issues) if issues else "配置完整，可测试连接"
            self.api_status_var.set(f"当前编辑：{provider_display_name(provider_name)} · {suffix}")
        except Exception as exc:
            self.api_status_var.set(f"读取 API 配置失败：{exc}")

    def _provider_payload(self):
        return {
            "enabled": self.api_enabled_var.get(),
            "api_key": self.api_key_var.get().strip(),
            "base_url": self.base_url_var.get().strip(),
            "model": self.model_var.get().strip(),
            "temperature": float(self.temperature_var.get().strip() or 0.4),
            "max_tokens": int(self.max_tokens_var.get().strip() or 800),
        }

    def save_api_provider(self):
        try:
            provider_name = self.provider_var.get()
            payload = self._provider_payload()
            self.settings = update_provider(
                provider_name,
                set_primary=self.api_primary_var.get(),
                **payload,
            )
            issues = validate_provider_config({**payload, "enabled": self.api_enabled_var.get()})
            suffix = "；".join(issues) if issues else "配置完整，可测试连接"
            self.api_status_var.set(f"配置已保存，并已自动备份 settings.yaml · {suffix}")
            self.append_log(f"[UI] API provider saved: {provider_name}")
        except Exception as exc:
            messagebox.showerror("保存失败", str(exc))
            self.api_status_var.set(f"保存失败：{exc}")

    def test_api_connection(self):
        try:
            provider = self._provider_payload()
        except Exception as exc:
            messagebox.showerror("配置错误", str(exc))
            return
        self.api_status_var.set("正在测试连接...")

        def worker():
            ok, message = test_openai_compatible_provider(provider)

            def finish():
                self.api_status_var.set(message)
                self.append_log(f"[UI] API test {'OK' if ok else 'FAIL'}: {self.provider_var.get()} - {message}")
                if ok:
                    messagebox.showinfo("测试成功", message)
                else:
                    messagebox.showwarning("测试失败", message)

            self.after(0, finish)

        threading.Thread(target=worker, daemon=True).start()

    def load_skill_list(self):
        try:
            data = load_skills()
            self.skill_docs = data.get("skills", [])
            self.skill_listbox.delete(0, "end")
            for skill in self.skill_docs:
                enabled = "启用" if skill.get("enabled", True) else "停用"
                self.skill_listbox.insert("end", f"{enabled} · {skill.get('id', '')} · {skill.get('title', '')}")
            self.skill_status_var.set(f"已加载 {len(self.skill_docs)} 个 Skills")
            if self.skill_docs and self.skill_listbox.size() > 0:
                self.skill_listbox.selection_set(0)
                self.load_selected_skill()
        except Exception as exc:
            self.skill_status_var.set(f"加载 Skills 失败：{exc}")

    def load_selected_skill(self):
        selection = self.skill_listbox.curselection()
        if not selection:
            return
        skill = self.skill_docs[selection[0]]
        self.skill_id_var.set(skill.get("id", ""))
        self.skill_title_var.set(skill.get("title", ""))
        self.skill_route_var.set(skill.get("route", "direct_reply"))
        self.skill_enabled_var.set(bool(skill.get("enabled", True)))
        self.skill_keywords_var.set(", ".join(skill.get("keywords", [])))
        self.skill_followup_var.set(skill.get("followup", ""))
        self.skill_answer_text.delete("1.0", "end")
        self.skill_answer_text.insert("1.0", skill.get("answer", ""))
        self.skill_status_var.set(f"当前 Skill：{skill.get('id', '')}")

    def _skill_payload(self):
        return {
            "id": self.skill_id_var.get().strip(),
            "title": self.skill_title_var.get().strip(),
            "enabled": self.skill_enabled_var.get(),
            "route": self.skill_route_var.get().strip(),
            "keywords": self.skill_keywords_var.get().strip(),
            "answer": self.skill_answer_text.get("1.0", "end-1c").strip(),
            "followup": self.skill_followup_var.get().strip(),
        }

    def save_skill_doc(self):
        try:
            skill = upsert_skill(self._skill_payload())
            self.load_skill_list()
            for index, item in enumerate(self.skill_docs):
                if item.get("id") == skill["id"]:
                    self.skill_listbox.selection_clear(0, "end")
                    self.skill_listbox.selection_set(index)
                    self.skill_listbox.see(index)
                    break
            self.skill_status_var.set("Skill 已保存，并已自动备份 customer_skills.yaml")
            self.append_log(f"[UI] Skill saved: {skill['id']}")
        except Exception as exc:
            messagebox.showerror("保存 Skill 失败", str(exc))
            self.skill_status_var.set(f"保存失败：{exc}")

    def delete_skill_doc(self):
        skill_id = self.skill_id_var.get().strip()
        if not skill_id:
            return
        if not messagebox.askyesno("确认删除", f"确定删除 Skill {skill_id} 吗？"):
            return
        try:
            changed = delete_skill(skill_id)
            self.load_skill_list()
            self.skill_status_var.set("Skill 已删除" if changed else "未找到要删除的 Skill")
            self.append_log(f"[UI] Skill deleted: {skill_id}")
        except Exception as exc:
            messagebox.showerror("删除 Skill 失败", str(exc))
            self.skill_status_var.set(f"删除失败：{exc}")

    def load_knowledge_list(self):
        try:
            data = load_knowledge()
            self.knowledge_docs = data.get("documents", [])
            self.knowledge_listbox.delete(0, "end")
            for doc in self.knowledge_docs:
                self.knowledge_listbox.insert("end", f"{doc.get('id', '')} · {doc.get('title', '')}")
            self.knowledge_status_var.set(f"已加载 {len(self.knowledge_docs)} 条知识")
            if self.knowledge_docs and self.knowledge_listbox.size() > 0:
                self.knowledge_listbox.selection_set(0)
                self.load_selected_knowledge()
        except Exception as exc:
            self.knowledge_status_var.set(f"加载知识库失败：{exc}")

    def load_selected_knowledge(self):
        selection = self.knowledge_listbox.curselection()
        if not selection:
            return
        doc = self.knowledge_docs[selection[0]]
        self.knowledge_id_var.set(doc.get("id", ""))
        self.knowledge_title_var.set(doc.get("title", ""))
        self.knowledge_keywords_var.set(", ".join(doc.get("keywords", [])))
        self.knowledge_route_var.set(doc.get("route", ""))
        self.knowledge_answer_text.delete("1.0", "end")
        self.knowledge_answer_text.insert("1.0", doc.get("answer", ""))
        self.knowledge_status_var.set(f"当前编辑：{doc.get('id', '')}")

    def _knowledge_payload(self):
        return {
            "id": self.knowledge_id_var.get().strip(),
            "title": self.knowledge_title_var.get().strip(),
            "keywords": self.knowledge_keywords_var.get().strip(),
            "answer": self.knowledge_answer_text.get("1.0", "end-1c").strip(),
            "route": self.knowledge_route_var.get().strip(),
        }

    def save_knowledge_doc(self):
        try:
            doc = upsert_document(self._knowledge_payload())
            self.load_knowledge_list()
            for index, item in enumerate(self.knowledge_docs):
                if item.get("id") == doc["id"]:
                    self.knowledge_listbox.selection_clear(0, "end")
                    self.knowledge_listbox.selection_set(index)
                    self.knowledge_listbox.see(index)
                    break
            self.knowledge_status_var.set("知识已保存，并已自动备份 customer_knowledge.yaml")
            self.append_log(f"[UI] Knowledge saved: {doc['id']}")
        except Exception as exc:
            messagebox.showerror("保存知识失败", str(exc))
            self.knowledge_status_var.set(f"保存失败：{exc}")

    def delete_knowledge_doc(self):
        doc_id = self.knowledge_id_var.get().strip()
        if not doc_id:
            return
        if not messagebox.askyesno("确认删除", f"确定删除知识条目 {doc_id} 吗？"):
            return
        try:
            changed = delete_document(doc_id)
            self.load_knowledge_list()
            self.knowledge_status_var.set("知识已删除" if changed else "未找到要删除的知识")
            self.append_log(f"[UI] Knowledge deleted: {doc_id}")
        except Exception as exc:
            messagebox.showerror("删除失败", str(exc))
            self.knowledge_status_var.set(f"删除失败：{exc}")

    def test_knowledge_match(self):
        question = self.knowledge_test_var.get().strip()
        if not question:
            messagebox.showinfo("请输入测试问题", "请先输入一段客户问题。")
            return
        try:
            matches = match_knowledge(question)
            if not matches:
                self.knowledge_status_var.set("未命中知识，建议补充关键词或新增知识")
                messagebox.showinfo("测试结果", "未命中任何知识条目。")
                return
            lines = []
            for item in matches:
                kws = ", ".join(item.get("matched_keywords", [])) or "-"
                lines.append(f"{item['id']} | {item['title']} | 分数 {item['score']} | 关键词 {kws}")
            result = "\n".join(lines)
            self.knowledge_status_var.set(f"命中 {len(matches)} 条知识：{matches[0]['id']}")
            messagebox.showinfo("测试命中结果", result)
        except Exception as exc:
            messagebox.showerror("测试失败", str(exc))
            self.knowledge_status_var.set(f"测试失败：{exc}")

    def load_crm_leads(self):
        try:
            self.crm_leads = self.db.list_leads(limit=100)
            self.crm_listbox.delete(0, "end")
            for lead in self.crm_leads:
                name = lead.get("company_name") or lead.get("contact_person") or lead.get("phone") or lead.get("session_id")
                stage = lead.get("stage") or "new_inquiry"
                self.crm_listbox.insert("end", f"#{lead.get('id')} · {stage} · {name}")
            self.crm_status_var.set(f"已加载 {len(self.crm_leads)} 条线索")
            if self.crm_leads and self.crm_listbox.size() > 0:
                self.crm_listbox.selection_set(0)
                self.load_selected_lead()
        except Exception as exc:
            self.crm_status_var.set(f"加载线索失败：{exc}")

    def load_selected_lead(self):
        selection = self.crm_listbox.curselection()
        if not selection:
            return
        lead = self.crm_leads[selection[0]]
        self.crm_selected_id = lead.get("id")
        self.crm_stage_var.set(lead.get("stage") or "new_inquiry")
        self.crm_owner_var.set(lead.get("owner") or lead.get("assigned_to") or "")
        self.crm_next_action_var.set(lead.get("next_action") or "")
        lines = [
            f"公司：{lead.get('company_name') or '-'}",
            f"联系人：{lead.get('contact_person') or '-'}",
            f"电话：{lead.get('phone') or '-'}  微信：{lead.get('wechat_id') or '-'}",
            f"数量：{lead.get('quantity_estimate') or '-'}  预算：{lead.get('budget') or '-'}  日期：{lead.get('due_date') or '-'}  城市：{lead.get('city') or '-'}",
            f"来源：{lead.get('source') or '-'}  评分：{lead.get('lead_score') or 0}",
            f"备注：{lead.get('notes') or '-'}",
        ]
        self.crm_detail_text.delete("1.0", "end")
        self.crm_detail_text.insert("1.0", "\n".join(lines))
        self.crm_status_var.set(f"当前线索：#{self.crm_selected_id}")

    def save_crm_lead(self):
        if not self.crm_selected_id:
            messagebox.showinfo("请选择线索", "请先选择一条线索。")
            return
        try:
            self.db.update_lead(
                self.crm_selected_id,
                {
                    "stage": self.crm_stage_var.get(),
                    "owner": self.crm_owner_var.get().strip(),
                    "next_action": self.crm_next_action_var.get().strip(),
                },
            )
            self.load_crm_leads()
            self.crm_status_var.set("线索阶段已保存")
            self.append_log(f"[UI] Lead updated: #{self.crm_selected_id}")
        except Exception as exc:
            messagebox.showerror("保存线索失败", str(exc))
            self.crm_status_var.set(f"保存失败：{exc}")

    def load_chat_sessions(self):
        try:
            self.chat_sessions = self.db.list_conversations(limit=100)
            self.chat_session_listbox.delete(0, "end")
            for session in self.chat_sessions:
                name = session.get("company_name") or session.get("contact_person") or session.get("friend_name")
                stage = session.get("lead_stage") or session.get("stage") or "new"
                score = session.get("lead_score") or 0
                status = session.get("status") or "active"
                lock = self.db.get_conversation_lock(session.get("session_id"))
                if lock:
                    status_label = "人工锁定"
                elif status == "needs_human":
                    status_label = "待人工"
                else:
                    status_label = "自动"
                self.chat_session_listbox.insert("end", f"{status_label} · {stage} · {score}分 · {name}")
            self.chat_status_var.set(f"已加载 {len(self.chat_sessions)} 个会话")
            if self.chat_sessions and self.chat_session_listbox.size() > 0:
                self.chat_session_listbox.selection_set(0)
                self.load_selected_chat_session()
        except Exception as exc:
            self.chat_status_var.set(f"加载会话失败：{exc}")

    def load_selected_chat_session(self):
        selection = self.chat_session_listbox.curselection()
        if not selection:
            return
        session = self.chat_sessions[selection[0]]
        self.chat_selected_session = session.get("session_id")
        messages = self.db.get_session_messages(self.chat_selected_session, limit=40)
        lead = self.db.get_lead_by_session(self.chat_selected_session) or {}

        lines = [
            f"客户：{session.get('friend_name')}",
            f"阶段：{lead.get('stage') or session.get('stage')}",
            f"线索评分：{lead.get('lead_score') or 0}",
            f"下一步：{lead.get('next_action') or '-'}",
            "-" * 36,
        ]
        for msg in messages:
            direction = "客户" if msg.get("direction") == "inbound" else "客服"
            created = msg.get("created_at") or ""
            lines.append(f"[{created}] {direction}: {msg.get('content')}")

        self.chat_history_text.delete("1.0", "end")
        self.chat_history_text.insert("1.0", "\n".join(lines))
        self.chat_ai_text.delete("1.0", "end")
        self.chat_ai_text.insert("1.0", "点击“生成 AI 建议”后，这里会显示草稿。不会自动发送给客户。")
        self.chat_status_var.set(f"当前会话：{session.get('friend_name')}")

    def generate_chat_suggestion(self):
        if not self.chat_selected_session:
            messagebox.showinfo("请选择会话", "请先选择一个会话。")
            return

        messages = self.db.get_session_messages(self.chat_selected_session, limit=12)
        inbound = [m for m in messages if m.get("direction") == "inbound"]
        if not inbound:
            messagebox.showinfo("暂无客户消息", "该会话还没有客户消息。")
            return

        latest_user_message = inbound[-1]["content"]
        history = []
        for msg in messages[-8:]:
            role = "user" if msg.get("direction") == "inbound" else "assistant"
            history.append({"role": role, "content": msg.get("content", "")})

        self.chat_ai_text.delete("1.0", "end")
        self.chat_ai_text.insert("1.0", "正在生成 AI 建议...")
        self.chat_status_var.set("正在生成 AI 建议...")

        def worker():
            try:
                agent = CustomerSupportAgent()
                decision = agent.analyze(latest_user_message, history=history)
                if decision.route == "direct_reply" and decision.answer:
                    suggestion = decision.answer
                    meta = f"命中知识：{', '.join(decision.citations) or '-'}；置信度：{decision.confidence:.2f}"
                else:
                    ai = AIService()
                    suggestion, _reply_type = ai.generate_reply(
                        latest_user_message,
                        history=history,
                        retrieved_context=decision.context,
                    )
                    meta = f"AI 草稿；topic={decision.topic}；reason={decision.reason}"
            except Exception as exc:
                suggestion = f"生成失败：{exc}"
                meta = "未发送"

            def finish():
                self.chat_ai_text.delete("1.0", "end")
                self.chat_ai_text.insert("1.0", f"{suggestion}\n\n---\n{meta}")
                self.chat_status_var.set("AI 建议已生成，仅作为人工草稿")
                self.append_log(f"[UI] Chat suggestion generated for {self.chat_selected_session}")

            self.after(0, finish)

        threading.Thread(target=worker, daemon=True).start()

    def _selected_chat_record(self):
        if not self.chat_selected_session:
            return None
        for session in self.chat_sessions:
            if session.get("session_id") == self.chat_selected_session:
                return session
        return None

    def _manual_reply_text(self):
        raw = self.chat_ai_text.get("1.0", "end-1c").strip()
        if "\n\n---" in raw:
            raw = raw.split("\n\n---", 1)[0].strip()
        return raw

    def send_manual_reply(self):
        session = self._selected_chat_record()
        if not session:
            messagebox.showinfo("请选择会话", "请先选择一个需要接管的会话。")
            return
        reply_text = self._manual_reply_text()
        if not reply_text:
            messagebox.showinfo("回复为空", "请先生成或手动填写要发送给客户的内容。")
            return

        friend_name = session.get("friend_name")
        session_id = self.chat_selected_session
        self.chat_status_var.set("正在发送人工回复...")

        def worker():
            ok = False
            locked_until = ""
            error_message = ""
            try:
                from core.wechat import ChatListener

                listener = ChatListener()
                ok = listener.send(reply_text, friend_name)
                if ok:
                    self.db.save_message(
                        session_id,
                        "outbound",
                        reply_text,
                        source="manual",
                        intent="manual_takeover",
                    )
                    locked_until = self.db.lock_conversation(
                        session_id,
                        minutes=10,
                        reason="manual_send",
                    )
                    self.db.log_event("manual_reply", f"{friend_name}: locked until {locked_until}")
                else:
                    error_message = "微信发送失败，请确认微信已登录并打开。"
            except Exception as exc:
                error_message = str(exc)

            def finish():
                if ok:
                    self.load_selected_chat_session()
                    self.chat_status_var.set(f"人工回复已发送，自动回复锁定到 {locked_until}")
                    self.append_log(f"[UI] Manual reply sent: {friend_name}")
                    messagebox.showinfo("发送成功", f"已发送给 {friend_name}，并锁定自动回复 10 分钟。")
                else:
                    self.chat_status_var.set(f"人工发送失败：{error_message}")
                    messagebox.showwarning("发送失败", error_message)

            self.after(0, finish)

        threading.Thread(target=worker, daemon=True).start()

    def clear_chat_lock(self):
        if not self.chat_selected_session:
            messagebox.showinfo("请选择会话", "请先选择一个会话。")
            return
        self.db.clear_conversation_lock(self.chat_selected_session)
        session = self._selected_chat_record() or {}
        self.chat_status_var.set("该会话已解除人工锁定")
        self.append_log(f"[UI] Manual lock cleared: {self.chat_selected_session}")
        messagebox.showinfo("已解除锁定", f"{session.get('friend_name', '当前会话')} 已恢复自动回复。")

    def backend_running(self):
        if self.backend_process and self.backend_process.poll() is None:
            return True
        try:
            out = subprocess.check_output(
                ["powershell", "-NoProfile", "-Command", "Get-Process smart_bot -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id"],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
            return bool(out)
        except Exception:
            return False

    def start_backend(self):
        if self.backend_running():
            self.append_log("[UI] 后台客服已经在运行。")
            return
        if not BACKEND_EXE.exists():
            messagebox.showerror("启动失败", f"找不到后台引擎：\n{BACKEND_EXE}")
            return
        LOG_DIR.mkdir(exist_ok=True)
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self.backend_process = subprocess.Popen(
            [str(BACKEND_EXE)],
            cwd=str(ROOT),
            creationflags=flags,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.append_log(f"[UI] 已启动后台客服，PID={self.backend_process.pid}")
        self.refresh_status()

    def stop_backend(self):
        try:
            subprocess.run(
                ["powershell", "-NoProfile", "-Command", "Get-Process smart_bot -ErrorAction SilentlyContinue | Stop-Process -Force"],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                check=False,
            )
            self.backend_process = None
            self.append_log("[UI] 已停止后台客服。")
        finally:
            self.refresh_status()

    def restart_backend(self):
        self.stop_backend()
        self.after(700, self.start_backend)

    def refresh_status(self):
        running = self.backend_running()
        self.status_var.set("运行中" if running else "未启动")
        self.pid_var.set(self._backend_pid() if running else "-")
        self.wechat_var.set("已检测" if self._wechat_running() else "未检测")
        self.after(2000, self.refresh_status)

    def _backend_pid(self):
        try:
            out = subprocess.check_output(
                ["powershell", "-NoProfile", "-Command", "Get-Process smart_bot -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id"],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
            return out or "-"
        except Exception:
            return "-"

    def _wechat_running(self):
        try:
            out = subprocess.check_output(
                ["powershell", "-NoProfile", "-Command", "Get-Process WeChat,Weixin -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty ProcessName"],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
            return bool(out)
        except Exception:
            return False

    def latest_log(self):
        files = sorted(LOG_DIR.glob("smart_bot_*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
        return files[0] if files else None

    def refresh_logs(self):
        log_file = self.latest_log()
        if log_file and log_file.exists():
            try:
                text = log_file.read_text(encoding="utf-8", errors="replace")
                tail = "\n".join(text.splitlines()[-160:])
                current = self.log_text.get("1.0", "end-1c")
                if tail != current:
                    self.log_text.delete("1.0", "end")
                    for line in tail.splitlines():
                        tag = "INFO"
                        if "ERROR" in line or "失败" in line:
                            tag = "ERROR"
                        elif "WARNING" in line or "警告" in line:
                            tag = "WARNING"
                        self.log_text.insert("end", line + "\n", tag)
                    self.log_text.see("end")
            except Exception as exc:
                self.append_log(f"[UI] 读取日志失败：{exc}")
        self.after(1500, self.refresh_logs)

    def append_log(self, line):
        stamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.insert("end", f"{stamp} {line}\n", "INFO")
        self.log_text.see("end")

    def clear_log_view(self):
        self.log_text.delete("1.0", "end")

    def open_config_dir(self):
        CONFIG_DIR.mkdir(exist_ok=True)
        os.startfile(str(CONFIG_DIR))

    def on_close(self):
        try:
            if LOCK_FILE.exists() and LOCK_FILE.read_text(encoding="utf-8", errors="ignore").strip() == str(os.getpid()):
                LOCK_FILE.unlink()
        except Exception:
            pass
        self.destroy()


if __name__ == "__main__":
    if ensure_single_instance():
        app = SmartBotConsole()
        app.mainloop()
