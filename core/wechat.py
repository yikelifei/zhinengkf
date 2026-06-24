# -*- coding: utf-8 -*-
""" WeChat 4.x automation via pywinauto — robust UIA-based controller """

import ctypes
import hashlib
import re
import time
from win32gui import EnumWindows, GetClassName, GetWindowText, IsWindowVisible

from .logger import warning, info


class ChatListener:
    def __init__(self, poll_interval=3, anti_flood_seconds=60):
        self.poll_interval = poll_interval
        self.last_reply_time = {}
        self.anti_flood_seconds = anti_flood_seconds
        self.daily_count = {}
        self._outgoing_seen = {}
        self._last_incoming_preview = {}
        self.app = None
        self.desktop = None
        self._connected = False
        self._connect_wechat()

    # ── Connection ────────────────────────────────────────────────

    def _connect_wechat(self):
        try:
            user32 = ctypes.windll.user32
            hwnds = []

            def enum_cb(hwnd, results):
                try:
                    cls = GetClassName(hwnd)
                    if cls == 'WeChatMainWndForPC':
                        pid_out = ctypes.c_ulong()
                        user32.GetWindowThreadProcessId(
                            hwnd, ctypes.byref(pid_out)
                        )
                        results.append({'hwnd': hex(hwnd), 'pid': pid_out.value})
                except Exception:
                    pass
                return True

            EnumWindows(enum_cb, hwnds)
            if not hwnds:
                raise RuntimeError(
                    '未找到微信 4.x 主窗口。请先打开并登录微信 4.x，然后重新启动智能客服。'
                )

            target_hwnd = int(hwnds[0]['hwnd'], 16)
            from pywinauto import Desktop
            self.desktop = Desktop(backend='uia')
            self.app = self.desktop.window(handle=target_hwnd)

            sessions_list = self._find_session_list()
            if sessions_list is None:
                raise RuntimeError(
                    '已找到微信窗口，但找不到会话列表。请确认微信已登录，并停留在聊天主界面。'
                )

            session_items = sessions_list.children()
            count = len(session_items)
            info(f'[WeChat] Connected to hwnd={target_hwnd}, {count} sessions.')
            self._connected = True

        except ImportError as e:
            raise RuntimeError(
                'Missing dependency: pip install pywinauto pywin32\nError: %s' % e
            )
        except Exception as e:
            self._connected = False
            if isinstance(e, RuntimeError):
                raise
            raise RuntimeError(f'无法连接微信自动化界面。\nError: {e}')

    def is_connected(self):
        """Check if the bot is still connected to WeChat."""
        if not self._connected or self.app is None:
            return False
        try:
            self._find_session_list()
            return True
        except Exception:
            self._clear_ui_cache()
            return False

    def _restore_if_minimized(self):
        """If WeChat main window is minimized, restore it (do not force foreground).

        This helps UIA find controls when WeChat is in the background without
        aggressively stealing focus from the user.
        """
        try:
            user32 = ctypes.windll.user32
            hwnd = user32.FindWindowW("WeChatMainWndForPC", None)
            if not hwnd:
                return False
            # SW_RESTORE = 9; only restore if minimized/iconic
            SW_RESTORE = 9
            if user32.IsIconic(hwnd):
                user32.ShowWindow(hwnd, SW_RESTORE)
                time.sleep(0.35)
                return True
        except Exception:
            pass
        return False

    def reconnect(self):
        """Attempt to reconnect to WeChat after connection loss."""
        self._connected = False
        try:
            self._connect_wechat()
            info('[WeChat] Reconnected successfully.')
            return True
        except Exception as e:
            warning(f'[WeChat] Reconnection failed: {e}')
            return False

    # ── UI Element Helpers (cached) ───────────────────────────────

    def _find_control_cached(self, ctrl_type, name_contains=None):
        cache_key = (ctrl_type, name_contains)
        if not hasattr(self, '_control_cache'):
            self._control_cache = {}

        if cache_key in self._control_cache:
            val = self._control_cache[cache_key]
            if val is not None:
                return val
            del self._control_cache[cache_key]

        try:
            for c in self.app.descendants(control_type=ctrl_type):
                n = c.element_info.name or ''
                if name_contains and name_contains not in n:
                    continue
                self._control_cache[cache_key] = c
                return c
            return None
        except Exception:
            return None

    def _get_children_cached(self, parent):
        if parent is None:
            return []
        try:
            return parent.children()
        except Exception:
            return []

    def _find_session_list(self):
        if not hasattr(self, '_session_list_cache'):
            self._session_list_cache = None
        if self._session_list_cache is not None:
            return self._session_list_cache
        try:
            result = self._find_control_cached('List', '会话') \
                     or self._find_control_cached('List')
            self._session_list_cache = result
            return result
        except Exception:
            self._session_list_cache = None
            raise

    def _clear_ui_cache(self):
        self._control_cache = {}
        self._session_list_cache = None
        self._edit_field_cache = None
        self._chat_window_cache = {}

    def _get_edit_field(self):
        """Find message input field, cached by session."""
        if hasattr(self, '_edit_field_cache') and self._edit_field_cache:
            return self._edit_field_cache
        try:
            for c in self.app.descendants(control_type='Edit'):
                nm = c.element_info.name or ''
                if nm and '搜索' not in nm:
                    self._edit_field_cache = c
                    return c
            return None
        except Exception:
            self._edit_field_cache = None
            return None

    def _session_list_right(self):
        try:
            sessions_list = self._find_session_list()
            if sessions_list is None:
                return 0
            return sessions_list.rectangle().right
        except Exception:
            return 0

    def _is_right_side_control(self, ctrl):
        try:
            right = self._session_list_right()
            rect = ctrl.rectangle()
            return rect.left > right + 10
        except Exception:
            return False

    def _normalize_chat_name(self, name):
        return (name or '').strip().lower()

    def _get_active_chat_title(self):
        """Return the likely active chat title shown in the right-side panel."""
        if not self.app:
            return ''

        try:
            top_bound = self.app.rectangle().top + 140
            candidates = []
            for ctrl_type in ('Text', 'Button'):
                for c in self.app.descendants(control_type=ctrl_type):
                    if not self._is_right_side_control(c):
                        continue
                    rect = c.rectangle()
                    if rect.top > top_bound:
                        continue
                    name = (c.element_info.name or '').strip()
                    if not name or len(name) > 64:
                        continue
                    if name in ('返回', '更多', '聊天信息', '群聊', '在线', '离线'):
                        continue
                    candidates.append((rect.top, rect.left, name))

            if not candidates:
                return ''

            candidates.sort()
            return candidates[0][2]
        except Exception:
            return ''

    def _current_chat_matches(self, target_name):
        """Verify the active chat panel is the intended contact before sending."""
        target = self._normalize_chat_name(target_name)
        if not target:
            return False

        active_title = self._normalize_chat_name(self._get_active_chat_title())
        if not active_title:
            return False

        if active_title == target:
            return True
        if active_title.startswith(target) or target.startswith(active_title):
            return True
        return target in active_title or active_title in target

    def _is_selected_session_item(self, item):
        try:
            return bool(item.is_selected())
        except Exception:
            pass
        try:
            return bool(item.iface_selection_item.CurrentIsSelected)
        except Exception:
            return False

    # ── Message Reading ───────────────────────────────────────────

    def _cache_key(self, sender, time_str, content):
        raw = '%s|%s|%s' % (sender.strip(), time_str.strip(), content.strip())
        return hashlib.md5(raw.encode('utf-8')).hexdigest()

    def _find_chat_windows(self):
        """Return visible detached WeChat chat windows keyed by title."""
        windows = []

        def enum_cb(hwnd, results):
            try:
                if not IsWindowVisible(hwnd):
                    return True
                if GetClassName(hwnd) != 'ChatWnd':
                    return True
                title = (GetWindowText(hwnd) or '').strip()
                if title:
                    results.append((title, hwnd))
            except Exception:
                pass
            return True

        EnumWindows(enum_cb, windows)
        return windows

    def _find_chat_window(self, who):
        target = self._normalize_chat_name(who)
        if not target:
            return None

        for title, hwnd in self._find_chat_windows():
            normalized = self._normalize_chat_name(title)
            if normalized == target or normalized in target or target in normalized:
                try:
                    return self.desktop.window(handle=hwnd)
                except Exception:
                    return None
        return None

    def _is_detached_inbound_item(self, item, sender):
        """Detached chat messages expose sender avatar buttons on inbound items."""
        try:
            for child in item.descendants(control_type='Button'):
                name = (child.element_info.name or '').strip()
                if name == sender:
                    return True
            return False
        except Exception:
            return False

    def _get_new_messages_from_chat_windows(self):
        if not self.desktop:
            return []
        if not hasattr(self, '_seen'):
            self._seen = set()

        results = []
        for sender, hwnd in self._find_chat_windows():
            if self._is_group_or_official(sender) or self._is_system_account(sender):
                continue
            try:
                chat = self.desktop.window(handle=hwnd)
                msg_list = None
                for ctrl in chat.descendants(control_type='List'):
                    if (ctrl.element_info.name or '').strip() == '消息':
                        msg_list = ctrl
                        break
                if msg_list is None:
                    continue

                events = []
                for item in msg_list.children(control_type='ListItem')[-8:]:
                    content = (item.element_info.name or '').strip()
                    if not content or re.match(r'^\[.*\]$', content):
                        continue
                    if re.match(r'^(\d{1,2}:\d{2}|昨天|前天|\d+月\d+日)', content):
                        continue
                    events.append({
                        'content': content,
                        'inbound': self._is_detached_inbound_item(item, sender),
                    })

                last_outbound = -1
                for idx, event in enumerate(events):
                    if not event['inbound']:
                        last_outbound = idx

                candidates = [
                    event['content']
                    for event in events[last_outbound + 1:]
                    if event['inbound']
                ]
                if last_outbound == -1 and len(candidates) > 1:
                    candidates = candidates[-1:]

                for content in candidates:
                    if self._is_own_outgoing_preview(sender, content):
                        continue
                    key = self._cache_key(sender, 'detached', content)
                    if key in self._seen:
                        continue
                    self._seen.add(key)
                    results.append({'sender': sender, 'content': content})
            except Exception as e:
                warning(f'[WeChat] Detached window read failed "{sender}": {e}')

        return results

    def _is_repeated_preview(self, sender, content):
        """Debounce the same visible preview without blocking future repeats."""
        now = time.time()
        content = (content or '').strip()
        last_content, last_time = self._last_incoming_preview.get(sender, ('', 0))
        self._last_incoming_preview[sender] = (content, now)
        if content and content == last_content and now - last_time < 90:
            return True
        return False

    def _is_group_or_official(self, sender):
        group_keywords = [
            '\u7fa4', '\u7fa4\u804a', '\u5fae\u4fe1\u7fa4',
            '\u4ea4\u6d41\u7fa4', '\u5ba2\u6237\u7fa4',
            '\u7c89\u4e1d\u7fa4', 'VIP\u7fa4',
            'chatroom', '@chatroom', '\u8ba8\u8bba\u7ec4', '缇?', '绮変笣缇?',
        ]
        return any(kw in (sender or '') for kw in group_keywords)
    def _looks_like_group_item(self, item, sender, content):
        """Best-effort guard: group previews often expose member-name prefixes."""
        group_keywords = [
            '\u7fa4', '\u7fa4\u804a', '\u5fae\u4fe1\u7fa4',
            '\u4ea4\u6d41\u7fa4', '\u5ba2\u6237\u7fa4',
            '\u7c89\u4e1d\u7fa4', 'VIP\u7fa4',
            'chatroom', '@chatroom', '\u8ba8\u8bba\u7ec4',
            '缇?', '绮変笣缇?',
        ]
        if any(kw in (sender or '') for kw in group_keywords):
            return True

        prefix_match = re.match(r'^([^:\uff1a]{1,12})[:\uff1a]\s*\S+', content or '')
        if prefix_match:
            prefix = prefix_match.group(1)
            business_prefixes = [
                '\u62a5\u4ef7', '\u4ef7\u683c', '\u8d39\u7528',
                '\u9884\u7b97', '\u5c3a\u5bf8', '\u89c4\u683c',
                '\u6570\u91cf', '\u5730\u5740',
            ]
            if not any(word in prefix for word in business_prefixes):
                return True

        try:
            names = [
                (c.element_info.name or '').strip()
                for c in item.descendants()
                if (c.element_info.name or '').strip()
            ]
        except Exception:
            names = []

        joined = ' '.join(names)
        group_markers = [
            '\u7fa4\u516c\u544a', '\u7fa4\u804a',
            '\u7fa4\u6210\u5458', '\u67e5\u770b\u66f4\u591a\u7fa4\u6210\u5458',
            '@\u6240\u6709\u4eba',
        ]
        return any(marker in joined for marker in group_markers)
    def mark_outgoing_seen(self, sender, content):
        key = self._cache_key(sender, '', content)
        cached = self._outgoing_seen.setdefault(sender, set())
        cached.add(key)
        if len(cached) > 50:
            self._outgoing_seen[sender] = set(list(cached)[-50:])
        if not hasattr(self, '_seen'):
            self._seen = set()
        self._seen.add(key)

    def _is_own_outgoing_preview(self, sender, content):
        stripped = (content or '').strip()
        if not stripped:
            return True
        own_prefixes = ('\u6211:', '\u6211\uff1a', '\u6211\u53d1\u51fa:', '\u6211\u53d1\u51fa\uff1a', 'You:', 'You\uff1a')
        if stripped.startswith(own_prefixes):
            return True
        key = self._cache_key(sender, '', stripped)
        return key in self._outgoing_seen.get(sender, set())

    def _is_system_account(self, sender):
        """Skip system/service accounts that are not real customers."""
        system_keywords = [
            '腾讯新闻', '微信运动', '微信支付', '微信团队',
            '服务通知', '订阅号', '公众平台', '小程序',
            '腾讯客服', '微信收款', '京东', '美团',
        ]
        for kw in system_keywords:
            if kw in sender:
                return True
        return False

    def _is_recent_time(self, time_str):
        if not time_str:
            return False
        time_str = time_str.strip()
        if re.match(r'^\d{1,2}:\d{2}$', time_str):
            try:
                hour = int(time_str.split(':')[0])
                return 6 <= hour < 24
            except Exception:
                return False
        if '月' in time_str and '日' in time_str:
            return True
        return False

    def _extract_preview_text(self, item):
        sender = ''
        time_str = ''
        content = ''

        for child in item.descendants():
            ct = child.element_info.control_type
            nm = (child.element_info.name or '').strip()
            if not nm:
                continue

            is_time = False
            if ':' in nm and len(nm) <= 8 \
                    and all(c.isdigit() or c == ':' for c in nm):
                is_time = True
            elif '月' in nm and ('日' in nm or any(c.isdigit() for c in nm)):
                is_time = True

            if ct == 'Button' and not sender:
                sender = nm
            elif ct == 'Text':
                if not sender and len(nm) < 50:
                    sender = nm
                elif is_time and not time_str:
                    time_str = nm
                elif not is_time and nm != sender and len(nm) > len(content):
                    content = nm

        if '已置顶' in sender:
            sender = sender.replace('已置顶', '')

        return sender, time_str, content

    def get_new_messages(self):
        """Read new messages from the session list."""
        if not self.app:
            return []

        # Auto-detect disconnect every N polls (checked via _seen attr existence)
        if not self.is_connected():
            warning('[WeChat] Connection lost, attempting reconnect...')
            if not self.reconnect():
                return []

        try:
            # If WeChat window was minimized, restore it (without forcing foreground)
            try:
                self._restore_if_minimized()
            except Exception:
                pass

            sessions_list = self._find_session_list()
            if sessions_list is None:
                return []

            session_items = self._get_children_cached(sessions_list)
            results = []

            if not hasattr(self, '_seen'):
                self._seen = set()

            for item in session_items:
                if item.element_info.control_type != 'ListItem':
                    continue

                sender, time_str, content = self._extract_preview_text(item)
                if not sender or not content:
                    continue

                if self._is_group_or_official(sender) or self._looks_like_group_item(item, sender, content):
                    warning(f'[WeChat] Skipped group/official: "{sender[:30]}"')
                    continue

                if self._is_system_account(sender):
                    warning(f'[WeChat] Skipped system account: "{sender[:30]}"')
                    continue

                if re.match(r'^\[.*\]$', content):
                    continue

                if self._is_own_outgoing_preview(sender, content):
                    warning(f'[WeChat] Skipped own/outgoing preview: "{sender[:30]}"')
                    continue

                if not self._is_recent_time(time_str):
                    continue

                key = self._cache_key(sender, time_str, content)
                if key not in self._seen:
                    self._seen.add(key)
                    results.append({
                        'sender': sender,
                        'content': content,
                    })

            # Trim seen-cache to prevent unbounded memory growth
            if len(self._seen) > 500:
                self._seen = set(list(self._seen)[-500:])

            info(f'[WeChat] Parsed: {len(results)} new message(s)')
            detached_results = self._get_new_messages_from_chat_windows()
            if detached_results:
                info(f'[WeChat] Parsed detached: {len(detached_results)} new message(s)')
                results.extend(detached_results)
            return results

        except Exception as e:
            self._clear_ui_cache()
            warning(f'[WeChat] Read error, cache cleared: {e}')
            return []

    # ── Message Sending ───────────────────────────────────────────

    def send(self, text, who):
        """Send a text message to a contact with focus verification + retry."""
        if not self.app or not self._connected:
            warning('[WeChat] Cannot send: not connected.')
            return False

        if self._send_to_detached_window(text, who):
            self.record_reply(who)
            return True

        # Verify chat window before each send attempt
        switched = self.switch_to_contact(who)
        if not switched:
            warning(f'[WeChat] Could not switch to "{who}" for sending.')
            return False

        active_title = self._get_active_chat_title()
        if active_title and active_title != who:
            warning(f'[WeChat] Active title mismatch after switch: expected "{who}", got "{active_title}".')
            switched = self.switch_to_contact(who)
            if not switched:
                warning('[WeChat] Re-switch failed after title mismatch; will verify edit field before sending.')

        try:
            # Find current edit field (may have changed after window switch)
            self._edit_field_cache = None  # force re-find
            edit_field = self._get_edit_field()

            if edit_field:
                if not self._is_right_side_control(edit_field):
                    warning('[WeChat] Refusing to send: edit field is not in chat panel.')
                else:
                    # Paste full text instead of typing char-by-char; Chinese text and
                    # punctuation are much more reliable this way in WeChat.
                    for _ in range(3):
                        try:
                            edit_field.set_focus()
                            time.sleep(0.2)
                            if self._paste_and_enter(edit_field, text, who):
                                self.record_reply(who)
                                return True
                        except Exception:
                            time.sleep(0.3)
                            continue
                    warning('[WeChat] paste/send failed 3 tries, trying fallback...')
            else:
                warning('[WeChat] Edit field not found, trying fallback send...')

            if self._send_via_wxauto(text, who):
                self.record_reply(who)
                return True

            if self._send_via_api(text, who):
                self.record_reply(who)
                return True

            warning('[WeChat] All send methods failed.')
            return False

        except Exception as e:
            warning(f'[WeChat] Send error: {e}')
            return False

    def _send_to_detached_window(self, text, who):
        chat = self._find_chat_window(who)
        if chat is None:
            return False
        try:
            edit_field = None
            for ctrl in chat.descendants(control_type='Edit'):
                name = (ctrl.element_info.name or '').strip()
                if name == '输入' or name:
                    edit_field = ctrl
                    break
            if edit_field is None:
                return False

            if self._paste_and_enter_detached(edit_field, text):
                info(f'[WeChat] Sent via detached chat window: "{who}"')
                return True
        except Exception as e:
            warning(f'[WeChat] Detached send failed "{who}": {e}')
        return False

    def _set_clipboard_text(self, text):
        """Set Windows clipboard text, returning previous text when available."""
        import win32clipboard
        previous = None
        try:
            win32clipboard.OpenClipboard()
            try:
                if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT):
                    previous = win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT)
            except Exception:
                previous = None
            win32clipboard.EmptyClipboard()
            win32clipboard.SetClipboardData(win32clipboard.CF_UNICODETEXT, text)
        finally:
            win32clipboard.CloseClipboard()
        return previous

    def _restore_clipboard_text(self, text):
        if text is None:
            return
        try:
            import win32clipboard
            win32clipboard.OpenClipboard()
            win32clipboard.EmptyClipboard()
            win32clipboard.SetClipboardData(win32clipboard.CF_UNICODETEXT, text)
            win32clipboard.CloseClipboard()
        except Exception:
            pass

    def _paste_and_enter(self, edit_field, text, who):
        from pywinauto.keyboard import send_keys
        previous_clipboard = self._set_clipboard_text(text)
        try:
            edit_field.set_focus()
            time.sleep(0.1)
            send_keys('^a{BACKSPACE}')
            time.sleep(0.1)
            send_keys('^v')
            time.sleep(0.2)
            if not self._current_chat_matches(who):
                warning(f'[WeChat] Active chat may not match "{who}" before Enter; proceeding because edit field is in chat panel.')
            send_keys('{ENTER}')
            time.sleep(0.2)
            return True
        finally:
            self._restore_clipboard_text(previous_clipboard)

    def _paste_and_enter_detached(self, edit_field, text):
        from pywinauto.keyboard import send_keys
        previous_clipboard = self._set_clipboard_text(text)
        try:
            edit_field.set_focus()
            time.sleep(0.1)
            send_keys('^a{BACKSPACE}')
            time.sleep(0.1)
            send_keys('^v')
            time.sleep(0.2)
            send_keys('{ENTER}')
            time.sleep(0.2)
            return True
        finally:
            self._restore_clipboard_text(previous_clipboard)

    def _send_via_wxauto(self, text, who):
        try:
            from wxauto import WeChat
        except ImportError:
            return False

        try:
            wx = WeChat()
            wx.SwitchToContact(who)
            send_fn = getattr(wx, 'SendMsg', None)
            if not callable(send_fn):
                warning('[WeChat] wxauto fallback missing SendMsg method.')
                return False
            send_fn(text)
            time.sleep(0.5)
            return True
        except Exception as e:
            warning(f'[WeChat] wxauto fallback failed: {e}')
            return False

    def _send_via_api(self, target_text, _who):
        """Fallback send via SendMessageW to WeChat main window."""
        try:
            import win32con
            user32 = ctypes.windll.user32
            hwnds = []

            def cb(hwnd, results):
                try:
                    if GetClassName(hwnd) == 'WeChatMainWndForPC':
                        results.append(hwnd)
                except Exception:
                    pass
                return True

            EnumWindows(cb, hwnds)
            if not hwnds:
                return False

            # Bring WeChat to foreground and type into it
            target_hwnd = hwnds[0]
            user32.SetForegroundWindow(target_hwnd)
            time.sleep(0.3)

            # Type characters one by one via WM_CHAR
            for ch in target_text:
                vk_code = ord(ch)
                user32.SendMessageW(target_hwnd, win32con.WM_CHAR, vk_code, 0)
                time.sleep(0.005)

            # Simulate Enter press
            user32.SendMessageW(target_hwnd, win32con.WM_KEYDOWN, 13, 0)
            time.sleep(0.05)
            user32.SendMessageW(target_hwnd, win32con.WM_KEYUP, 13, 0)

            return True
        except Exception as e:
            warning(f'[WeChat] Send-API fallback error: {e}')
            return False

    # ── Contact Management ────────────────────────────────────────

    def can_reply(self, contact_name):
        # Anti-flood delay is disabled: always allow replies.
        return True

    def record_reply(self, contact_name):
        self.last_reply_time[contact_name] = time.time()
        count = self.daily_count.get(contact_name, 0) + 1
        self.daily_count[contact_name] = count

    def switch_to_contact(self, name):
        """Switch to a specific contact's chat window by clicking session list."""
        if not self.app or not self._connected:
            return False
        try:
            sessions_list = self._find_session_list()
            if sessions_list is None:
                return False

            session_items = self._get_children_cached(sessions_list)
            for item in session_items:
                if item.element_info.control_type != 'ListItem':
                    continue
                sender, _, _ = self._extract_preview_text(item)
                if sender == name:
                    # Find Button in descendants (child_window not available on ListItemWrapper)
                    btn = None
                    for desc in item.descendants():
                        if desc.element_info.control_type == 'Button':
                            btn = desc
                            break
                    if btn is None:
                        # Fallback: try clicking the item itself
                        try:
                            item.click_input()
                            time.sleep(0.8)
                            if self._switch_verified(item, name):
                                return True
                            return False
                        except Exception:
                            break
                    try:
                        btn.click_input()
                        time.sleep(0.8)
                        if self._switch_verified(item, name):
                            return True
                        return False
                    except Exception:
                        try:
                            btn.click()
                            time.sleep(0.8)
                            if self._switch_verified(item, name):
                                return True
                            return False
                        except Exception:
                            break

            warning(f'[WeChat] Contact "{name}" not found in session list')
            return False
        except Exception as e:
            self._clear_ui_cache()
            warning(f'[WeChat] Switch error: {e}')
            return False

    def _switch_verified(self, item, name):
        active_title = self._get_active_chat_title()
        if active_title == name or self._is_selected_session_item(item):
            return True
        edit_field = self._get_edit_field()
        if edit_field is not None and self._is_right_side_control(edit_field):
            warning(
                f'[WeChat] Title check mismatch for "{name}", active title="{active_title}", '
                'but chat edit field is available; proceeding.'
            )
            return True
        warning(f'[WeChat] Switch verification failed for "{name}"; active title="{active_title}".')
        return False

    def send_image(self, image_path, who):
        """Send an image file via wxauto fallback."""
        try:
            import os
            if not os.path.exists(image_path):
                warning(f'[WeChat] Image not found: {image_path}')
                return False

            try:
                from wxauto import WeChat
                wx = WeChat()
                wx.SwitchToContact(who)
                wx.SendFiles(image_path)
                self.record_reply(who)
                return True
            except ImportError:
                pass

            warning('[WeChat] No image sending method available')
            return False
        except Exception as e:
            warning(f'[WeChat] Send image error: {e}')
            return False

    def get_friends(self):
        """Get list of contact names from session list."""
        if not self.app or not self._connected:
            return []
        try:
            result = []
            sessions_list = self._find_session_list()
            if sessions_list is None:
                return []
            for item in self._get_children_cached(sessions_list):
                if item.element_info.control_type != 'ListItem':
                    continue
                sender, _, _ = self._extract_preview_text(item)
                if sender:
                    result.append(sender)
            return result
        except Exception:
            return []
