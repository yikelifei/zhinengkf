# -*- coding: utf-8 -*-
"""Local image prompt extraction and queue records.

This module only turns customer requirements into auditable prompt text and
local queue records. It does not call, wrap, or assume any external image API.
"""

from __future__ import annotations

from datetime import datetime
import hashlib
import re


JOB_STATUSES = {
    "queued",
    "prompt_ready",
    "in_review",
    "approved",
    "blocked",
    "done",
    "cancelled",
}

FIELD_LABELS = {
    "product_category": "品类",
    "scene": "场景",
    "style": "风格",
    "colors": "颜色",
    "texts": "文字",
    "logo": "Logo",
    "size": "尺寸",
    "restrictions": "禁忌/注意事项",
    "revision_notes": "修改意见",
}

REQUIRED_PROMPT_FIELDS = ["product_category", "scene", "style", "size"]

CATEGORY_KEYWORDS = [
    "详情页",
    "电商主图",
    "朋友圈海报",
    "小红书封面",
    "公众号首图",
    "包装盒",
    "礼盒",
    "海报",
    "主图",
    "banner",
    "横幅",
    "封面",
    "插画",
    "贴纸",
    "吊牌",
    "贺卡",
    "名片",
    "折页",
    "易拉宝",
    "展板",
    "图片",
    "配图",
]

SCENE_KEYWORDS = [
    "中秋",
    "端午",
    "春节",
    "七夕",
    "国庆",
    "年会",
    "开业",
    "促销",
    "直播间",
    "朋友圈",
    "小红书",
    "公众号",
    "淘宝",
    "天猫",
    "抖音",
    "门店",
    "展会",
    "会议",
    "商务拜访",
    "员工福利",
    "客户伴手礼",
    "节日礼赠",
]

STYLE_KEYWORDS = [
    "国潮",
    "新中式",
    "简约",
    "极简",
    "高级",
    "高端",
    "商务",
    "科技感",
    "可爱",
    "卡通",
    "插画",
    "写实",
    "摄影",
    "3D",
    "立体",
    "水彩",
    "扁平",
    "复古",
    "年轻",
    "清新",
    "温馨",
    "大气",
    "奢华",
]

COLOR_KEYWORDS = [
    "红金",
    "黑金",
    "蓝白",
    "红色",
    "金色",
    "黑色",
    "白色",
    "蓝色",
    "绿色",
    "橙色",
    "黄色",
    "紫色",
    "粉色",
    "灰色",
    "银色",
    "米色",
    "奶油色",
    "中国红",
    "渐变",
]

IMAGE_REQUEST_KEYWORDS = set(
    CATEGORY_KEYWORDS
    + [
        "出图",
        "生图",
        "画面",
        "视觉",
        "设计图",
        "提示词",
        "prompt",
        "Prompt",
        "改图",
        "修图",
    ]
)

NEGATIVE_MARKERS = ("不要", "避免", "不能", "别", "禁止", "不要出现", "去掉")
ATTENTION_MARKERS = ("注意", "必须", "需要保留", "保留", "突出", "强调")
REVISION_MARKERS = ("修改", "调整", "改成", "换成", "上一版", "前一版", "再把", "重做", "优化", "放大", "缩小")


def extract_image_prompt_fields(text: str, lead: dict | None = None) -> dict:
    raw_text = str(text or "")
    lead = lead or {}
    context = normalize(
        "\n".join(
            item
            for item in [
                str(lead.get("product_category") or ""),
                str(lead.get("festival") or ""),
                str(lead.get("notes") or ""),
                raw_text,
            ]
            if item
        )
    )

    positive_context = remove_marked_clauses(context, NEGATIVE_MARKERS)
    fields = {
        "product_category": first_text(lead.get("product_category")) or extract_category(context),
        "scene": extract_scene(context, lead),
        "style": extract_keywords(positive_context, STYLE_KEYWORDS, limit=4),
        "colors": extract_colors(positive_context),
        "texts": extract_texts(raw_text),
        "logo": extract_logo(context),
        "size": extract_size(context),
        "restrictions": extract_clauses(context, NEGATIVE_MARKERS + ATTENTION_MARKERS),
        "revision_notes": extract_clauses(context, REVISION_MARKERS),
    }
    fields["missing_fields"] = missing_prompt_fields(fields)
    return fields


