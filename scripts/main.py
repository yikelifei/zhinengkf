#!/usr/bin/env python3
# -*- coding: utf-8 -*-
""" 智能客服主程序 — 启动入口 """

import sys
import os

# Force UTF-8 mode and console encoding on Windows before colorama takes over stdout
os.environ.setdefault('PYTHONUTF8', '1')
os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)
_local_deps = os.path.join(_project_root, ".codex_deps")
if os.path.isdir(_local_deps) and _local_deps not in sys.path:
    sys.path.insert(0, _local_deps)

from core.env_loader import load_env
from core.paths import resource_path

# Load env vars first, before any provider config is initialized.
load_env(".env")

import time
import random
import signal
import yaml

from core.logger import setup_logger, log as log_msg, info, warning, error
from core.wechat import ChatListener
from core.database import Database
from core.intent_classifier import IntentClassifier
from core.rule_engine import RuleEngine
from core.ai_service import AIService, AIError
from core.template_renderer import render
from core.conversation import ConversationManager
from core.customer_agent import CustomerSupportAgent
from core.business_hours import business_hours_status


logger = setup_logger("smart_bot")


class ShutdownRequested(Exception):
    """Raised when SIGINT/SIGTERM received."""
    pass


def _signal_handler(signum, frame):
    raise ShutdownRequested(f"Received signal {signum}")


signal.signal(signal.SIGINT, _signal_handler)
signal.signal(signal.SIGTERM, _signal_handler)


def load_config(path="config/settings.yaml"):
    path = resource_path(path)
    info(f"[Config] Loading settings: {path}")
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


