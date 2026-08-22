#!/usr/bin/env python3
"""Build searchable, send-ready page screenshots for customer selection decks."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree

import pdfplumber
from PIL import Image


# Pages rejected during manual visual QA. Keep them in the integrity index, but
# never offer them to a customer until the source page itself is corrected.
VISUAL_QA_EXCLUDED_PAGES = {
    ("beauty_50_80_2026", 15): "top price and size labels are clipped in the approved source rendering",
    ("beauty_50_80_2026", 17): "top price and size labels are clipped in the approved source rendering",
    ("beauty_50_80_2026", 36): "top price and size labels are clipped in the approved source rendering",
}
from pypdf import PdfReader


MATERIALS = [
    ("enterprise_under_50", "2025企业50以内.pdf", "2025企业50以内.pdf", "pdf"),
    ("enterprise_51_100", "企业51-100.pdf", "企业礼赠_51-100元_发送版.pdf", "pdf"),
    ("enterprise_101_150", "企业101-150.pdf", "企业礼赠_101-150元_发送版.pdf", "pdf"),
    ("enterprise_151_200", "企业151-200.pdf", "企业礼赠_151-200元_发送版.pdf", "pdf"),
    ("enterprise_over_200", "2025企业200+.pdf", "2025企业200+.pdf", "pdf"),
    ("beauty_20_below_50", "2025美业20-50.pdf", "美业礼赠_20-50元_发送版.pdf", "pdf"),
    ("beauty_50_80_2026", "2026美业50-80   ppt.pptx", "美业礼赠_50-80元_2026发送版.pdf", "pptx"),
    ("beauty_over_80_100", "2025美业51-100.pdf", "美业礼赠_51-100元_发送版.pdf", "pdf"),
    ("small_budget_under_20", "2026小预算20内 .pptx", "通用小预算_20元以内_2026发送版.pdf", "pptx"),
    ("small_budget_over_20_30", "2026小预算20-30  pptx.pptx", "通用小预算_20-30元_2026发送版.pdf", "pptx"),
    ("small_budget_over_30_50", "2026小预算30-50.pptx", "通用小预算_30-50元_2026发送版.pdf", "pptx"),
]

BOILERPLATE = (
    "临沂臻希礼业",
    "临沂臻希太希阳礼花业束",
    "GIFT LIST",
    "GIFT LIS",
    "臻希礼业",
)
SKIP_HINT_PATTERNS = (
    re.compile(r"^[\d\s./*xX×+\-—~～元￥¥cmCM毫升MLml克gG]+$"),
    re.compile(r"^(礼盒|包装|产品)?尺[寸码]"),
    re.compile(r"^(颜色|规格|材质|数量|装箱|单价|参考价|活动价|市场价|尺寸)"),
    re.compile(r"^(支持|可做|可以|默认|随机|备注|注[:：]?)$"),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--material-root", required=True, type=Path)
    parser.add_argument("--rules-index", required=True, type=Path)
    parser.add_argument("--docs-index", required=True, type=Path)
    parser.add_argument("--pdftoppm", required=True, type=Path)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def pdf_page_texts(path: Path) -> list[str]:
    with pdfplumber.open(path) as pdf:
        return [normalize_text(page.extract_text() or "") for page in pdf.pages]


def pptx_slide_texts(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as archive:
        slide_names = sorted(
            (
                name
                for name in archive.namelist()
                if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
            ),
            key=lambda name: int(re.search(r"slide(\d+)\.xml", name).group(1)),
        )
        texts: list[str] = []
        for slide_name in slide_names:
            root = ElementTree.fromstring(archive.read(slide_name))
            values = [node.text or "" for node in root.iter() if node.tag.endswith("}t")]
            texts.append(normalize_text(" ".join(values)))
        return texts


def normalize_text(value: str) -> str:
    text = str(value or "").replace("\u00a0", " ")
    for boilerplate in BOILERPLATE:
        text = text.replace(boilerplate, " ")
    return re.sub(r"\s+", " ", text).strip()


def product_hints(text: str) -> list[str]:
    candidates = re.split(r"[\s•·|｜,，;；:：。！？!?()（）\[\]【】]+", text)
    hints: list[str] = []
    for raw in candidates:
        value = raw.strip("-—_+*/\\<>《》\"'“”‘’")
        if not value or len(value) < 2 or len(value) > 28:
            continue
        if any(pattern.search(value) for pattern in SKIP_HINT_PATTERNS):
            continue
        if not re.search(r"[\u4e00-\u9fffA-Za-z]", value):
            continue
        if value in hints:
            continue
        hints.append(value)
        if len(hints) >= 12:
            break
    return hints


def render_material_pages(
    pdftoppm: Path,
    pdf_path: Path,
    output_directory: Path,
    page_count: int,
    force: bool,
) -> list[Path]:
    output_paths = [output_directory / f"page-{page_number:04d}.jpg" for page_number in range(1, page_count + 1)]
    if not force and all(path.exists() for path in output_paths):
        for path in output_paths:
            verify_image(path)
        return output_paths
    output_directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="selection-page-") as temporary_directory:
        prefix = Path(temporary_directory) / "page"
        command = [
            str(pdftoppm),
            "-jpeg",
            "-jpegopt", "quality=88,optimize=y,progressive=y",
            "-scale-to-x", "1600",
            "-scale-to-y", "-1",
            str(pdf_path),
            str(prefix),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if completed.returncode != 0:
            raise RuntimeError(f"pdftoppm failed for {pdf_path.name}: {completed.stderr.strip()}")
        rendered_pages = {}
        for rendered in Path(temporary_directory).glob("page-*.jpg"):
            match = re.search(r"-(\d+)\.jpg$", rendered.name)
            if match:
                rendered_pages[int(match.group(1))] = rendered
        if len(rendered_pages) != page_count:
            raise RuntimeError(
                f"pdftoppm page count mismatch for {pdf_path.name}: rendered={len(rendered_pages)} expected={page_count}"
            )
        for page_number, output_path in enumerate(output_paths, start=1):
            compress_image(rendered_pages[page_number], output_path)
    for path in output_paths:
        verify_image(path)
    return output_paths


def compress_image(source: Path, output: Path) -> None:
    with Image.open(source) as opened:
        image = opened.convert("RGB")
        qualities = (88, 84, 80, 76, 72)
        for quality in qualities:
            temporary = output.with_suffix(f".q{quality}.tmp")
            image.save(temporary, format="JPEG", quality=quality, optimize=True, progressive=True, subsampling=0)
            if temporary.stat().st_size <= 1_900_000:
                os.replace(temporary, output)
                remove_quality_temps(output)
                return
            temporary.unlink(missing_ok=True)
        resized = image.copy()
        resized.thumbnail((1400, 1400), Image.Resampling.LANCZOS)
        temporary = output.with_suffix(".resized.tmp")
        resized.save(temporary, format="JPEG", quality=76, optimize=True, progressive=True, subsampling=1)
        if temporary.stat().st_size > 1_900_000:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(f"rendered page cannot be compressed below 1.9 MB: {output}")
        os.replace(temporary, output)
        remove_quality_temps(output)


def remove_quality_temps(output: Path) -> None:
    for item in output.parent.glob(f"{output.stem}.*.tmp"):
        item.unlink(missing_ok=True)


def verify_image(path: Path) -> None:
    if path.stat().st_size <= 5 or path.stat().st_size > 2 * 1024 * 1024:
        raise RuntimeError(f"send image size is invalid: {path}")
    with Image.open(path) as image:
        image.verify()
    with Image.open(path) as image:
        if image.format != "JPEG" or image.width < 1000 or image.height < 500:
            raise RuntimeError(f"send image dimensions or format are invalid: {path}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def main() -> None:
    args = parse_args()
    if not args.pdftoppm.is_file():
        raise FileNotFoundError(args.pdftoppm)
    pages: list[dict] = []
    material_summaries: list[dict] = []
    image_root = args.material_root / "page-recommendations"
    for material_id, source_name, send_name, source_kind in MATERIALS:
        source_path = args.source_root / source_name
        send_path = args.material_root / send_name
        if not source_path.is_file():
            raise FileNotFoundError(source_path)
        if not send_path.is_file():
            raise FileNotFoundError(send_path)
        texts = pdf_page_texts(source_path) if source_kind == "pdf" else pptx_slide_texts(source_path)
        send_page_count = len(PdfReader(send_path).pages)
        if len(texts) != send_page_count:
            raise RuntimeError(
                f"page count mismatch for {material_id}: source={len(texts)} send={send_page_count}"
            )
        material_pages: list[dict] = []
        output_paths = render_material_pages(
            args.pdftoppm,
            send_path,
            image_root / material_id,
            send_page_count,
            args.force,
        )
        for page_number, text in enumerate(texts, start=1):
            output_path = output_paths[page_number - 1]
            hints = product_hints(text)
            record = {
                "materialId": material_id,
                "pageNumber": page_number,
                "imageStorageRelativePath": output_path.relative_to(args.material_root.parent.parent).as_posix(),
                "text": text[:1600],
                "productHints": hints,
                "eligible": bool(hints or len(text) >= 8)
                and (material_id, page_number) not in VISUAL_QA_EXCLUDED_PAGES,
                "imageBytes": output_path.stat().st_size,
                "imageSha256": sha256(output_path),
            }
            pages.append(record)
            material_pages.append(record)
        material_summaries.append({
            "materialId": material_id,
            "sourceName": source_name,
            "sendFileName": send_name,
            "pageCount": len(material_pages),
            "eligiblePageCount": sum(1 for page in material_pages if page["eligible"]),
        })
        print(f"built {material_id}: {len(material_pages)} pages", flush=True)

    data = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "policy": {
            "maximumRecommendedPages": 3,
            "messageCountWithText": 4,
            "sourceIntegrity": "Each image is a direct rendering of the corresponding approved source page.",
        },
        "materials": material_summaries,
        "pages": pages,
    }
    write_json(args.rules_index, data)
    write_json(args.docs_index, data)
    print(json.dumps({
        "materials": len(material_summaries),
        "pages": len(pages),
        "eligiblePages": sum(1 for page in pages if page["eligible"]),
        "rulesIndex": str(args.rules_index),
        "docsIndex": str(args.docs_index),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
