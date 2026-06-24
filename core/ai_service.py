"""AI service with pluggable provider routing and fallback."""

import os
import re
import sys
import time

from .logger import info, warning
from .paths import resource_path


def get_resource_path(relative_path: str) -> str:
    return resource_path(relative_path)


class AIError(Exception):
    pass


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
        self.base_url = config["base_url"].rstrip("/")
        self.api_key = config.get("api_key", "")
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}" if self.api_key else "",
        }
        self.request_format = config.get("request_format", "openai")
        self.custom_template = config.get("custom_request_template", {})
        self.timeout = config.get("timeout_seconds", 15)
        self.model = config.get("model", "gpt-4o-mini")
        self.temperature = config.get("temperature", 0.7)
        self.max_tokens = config.get("max_tokens", 300)
        self.api_endpoint = config.get("api_endpoint", "/chat/completions")

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
        self.config = config
        self.providers = {}
        self.primary = None
        self.fallback_chain = []
        self.disabled = not config.get("enabled", True)
        self.timeout = config.get("timeout_seconds", 15)
        self.max_retries = config.get("max_retries", 2)

        self._init_providers()

    def _init_providers(self):
        providers_config = self.config.get("providers", {})
        for name, provider_cfg in providers_config.items():
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

        self.primary = self.config.get("primary")
        self.fallback_chain = self.config.get("fallback_chain", [])

    def chat(self, messages: list[dict]) -> str:
        if self.disabled or not self.providers:
            raise AIError("所有 AI 引擎均未启用或未配置")

        attempt_order = [self.primary] + self.fallback_chain
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
    def __init__(self, settings_path="config/settings.yaml", prompts_path="config/prompts.yaml"):
        import yaml
        settings_path = get_resource_path(settings_path)
        prompts_path = get_resource_path(prompts_path)
        info(f"[Config] AI settings: {settings_path}")
        info(f"[Config] AI prompts: {prompts_path}")
        with open(settings_path, encoding="utf-8") as f:
            self.settings = yaml.safe_load(f)
        with open(prompts_path, encoding="utf-8") as f:
            self.prompts = yaml.safe_load(f)

        self.router = AIServiceRouter(self.settings["ai_engine"])
        self.prompt_key = self.settings.get("ai_engine", {}).get("prompt_key", "meiyi_system")
        self.system_prompt = self.prompts.get(self.prompt_key, self.prompts.get("meiyi_system", ""))
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
            system_prompt = (
                f"{system_prompt}\n\n"
                "可用业务知识如下。回答必须优先依据这些知识，不确定时引导客户补充信息或转人工：\n"
                f"{retrieved_context}"
            )

        messages = [{"role": "system", "content": system_prompt}]
        if history:
            messages.extend(history[-6:])
        messages.append({"role": "user", "content": user_message})

        reply = self.router.chat(messages)
        reply = self._clean_reply(reply)
        if not reply:
            raise AIError("AI returned empty reply after cleanup")

        if "已为您转接人工客服" in reply[:30] or "转人工" in reply[:20]:
            return "已为您转接人工客服，请稍等。", "transfer_human"

        if len(reply) > 200:
            reply = self._truncate_reply(reply, 200)

        return reply, "normal"

    def _clean_reply(self, reply: str) -> str:
        text = (reply or "").split("<think>")[0]
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
