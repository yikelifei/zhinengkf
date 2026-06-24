# 企业定制礼盒智能客服系统 — 实施计划

---

## 一、业务场景

公司主营业务：**企业定制小礼物/礼盒**（如端午节礼盒、中秋月饼礼盒、新年礼包等）

### 客户旅程

```
小红书看到精美礼盒图文 → 私信→加到微信 → 详细咨询
                                                │
                                    ┌───────────┴─────────────┐
                                    ▼                         ▼
                              问价格/起订量              要更多图片/案例
                              问定制细节                表达合作意向
                                    │
                                    ▼
                            提供定制方案
                                │
                  ┌─────────────┼─────────────┐
                  ▼             ▼             ▼
              贺卡设计       腰封设计      吊牌设计
              (企业LOGO)    (品牌文案)    (产品标签)
                  │             │             │
                  └─────────────┼─────────────┘
                              ▼
                        设计稿给客户确认
                              │
                              ▼
                   确认后打样 → 批量生产
                              │
                              ▼
                          发货交付
```

### 核心问题
- 人工客服响应慢，错过黄金时段（午休、下班后、深夜客户常来问）
- 同样的问题每天重复回答几十遍（价格、起订量、定制流程）
- 线索容易遗漏，不知道哪些客户真的想下单
- 新来的客服话术不专业，转化率差

### 本系统解决
- **秒回**客户常见问题，不等排队
- **引导留资**（手机号/微信号/公司名），不漏掉任何一个意向客户
- **标准化话术**，每次回复都专业得体
- **完整记录**每条线索和沟通历史

---

## 二、开源项目调研

