from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from PIL import Image
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
STORAGE_ROOT = ROOT / ".runtime-stable" / "storage" / "knowledge-materials" / "customer-selection-2026-08-21"
PAGE_ROOT = STORAGE_ROOT / "page-recommendations"
INDEX_PATH = ROOT / "packages" / "rules" / "customerSelectionPageIndex.json"
DOC_INDEX_PATH = ROOT / "docs" / "knowledge-base" / "customer-selection-page-index-2026-08-21.json"
QA_PATH = ROOT / "tmp" / "specific-categories-20260821" / "build-result.json"
MAX_SEND_FILE_BYTES = 20 * 1024 * 1024
MAX_PAGE_IMAGE_BYTES = 2 * 1024 * 1024


MATERIALS = [
    {
        "materialId": "yoga_gifts_pdf",
        "category": "yoga",
        "title": "瑜伽系列礼品（PDF分册）",
        "sourceName": "瑜伽系列礼品PPT.pdf",
        "sourcePath": Path(r"E:\weixin\liaotan\xwechat_files\wxid_ifhvhozp32mv12_f5a4\msg\file\2026-08\瑜伽系列礼品PPT.pdf"),
        "renderDir": ROOT / "tmp" / "specific-categories-20260821" / "highres" / "yoga-pdf",
        "sendFileName": "瑜伽系列礼品_PDF分册_发送版.pdf",
        "expectedPages": 16,
        "format": "pdf",
        "variantPriority": 1,
    },
    {
        "materialId": "yoga_gifts_pptx",
        "category": "yoga",
        "title": "瑜伽系列礼品（PPT分册）",
        "sourceName": "瑜伽系列礼品PPT.pptx",
        "sourcePath": Path(r"E:\weixin\liaotan\xwechat_files\wxid_ifhvhozp32mv12_f5a4\msg\file\2026-08\瑜伽系列礼品PPT.pptx"),
        "renderDir": ROOT / "tmp" / "specific-categories-20260821" / "highres" / "yoga-pptx",
        "sendFileName": "瑜伽系列礼品_PPT分册_发送版.pdf",
        "expectedPages": 16,
        "format": "pptx",
        "variantPriority": 2,
    },
    {
        "materialId": "business_gifts_2026",
        "category": "business_gift",
        "title": "2026年商务伴手礼",
        "sourceName": "2026年商务伴手礼PPT.pptx",
        "sourcePath": Path(r"E:\weixin\liaotan\xwechat_files\wxid_ifhvhozp32mv12_f5a4\msg\file\2026-08\2026年商务伴手礼PPT.pptx"),
        "renderDir": ROOT / "tmp" / "specific-categories-20260821" / "highres" / "business-pptx",
        "sendFileName": "2026年商务伴手礼_发送版.pdf",
        "expectedPages": 10,
        "format": "pptx",
        "variantPriority": 1,
    },
    {
        "materialId": "teachers_day_pdf",
        "category": "teachers_day",
        "title": "2026教师节伴手礼（PDF分册）",
        "sourceName": "2026教师节伴手礼(1).pdf",
        "sourcePath": Path(r"E:\weixin\liaotan\xwechat_files\wxid_mtkp7lffux8e22_cd3f\msg\file\2026-08\2026教师节伴手礼(1).pdf"),
        "renderDir": ROOT / "tmp" / "specific-categories-20260821" / "highres" / "teacher-pdf",
        "sendFileName": "2026教师节伴手礼_PDF分册_发送版.pdf",
        "expectedPages": 32,
        "format": "pdf",
        "variantPriority": 1,
    },
    {
        "materialId": "teachers_day_pptx",
        "category": "teachers_day",
        "title": "2026教师节伴手礼（PPT分册）",
        "sourceName": "2026教师节伴手礼.pptx",
        "sourcePath": Path(r"E:\weixin\liaotan\xwechat_files\wxid_mtkp7lffux8e22_cd3f\msg\file\2026-08\2026教师节伴手礼.pptx"),
        "renderDir": ROOT / "tmp" / "specific-categories-20260821" / "highres" / "teacher-pptx",
        "sendFileName": "2026教师节伴手礼_PPT分册_发送版.pdf",
        "expectedPages": 32,
        "format": "pptx",
        "variantPriority": 2,
    },
]


PRODUCT_TERMS = [
    "瑜伽垫", "瑜伽球", "筋膜球", "花生球", "拉力带", "弹力带", "瑜伽袜", "运动毛巾", "速干毛巾",
    "水杯", "保温杯", "吸管杯", "咖啡杯", "按摩梳", "护手霜", "香薰", "香皂", "眼罩", "毛巾",
    "帆布袋", "手提袋", "收纳包", "笔记本", "签字笔", "书签", "茶", "咖啡", "蓝牙音箱", "充电宝",
    "雨伞", "香氛", "颈枕", "小风扇", "手机支架", "养生锤", "乐乐茶", "花茶", "抱枕", "帆布包",
]


