"""AI service with pluggable provider routing and fallback."""

import os
import re
import sys
import time

import yaml

from .logger import info, warning
from .paths import resource_path


def get_resource_path(relative_path: str) -> str:
    return resource_path(relative_path)


class AIError(Exception):
    pass


def _safe_int(value, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _load_yaml_dict(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    except (FileNotFoundError, yaml.YAMLError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data


# ========== Base class: all AI backends implement this interface ==========
class AIBackend:
    @property
    def engine_name(self) -> str:
        return "base"

    def chat(self, messages: list[dict]) -> str:
        raise NotImplementedError

    def health_check(self) -> bool:
        try:
            self.chat([{"role": "user", "content": "ping"}])
            return True
        except Exception:
            return False


# ========== OpenAI-compatible SDK backend ==========
class OpenAIService(AIBackend):
    @property
    def engine_name(self):
        return "openai"

    def __init__(self, config: dict):
        from openai import OpenAI
        self.client = OpenAI(
            api_key=config["api_key"],
            base_url=config["base_url"],
        )
        self.model = config["model"]
        self.temperature = config.get("temperature", 0.7)
        self.max_tokens = config.get("max_tokens", 300)
        self.timeout = config.get("timeout_seconds", 15)

    def chat(self, messages):
        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            timeout=self.timeout,
        )
        return response.choices[0].message.content


# ========== Zhipu GLM backend ==========
class ZhipuService(AIBackend):
    @property
    def engine_name(self):
        return "zhipu"

    def __init__(self, config: dict):
        from zhipuai import ZhipuAI
        self.client = ZhipuAI(api_key=config["api_key"])
        self.model = config["model"]
        self.temperature = config.get("temperature", 0.7)
        self.max_tokens = config.get("max_tokens", 300)

    def chat(self, messages):
        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=self.temperature,
            top_p=0.7,
        )
        return response.choices[0].message.content


# ========== DeepSeek backend ==========
class DeepSeekService(AIBackend):
    @property
    def engine_name(self):
        return "deepseek"

    def __init__(self, config: dict):
        from openai import OpenAI
        self.client = OpenAI(
            api_key=config["api_key"],
            base_url=config["base_url"],
        )
        self.model = config["model"]
        self.temperature = config.get("temperature", 0.7)
        self.max_tokens = config.get("max_tokens", 300)

    def chat(self, messages):
        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )
        return response.choices[0].message.content


# ========== Generic OpenAI-compatible HTTP backend ==========
class GenericHTTPService(AIBackend):
    @property
    def engine_name(self):
        return f"custom({self.request_format})"

    def __init__(self, config: dict):
        import requests
        self.http = requests
        self.base_url = str(config.get("base_url") or "").rstrip("/")
        self.api_key = str(config.get("api_key") or "")
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}" if self.api_key else "",
        }
        self.request_format = str(config.get("request_format") or "openai")
        self.custom_template = config.get("custom_request_template", {})
        if not isinstance(self.custom_template, dict):
            self.custom_template = {}
        self.timeout = _safe_int(config.get("timeout_seconds"), 15)
        self.model = str(config.get("model") or "gpt-4o-mini")
        self.temperature = config.get("temperature", 0.7)
        self.max_tokens = config.get("max_tokens", 300)
        self.api_endpoint = str(config.get("api_endpoint") or "/chat/completions")

    def _build_request_body(self, messages):
        body = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }
        return body

    def _parse_response(self, resp_json):
        return resp_json["choices"][0]["message"]["content"]

    def chat(self, messages):
        body = self._build_request_body(messages)
        url = self.base_url.rstrip("/") + self.api_endpoint
        resp = self.http.post(
            url, headers=self.headers, json=body, timeout=self.timeout
        )
        resp.raise_for_status()
        resp.encoding = 'utf-8'
        return self._parse_response(resp.json())


# ========== AI backend registry ==========
BACKEND_REGISTRY = {
    "openai": OpenAIService,
    "zhipu": ZhipuService,
    "deepseek": DeepSeekService,
}