class SmartBot:
    def __init__(self):
        info("=" * 50)
        info("Smart Bot starting...")
        info("=" * 50)

        # Load configs
        self.settings = load_config()
        keywords_path = resource_path("config/keywords.yaml")
        prompts_path = resource_path("config/prompts.yaml")
        info(f"[Config] Loading keywords: {keywords_path}")
        info(f"[Config] Loading prompts: {prompts_path}")
        with open(keywords_path, encoding="utf-8") as f:
            self.keywords_config = yaml.safe_load(f)
        with open(prompts_path, encoding="utf-8") as f:
            self.prompts_config = yaml.safe_load(f)

        # Anti-spam config
        self.max_daily_replies = self.settings.get("wechat", {}).get(
            "max_daily_replies", 30
        )
        self.daily_reply_start = time.strftime("%Y-%m-%d")
        self.recent_reply_cache = {}

        # Initialize modules
        self.db = Database()
        self.classifier = IntentClassifier(self.keywords_config)
        self.rule_engine = RuleEngine(self.keywords_config)
        self.ai_service = AIService()
        self.customer_agent = CustomerSupportAgent()
        self.conv_manager = ConversationManager(self.db)

        # Connect to WeChat (with retry)
        self.listener = None
        self._connect_wechat_with_retry()

        if not self.listener:
            logger.error("Cannot connect to WeChat, exiting.")
            sys.exit(1)

        # Restore seen-cache from DB
        self._restore_seen_cache()

        info("[OK] Initialization complete.\n")
        self._show_status()

    def _connect_wechat_with_retry(self, max_retries=5):
        """Connect to WeChat with exponential backoff retry."""
        for attempt in range(1, max_retries + 1):
            try:
                info(f"[WeChat] Attempt {attempt}/{max_retries}...")
                self.listener = ChatListener(
                    poll_interval=self.settings["wechat"]["poll_interval"],
                    anti_flood_seconds=self.settings["wechat"][
                        "anti_flood_seconds"
                    ],
                )
                return
            except RuntimeError as e:
                msg = str(e)
                if "未找到微信" in msg or "No WeChat 4.x window found" in msg:
                    error(f"[WeChat] {msg}")
                    return
                wait = min(attempt * 3, 15)
                warning(
                    f"[WeChat] Failed: {e}. Retrying in {wait}s..."
                )
                time.sleep(wait)

        error("[WeChat] All connection attempts failed.")

    def _restore_seen_cache(self):
        """Restore message dedup cache from last run."""
        try:
            rows = self.db.execute(
                "SELECT msg_hash FROM message_seen ORDER BY id DESC LIMIT 500"
            ).fetchall()
            if rows:
                self.listener._seen = {r["msg_hash"] for r in rows}
                info(f"[Cache] Restored {len(self.listener._seen)} seen messages.")
            else:
                self.listener._seen = set()
        except Exception:
            self.listener._seen = set()

    def _persist_seen_cache(self):
        """Persist seen-message hashes to DB for crash recovery."""
        if not hasattr(self.listener, '_seen') or not self.listener._seen:
            return
        try:
            hashes = list(self.listener._seen)[-500:]
            for h in hashes:
                try:
                    self.db.execute(
                        "INSERT OR IGNORE INTO message_seen (msg_hash) VALUES (?)",
                        (h,),
                    )
                except Exception:
                    pass
            self.db.commit()
        except Exception:
            pass

    def _normalize_reply(self, reply_text):
        """Normalize outgoing replies to be concise and single-message."""
        if not reply_text:
            return reply_text

        text = reply_text.replace('\r\n', '\n').strip()
        paragraphs = [p.strip() for p in text.split('\n') if p.strip()]
        text = ' '.join(paragraphs)

        import re
        text = re.sub(r'\s+', ' ', text).strip()
        max_len = 260
        if len(text) <= max_len:
            return text

        end_marks = "\u3002\uff01\uff1f!?"
        soft_marks = "\uff0c,\u3001 "
        sentences = re.findall(
            r'[^' + re.escape(end_marks) + r']+[' + re.escape(end_marks) + r']?',
            text,
        )
        selected = ''
        for sentence in sentences:
            candidate = (selected + sentence).strip()
            if selected and len(candidate) > max_len:
                break
            selected = candidate
        if selected and selected[-1] in end_marks:
            return selected
        cut = max(text.rfind(p, 0, max_len) for p in end_marks + "\uff1b;")
        if cut > 40:
            return text[:cut + 1].strip()
        cut = max(text.rfind(p, 0, max_len) for p in soft_marks)
        if cut > 40:
            return text[:cut].strip() + "\u3002"
        return text[:max_len].rstrip("\uff0c,\u3001\uff1b; ") + "\u3002"

        sentences = re.findall(r'[^。！？!?]+[。！？!?]?', text)
        selected = ''
        for sentence in sentences:
            candidate = (selected + sentence).strip()
            if selected and len(candidate) > max_len:
                break
            selected = candidate

        if selected and selected[-1] in '。！？!?':
            return selected

        cut = max(text.rfind(p, 0, max_len) for p in '。！？!?；;')
        if cut > 40:
            return text[:cut + 1].strip()

        cut = max(text.rfind(p, 0, max_len) for p in '，,、 ')
        if cut > 40:
            return (text[:cut].strip() + '。')

        return text[:max_len].rstrip('，,、；; ') + '。'

        paragraphs = [p.strip() for p in text.split('\n') if p.strip()]
        if paragraphs:
            text = paragraphs[0]

        import re
        sentence_parts = re.split(r'([。！？!?])', text)
        if len(sentence_parts) >= 2:
            text = ''.join(sentence_parts[:2]).strip()
        elif len(text) > 120:
            text = text[:117].rstrip() + '...'

        # Avoid sending very long single reply
        if len(text) > 120:
            text = text[:117].rstrip() + '...'

        return text

    def _reply_key(self, text):
        return " ".join((text or "").split()).strip()

    def _is_duplicate_reply(self, session_id, sender, reply_text):
        """Avoid sending the same exact copy to the same contact repeatedly."""
        key = self._reply_key(reply_text)
        if not key:
            return True

        if key in self.recent_reply_cache.get(sender, set()):
            return True

        try:
            rows = self.db.execute(
                """SELECT content FROM messages
                   WHERE session_id = ? AND direction = 'outbound'
                   ORDER BY id DESC LIMIT 10""",
                (session_id,),
            ).fetchall()
            for row in rows:
                if self._reply_key(row["content"]) == key:
                    return True
        except Exception:
            pass

        return False

    def _is_recent_outbound_content(self, session_id, content):
        key = self._reply_key(content)
        if not key:
            return False
        try:
            rows = self.db.execute(
                """SELECT content FROM messages
                   WHERE session_id = ? AND direction = 'outbound'
                   ORDER BY id DESC LIMIT 10""",
                (session_id,),
            ).fetchall()
            return any(self._reply_key(row["content"]) == key for row in rows)
        except Exception:
            return False

    def _record_reply_text(self, sender, reply_text):
        key = self._reply_key(reply_text)
        if not key:
            return
        cached = self.recent_reply_cache.setdefault(sender, set())
        cached.add(key)
        if len(cached) > 20:
            self.recent_reply_cache[sender] = set(list(cached)[-20:])

    def _make_non_duplicate_reply(self, reply_intent, content):
        """Reply every time, but avoid sending the exact same copy again."""
        variants = {
            "price": "收到，价格这块还需要结合数量、材质和定制内容来算；您把预计份数和预算发我，我可以继续帮您按档位判断。",
            "pricing": "价格需要结合数量、材质、尺寸和定制项核算；您把预计份数和预算发我，我可以先帮您判断适合的档位。",
            "min_order": "可以的，我再补充一下：常规建议 50 份起做，数量越多单价越好；您预计做多少份呢？",
            "moq": "常规建议 50 份起做，100 份以上价格会更好；您预计做多少份、什么时候使用？",
            "delivery_time": "交期我再帮您确认一下：一般确认设计后 5-7 个工作日，具体还要看数量和工艺；您计划哪天使用？",
            "delivery": "常规交期一般是确认方案和设计稿后 5-7 个工作日；您计划哪天使用、预计做多少份？",
            "case_study": "有的，我们可以按节日、预算和风格给您推荐款式；您想看端午、中秋、春节还是企业伴手礼方向？",
            "styles": "款式可以按端午、中秋、春节、企业伴手礼、简约商务或国潮风来推荐；您想看哪个方向？",
            "order_confirm": "好的，我这边继续帮您登记；麻烦补充公司名称、联系电话、数量和使用日期，方便人工客服核价。",
            "process": "定制流程是先确认用途、数量和预算，再出方案、确认设计、生产质检和发货；您先说下节日和预计数量就行。",
            "customization": "LOGO、贺卡、腰封、吊牌和祝福语都可以定制，设计稿需要人工设计师确认；您需要加哪些定制项？",
            "shipping": "配送方式要看数量、体积和收货城市；您把收货城市和预计份数发我，我好先判断快递还是物流更合适。",
        }
        return variants.get(
            reply_intent,
            "收到，您的问题我看到了。您可以再补充一下数量、预算、使用日期或想做的礼盒类型，我好继续帮您判断。",
        )

    def _handle_after_hours(self, session_id, sender, content):
        status = business_hours_status()
        if status.is_open:
            return False
        reply_text = self._normalize_reply(status.after_hours_message)
        if self._is_duplicate_reply(session_id, sender, reply_text):
            info(f"[AfterHours] {sender}: duplicate after-hours copy skipped.")
            return True

        contact_info = self.conv_manager.extract_contact_info(content)
        if contact_info:
            self.db.save_lead(session_id, {
                **contact_info,
                "notes": f"after_hours: {content}",
                "source": "wechat_after_hours",
                "lead_score": 70 if contact_info.get("phone") else 45,
                "next_action": "非工作时间留言，工作时间优先人工回访",
            })
        self.db.mark_human_needed(session_id, reason="after_hours")
        self.db.log_event("after_hours_reply", f"{sender}: {status.working_hours}")
        ok = self.listener.send(reply_text, sender)
        if ok:
            self._record_reply_text(sender, reply_text)
            if hasattr(self.listener, "mark_outgoing_seen"):
                self.listener.mark_outgoing_seen(sender, reply_text)
            self.db.save_message(
                session_id,
                direction="outbound",
                content=reply_text,
                source="after_hours",
                intent="after_hours",
            )
            self.conv_manager.add_to_context(session_id, "assistant", reply_text)
            log_msg(f"[非工作时间回复] {sender}: {reply_text[:60]}...", "green")
        else:
            error(f"[发送失败] 非工作时间回复给 {sender}")
        return True

    def _match_local_template(self, content):
        """Stable Chinese templates for common business questions."""
        text = (content or '').strip()
        rules = [
            ('price', ['价格', '多少钱', '报价', '费用', '价位', '预算', '贵不贵', '怎么算'], '礼盒价格主要看数量、材质和定制项，常规款大概 8-35 元/份，高端定制约 35-80 元/份；您方便说下预计数量和用途吗？我好按档位给您估算。'),
            ('min_order', ['起订', '起做', '最低', '最少', '多少份', '小批量', '几份'], '我们常规 50 份起做，100 份以上价格会更好；如果是试单或样品需求，也可以先告诉我数量和预算，我帮您看适合的方案。'),
            ('delivery_time', ['多久', '交期', '几天', '什么时候', '发货', '来得及', '加急'], '常规交期一般是确认设计和数量后 5-7 个工作日，加急单需要看数量和工艺；您告诉我预计使用日期，我帮您判断是否来得及。'),
            ('custom_process', ['流程', '怎么定制', '怎么做', '怎么下单', '怎么订', '定制步骤'], '定制流程是先确认节日、数量和预算，再出设计方案，确认后打样或直接生产，最后质检发货；您先说下要做什么节日礼盒和大概数量就行。'),
            ('case_study', ['案例', '样品', '图片', '照片', '效果图', '款式', '都有', '看看'], '我们有端午、中秋、春节和企业伴手礼等多种款式，可以按预算做简约款、国潮款或高端定制款；您想看哪类节日或哪个价位的方案？'),
            ('material', ['材质', '材料', '质量', '结实', '环保', '会不会破'], '常用材质有白卡纸、特种纸、灰板裱纸、木盒和铁盒等，都会按承重和外观需求来选；如果要装食品或易碎品，我会优先推荐更稳的结构。'),
            ('logo_design', ['logo', 'LOGO', '印字', '企业', '公司名', '贺卡', '腰封', '吊牌'], '可以加企业 LOGO、贺卡、腰封、吊牌和祝福语，设计稿确认后再生产；您有现成 LOGO 文件的话，后续发给人工设计师对接就可以。'),
            ('shipping', ['运费', '包邮', '配送', '发到', '快递', '物流'], '发货可以走快递或物流，运费要看数量、体积和收货城市；您告诉我收货地区和预计份数，我可以先帮您估一个配送方式。'),
            ('order_confirm', ['下单', '购买', '订购', '合作', '联系我', '怎么付款', '我要做'], '可以的，我先帮您登记需求；麻烦发一下公司名称、联系人电话、礼盒数量和使用日期，人工客服会继续给您核价和确认细节。'),
            ('transfer_human', ['人工', '电话', '语音', '投诉', '差评', '退款', '售后'], '已为您转接人工客服，请稍等。'),
        ]
        for intent, keywords, reply in rules:
            if any(kw in text for kw in keywords):
                return intent, reply
        return None, None
    def _is_group_sender(self, sender, content=""):
        group_keywords = [
            "群", "群聊", "微信群", "交流群", "客户群", "粉丝群", "VIP群",
            "chatroom", "@chatroom", "讨论组", "缇?", "绮変笣缇?",
        ]
        return any(kw in (sender or "") for kw in group_keywords)

    def _is_own_message_preview(self, content):
        stripped = (content or "").strip()
        return stripped.startswith(("我:", "我：", "我发出:", "我发出：", "You:", "You："))
    def _check_daily_limit(self, contact_name=None):
        """Reset counter at midnight, enforce limit."""
        today = time.strftime("%Y-%m-%d")
        if today != self.daily_reply_start:
            self.daily_reply_start = today
            self.listener.daily_count = {}
            info(f"[AntiSpam] Daily reply counter reset for {today}.")
        if contact_name is None:
            return True
        count = self.listener.daily_count.get(contact_name, 0)
        if count >= self.max_daily_replies:
            warning(
                f"[AntiSpam] {contact_name} reached daily limit "
                f"({count}/{self.max_daily_replies}), pausing."
            )
            return False
        return True

    def _is_worthy_of_reply(self, content):
        """Return False only for obvious noise; let real customer questions through."""
        stripped = (content or "").strip()
        if not stripped:
            return False

        cleaned = stripped.lower().strip(" ，。！？!?~～,.")
        greetings = {
            "你好", "您好", "嗨", "哈喽", "在吗", "在不在", "在的",
            "嗯", "好", "好的", "谢谢", "收到", "ok", "hello", "hi", "hey",
        }
        if cleaned in greetings:
            return False

        media_markers = {"[图片]", "[表情]", "[文件]", "[链接]", "[视频]", "[语音]"}
        if stripped in media_markers:
            return False

        emoji_only = all(
            ('\U0001F300' <= c <= '\U0001FAFF') or
            ('\U00002600' <= c <= '\U000027BF') or
            c.isspace()
            for c in stripped
        )
        if emoji_only:
            return False

        chinese_chars = sum(1 for c in stripped if '\u4e00' <= c <= '\u9fff')
        business_keywords = [
            "价格", "多少钱", "报价", "费用", "预算", "便宜", "划算",
            "怎么买", "怎么订", "怎么下单", "购买", "下单", "订购",
            "定制", "流程", "怎么做", "起订", "最低", "最少", "批量",
            "礼盒", "贺卡", "腰封", "吊牌", "丝带", "包装",
            "多久", "交期", "什么时候", "急", "加急", "发货", "运费",
            "材料", "材质", "质量", "样品", "案例", "图片", "照片",
            "推荐", "介绍", "有没有", "都有", "咨询", "了解", "需要",
            "中秋", "端午", "春节", "年货", "合作", "联系",
        ]
        if any(kw in stripped for kw in business_keywords):
            return True

        if any(mark in stripped for mark in ("?", "？", "吗", "呢")) and chinese_chars >= 2:
            return True

        return chinese_chars >= 2

        """判断消息是否值得回复（避免对每条消息都回复）。"""
        chinese_chars = sum(1 for c in content if '一' <= c <= '鿿')
        non_chinese = len(content) - chinese_chars

        # Skip very short non-Chinese messages
        if chinese_chars == 0 and 5 < len(content.strip()) < 30:
            return False

        # Skip one-character / meaningless messages
        if len(content.strip()) < 2:
            return False

        # Skip common greetings / small talk
        stripped = content.strip()
        greetings = {
            '你好', '您好', '嗨', '哈喽', '在吗', '在的',
            'hello', 'hi', 'hey',
        }
        cleaned = stripped.lower().replace('！', '').replace('!', '')
        if cleaned in greetings:
            return False

        # Emoji-only messages
        emoji_only = all(
            ('\U0001F600' <= c <= '\U0001FAFF') or
            ('\U00002702' <= c <= '\U00002B55') or
            c.isspace() or
            c in ('[图片]', '[表情]', '[文件]', '[链接]')
            for c in stripped
        )
        if emoji_only and len(stripped) <= 10:
            return False

        # Business-related keywords → worth replying
        business_keywords = [
            '价格', '多少钱', '报价', '贵不贵', '费用', '预算',
            '怎么买', '怎么订购', '怎么下单', '购买', '下单', '订购',
            '定制流程', '定制方式', '怎么做', '步骤',
            '起订量', '最少', '批量', '低订量', '最低', '起定量',
            '贺卡', '腰封', '吊牌', '丝带',
            '多久', '交期', '什么时候要', '急要', '加急', '急单',
            '材料', '材质', '质量', '做工',
            '样品', '案例', '实拍', '效果图', '照片',
            '推荐', '介绍', '有没有', '咨询', '想了解',
            '运费', '发货', '售后', '配送', '包邮',
            '中秋礼盒', '端午礼盒', '春节礼包', '年货',
            '合作', '想', '需要', '了解',
        ]
        for kw in business_keywords:
            if kw in content:
                return True

        # Longer Chinese sentences are likely real questions
        if len(stripped) >= 8 and chinese_chars >= 3:
            return True

        return False

    def handle_message(self, msg):
        sender = msg["sender"]
        content = msg["content"]

        if self._is_group_sender(sender, content):
            log_msg(f"[跳过] {sender} (群聊/群消息)", "yellow")
            return

        if self._is_own_message_preview(content):
            log_msg(f"[跳过] {sender} (自己发送的消息)", "yellow")
            return

        # ── Check daily reply limit ──
        if not self._check_daily_limit(sender):
            log_msg(f"[忽略] {sender} 已达每日回复上限", "yellow")
            return

        # Whitelist / blacklist filtering
        whitelist = self.settings.get("wechat", {}).get("whitelist", [])
        blacklist = self.settings.get("wechat", {}).get("blacklist", [])

        if whitelist and sender not in whitelist:
            log_msg(f"[忽略] {sender} (不在白名单)", "yellow")
            return
        if sender in blacklist:
            log_msg(f"[跳过] {sender} (黑名单)", "yellow")
            return

        # ── Reply all incoming messages ──
        info(f"\n[收到] {sender}: {content}")

        # ── Anti-flood check disabled ──

        # ── Session management ──
        session_id = self.db.create_or_get_session(sender)
        if not session_id:
            error(f"[错误] 无法为 {sender} 创建会话")
            return

        if self._is_recent_outbound_content(session_id, content):
            info(f"[Skip] {sender}: preview is our recent outbound message.")
            return

        # Save inbound message and update context (single call)
        self.conv_manager.add_message(session_id, direction="inbound", content=content)

        if self._handle_after_hours(session_id, sender, content):
            return

        lock = self.db.get_conversation_lock(session_id)
        if lock:
            until = lock.get("manual_lock_until")
            reason = lock.get("manual_lock_reason") or "manual_takeover"
            info(f"[人工接管] {sender} 已锁定到 {until}，跳过自动回复 ({reason})")
            self.db.log_event("manual_takeover_skip", f"{sender}: {content}")
            return

        # Retrieve conversation history (updated with this message)
        history = self.conv_manager.get_ai_context(session_id)[-6:]

        agent_decision = self.customer_agent.analyze(content, history)
        if agent_decision.route == "ignore":
            info(f"[Agent] Ignored {sender}: {agent_decision.reason}")
            return

        # Check session stage
        stage_row = self.db.execute(
            "SELECT stage FROM conversations WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        is_new_session = stage_row and stage_row["stage"] == "new"

        # ── Intent classification ──
        local_intent, local_template = self._match_local_template(content)
        intent_result = self.classifier.classify(content)
        rule_intent, rule_template = self.rule_engine.match(content)
        if local_template:
            rule_intent, rule_template = local_intent, local_template

        reply_text = None
        reply_source = None
        reply_intent = intent_result.get('intent', 'vague')
        special_action = intent_result.get('action')

        # Special actions: welcome, transfer_human
        if agent_decision.route == "direct_reply":
            reply_text = agent_decision.answer
            reply_source = "agent_rag"
            reply_intent = agent_decision.topic
            if agent_decision.topic in ("transfer_human", "out_of_scope"):
                self.db.mark_human_needed(session_id, reason=agent_decision.topic)
                self.db.log_event("agent_transfer", f"{sender}: {content}")
            info(
                f"[Agent] route={agent_decision.route} "
                f"topic={agent_decision.topic} confidence={agent_decision.confidence:.2f}"
            )

        elif rule_intent == 'welcome':
            reply_text = rule_template
            reply_source = "rule"
            reply_intent = 'welcome'
            if is_new_session:
                self.db.update_conversation_stage(
                    session_id, 'info_collected'
                )
                self.db.log_event("new_session", f"{sender} -> {session_id}")

        elif rule_intent == 'transfer_human':
            reply_text = rule_template
            reply_source = "rule"
            info(f"[转人工] 客户 {sender} 需要人工客服介入!")
            self.db.mark_human_needed(session_id, reason="rule_transfer_human")
            self.db.log_event("transfer_human", f"{sender}: {content}")

        elif rule_intent and rule_template:
            reply_text = render(rule_template, {"message": content})
            reply_source = "rule"

            if rule_intent == 'order_confirm':
                self.db.log_event("lead_generated", f"{sender} 意向下单")

            self.conv_manager.advance_stage(session_id, 'info_collected')

        else:
            # Rule miss → AI fallback
            try:
                reply_text, reply_type = self.ai_service.generate_reply(
                    content,
                    history,
                    retrieved_context=agent_decision.context,
                )
                reply_source = "ai"
                reply_intent = agent_decision.topic or "ai_fallback"
                if agent_decision.context:
                    reply_source = "agent_rag_ai"

                if reply_type == "transfer_human":
                    info(f"[AI建议转人工] 客户 {sender}")
                    self.db.mark_human_needed(session_id, reason="ai_transfer_human")
                    self.db.log_event("ai_transfer", f"{sender}: {content}")

            except AIError as e:
                warning(f"[AI不可用] {e}，切换为通用回复")
                reply_text = (
                    "抱歉，智能助手暂时无法响应。"
                    "您的问题已记录，人工客服会尽快回复您~ "
                )
                reply_source = "fallback"

        # ── Extract lead info ──
        if reply_text:
            contact_info = self.conv_manager.extract_contact_info(content)
            if contact_info:
                lead_score = 30
                if contact_info.get("phone") or contact_info.get("wechat_id"):
                    lead_score += 30
                if contact_info.get("quantity_estimate"):
                    lead_score += 15
                if contact_info.get("budget"):
                    lead_score += 15
                if contact_info.get("due_date"):
                    lead_score += 10
                self.db.save_lead(session_id, {
                    **contact_info,
                    "notes": f"{reply_intent}: {content}",
                    "source": "wechat",
                    "lead_score": min(100, lead_score),
                    "next_action": "补充数量、预算、日期、城市并人工跟进",
                })
                log_msg(f"[线索] 提取到信息: {contact_info}", "magenta")

        # ── Send reply ──
        if reply_text:
            reply_text = self._normalize_reply(reply_text)
            if self._is_duplicate_reply(session_id, sender, reply_text):
                info(f"[Rewrite] {sender}: duplicate reply text, using alternate copy.")
                reply_text = self._normalize_reply(
                    self._make_non_duplicate_reply(reply_intent, content)
                )
            time.sleep(random.uniform(2.0, 4.0))
            ok = self.listener.send(reply_text, sender)
            if ok:
                self._record_reply_text(sender, reply_text)
                if hasattr(self.listener, "mark_outgoing_seen"):
                    self.listener.mark_outgoing_seen(sender, reply_text)
                log_msg(f"[回复] {sender}: {reply_text[:60]}...", "green")
                self.db.save_message(
                    session_id, direction="outbound", content=reply_text,
                    source=reply_source, intent=reply_intent,
                )
                self.conv_manager.add_to_context(
                    session_id, "assistant", reply_text
                )
                self.conv_manager.advance_stage(
                    session_id,
                    'quotation_given' if reply_intent == 'price' else 'info_collected',
                )
            else:
                error(f"[发送失败] 给 {sender}")

        # Auto image sending disabled to ensure a single reply per incoming message.
        # if rule_intent == 'case_study':
        #     self._send_sample_images(sender)

    def _send_sample_images(self, sender):
        """Send sample images (placeholder)."""
        import os
        image_dir = "assets/sample_images"
        if os.path.isdir(image_dir):
            files = [f for f in os.listdir(image_dir) if f.endswith(('.jpg', '.png'))]
            if files:
                img_path = os.path.join(image_dir, files[0])
                self.listener.send_image(img_path, sender)
                info(f"[图片] 已发送: {img_path}")

    def _show_status(self):
        info(f"AI skill: {self.ai_service.prompt_key}")
        info("AI引擎:")
        ai_status = self.ai_service.check_health()
        prompt_key = ai_status.pop("ai_prompt_key", None)
        if prompt_key:
            info(f"AI prompt key: {prompt_key}")
        parts = []
        for name, status in ai_status.items():
            icon = "O" if status["available"] else "o"
            model = status.get("model") or "-"
            label = f"{icon}{name}({model})"
            if status["is_primary"]:
                label += " *"
            if status.get("in_fallback_chain"):
                label += " fallback"
            parts.append(label)
        info(" | ".join(parts))

    def _cleanup_stale_logs(self):
        """Remove log files older than 30 days."""
        import glob as g
        try:
            now = time.time()
            max_age = 30 * 86400
            for fpath in g.glob("logs/smart_bot_*.log"):
                if now - os.path.getmtime(fpath) > max_age:
                    os.remove(fpath)
                    info(f"[Cleanup] Removed stale log: {os.path.basename(fpath)}")
        except Exception:
            pass

    def run(self):
        info("\n" + "=" * 48)
        info("  Gift Box Customization Smart Customer Service")
        info("  Started at " + time.strftime("%Y-%m-%d %H:%M:%S"))
        info("=" * 48 + "\n")

        self._cleanup_stale_logs()

        poll_interval = self.settings["wechat"]["poll_interval"]
        # Do a health check every N polls
        health_check_every = max(poll_interval, 10)
        last_health_check = 0

        while True:
            try:
                msgs = self.listener.get_new_messages()

                # 每轮只处理一条消息，处理后立即发送，然后等待下一轮
                if msgs:
                    msg = msgs[0]  # 只取第一条消息
                    self.handle_message(msg)
                    self._persist_seen_cache()

                # Periodic health check & stale log cleanup
                now = time.time()
                if now - last_health_check > health_check_every:
                    last_health_check = now
                    if not self.listener.is_connected():
                        warning("[Main] WeChat connection lost.")
                        self.listener.reconnect()
                    self._cleanup_stale_logs()

            except ShutdownRequested:
                info("\n[Shutdown] User interrupted, saving state...")
                self._persist_seen_cache()
                break
            except Exception as e:
                error(f"[异常] {e}")
                import traceback
                traceback.print_exc()

            time.sleep(poll_interval)

        # Graceful cleanup
        self._persist_seen_cache()
        info("[Shutdown] Goodbye.")


if __name__ == "__main__":
    bot = SmartBot()
    bot.run()