def build_image_prompt(fields: dict) -> str:
    category = fields.get("product_category") or "未确认品类"
    scene = fields.get("scene") or "未确认场景，先按通用商业展示处理"
    style = join_values(fields.get("style")) or "未确认风格，保持干净、商业化、不过度装饰"
    colors = join_values(fields.get("colors")) or "未确认颜色，使用稳妥的品牌商业配色"
    size = fields.get("size") or "未确认尺寸，先按常用方图 1:1 构图"
    text_line = texts_for_prompt(fields.get("texts"))
    logo_line = logo_for_prompt(fields.get("logo") or {})
    restrictions = (
        join_values(fields.get("restrictions"))
        or "不要添加未确认的品牌名、价格、联系方式或外部平台水印"
    )
    revision_notes = join_values(fields.get("revision_notes")) or "无明确修改意见"

    return "\n".join(
        [
            f"出图任务：生成一张{category}视觉图。",
            f"画面场景：{scene}。",
            f"整体风格：{style}。",
            f"主色/配色：{colors}。",
            f"画面文字：{text_line}。",
            f"Logo处理：{logo_line}。",
            f"尺寸与构图：{size}。",
            f"修改意见：{revision_notes}。",
            f"禁忌和注意事项：{restrictions}。",
            "输出要求：画面主体清晰，层次明确，适合交给设计或外部出图软件继续制作；不要假设任何未确认的外部 API 参数。",
        ]
    )


def create_image_prompt_job(
    source_text: str,
    lead: dict | None = None,
    job_id: str | None = None,
    status: str = "queued",
    now: datetime | str | None = None,
) -> dict:
    if status not in JOB_STATUSES:
        raise ValueError(f"unsupported image prompt job status: {status}")

    lead = lead or {}
    fields = extract_image_prompt_fields(source_text, lead=lead)
    timestamp = format_time(now)
    resolved_job_id = job_id or stable_job_id(source_text, lead)
    return {
        "job_id": resolved_job_id,
        "status": status,
        "created_at": timestamp,
        "updated_at": timestamp,
        "source_type": lead.get("source_type") or "lead",
        "session_id": lead.get("session_id") or "",
        "customer": lead.get("company_name")
        or lead.get("contact_person")
        or lead.get("session_id")
        or "未命名客户",
        "source_text": str(source_text or ""),
        "fields": fields,
        "prompt": build_image_prompt(fields),
        "missing_fields": fields.get("missing_fields", []),
        "audit_notes": [
            "本任务只生成本地提示词和队列记录。",
            "未调用真实出图软件，也未假设外部 API。",
        ],
    }


def missing_prompt_fields(fields: dict) -> list[str]:
    missing = []
    for key in REQUIRED_PROMPT_FIELDS:
        value = fields.get(key)
        if isinstance(value, list):
            is_missing = not value
        else:
            is_missing = not str(value or "").strip()
        if is_missing:
            missing.append(key)
    return missing


def looks_like_image_request(text: str) -> bool:
    normalized = normalize(text)
    if not normalized:
        return False
    return any(keyword in normalized for keyword in IMAGE_REQUEST_KEYWORDS)