# ========== 璺敱鍣細閫夊紩鎿?+ 鑷姩闄嶇骇 ==========
class AIServiceRouter:
    def __init__(self, config: dict):
        self.config = config if isinstance(config, dict) else {"enabled": False}
        self.providers = {}
        self.primary = None
        self.fallback_chain = []
        self.disabled = not self.config.get("enabled", True)
        self.timeout = _safe_int(self.config.get("timeout_seconds"), 15)
        self.max_retries = max(0, _safe_int(self.config.get("max_retries"), 2))

        self._init_providers()

    def _init_providers(self):
        providers_config = self.config.get("providers", {})
        if not isinstance(providers_config, dict):
            providers_config = {}
        for name, provider_cfg in providers_config.items():
            name = str(name or "").strip()
            if not name or not isinstance(provider_cfg, dict):
                warning(f"[AI] Invalid provider config for '{name or 'unknown'}', skipping.")
                continue
            if not provider_cfg.get("enabled", False):
                continue

            expanded = {}
            for k, v in provider_cfg.items():
                if isinstance(v, str):
                    expanded[k] = os.path.expandvars(v)
                    # Keep placeholder if env var not set (won't pass empty string)
                    if expanded[k] == "":
                        expanded[k] = v
                else:
                    expanded[k] = v

            # Validate required fields after expansion
            api_key = expanded.get("api_key", "")
            if not api_key or "${" in api_key:
                warning(f"[AI] Provider '{name}' has no valid api_key, skipping.")
                continue

            backend_cls = BACKEND_REGISTRY.get(name)
            if backend_cls is None and (
                name.startswith("custom_api")
                or expanded.get("request_format", "openai") == "openai"
            ):
                backend_cls = GenericHTTPService

            if backend_cls is None:
                warning(f"[AI] Unregistered engine type: {name}, skipping")
                continue

            try:
                self.providers[name] = backend_cls(expanded)
            except Exception as e:
                warning(f"[AI] Failed to initialize engine {name}: {e}")

        primary = self.config.get("primary")
        self.primary = str(primary).strip() if primary else None
        fallback_chain = self.config.get("fallback_chain", [])
        self.fallback_chain = (
            [str(item).strip() for item in fallback_chain if str(item).strip()]
            if isinstance(fallback_chain, list)
            else []
        )

    def chat(self, messages: list[dict]) -> str:
        if self.disabled or not self.providers:
            raise AIError("所有 AI 引擎均未启用或未配置")

        attempt_order = ([self.primary] if self.primary else []) + self.fallback_chain
        attempt_order = [e for e in attempt_order if e in self.providers]

        if not attempt_order:
            attempt_order = list(self.providers.keys())

        last_error = None
        for engine_name in attempt_order:
            backend = self.providers[engine_name]

            for retry in range(self.max_retries + 1):
                try:
                    start = time.time()
                    result = backend.chat(messages)
                    elapsed = round(time.time() - start, 2)
                    info(f"[AI] OK {engine_name} success ({elapsed}s), retries={retry}")
                    return result.strip()
                except Exception as e:
                    last_error = str(e)
                    warning(f"[AI] FAIL {engine_name} (attempt {retry+1}): {e}")
                    if retry < self.max_retries:
                        time.sleep(1 * (retry + 1))

            warning(f"[AI] All retries exhausted for {engine_name}, switching")

        raise AIError(f"所有 AI 引擎均失败: {last_error}")

    def get_status(self) -> dict:
        status = {}
        for name, backend in self.providers.items():
            available = backend.health_check()
            status[name] = {
                "available": available,
                "is_primary": name == self.primary,
                "in_fallback_chain": name in self.fallback_chain,
                "engine_name": backend.engine_name,
                "model": getattr(backend, "model", ""),
            }
        return status


