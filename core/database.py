""" 数据库模块 — SQLite CRUD """

import sqlite3
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from .logger import warning


class Database:
    def __init__(self, db_path="data/kefu.db"):
        self.db_path = str(db_path)
        if self.db_path != ":memory:":
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = None
        self._init_db()

    def _get_conn(self):
        if self.conn is None:
            self.conn = sqlite3.connect(self.db_path, timeout=10.0)
            self.conn.row_factory = sqlite3.Row
            # WAL mode: better concurrency, less locking
            self.conn.execute("PRAGMA journal_mode=WAL")
            # Busy timeout prevents "database is locked" errors
            self.conn.execute("PRAGMA busy_timeout=5000")
        return self.conn

    def _init_db(self):
        conn = self._get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                friend_name TEXT NOT NULL,
                session_id TEXT UNIQUE NOT NULL,
                first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_seen_at DATETIME,
                stage TEXT DEFAULT 'new',
                status TEXT DEFAULT 'active',
                manual_lock_until DATETIME,
                manual_lock_reason TEXT
            )
        """)
        self._ensure_conversation_columns(conn)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                direction TEXT NOT NULL,
                content TEXT NOT NULL,
                source TEXT DEFAULT 'rule',
                intent TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                company_name TEXT,
                contact_person TEXT,
                phone TEXT,
                wechat_id TEXT,
                festival TEXT,
                product_category TEXT,
                quantity_estimate TEXT,
                notes TEXT,
                stage TEXT DEFAULT 'new_inquiry',
                assigned_to TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME
            )
        """)
        self._ensure_lead_columns(conn)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                detail TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS message_seen (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                msg_hash TEXT UNIQUE NOT NULL
            )
        """)
        # Indexes for faster queries
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_session "
            "ON messages(session_id, id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_leads_stage "
            "ON leads(stage, created_at)"
        )
        conn.commit()

    def _ensure_conversation_columns(self, conn):
        existing = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(conversations)").fetchall()
        }
        columns = {
            "manual_lock_until": "DATETIME",
            "manual_lock_reason": "TEXT",
        }
        for name, definition in columns.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE conversations ADD COLUMN {name} {definition}")

    def _ensure_lead_columns(self, conn):
        existing = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(leads)").fetchall()
        }
        columns = {
            "budget": "TEXT",
            "due_date": "TEXT",
            "city": "TEXT",
            "source": "TEXT",
            "lead_score": "INTEGER DEFAULT 0",
            "next_action": "TEXT",
            "owner": "TEXT",
            "lost_reason": "TEXT",
            "deal_value": "TEXT",
            "contract_status": "TEXT",
            "payment_status": "TEXT",
            "invoice_requirement": "TEXT",
            "delivery_address": "TEXT",
            "production_status": "TEXT",
            "shipping_status": "TEXT",
        }
        for name, definition in columns.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE leads ADD COLUMN {name} {definition}")

    def execute(self, sql, params=()):
        conn = self._get_conn()
        return conn.execute(sql, params)

    def commit(self):
        conn = self._get_conn()
        conn.commit()

    def create_or_get_session(self, friend_name):
        """获取或创建会话，返回 session_id"""
        try:
            result = self.execute(
                "SELECT session_id FROM conversations WHERE friend_name = ?",
                (friend_name,),
            ).fetchone()
            if result:
                return result["session_id"]

            import time
            # Use timestamp+random for unique ID (collision virtually impossible)
            session_id = '%.6d%s' % (int(time.time()), uuid.uuid4().hex[:6])

            self.execute(
                "INSERT INTO conversations (friend_name, session_id) VALUES (?, ?)",
                (friend_name, session_id),
            )
            self.commit()
            return session_id
        except Exception as e:
            warning(f"[DB] Creating session failed: {e}")
            return None

    def save_message(self, session_id, direction, content, source="rule", intent=None):
        try:
            self.execute(
                """INSERT INTO messages (session_id, direction, content, source, intent)
                   VALUES (?, ?, ?, ?, ?)""",
                (session_id, direction, content, source, intent),
            )
            self.commit()
        except Exception as e:
            warning(f"[DB] Saving message failed: {e}")

    def get_messages_history(self, session_id, limit=6):
        rows = self.execute(
            """SELECT direction, content FROM messages
               WHERE session_id = ? ORDER BY id DESC LIMIT ?""",
            (session_id, limit),
        ).fetchall()
        # 翻转为正常时间顺序
        history = []
        for row in reversed(rows):
            role = "user" if row["direction"] == "inbound" else "assistant"
            history.append({"role": role, "content": row["content"]})
        return history

    def list_conversations(self, limit=100):
        limit = _safe_positive_int(limit, default=100, max_value=1000)
        rows = self.execute(
            """SELECT c.*, l.company_name, l.contact_person, l.phone, l.stage AS lead_stage,
                      l.lead_score, l.next_action
               FROM conversations c
               LEFT JOIN leads l ON l.session_id = c.session_id
               ORDER BY
                 CASE c.status
                   WHEN 'manual_takeover' THEN 0
                   WHEN 'needs_human' THEN 1
                   ELSE 2
                 END,
                 COALESCE(c.last_seen_at, c.first_seen_at) DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_session_messages(self, session_id, limit=50):
        limit = _safe_positive_int(limit, default=50, max_value=500)
        rows = self.execute(
            """SELECT direction, content, source, intent, created_at
               FROM messages
               WHERE session_id = ?
               ORDER BY id DESC
               LIMIT ?""",
            (session_id, limit),
        ).fetchall()
        return [dict(r) for r in reversed(rows)]

    def get_lead_by_session(self, session_id):
        row = self.execute(
            "SELECT * FROM leads WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        return dict(row) if row else None

    def lock_conversation(self, session_id, minutes=10, reason="manual_takeover"):
        until = (datetime.now() + timedelta(minutes=minutes)).strftime("%Y-%m-%d %H:%M:%S")
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.execute(
            """UPDATE conversations
               SET manual_lock_until = ?, manual_lock_reason = ?, status = ?, last_seen_at = ?
               WHERE session_id = ?""",
            (until, reason, "manual_takeover", now, session_id),
        )
        self.commit()
        return until

    def clear_conversation_lock(self, session_id):
        self.execute(
            """UPDATE conversations
               SET manual_lock_until = NULL, manual_lock_reason = NULL, status = ?
               WHERE session_id = ?""",
            ("active", session_id),
        )
        self.commit()

    def get_conversation_lock(self, session_id):
        row = self.execute(
            """SELECT manual_lock_until, manual_lock_reason
               FROM conversations
               WHERE session_id = ?""",
            (session_id,),
        ).fetchone()
        if not row or not row["manual_lock_until"]:
            return None
        try:
            locked_until = datetime.strptime(row["manual_lock_until"], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None
        if locked_until <= datetime.now():
            self.clear_conversation_lock(session_id)
            return None
        return {
            "manual_lock_until": row["manual_lock_until"],
            "manual_lock_reason": row["manual_lock_reason"],
        }

    def mark_human_needed(self, session_id, reason="transfer_human"):
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.execute(
            """UPDATE conversations
               SET status = ?, manual_lock_reason = ?, last_seen_at = ?
               WHERE session_id = ?""",
            ("needs_human", reason, now, session_id),
        )
        self.commit()

    def mark_conversation_active(self, session_id):
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.execute(
            """UPDATE conversations
               SET status = ?, manual_lock_reason = NULL, last_seen_at = ?
               WHERE session_id = ?""",
            ("active", now, session_id),
        )
        self.commit()

    def save_lead(self, session_id, info):
        """保存客户线索"""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        # Check if lead already exists for this session
        existing = self.execute(
            "SELECT id FROM leads WHERE session_id = ?", (session_id,)
        ).fetchone()

        if existing:
            self.execute(
                """UPDATE leads SET
                   company_name=COALESCE(?, company_name),
                   contact_person=COALESCE(?, contact_person),
                   phone=COALESCE(?, phone),
                   wechat_id=COALESCE(?, wechat_id),
                   festival=COALESCE(?, festival),
                   product_category=COALESCE(?, product_category),
                   quantity_estimate=COALESCE(?, quantity_estimate),
                   notes=COALESCE(?, notes),
                   budget=COALESCE(?, budget),
                   due_date=COALESCE(?, due_date),
                   city=COALESCE(?, city),
                   source=COALESCE(?, source),
                   lead_score=MAX(COALESCE(?, lead_score), COALESCE(lead_score, 0)),
                   next_action=COALESCE(?, next_action),
                   owner=COALESCE(?, owner),
                   updated_at=?
                   WHERE session_id=?""",
                (
                    info.get("company_name"),
                    info.get("contact_person"),
                    info.get("phone"),
                    info.get("wechat_id"),
                    info.get("festival"),
                    info.get("product_category"),
                    info.get("quantity_estimate"),
                    info.get("notes"),
                    info.get("budget"),
                    info.get("due_date"),
                    info.get("city"),
                    info.get("source"),
                    info.get("lead_score", 0),
                    info.get("next_action"),
                    info.get("owner"),
                    now,
                    session_id,
                ),
            )
        else:
            self.execute(
                """INSERT INTO leads
                   (session_id, company_name, contact_person, phone, wechat_id,
                    festival, product_category, quantity_estimate, notes, stage,
                    budget, due_date, city, source, lead_score, next_action, owner, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    session_id,
                    info.get("company_name"),
                    info.get("contact_person"),
                    info.get("phone"),
                    info.get("wechat_id"),
                    info.get("festival"),
                    info.get("product_category"),
                    info.get("quantity_estimate"),
                    info.get("notes"),
                    info.get("stage", "new_inquiry"),
                    info.get("budget"),
                    info.get("due_date"),
                    info.get("city"),
                    info.get("source"),
                    info.get("lead_score", 0),
                    info.get("next_action"),
                    info.get("owner"),
                    now,
                ),
            )
        self.commit()

    def list_leads(self, limit=100):
        limit = _safe_positive_int(limit, default=100, max_value=5000)
        rows = self.execute(
            """SELECT * FROM leads
               ORDER BY COALESCE(updated_at, created_at) DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def update_lead(self, lead_id, fields):
        if not isinstance(fields, dict):
            return False
        allowed = {
            "company_name", "contact_person", "phone", "wechat_id", "festival",
            "product_category", "quantity_estimate", "notes", "stage",
            "assigned_to", "budget", "due_date", "city", "source",
            "lead_score", "next_action", "owner", "lost_reason", "deal_value",
            "contract_status", "payment_status", "invoice_requirement",
            "delivery_address", "production_status", "shipping_status",
        }
        updates = {key: value for key, value in fields.items() if key in allowed}
        if not updates:
            return False
        updates["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        sets = ", ".join(f"{key}=?" for key in updates)
        params = list(updates.values()) + [lead_id]
        cursor = self.execute(f"UPDATE leads SET {sets} WHERE id=?", params)
        self.commit()
        return cursor.rowcount > 0

    def query_pending_leads(self, days=7):
        """查询待跟进的线索（最近N天未成交）"""
        days = _safe_positive_int(days, default=7, max_value=3650)
        rows = self.execute(
            """SELECT * FROM leads
               WHERE stage IN ('new_inquiry')
                 AND created_at > datetime('now', ?)""",
            (f"-{days} days",),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_followup_leads(self, limit=100):
        limit = _safe_positive_int(limit, default=100, max_value=1000)
        rows = self.execute(
            """SELECT * FROM leads
               WHERE COALESCE(stage, 'new_inquiry') NOT IN
                     ('ordered', 'closed_won', 'closed_lost', 'lost')
               ORDER BY
                 CASE
                   WHEN lead_score >= 80 THEN 0
                   WHEN lead_score >= 50 THEN 1
                   ELSE 2
                 END,
                 COALESCE(updated_at, created_at) ASC
               LIMIT ?""",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_daily_metrics(self, days=7):
        days = _safe_positive_int(days, default=7, max_value=3650)
        rows = self.execute(
            """SELECT
                 date(created_at) AS day,
                 SUM(CASE WHEN direction='inbound' THEN 1 ELSE 0 END) AS inbound_messages,
                 SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END) AS outbound_messages,
                 COUNT(DISTINCT session_id) AS active_sessions
               FROM messages
               WHERE created_at >= datetime('now', ?)
               GROUP BY date(created_at)
               ORDER BY day DESC""",
            (f"-{days} days",),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_lead_metrics(self):
        row = self.execute(
            """SELECT
                 COUNT(*) AS total,
                 SUM(CASE WHEN lead_score >= 80 THEN 1 ELSE 0 END) AS high_intent,
                 SUM(CASE WHEN COALESCE(stage, '') IN ('ordered', 'closed_won') THEN 1 ELSE 0 END) AS won,
                 SUM(CASE WHEN COALESCE(stage, '') IN ('lost', 'closed_lost') THEN 1 ELSE 0 END) AS lost,
                 AVG(COALESCE(lead_score, 0)) AS avg_score
               FROM leads"""
        ).fetchone()
        return dict(row) if row else {
            "total": 0,
            "high_intent": 0,
            "won": 0,
            "lost": 0,
            "avg_score": 0,
        }

    def get_stage_metrics(self):
        rows = self.execute(
            """SELECT COALESCE(stage, 'new_inquiry') AS stage, COUNT(*) AS count
               FROM leads
               GROUP BY COALESCE(stage, 'new_inquiry')
               ORDER BY count DESC"""
        ).fetchall()
        return [dict(r) for r in rows]

    def update_conversation_stage(self, session_id, stage):
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.execute(
            "UPDATE conversations SET stage = ?, last_seen_at = ? WHERE session_id = ?",
            (stage, now, session_id),
        )
        self.commit()

    def log_event(self, event_type, detail=""):
        self.execute(
            "INSERT INTO audit_log (event_type, detail) VALUES (?, ?)",
            (event_type, detail),
        )
        self.commit()

    def get_audit_events(self, limit=100):
        limit = _safe_positive_int(limit, default=100, max_value=1000)
        rows = self.execute(
            """SELECT id, event_type, detail, created_at
               FROM audit_log
               ORDER BY id DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]


def _safe_positive_int(value, default: int, max_value: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    if parsed <= 0:
        return default
    return min(parsed, max_value)