class ImagePromptJobQueue:
    """Small in-memory queue for local prompt jobs."""

    def __init__(self, jobs: list[dict] | None = None):
        self._jobs: list[dict] = []
        for job in jobs or []:
            self.add_job(job)

    def add(self, source_text: str, lead: dict | None = None, status: str = "queued") -> dict:
        job = create_image_prompt_job(source_text, lead=lead, status=status)
        return self.add_job(job)

    def add_job(self, job: dict) -> dict:
        job_id = job.get("job_id")
        if not job_id:
            raise ValueError("image prompt job requires job_id")
        if self.get(job_id):
            raise ValueError(f"duplicate image prompt job_id: {job_id}")
        status = job.get("status")
        if status not in JOB_STATUSES:
            raise ValueError(f"unsupported image prompt job status: {status}")
        self._jobs.append(job)
        return job

    def get(self, job_id: str) -> dict | None:
        for job in self._jobs:
            if job.get("job_id") == job_id:
                return job
        return None

    def list_jobs(self, status: str | None = None) -> list[dict]:
        if status is None:
            return list(self._jobs)
        return [job for job in self._jobs if job.get("status") == status]

    def update_status(
        self,
        job_id: str,
        status: str,
        note: str = "",
        now: datetime | str | None = None,
    ) -> dict:
        if status not in JOB_STATUSES:
            raise ValueError(f"unsupported image prompt job status: {status}")
        job = self.get(job_id)
        if not job:
            raise KeyError(job_id)
        job["status"] = status
        job["updated_at"] = format_time(now)
        if note:
            job.setdefault("audit_notes", []).append(note)
        return job

    def summary(self) -> dict:
        counts = {status: 0 for status in sorted(JOB_STATUSES)}
        for job in self._jobs:
            status = job.get("status", "queued")
            counts[status] = counts.get(status, 0) + 1
        return {
            "total": len(self._jobs),
            "missing_required": sum(1 for job in self._jobs if job.get("missing_fields")),
            "by_status": counts,
        }


def extract_category(text: str) -> str:
    keywords = extract_keywords(text, CATEGORY_KEYWORDS, limit=3)
    if keywords:
        return " / ".join(keywords)

    match = re.search(
        r"(?:品类|产品|商品|物料|设计|做|生成|出一张|设计一张|需要|想要)[:：是为\s]*([^，。；;\n]{2,24})",
        text,
    )
    if match:
        return clean_phrase(match.group(1))
    return ""


def extract_scene(text: str, lead: dict) -> str:
    scenes = []
    if lead.get("festival"):
        scenes.append(str(lead.get("festival")))
    scenes.extend(extract_keywords(text, SCENE_KEYWORDS, limit=4))

    for pattern in [
        r"(?:用于|用在|使用场景|场景|投放到|发到|面向)[:：\s]*([^，。；;\n]{2,40})",
        r"(?:送给)[:：\s]*([^，。；;\n]{2,30})",
    ]:
        match = re.search(pattern, text)
        if match:
            scenes.append(clean_phrase(match.group(1)))
    return " / ".join(unique(scenes)[:4])


def extract_colors(text: str) -> list[str]:
    colors = extract_keywords(text, COLOR_KEYWORDS, limit=6)
    colors.extend(re.findall(r"#[0-9a-fA-F]{3,6}\b", text))
    return unique(colors)[:6]


def extract_texts(text: str) -> list[str]:
    found = []
    for match in re.findall(r"[“\"'‘]([^”\"'’]{1,80})[”\"'’]", text):
        found.append(clean_phrase(match))

    for pattern in [
        r"(?:文字|文案|标语|标题|主标题|副标题|写上|加上|放上)[:：为是\s]*([^，。；;\n]{1,80})",
    ]:
        for match in re.findall(pattern, text):
            cleaned = clean_phrase(match)
            if cleaned and not re.search(r"(logo|LOGO|尺寸|颜色|风格|[“”\"'‘’])", cleaned):
                found.append(cleaned)
    return unique(found)[:5]


def extract_logo(text: str) -> dict:
    if re.search(r"(?:不要|无需|不需要|无|去掉|别放).{0,8}(?:logo|LOGO|标志|品牌标识)", text):
        return {"required": False, "note": "客户明确不需要 Logo"}
    if re.search(r"(?:logo|LOGO|标志|品牌标识)", text):
        clause = first_clause_with(text, ("logo", "LOGO", "标志", "品牌标识"))
        return {"required": True, "note": clause or "客户提到需要 Logo"}
    return {"required": None, "note": "未确认是否需要 Logo"}