# ========== 闂ㄩ潰绫伙細瀵瑰缁熶竴鍏ュ彛 ==========
class AIService:
    MAX_HISTORY_MESSAGES = 12
    RECENT_HISTORY_MESSAGES = 6
    MAX_HISTORY_CHARS = 3600
    MAX_RETRIEVED_CONTEXT_CHARS = 2500
    MAX_SINGLE_HISTORY_MESSAGE_CHARS = 900
    REQUEST_SUMMARY_MAX_CHARS = 1200

    def __init__(self, settings_path="config/settings.yaml", prompts_path="config/prompts.yaml"):
        settings_path = get_resource_path(settings_path)
        prompts_path = get_resource_path(prompts_path)
        info(f"[Config] AI settings: {settings_path}")
        info(f"[Config] AI prompts: {prompts_path}")
        self.settings = _load_yaml_dict(settings_path)
        self.prompts = _load_yaml_dict(prompts_path)

        ai_config = (
            self.settings.get("ai_engine")
            if isinstance(self.settings.get("ai_engine"), dict)
            else {}
        )
        self.router = AIServiceRouter(ai_config if ai_config else {"enabled": False})
        self.prompt_key = str(ai_config.get("prompt_key") or "meiyi_system")
        system_prompt = self.prompts.get(self.prompt_key)
        if not isinstance(system_prompt, str):
            system_prompt = self.prompts.get("meiyi_system", "")
        self.system_prompt = system_prompt if isinstance(system_prompt, str) else ""
        info(f"[AI] Using prompt skill: {self.prompt_key}")

    def generate_reply(
        self,
        user_message: str,
        history: list[dict] = None,
        retrieved_context: str = "",
    ) -> tuple:
        """Generate a customer-facing reply.

        Returns: (reply_text, reply_type), where reply_type is
        "normal" or "transfer_human".
        """
        if self.router.disabled or not self.router.providers:
            raise AIError("AI engine is unavailable; check provider config.")

        system_prompt = self.system_prompt
        if retrieved_context:
            retrieved_context = self._compact_text(
                retrieved_context,
                self.MAX_RETRIEVED_CONTEXT_CHARS,
            )
            system_prompt = (
                f"{system_prompt}\n\n"
                "可用业务知识如下。回答必须优先依据这些知识，不确定时引导客户补充信息或转人工：\n"
                f"{retrieved_context}"
            )

        messages = [{"role": "system", "content": system_prompt}]
        if history:
            messages.extend(self._prepare_history(history))
        messages.append({"role": "user", "content": user_message})

        try:
            reply = self.router.chat(messages)
        except AIError as exc:
            if history and self._is_context_capacity_error(str(exc)):
                warning("[AI] Context capacity error; retrying with compressed history.")
                retry_messages = [{"role": "system", "content": system_prompt}]
                retry_messages.extend(self._prepare_history(history, force=True))
                retry_messages.append({"role": "user", "content": user_message})
                reply = self.router.chat(retry_messages)
            else:
                raise
        reply = self._clean_reply(reply)
        if not reply:
            raise AIError("AI returned empty reply after cleanup")

        if "已为您转接人工客服" in reply[:30] or "转人工" in reply[:20]:
            return "已为您转接人工客服，请稍等。", "transfer_human"

        if len(reply) > 200:
            reply = self._truncate_reply(reply, 200)

        return reply, "normal"

    def _prepare_history(self, history, force=False):
        prepared = []
        message_limit = 300 if force else self.MAX_SINGLE_HISTORY_MESSAGE_CHARS
        for message in history or []:
            if not isinstance(message, dict):
                continue
            role = str(message.get("role", "")).strip()
            if role not in {"system", "user", "assistant"}:
                continue
            content = self._compact_text(
                message.get("content", ""),
                message_limit,
            )
            if content:
                prepared.append({"role": role, "content": content})

        if not prepared:
            return []

        max_chars = self.MAX_HISTORY_CHARS // 2 if force else self.MAX_HISTORY_CHARS
        max_recent = 2 if force else self.RECENT_HISTORY_MESSAGES
        if (
            not force
            and len(prepared) <= self.MAX_HISTORY_MESSAGES
            and self._messages_chars(prepared) <= max_chars
        ):
            return prepared

        recent = prepared[-max_recent:]
        older = prepared[:-max_recent]
        summary = self._summarize_history_for_request(older)
        result = []
        if summary:
            result.append({"role": "system", "content": summary})
        result.extend(recent)
        return result

    def _summarize_history_for_request(self, history):
        if not history:
            return ""
        labels = {
            "system": "Context",
            "user": "Customer",
            "assistant": "Support",
        }
        lines = []
        for message in history:
            content = self._compact_text(message.get("content", ""), 180)
            if content:
                lines.append(f"{labels.get(message.get('role'), 'Message')}: {content}")

        summary = "\n".join(lines)
        if len(summary) <= self.REQUEST_SUMMARY_MAX_CHARS:
            return "Compressed previous conversation:\n" + summary

        kept = []
        total = len("Compressed previous conversation; older details omitted.")
        for line in reversed(summary.splitlines()):
            size = len(line) + 1
            if kept and total + size > self.REQUEST_SUMMARY_MAX_CHARS:
                break
            kept.append(line)
            total += size
        return (
            "Compressed previous conversation; older details omitted.\n"
            + "\n".join(reversed(kept))
        )

    def _messages_chars(self, messages):
        return sum(
            len(str(message.get("role", ""))) + len(str(message.get("content", "")))
            for message in messages
            if isinstance(message, dict)
        )

    def _compact_text(self, text, limit):
        limit = max(0, _safe_int(limit, 0))
        value = re.sub(r"\s+", " ", str(text or "").strip())
        if not limit:
            return ""
        if len(value) <= limit:
            return value
        head = max(1, limit // 2 - 2)
        tail = max(1, limit - head - 5)
        return f"{value[:head]} ... {value[-tail:]}"

    def _is_context_capacity_error(self, message):
        text = str(message or "").lower()
        markers = (
            "context",
            "token",
            "tokens",
            "maximum context",
            "context_length_exceeded",
            "cache",
            "kv cache",
            "prompt is too long",
            "too many",
        )
        return any(marker in text for marker in markers)

    def _clean_reply(self, reply: str) -> str:
        text = str(reply or "").split("<think>")[0]
        text = re.sub(r"<think>.*?</think>", "", text, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r"<think>.*", "", text, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r"<[^>]+>", "", text).strip()
        text = text.replace("\r\n", "\n")
        text = re.sub(r"\s+", " ", text).strip()
        return text

    def _truncate_reply(self, text: str, max_len: int) -> str:
        marks = "。！？!?；;"
        cut = max(text.rfind(mark, 0, max_len) for mark in marks)
        if cut > 40:
            return text[:cut + 1].strip()
        return text[:max_len].rstrip("，,、；; ") + "。"

    def check_health(self) -> dict:
        status = self.router.get_status()
        status["ai_prompt_key"] = self.prompt_key
        return status