| 项目名称 | 地址 | Stars | 说明 | 利用方式 |
|---------|------|-------|------|---------|
| **wxauto** | [github.com/cluic/wxauto](https://github.com/cluic/wxauto) | ~7k | Windows版微信自动化核心库，UIAutomation方案 | ✅ 消息收发基座 |
| **WeChatBot_WXAUTO_SE** | [github.com/iwyxdxl/WeChatBot_WXAUTO_SE](https://github.com/iwyxdxl/WeChatBot_WXAUTO_SE) | - | LLM自动回复，支持多用户/群聊 | ⚙️ 混合回复逻辑参考 |
| **WeMai (MaiBot)** | [github.com/Angela459/WeMai](https://github.com/Angela459/WeMai) | - | wxauto上的自动回复Bot | ⚙️ 架构借鉴 |
| **wxauto-mcp** | [github.com/cluic/wxauto-mcp](https://github.com/cluic/wxauto-mcp) | 新上 | MCP协议，AI工具对接 | 📖 思路参考 |

### 结论
无现成匹配「礼盒定制」场景的项目。以 **wxauto 为基座** + **WeChatBot 的意图分类+混合回复逻辑**，按礼盒定制业务流程深度定制开发。

---

## 三、技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      PC 微信客户端（已登录）                       │
└──────────┬──────────────────────────────────────────────────────┘
           │ UI Automation (wxauto)，只读消息+发送回复
┌──────────▼──────────────────────────────────────────────────────┐
│                    智能客服主程序                                  │
│                                                                  │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ 消息监听器 │→│ 意图分类器 │→│  路由决策  │→│  回复执行器    │  │
│  │          │  │           │  │          │  │               │  │
│  │GetMsg()  │  │精确关键词  │  │明确意图  │  │ 规则→模板回复  │  │
│  │去重+轮询  │  │模糊语义   │  │模糊意图  │  │ 不确定→AI生成  │  │
│  │60s防刷屏 │  │AI兜底判断 │  │AI兜底    │  │ 转人工→告警    │  │
│  └──────────┘  └───────────┘  └──────────┘  └───────────────┘  │
│                                                                  │
│  ┌────────────────── 数据层 ──────────────────┐                 │
│  │  SQLite → conversations / messages / leads │                 │
│  │  YAML → keywords.yaml / templates.yaml / prompts.yaml            │
│  └────────────────────────────────────────────┘                 │
└──────────────────────────────────────────────────────────────────┘
```

### 依赖
```
Python 3.9+
├── wxauto v3.9        # 微信消息收发
├── openai             # OpenAI / DeepSeek / 通用兼容接口
├── zhipuai            # 智谱 bigmodel
├── pyyaml             # 配置文件解析
├── apscheduler        # 定时跟进任务
├── requests           # 自定义API调用
├── sqlite3            # 内置数据库
└── colorama           # 彩色日志
```

---

## 四、目录结构

```
zhinengkefu/
├── config/
│   ├── settings.yaml          # API密钥/轮询间隔/黑白名单/风控阈值
│   ├── keywords.yaml          # 关键词库（含优先级/话术ID映射）
│   ├── templates.yaml         # 礼盒话术模板库（节日/品类/定制项）
│   └── prompts.yaml           # AI提示词（人设/边界/禁止行为）
├── core/
│   ├── __init__.py
│   ├── wechat.py              # 微信接入层（封装wxauto）
│   ├── intent_classifier.py   # 意图分类器（三级漏斗）
│   ├── rule_engine.py         # 规则引擎（关键词→话术→回复）
│   ├── ai_service.py          # AI服务（LLM调用+安全过滤）
│   ├── template_renderer.py   # 话术模板渲染（{{变量}}注入）
│   ├── conversation.py        # 会话管理（上下文/阶段跟踪）
│   └── database.py            # SQLite CRUD
├── data/
│   └── kefu.db                # 运行时数据库
├── assets/
│   └── sample_images/         # 礼盒展示图（按节日分类）
├── logs/
│   └── bot.log
├── scripts/
│   └── main.py                # 启动入口
├── tests/
│   └── test_intent.py
├── requirements.txt
└── README.md
```

---

## 五、功能模块详细设计

### 5.1 消息监听 (`wechat.py`)

```python
from wxauto import WeChat
import time

class ChatListener:
    def __init__(self, poll_interval=3, anti_flood_seconds=60):
        self.wx = WeChat()
        self.seen_messages = set()
        self.poll_interval = poll_interval
        self.last_reply_time = {}       # {contact_name: last_reply_timestamp}
        self.anti_flood_seconds = anti_flood_seconds

    def get_new_messages(self):
        """获取未处理的新消息，含去重"""
        msgs = self.wx.GetMsg()
        new = []
        for msg in msgs:
            content = msg.get('content', '').strip()
            if not content or len(content) < 1:
                continue
            msg_key = f"{msg['sender']}_{msg['time']}_{hash(content[:80])}"
            if msg_key not in self.seen_messages:
                self.seen_messages.add(msg_key)
                new.append({
                    'sender': msg['sender'],
                    'content': content,
                    'time': msg.get('time', ''),
                })
        return new

    def can_reply(self, contact_name):
        """防刷屏检查：同一联系人60秒内最多回复1次"""
        now = time.time()
        last = self.last_reply_time.get(contact_name, 0)
        return (now - last) >= self.anti_flood_seconds

    def record_reply(self, contact_name):
        self.last_reply_time[contact_name] = time.time()

    def send(self, text, who):
        self.wx.SendMsg(text, who=who)
        self.record_reply(who)
```

### 5.2 意图分类器 (`intent_classifier.py`)

三级漏斗式分类，逐级降级：

```
用户消息
  │
  ├─ Level 1: 精确关键词匹配（Trie树，O(m)复杂度）
  │    命中 → 返回意图ID + 对应话术
  │    未命中 → 进入 Level 2
  │
  ├─ Level 2: 模糊匹配（同义词库 + 编辑距离≤1）
  │    命中 → 返回意图ID + 对应话术
  │    未命中 → 进入 Level 3
  │
  └─ Level 3: AI意图判断
       将消息+最近3轮上下文发给AI，让AI返回意图ID
```

**预定义意图清单（礼盒定制场景）：**

| 意图ID | 意图名 | 触发条件 | 处理方式 |
|--------|--------|----------|----------|
| `welcome` | 首次欢迎 | 新会话第一条消息 | 主动发送欢迎语 |
| `greeting` | 打招呼 | "你好""在吗"等 | 规则回复 + 引导提问 |
| `product_catalog` | 看产品图册 | "有什么样的盒子""发点图片" | 推送节日产品图册 |
| `price` | 询价 | "多少钱""什么价位" | 规则回复报价区间 |
| `min_order` | 起订量 | "最少做多少""起定量" | 规则回复起订量 |
| `custom_detail` | 定制详情 | "怎么定制""能印logo吗" | 讲解定制流程 |
| `design_item` | 指定定制项 | "贺卡""腰封""吊牌""丝带" | 推送该项定制详情 |
| `process` | 定制流程 | "怎么做""流程是怎样的" | 讲解全流程 |
| `timeline` | 交期 | "多久能做""什么时候要" | 规则回复交期 |
| `sample` | 看样品/案例 | "有样品吗""看看之前的" | 推送案例图 |
| `comparison` | 竞品比较 | "跟XX家比怎么样" | 突出自身优势 |
| `quality` | 质量顾虑 | "质量好不好的""会不会破损" | 材料说明+案例背书 |
| `order_confirm` | 确定要买 | "想要""给我订一批""怎么下单" | 收集信息→创建订单→转人工 |
| `vague` | 未知意图 | 以上均未命中 | AI兜底回复 |
| `transfer_human` | 转人工 | "找人工""太复杂了要电话" | 立即通知运营 |

### 5.3 规则引擎 (`rule_engine.py`)

```python
class RuleEngine:
    """关键词→话术模板→回复，带优先级排序"""

    def match(self, message_text):
        """
        返回 (intent_id, reply_text) 或 (None, None)
        """
        candidates = []
        for intent_id, rule in self.keywords.items():
            for kw in rule['keywords']:
                if kw in message_text:
                    priority = rule.get('priority', 0)
                    candidates.append((priority, intent_id, rule))

        # 按优先级降序排列，取最高分
        if not candidates:
            return None, None

        candidates.sort(key=lambda x: x[0], reverse=True)
        _, intent_id, rule = candidates[0]

        template = rule['reply_template']
        reply = render_template(template, {'message': message_text})

        return intent_id, reply
```

### 5.4 AI 服务 — 多引擎可插拔架构 (`ai_service.py`)

#### 架构设计

```
                  ai_service.py (门面)
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    OpenAIService   ZhipuService   DeepSeekService
          │            │             │
     openai SDK   zhipuai SDK   http请求(通用兼容OpenAI格式)
          │            │             │
          └────────────┼────────────┘
                       ▼
              AIServiceRouter (路由器)
                       │
          ┌────────────┼───────────────┐
          ▼            ▼               ▼
     主引擎在线?   健康检查失败      全部失败?
     Yes → 转发     No → 自动降级   fallback→本地模板
```

**核心思路：**
- `ai_service.py` 是门面，不直接调用某个厂商API
- 每个AI厂商封装为一个独立的 Service 类，统一接口 `chat(messages)` → `str`
- `AIServiceRouter` 负责选哪个引擎、失败后降级到哪个备用引擎
- **新增任意AI接口只需3步**（见第13节扩展指南）

#### 配置方式（开箱即用，直接填你的API Key）

```yaml
# config/settings.yaml — AI引擎配置
# ╔══════════════════════════════════════════════════╗
# ║ 使用说明：                                          ║
# ║ 1. 把 api_key 里的 "YOUR_XXX_KEY" 替换为你的真实密钥   ║
# ║ 2. enabled: true/false 控制是否启用该引擎              ║
# ║ 3. primary 设置为主引擎（第一个被调用）                  ║
# ║ 4. fallback_chain 是降级链，主引擎挂了自动切下一个        ║
# ║ 5. custom_api_1 / custom_api_2 留给其他接口，按需开启    ║
# ╚══════════════════════════════════════════════════╝

ai_engine:
  enabled: true                    # 总开关
  primary: openai                  # ★ 首选引擎
  fallback_chain:                  # ★ 降级顺序（从上到下）
    - zhipu
    - deepseek
    - custom_api_1                 # 可改为其他已启用的引擎名
  timeout_seconds: 15              # 单个请求超时(秒)
  max_retries: 2                   # 失败重试次数

  # ────────── 各AI接口完整配置 ──────────
  providers:

    # ══════ ① OpenAI（GPT系列） ══════
    openai:
      enabled: true                # ★ 打开/关闭这个引擎
      api_key: "sk-your-openai-key-here"    # ← 在这里填你的 Key
      base_url: "https://api.openai.com/v1" # ← 如果用的是代理或第三方中转站，改这里
      model: "gpt-4o-mini"         # 模型名：gpt-4o-mini / gpt-4o
      temperature: 0.7
      max_tokens: 300

    # ══════ ② 智谱 GLM（国产免费） ══════
    zhipu:
      enabled: true                # ★ 建议测试期主力，免费额度很大
      api_key: "your-zhipu-api-key-here"    # ← 在这里填你的 Key
      base_url: "https://open.bigmodel.cn/api/paas/v4"
      model: "glm-4-flash"         # 完全免费
      # 其他可选模型：glm-4-plus（付费，质量更高）/ glm-4-alltools
      temperature: 0.7
      max_tokens: 300

    # ══════ ③ DeepSeek（最便宜） ══════
    deepseek:
      enabled: false               # 默认关闭，需要时打开
      api_key: "your-deepseek-api-key-here"  # ← 在这里填你的 Key
      base_url: "https://api.deepseek.com/v1"
      model: "deepseek-chat"       # 也支持 deepseek-reasoner
      temperature: 0.7
      max_tokens: 300

    # ══════ ④ 自定义接口预留位1 ══════
    # 说明：如果你的API兼容OpenAI格式（绝大多数都兼容），不需要写代码，改配置就行
    custom_api_1:
      enabled: false               # ★ 需要时改成 true
      api_key: "your-api-key-here" # ← 在这里填你的 Key
      base_url: "https://api.example.com/v1"  # ← 填API地址
      model: "任意模型名"           # ← 填该API支持的模型名
      request_format: openai       # 标准OpenAI格式，兼容90%的API
      temperature: 0.7
      max_tokens: 300

    # ══════ ⑤ 自定义接口预留位2 ══════
    custom_api_2:
      enabled: false               # ★ 需要时改成 true
      api_key: "your-api-key-here" # ← 在这里填你的 Key
      base_url: "https://api.example2.com/v1"  # ← 填API地址
      model: "任意模型名"           # ← 填该API支持的模型名
      request_format: openai
      temperature: 0.7
      max_tokens: 300
```

---

### API Key 获取地址汇总

| 接口 | 注册地址 | 免费额度 | 价格参考 |
|------|---------|---------|---------|
| **OpenAI** | platform.openai.com | 新账号有$5赠金 | ~¥0.0013/k token |
| **智谱 GLM** | bigmodel.cn | 免费，无限制 | 永久免费 |
| **DeepSeek** | platform.deepseek.com | 有赠金 | ~¥0.0002/k token |
| **Custom 1/2** | 你自己的接口 | — | — |

> 💡 **测试期推荐方案**：先用 `zhipu`（免费）+ `openai`（OpenAI赠送金）双引擎跑通流程，稳定后再根据效果切换。

#### 核心代码

```python
import time
from abc import ABC, abstractmethod

# ========== 抽象基类：所有AI引擎必须实现此接口 ==========
class AIBackend(ABC):
    """AI引擎抽象基类"""

    @abstractmethod
    def chat(self, messages: list[dict]) -> str:
        """
        统一对话接口
        Args:
            messages: [{"role": "system/user/assistant", "content": "..."}]
        Returns:
            回复文本字符串
        Raises:
            AIError: 调用失败时抛出
        """
        pass

    def health_check(self) -> bool:
        """健康检查，用于路由降级"""
        try:
            self.chat([{"role": "user", "content": "ping"}])
            return True
        except Exception:
            return False


# ========== OpenAI 兼容引擎 ==========
class OpenAIService(AIBackend):
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


# ========== 智谱引擎 ==========
class ZhipuService(AIBackend):
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


# ========== DeepSeek 引擎 ==========
class DeepSeekService(AIBackend):
    def __init__(self, config: dict):
        from openai import OpenAI as OpenAIClient
        self.client = OpenAIClient(
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


# ========== 通用自定义引擎（适配任何兼容OpenAI格式的API）==========
class GenericHTTPService(AIBackend):
    """
    通用HTTP引擎：支持两种模式
    - openai: 标准OpenAI格式，无需额外配置
    - custom: 自定义请求体，通过 custom_request_template 指定
    """
    import json

    def __init__(self, config: dict):
        import requests
        self.http = requests
        self.base_url = config["base_url"]
        self.api_key = config.get("api_key", "")
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}" if self.api_key else "",
        }
        self.request_format = config.get("request_format", "openai")
        self.custom_template = config.get("custom_request_template", {})
        self.timeout = config.get("timeout_seconds", 15)

    def _build_request_body(self, messages, extra_params=None):
        if self.request_format == "openai":
            # 标准OpenAI格式，直接用
            body = {
                "model": self.custom_template.get("model", "gpt-4o-mini"),
                "messages": messages,
                "temperature": self.custom_template.get("temperature", 0.7),
                "max_tokens": self.custom_template.get("max_tokens", 300),
            }
            if extra_params:
                body.update(extra_params)
            return body

        elif self.request_format == "custom":
            # 深度自定义：将 messages 注入到模板中
            template = self.custom_template.copy()
            template["messages"] = messages  # 或根据实际API结构调整字段名
            return template

        else:
            raise ValueError(f"Unknown format: {self.request_format}")

    def _parse_response(self, resp_json):
        # 根据API返回格式解析
        if self.request_format == "openai":
            return resp_json["choices"][0]["message"]["content"]

        elif self.request_format == "custom":
            # 在此处根据你的API响应格式解析
            # 示例：resp_json["result"]["text"]
            return resp_json.get("text", resp_json.get("result", ""))

        else:
            raise ValueError(f"Unknown format: {self.request_format}")

    def chat(self, messages):
        body = self._build_request_body(messages)
        resp = self.http.post(self.base_url, headers=self.headers, json=body, timeout=self.timeout)
        resp.raise_for_status()
        return self._parse_response(resp.json())


# ========== AI引擎注册表：新增引擎只需在这里注册 ==========
BACKEND_REGISTRY = {
    "openai": OpenAIService,
    "zhipu": ZhipuService,
    "deepseek": DeepSeekService,
}  # ← 新增引擎就往这里加一行


# ========== 路由器：选引擎 + 降级链 ==========
class AIServiceRouter:
    """智能路由：主引擎优先，失败自动降級到备用引擎"""

    def __init__(self, config: dict):
        self.config = config
        self.providers: dict[str, AIBackend] = {}
        self.primary: str | None = None
        self.fallback_chain: list[str] = []
        self.disabled = not config.get("enabled", True)
        self.timeout = config.get("timeout_seconds", 15)
        self.max_retries = config.get("max_retries", 2)

        self._init_providers()

    def _init_providers(self):
        """加载所有启用的引擎"""
        providers_config = self.config.get("providers", {})
        for name, provider_cfg in providers_config.items():
            if not provider_cfg.get("enabled", False):
                continue

            # 展开环境变量引用 ${VAR_NAME}
            expanded = {k: os.path.expandvars(str(v)) for k, v in provider_cfg.items()}

            backend_cls = BACKEND_REGISTRY.get(name)
            if name.startswith("custom_api"):
                backend_cls = GenericHTTPService

            if backend_cls is None:
                log.warning(f"未注册的AI引擎类型: {name}，跳过")
                continue

            self.providers[name] = backend_cls(expanded)

        # 设置主引擎和降级链
        self.primary = self.config.get("primary")
        self.fallback_chain = self.config.get("fallback_chain", [])

    def chat(self, messages: list[dict]) -> str:
        """
        发送消息，自动选择引擎+降级
        流程: 主引擎 → 降级链依次尝试 → 最后都失败抛异常
        """
        if self.disabled or not self.providers:
            raise AIError("所有AI引擎均未启用或未配置")

        # 构建尝试顺序：主引擎 + 降级链
        attempt_order = [self.primary] + self.fallback_chain
        attempt_order = [e for e in attempt_order if e in self.providers]

        # 如果主引擎不在列表里，兜底用第一个可用的
        if not attempt_order:
            attempt_order = list(self.providers.keys())

        last_error = None
        for engine_name in attempt_order:
            backend = self.providers[engine_name]

            # 快速健康检查（可选，避免明显挂掉的也调）
            if not backend.health_check():
                log.info(f"[AI] 引擎 {engine_name} 健康检查未通过，跳过")
                last_error = f"{engine_name} unhealthy"
                continue

            # 尝试调用
            for retry in range(self.max_retries + 1):
                try:
                    start = time.time()
                    result = backend.chat(messages)
                    elapsed = round(time.time() - start, 2)

                    log.info(
                        f"[AI] ✓ {engine_name} 成功 ({elapsed}s) | "
                        f"重试次数={retry}"
                    )
                    return result.strip()

                except Exception as e:
                    last_error = str(e)
                    log.warning(
                        f"[AI] ✗ {engine_name} 失败 (第{retry+1}次): {e}"
                    )
                    if retry < self.max_retries:
                        time.sleep(1 * (retry + 1))  # 指数退避

            log.info(f"[AI] {engine_name} 所有重试已用完，切换到下一个引擎")

        raise AIError(
            f"所有AI引擎均失败: {'; '.join(set(last_error.split('; ')))}"
        )

    def get_status(self) -> dict:
        """获取所有引擎的健康状态"""
        status = {}
        for name, backend in self.providers.items():
            status[name] = {
                "available": backend.health_check(),
                "is_primary": name == self.primary,
                "in_fallback_chain": name in self.fallback_chain,
            }
        return status


# ========== 门面类：对外统一入口 ==========
class AIService:
    """AI服务门面，隐藏底层多个引擎的细节"""

    def __init__(self, settings_path="config/settings.yaml", prompts_path="config/prompts.yaml"):
        self.settings = load_yaml(settings_path)
        self.prompts = load_yaml(prompts_path)
        self.router = AIServiceRouter(self.settings["ai_engine"])
        self.system_prompt = self.prompts.get("meiyi_system", "")

    def generate_reply(self, user_message: str, history: list[dict] = None) -> tuple[str, str]:
        """
        生成回复
        Returns: (reply_text, used_engine_name)
        """
        if self.router.disabled or not self.router.providers:
            raise AIError("AI引擎不可用，请检查配置")

        messages = [
            {"role": "system", "content": self.system_prompt},
        ]

        if history:
            messages.extend(history[-6:])  # 最近3轮

        messages.append({"role": "user", "content": user_message})

        reply = self.router.chat(messages)

        # 检测是否应转人工
        if "转人工" in reply[:10] or "需要找人工客服" in reply:
            return reply, "transfer_human"

        # 长度限制
        if len(reply) > 300:
            reply = reply[:297] + "..."

        return reply, "normal"

    def check_health(self) -> dict:
        return self.router.get_status()
```

#### 内置AI引擎对比

| 引擎 | 价格/千token | 中文能力 | 推荐场景 | 测试期建议 |
|------|-------------|---------|---------|-----------|
| **GPT-4o-mini** | ~¥0.0013/k | ⭐⭐⭐⭐ | 通用主力 | ✅ 先用这个跑通流程 |
| **智谱 glm-4-flash** | 免费额度充足 | ⭐⭐⭐⭐⭐ | 国产平替 | ✅ 同步准备 |
| **DeepSeek Chat** | ~¥0.0005/k 最便宜 | ⭐⭐⭐⭐ | 低成本方案 | 规则稳定后再切 |
| **Custom API 1** | 由你定 | 取决于接入的模型 | 自有模型/其他平台 | 📝 按需填写 |
| **Custom API 2** | 由你定 | 取决于接入的模型 | 自有模型/其他平台 | 📝 按需填写 |

---

### 5.5 会话管理 & AI交互流程 (`conversation.py`)

追踪每个客户的对话阶段，同时管理AI上下文窗口：

```python
STAGES = ['new', 'info_collected', 'quotation_given', 'design_discussion',
          'sample_sent', 'ready_to_order', 'ordered', 'followup_needed']

class ConversationManager:
    """管理单个客户的对话状态 + AI上下文"""

    MAX_AI_CONTEXT_ROUNDS = 6  # 传给AI的最多历史轮数

    def __init__(self, db):
        self.db = db
        self.context_cache = {}  # session_id -> [recent_messages_for_ai]

    def add_message(self, session_id, role, content):
        """记录消息并维护AI上下文缓存"""
        self.db.save_message(session_id, direction=role, content=content)

        if session_id not in self.context_cache:
            self.context_cache[session_id] = []

        self.context_cache[session_id].append({
            "role": role,
            "content": content,
        })
        # 只保留最近的上下文轮次
        if len(self.context_cache[session_id]) > self.MAX_AI_CONTEXT_ROUNDS * 2:
            self.context_cache[session_id] = self.context_cache[session_id][-self.MAX_AI_CONTEXT_ROUNDS * 2:]

        # 更新时间
        self.db.execute("""
            UPDATE conversations SET last_seen_at = CURRENT_TIMESTAMP
            WHERE session_id = ?
        """, (session_id,))

    def get_ai_context(self, session_id):
        """取出供AI使用的对话上下文"""
        return self.context_cache.get(session_id, [])

    def advance_stage(self, session_id, stage):
        ...

    def extract_contact_info(self, message):
        """从消息中尝试提取手机号、公司名等信息"""
        phone_pattern = re.search(r'1[3-9]\d{9}', message)
        ...

    def save_lead(self, session_id, friend_name, extracted_info):
        """保存为销售线索"""
        ...
```

### 5.6 数据库设计 (`database.py`)

```sql
-- 会话表：每个微信好友一条记录
CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    friend_name TEXT NOT NULL,          -- 好友昵称/备注名
    session_id TEXT UNIQUE NOT NULL,     -- UUID，跨表关联键
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME,
    stage TEXT DEFAULT 'new',           -- 当前对话阶段
    status TEXT DEFAULT 'active'        -- active/paused/blocked
);

-- 消息记录表：逐条聊天记录
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    direction TEXT NOT NULL,            -- inbound / outbound
    content TEXT NOT NULL,              -- 消息内容
    source TEXT DEFAULT 'rule',         -- rule / ai / human
    intent TEXT,                        -- 意图标签
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 客户线索表：销售转化跟踪
CREATE TABLE leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    company_name TEXT,                  -- 公司名称
    contact_person TEXT,                -- 联系人姓名
    phone TEXT,                         -- 手机号
    wechat_id TEXT,                     -- 微信号
    festival TEXT,                      -- 节日类型
    product_category TEXT,              -- 产品类别
    quantity_estimate TEXT,             -- 预估数量
    notes TEXT,                         -- 备注/特殊要求
    stage TEXT DEFAULT 'new_inquiry',   -- new_quotation/design/order_confirmed/delivered
    assigned_to TEXT,                   -- 分配给哪位运营
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME
);

-- 操作日志表
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,           -- login/logout/reply_error/alert
    detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 六、核心回复流程

```
新客户发来消息
      │
      ▼
去重检查（跳过已处理消息）
      │
      ▼
是否为新会话？
  │ YES → 创建会话 → 创建线索记录 → 推送欢迎语 → 进入 info_collected 阶段
  │ NO
  ▼
Intent Classifier 三级分类
  │
  ├─[Level1 精确关键词命中]
  │    → Rule Engine 匹配话术模板
  │    → 模板变量替换 {{festival}} {{min_order}} 等
  │    → 敏感词过滤 → 发送回复 → 更新线索阶段
  │
  ├─[Level2 模糊匹配命中]
  │    → 同上
  │
  └─[Level3 未命中 → AI兜底]
       → 传入最近3轮对话上下文
       → AI生成回复
       → 长度截断≤300字
       → 检测回复中含"转人工"标记
       │       → 发消息提醒运营人员
       │       → 修改会话状态为 waiting_human
       → 正常 → 发送AI回复 → 尝试从回复中提取线索信息
```

---

## 七、礼盒定制专属话术设计

### 7.1 关键词库 (`config/keywords.yaml`)

```yaml
# --- 询价 ---
price:
  keywords: ["价格","多少钱","报价","贵不贵","预算","便宜","划算"]
  reply_template: >
    我们的礼盒价格根据材质、数量和定制项不同，大致区间是：
    基础款礼盒 ¥8-15/个（不含定制）
    中高端礼盒 ¥15-35/个（含贺卡+腰封+吊牌）
    高端定制礼盒 ¥35-80/个（全定制，含丝绒/木盒等特殊材质）
    量大更优惠哦！您大概需要多少份呢？我帮您精准报价~ 🎁
  priority: 95
  lead_capture: true          # 触发收集数量

# --- 起订量 ---
min_order:
  keywords: ["最少","起定量","起订量","起步量","最少做多少","小单"]
  reply_template: >
    我们的起订量是 50份起做~ 😊
    100份以上享折扣价，300份以上可以单独开模具定制专属造型！
    您是公司采购还是个人定制呢？
  priority: 90
  lead_capture: true

# --- 定制流程 ---
custom_process:
  keywords: ["定制流程","怎么定制","流程","怎么做","步骤"]
  reply_template: >
    定制流程很简单，5步搞定：
    1️⃣ 沟通需求 — 节日、数量、预算
    2️⃣ 设计方案 — 我们出贺卡+腰封+吊牌效果图给您选
    3️⃣ 确认打样 — 寄实物样品给您确认
    4️⃣ 批量生产 — 确认后3-5个工作日完成
    5️⃣ 质检发货 — 打包好发到您指定地点
    全程都有专人跟进，您不用操心~ 想了解哪个环节？
  priority: 85

# --- 贺卡定制 ---
card_custom:
  keywords: ["贺卡","贺词","卡片","写什么","祝福语"]
  reply_template: >
    贺卡我们可以帮您设计排版，您只需要提供：
    ✍️ 企业名称 + LOGO
    ✍️ 祝福语/贺词内容（没有的话我们有模板可选）
    ✍️ 颜色偏好（企业VI色系最佳）
    我们会出具效果图给您确认后再印刷~
    贺卡额外费用约 ¥1-3/张，量大更优惠！
  priority: 80
  follow_up_suggestion: "要不要看下我们的贺卡设计案例？"

# --- 腰封定制 ---
waistband_custom:
  keywords: ["腰封","书型盒","外套","封面"]
  reply_template: >
    腰封是套在礼盒外面的装饰纸带，相当于礼盒的"外衣"~ 📦
    可以印制企业LOGO、产品名称、宣传语。
    材质有铜版纸、特种纸两种可选，触感更好看。
    费用约 ¥0.5-1.5/条，包含在设计费里！
  priority: 75

# --- 吊牌定制 ---
tag_custom:
  keywords: ["吊牌","挂牌","标签","铭牌"]
  reply_template: >
    吊牌可以定制形状（圆形/方形/异形）、材质（铜版纸/牛皮纸/PET透明）。
    建议搭配礼盒风格设计，加上企业Logo和产品简介。
    费用约 ¥0.3-1/个，100份以上免费设计！
  priority: 70

# --- 交期 ---
delivery_time:
  keywords: ["多久","多长时间","交期","什么时候要","急要","加急"]
  reply_template: >
    标准交期：确认后 5-7 个工作日。
    急单可以走加急通道，3个工作日交稿+生产（加收15%加急费）。
    但是建议提前15-20天联系我们，这样时间充裕可以多做几版设计给您选~ 💡
  priority: 88

# --- 案例 ---
case_study:
  keywords: ["案例","样品","看过往","以前做过","看看","图片","效果图"]
  reply_template: >
    我们有丰富的案例经验，做过这些节日的礼盒：
    🎋 端午节 — 粽子礼盒（竹编风/国潮风）
    🥮 中秋节 — 月饼礼盒（精装纸质/木质/铁盒）
    🧧 春节 — 年货礼包（红色喜庆系列）
    💝 三八节/母亲节 — 女性礼品套装
    🎆 国庆/周年庆 — 企业定制伴手礼
    我发几张实拍图给您看看~ （后续通过SendImage自动发送）
  priority: 82
  auto_send_image: true
  image_dir: "assets/sample_images/"

# --- 下单 ---
order_confirm:
  keywords: ["下单","订购","合作","要一份","给我来一个","联系"]
  reply_template: "太好了！我来帮您登记一下需求~ 🙂\n\n方便留一下您的**公司名称**和**联系电话**吗？我们的客户经理会在30分钟内联系您，给您报精准价格并安排后续~"
  priority: 99
  action: capture_lead_and_alert
  # capture_lead: 从上下文中提取公司名+电话
  # alert: 通知运营群

# --- 首次欢迎 ---
welcome:
  keywords: ["__WELCOME__"]       # 特殊标记，不由关键词匹配触发
  reply_template: >
    您好呀~欢迎光临！🎁
    我们是专业的企业礼盒定制服务商，提供节日礼盒的设计、生产、配送一站式服务。
    请问您需要哪种节日的礼盒呢？端午节、中秋节、春节都有现成方案~
  is_welcome: true
  priority: 100
```

### 7.2 产品图册展示 (`templates.yaml`)

```yaml
product_categories:
  duanwu_2026:
    name: "端午节礼盒"
    description: "竹编国风粽子礼盒"
    price_range: "¥15-45/份"
    min_order: 50
    images:
      - "assets/sample_images/duanwu_1.jpg"
      - "assets/sample_images/duanwu_2.jpg"
    features:
      - "竹编手感盒，可重复使用"
      - "内含手工粽子6枚+咸鸭蛋+雄黄酒"
      - "支持企业LOGO烫金"
    custom_options:
      - card
      - waistband
      - tag
      - ribbon
      - insert_booklet

  zhongqiu_2026:
    name: "中秋节礼盒"
    description: "国潮风月饼礼盒"
    price_range: "¥25-68/份"
    min_order: 100
    images:
      - "assets/sample_images/zhongqiu_1.jpg"
    ...
```

### 7.3 定时跟进策略

```python
# APScheduler 定时任务
# 每天早上10:00 — 向未成交的线索发送关怀消息
@schedule.cron(hour=10, minute=0)
def daily_followup():
    pending = db.query_leads(
        where="stage IN ('new', 'quotation_given') AND created_at > datetime('now', '-7 days')"
    )
    for lead in pending:
        msg = render("""
        {{name}}总您好~ 👋
        上次聊的端午礼盒定制方案还有兴趣吗？
        现在预定享早鸟价：满200份减¥5/份，满500份减¥10/份！
        活动截止到本月月底哦~
        """, {'name': lead.contact_person or '您'})
        send_via_wechat(lead.session_id, msg)
        log(f"跟进消息已发送给 {lead.company_name}")
```

---

## 八、完整对话示例

### 场景：客户咨询端午礼盒

```
客户: 你好，在吗？

小礼: 您好呀~欢迎光临！🎁 我们是专业的企业礼盒定制服务商。
      请问您需要哪种节日的礼盒呢？端午节、中秋节、春节都有现成方案~

客户: 端午节的礼盒你们有哪些款式？

小礼: 我们有几款热门端午礼盒：
      🎋 竹编国风粽子礼盒 ¥15-45/份，可放6枚粽子+咸鸭蛋+雄黄酒
      🐉 国潮插画纸盒 ¥12-30/份，简约大气适合批量发放
      💎 木盒高端定制 ¥35-80/份，烫金LOGO，适合重要客户赠送

      您大概需要做多少份呢？

客户: 我们公司大概300人，需要送给员工和客户

小礼: 300份非常棒，可以直接享受批发折扣了~ 😊
      推荐竹编款或者木盒款，员工发放选竹编性价比最高，
      送重要客户推荐木盒更显档次。

      方便留一下公司名称和联系方式吗？我让您专属经理给您报个精准价格？

客户: XX科技有限公司，电话13800138000

小礼: 收到！已经为您登记好需求：
      📋 XX科技有限公司 | 300份 | 端午礼盒
      我们的经理会尽快联系您~

      另外想问一下，贺卡和腰封也要一起定制吗？
      可以印有咱们公司的LOGO和祝福语，很有仪式感~ ✨
```

---

## 九、安全防护

| 风险 | 防护机制 |
|------|----------|
| 微信被封号 | wxauto走UI自动化（不抓包分析网络数据），60秒防刷，模拟真人节奏 |
| 垃圾消息刷屏 | 同联系人60秒限回复1次，单日上限30次自动暂停 |
| 敏感词泄露 | 所有输出经过敏感词过滤器扫描 |
| AI胡说八道 | prompt严格限定范围 + max_tokens=300 + 禁止承诺类词汇白名单过滤 |
| 消息丢失 | 每条消息落盘SQLite，重启后可重放未读 |
| 误回复陌生人 | 白名单机制，默认只对已有会话记录的好友自动回复 |
| 恶意试探/测试 | 识别异常频率或敏感词组合时标记并通知管理员 |

---

## 十、实施时间表

| 阶段 | 天数 | 交付物 |
|------|------|--------|
| **Phase 1** — 基座搭建 | 2天 | wxauto消息收发通、SQLite建表、配置框架 |
| **Phase 2** — 规则引擎 | 3天 | 关键词匹配、话术模板加载渲染、优先级排序 |
| **Phase 3** — AI集成 | 2天 | AI Service、Prompt调优、意图兜底联动 |
| **Phase 4** — 业务逻辑 | 3天 | 欢迎语、线索采集与阶段推进、定时跟进、案例推送 |
| **Phase 5** — 联调测试 | 2天 | 端到端测试、异常覆盖、话术打磨优化 |
| **Phase 6** — 部署上线 | 1天 | Windows后台服务、开机自启、运行监控 |

**总计约 13 个工作日（约3周）**

---

## 十一、预算估算

| 项目 | 费用 |
|------|------|
| Python环境 + wxauto | 免费（开源） |
| SQLite | 免费（内置） |
| AI API — OpenAI GPT-4o-mini | ~¥0.03/次 (~¥0.0013/k token) |
| AI API — 智谱 glm-4-flash | **免费**额度充足，适合测试期主力 |
| AI API — DeepSeek Chat | ~¥0.01/次 最便宜方案 |
| Windows PC（常驻） | 已有即可 |
| **日均成本** | 规则命中70%零成本 + AI兜底50次×¥0.02 ≈ **¥1/天** |

---

## 十二、扩展指南 — 如何添加新AI接口

### 方案A：OpenAI兼容格式（90%的API都兼容，不需要写代码）

直接用配置文件里预留的 `custom_api_1` / `custom_api_2`，改3个值就行：

```yaml
# config/settings.yaml → providers.custom_api_1
custom_api_1:
  enabled: true                # 改为 true
  api_key: "你的API密钥"       # 填进去
  base_url: "https://api.xxx.com/v1"   # 填进去
  model: "模型名"              # 填进去
  request_format: openai       # 保持默认即可
```

然后在 `fallback_chain` 里加上 `custom_api_1`，重启生效。

### 方案B：非标准格式（深度定制请求体）

如果目标API不是OpenAI格式，在 `settings.yaml` 中设置 `request_format: custom`，然后填写 `custom_request_template` 定义完整请求结构：

```yaml
custom_api_1:
  enabled: true
  request_format: custom       # ← 切换为自定义格式
  custom_request_template:     # ← 这里定义你API需要的完整JSON结构
    endpoint: "/chat"
    input_field: "prompt"      # 你的API把消息存在哪个字段
    output_field: "result.text" # 你的API返回的数据路径
    # ...其他固定参数
```

对应的解析逻辑在 `ai_service.py` 的 `GenericHTTPService._parse_response()` 方法中。

### 方案C：完全自定义引擎类

如果你的API格式特殊，需要写一个专用引擎类（参考 Step 1 代码模板），然后注册到 `BACKEND_REGISTRY`。**大多数情况用方案A就够了。**

---

## 十三、待你确认的问题

1. **目前有多少款礼盒产品？** 方便的话列出来，我把话术写好放进去
2. **日常一天大约多少个微信客户咨询？** 影响并发和性能设计
3. **有现成的产品图片吗？** 需要上传到 `assets/` 目录供自动发送
4. **团队几个人负责跟进？** 影响"转人工"的通知机制设计
5. **AI接口偏好？** 建议测试期先用 **智谱 glm-4-flash**（免费） + **OpenAI GPT-4o-mini** 双引擎并行对比效果。计划已预留 2 个自定义 API 位，随时可接入自己的模型或其他平台，改配置就行不用改代码

---

*计划版本: v3 — 多AI引擎可插拔架构 | 日期: 2026-05-22 | 核心依赖: wxauto ≥ v3.9*