# The two PDFs keep their selling prices as outlined/image text, so PDF text
# extraction cannot see the figures. These values were transcribed from the
# independently rendered PDF pages (not copied from the same-named PPTX).
VISUAL_PRICE_OVERRIDES = {
    "yoga_gifts_pdf": {
        2: 26, 3: 27, 4: 39, 5: 43, 6: 44, 7: 72, 8: 72, 9: 75,
        10: 79, 11: 82, 12: 108, 13: 117, 14: 123, 15: 160, 16: 198,
    },
    "teachers_day_pdf": {
        2: 28, 3: 29, 4: 32, 5: 35, 6: 42, 7: 42, 8: 47, 9: 49,
        10: 54, 11: 59, 12: 59, 13: 60, 14: 62, 15: 64, 16: 68,
        17: 76, 18: 81, 19: 85, 20: 86, 21: 90, 22: 93, 23: 99,
        24: 110, 25: 120, 26: 126, 27: 128, 28: 144, 29: 153,
        30: 188, 31: 232,
    },
}


def natural_page_number(path: Path) -> int:
    match = re.search(r"(\d+)(?!.*\d)", path.stem)
    return int(match.group(1)) if match else 0


def render_images(material: dict) -> list[Path]:
    paths = sorted(
        [path for path in material["renderDir"].iterdir() if path.suffix.lower() in {".png", ".jpg", ".jpeg"}],
        key=natural_page_number,
    )
    if len(paths) != material["expectedPages"]:
        raise RuntimeError(f"{material['materialId']} rendered page count {len(paths)} != {material['expectedPages']}")
    return paths


def pdf_texts(path: Path) -> list[str]:
    reader = PdfReader(str(path))
    return [normalize_text(page.extract_text() or "") for page in reader.pages]


def pptx_texts(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as archive:
        slide_names = sorted(
            [name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)],
            key=lambda name: int(re.search(r"slide(\d+)\.xml", name).group(1)),
        )
        texts = []
        for name in slide_names:
            root = ElementTree.fromstring(archive.read(name))
            values = [node.text or "" for node in root.iter() if node.tag.endswith("}t")]
            texts.append(normalize_text(" ".join(values)))
        return texts


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def extract_price(text: str) -> tuple[float | None, str | None]:
    patterns = [
        (r"(?:礼盒售价|产品价格|礼盒.{0,5}售价|售价)\s*[：:]?\s*(?:活动款\s*)?(\d+(?:\.\d+)?)", "ppt_page_marked_price"),
        (r"采购价\s*[：:]?\s*(\d+(?:\.\d+)?)\s*元", "ppt_page_marked_purchase_price"),
        (r"[¥￥]\s*(\d+(?:\.\d+)?)\s*元?", "ppt_page_marked_currency_price"),
        (r"(\d+(?:\.\d+)?)\s*元", "ppt_page_marked_yuan_price"),
    ]
    for pattern, label in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            value = float(match.group(1))
            return (int(value) if value.is_integer() else value), label
    return None, None


def product_hints(text: str) -> list[str]:
    return [term for term in PRODUCT_TERMS if term in text][:12]


def page_is_eligible(page_number: int, text: str, price: float | None) -> bool:
    if page_number == 1 or price is None:
        return False
    if re.search(r"合作伙伴|BUSINESS CUSTOMIZATION|一程引路|满心长明", text, flags=re.IGNORECASE):
        return False
    return True


def write_page_jpeg(source: Path, target: Path) -> tuple[int, str]:
    with Image.open(source) as image:
        rgb = image.convert("RGB")
        quality = 90
        while True:
            buffer = io.BytesIO()
            rgb.save(buffer, format="JPEG", quality=quality, optimize=True, progressive=True)
            payload = buffer.getvalue()
            if len(payload) <= MAX_PAGE_IMAGE_BYTES or quality <= 68:
                break
            quality -= 6
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    return len(payload), hashlib.sha256(payload).hexdigest()