def extract_size(text: str) -> str:
    match = re.search(r"(\d{2,5})\s*(?:x|X|×|\*)\s*(\d{2,5})(?:\s*(?:px|像素))?", text)
    if match:
        return f"{match.group(1)}x{match.group(2)}"

    ratio = re.search(r"(?<!\d)(\d{1,2})\s*:\s*(\d{1,2})(?!\d)", text)
    if ratio:
        return f"{ratio.group(1)}:{ratio.group(2)}"

    size_keywords = [
        ("A4", "A4"),
        ("a4", "A4"),
        ("方图", "方图 1:1"),
        ("正方形", "方图 1:1"),
        ("横版", "横版"),
        ("竖版", "竖版"),
        ("手机屏", "手机屏竖版"),
        ("朋友圈", "朋友圈常用比例"),
        ("小红书", "小红书封面比例"),
    ]
    for keyword, label in size_keywords:
        if keyword in text:
            return label
    return ""


def extract_clauses(text: str, markers: tuple[str, ...]) -> list[str]:
    clauses = []
    for clause in split_clauses(text):
        if any(marker in clause for marker in markers):
            clauses.append(clean_phrase(clause))
    return unique(clauses)[:6]


def remove_marked_clauses(text: str, markers: tuple[str, ...]) -> str:
    return "，".join(clause for clause in split_clauses(text) if not any(marker in clause for marker in markers))


def extract_keywords(text: str, keywords: list[str], limit: int = 5) -> list[str]:
    lowered = text.lower()
    found = [keyword for keyword in keywords if keyword.lower() in lowered]
    return unique(found)[:limit]


def first_clause_with(text: str, keywords: tuple[str, ...]) -> str:
    for clause in split_clauses(text):
        if any(keyword in clause for keyword in keywords):
            return clean_phrase(clause)
    return ""


def split_clauses(text: str) -> list[str]:
    return [item.strip() for item in re.split(r"[，。；;\n\r]+", text) if item.strip()]


def texts_for_prompt(texts) -> str:
    values = as_list(texts)
    if not values:
        return "不要自行添加未确认文案，可预留文字区域"
    return "；".join(values)


def logo_for_prompt(logo: dict) -> str:
    required = logo.get("required")
    note = logo.get("note") or ""
    if required is True:
        return f"需要加入客户 Logo，{note}；如未提供源文件，只预留位置，不自造品牌标识"
    if required is False:
        return f"不放 Logo，{note}"
    return "未确认是否需要 Logo；先预留可替换位置，不自造品牌标识"


def join_values(value) -> str:
    return " / ".join(as_list(value))


def as_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    return [text] if text else []


def first_text(value) -> str:
    return str(value or "").strip()


def clean_phrase(value: str) -> str:
    text = normalize(value)
    text = re.split(r"\s*(?:品类|产品|节日/场景|场景|数量|预算|备注|尺寸|颜色|风格)[:：]", text, maxsplit=1)[0]
    text = re.sub(r"\s*(?:品类|产品|节日/场景|场景|数量|预算|备注|尺寸|颜色|风格)$", "", text)
    text = re.sub(r"^(请|帮我|麻烦|需要|想要|要|做|生成|设计|一个|一张)", "", text)
    text = re.sub(r"(谢谢|麻烦了)$", "", text)
    return text.strip(" ：:，。；;")


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def unique(values: list[str]) -> list[str]:
    result = []
    seen = set()
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def stable_job_id(source_text: str, lead: dict) -> str:
    seed = "|".join(
        [
            str(lead.get("session_id") or ""),
            str(lead.get("id") or ""),
            str(source_text or ""),
        ]
    )
    return "img_" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:12]


def format_time(value: datetime | str | None) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if value:
        return str(value)
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