def write_send_pdf(images: list[Path], target: Path) -> tuple[int, int]:
    target.parent.mkdir(parents=True, exist_ok=True)
    for quality in (88, 82, 76, 70):
        encoded_pages = []
        page_images = []
        try:
            for source in images:
                with Image.open(source) as image:
                    buffer = io.BytesIO()
                    image.convert("RGB").save(buffer, format="JPEG", quality=quality, optimize=True, progressive=True)
                    encoded_pages.append(buffer.getvalue())
            for payload in encoded_pages:
                page_images.append(Image.open(io.BytesIO(payload)).convert("RGB"))
            first, rest = page_images[0], page_images[1:]
            first.save(target, format="PDF", save_all=True, append_images=rest, resolution=144.0)
        finally:
            for image in page_images:
                image.close()
        size = target.stat().st_size
        if size <= MAX_SEND_FILE_BYTES:
            reopened = PdfReader(str(target))
            if len(reopened.pages) != len(images):
                raise RuntimeError(f"{target.name} PDF page count mismatch")
            return size, quality
    raise RuntimeError(f"{target.name} exceeds WeCom 20MB after compression")


def build_material(material: dict) -> tuple[dict, list[dict], dict]:
    if not material["sourcePath"].is_file():
        raise FileNotFoundError(material["sourcePath"])
    images = render_images(material)
    texts = pdf_texts(material["sourcePath"]) if material["format"] == "pdf" else pptx_texts(material["sourcePath"])
    if len(texts) != len(images):
        raise RuntimeError(f"{material['materialId']} text page count {len(texts)} != rendered page count {len(images)}")
    send_path = STORAGE_ROOT / material["sendFileName"]
    send_size, pdf_quality = write_send_pdf(images, send_path)
    page_dir = PAGE_ROOT / material["materialId"]
    pages = []
    prices = []
    for index, (image, text) in enumerate(zip(images, texts), start=1):
        price, price_label = extract_price(text)
        visual_price = VISUAL_PRICE_OVERRIDES.get(material["materialId"], {}).get(index)
        if visual_price is not None:
            price = visual_price
            price_label = "pdf_page_visually_verified_price"
        if price is not None:
            prices.append(float(price))
        page_path = page_dir / f"page-{index:04d}.jpg"
        image_size, image_hash = write_page_jpeg(image, page_path)
        pages.append({
            "materialId": material["materialId"],
            "pageNumber": index,
            "imageStorageRelativePath": page_path.relative_to(STORAGE_ROOT.parent.parent).as_posix(),
            "text": text,
            "productHints": product_hints(text),
            "listedPriceCny": price,
            "priceLabel": price_label,
            "eligible": page_is_eligible(index, text, price),
            "imageBytes": image_size,
            "imageSha256": image_hash,
        })
    material_record = {
        "materialId": material["materialId"],
        "category": material["category"],
        "title": material["title"],
        "sourceName": material["sourceName"],
        "sendFileName": material["sendFileName"],
        "pageCount": len(pages),
        "eligiblePageCount": sum(1 for page in pages if page["eligible"]),
        "minimumListedPriceCny": min(prices) if prices else None,
        "maximumListedPriceCny": max(prices) if prices else None,
        "variantPriority": material["variantPriority"],
    }
    qa = {
        **material_record,
        "sendFileBytes": send_size,
        "sendPdfQuality": pdf_quality,
        "missingPricePages": [page["pageNumber"] for page in pages if page["pageNumber"] > 1 and page["listedPriceCny"] is None],
        "oversizedPageImages": [page["pageNumber"] for page in pages if page["imageBytes"] > MAX_PAGE_IMAGE_BYTES],
    }
    return material_record, pages, qa


def main() -> None:
    PAGE_ROOT.mkdir(parents=True, exist_ok=True)
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    material_ids = {item["materialId"] for item in MATERIALS}
    index["materials"] = [item for item in index.get("materials", []) if item.get("materialId") not in material_ids]
    index["pages"] = [item for item in index.get("pages", []) if item.get("materialId") not in material_ids]
    qa_results = []
    for material in MATERIALS:
        material_record, pages, qa = build_material(material)
        index["materials"].append(material_record)
        index["pages"].extend(pages)
        qa_results.append(qa)
    index["version"] = max(2, int(index.get("version") or 0))
    INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    documentation_index = {
        "version": index["version"],
        "generatedAt": "2026-08-21",
        "policy": {
            "maximumRecommendedPages": 3,
            "messageCountWithText": 4,
            "sourceIntegrity": "Each image is a direct rendering of the corresponding approved independent source page.",
            "priceSemantics": "Page-marked amounts are selling prices; catalog prices are internal costs.",
            "specificCategoryVolumes": "Five independent volumes across yoga, business gifts, and Teachers' Day; never merge same-named files.",
        },
        "materials": index["materials"],
        "pages": index["pages"],
    }
    DOC_INDEX_PATH.write_text(json.dumps(documentation_index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    QA_PATH.parent.mkdir(parents=True, exist_ok=True)
    QA_PATH.write_text(json.dumps({"materials": qa_results}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "materialCount": len(index["materials"]),
        "pageCount": len(index["pages"]),
        "newMaterials": qa_results,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
