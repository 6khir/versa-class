#!/usr/bin/env python3
"""
VERSA CLASS - Layered PPTX compiler (Option A: local Python only).

Each source page becomes EXACTLY one slide:
  1. Cleaned artwork as a full-bleed background.
  2. One native PowerPoint text box per OCR run, mapped 1:1 from image pixels
     onto the slide (EMU), sitting on that same slide.

ComfyUI is not used. A failed page keeps its original artwork and the deck
continues.
"""

import json
import os
import sys
import tempfile

from PIL import Image
import numpy as np

try:
    from pptx import Presentation
    from pptx.util import Inches, Pt, Emu
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    from pptx.enum.shapes import MSO_SHAPE_TYPE
except ImportError as error:
    raise RuntimeError(
        f"FATAL: python-pptx resolution failed on interpreter: {sys.executable}. Details: {error}"
    ) from error

from versa_text_inpaint import erase_text
from versa_text_canon import extract_canonical_lines, repair_runs

POINTS_PER_INCH = 72.0
DEFAULT_DPI = 300
MIN_TEXT_HEIGHT_PX = 6
MIN_PPTX_BYTES = 2048

TEACHER_FONT_MAP = {
    "DISPLAY": "Comic Sans MS",
    "SERIF": "Georgia",
    "SANS_SERIF": "Arial",
    "MONOSPACE": "Courier New",
    "ComicSansMS": "Comic Sans MS",
    "Chalkboard": "Comic Sans MS",
    "Georgia": "Georgia",
    "TrebuchetMS": "Trebuchet MS",
    "Arial": "Arial",
    "Helvetica": "Arial",
}


def _clean_font_name(matched_name, topology):
    if matched_name:
        base = matched_name.split("-")[0].replace(" ", "")
        for key, friendly in TEACHER_FONT_MAP.items():
            if key.lower() in base.lower():
                is_bold = "bold" in matched_name.lower() or "black" in matched_name.lower()
                return friendly, is_bold
    if topology in TEACHER_FONT_MAP:
        return TEACHER_FONT_MAP[topology], False
    return "Arial", False


def _ring_stats(array, box, pad=4):
    height, width = array.shape[:2]
    x0, y0, x1, y1 = [int(round(value)) for value in box]
    ox0, oy0 = max(0, x0 - pad), max(0, y0 - pad)
    ox1, oy1 = min(width, x1 + pad), min(height, y1 + pad)
    parts = []
    if oy0 < y0:
        parts.append(array[oy0:y0, ox0:ox1].reshape(-1, 3))
    if y1 < oy1:
        parts.append(array[y1:oy1, ox0:ox1].reshape(-1, 3))
    if ox0 < x0:
        parts.append(array[oy0:oy1, ox0:x0].reshape(-1, 3))
    if x1 < ox1:
        parts.append(array[oy0:oy1, x1:ox1].reshape(-1, 3))
    if not parts:
        return None
    stacked = np.concatenate(parts, axis=0).astype(np.float32)
    if stacked.size == 0:
        return None
    return tuple(int(round(value)) for value in np.median(stacked, axis=0))


def _ink_colour(array, box, background):
    x0, y0, x1, y1 = [int(round(value)) for value in box]
    height, width = array.shape[:2]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(width, x1), min(height, y1)
    if x1 <= x0 or y1 <= y0:
        return (20, 20, 20)
    patch = array[y0:y1, x0:x1].reshape(-1, 3).astype(np.float32)
    if patch.size == 0:
        return (20, 20, 20)
    reference = np.asarray(background, dtype=np.float32).reshape(1, 3)
    distance = np.linalg.norm(patch - reference, axis=1)
    ink = patch[distance >= max(np.percentile(distance, 75), 1e-6)]
    if ink.size == 0:
        ink = patch
    return tuple(int(round(value)) for value in np.median(ink, axis=0))


def _px_to_emu(value, source_px, slide_emu):
    if source_px <= 0:
        return 0
    return int(round((float(value) / float(source_px)) * int(slide_emu)))


def _align_for_box(box, page_w):
    x0, _y0, x1, _y1 = [float(value) for value in box]
    width = max(1.0, x1 - x0)
    center = (x0 + x1) / 2.0
    if width > page_w * 0.45 and abs(center - page_w / 2.0) < page_w * 0.12:
        return PP_ALIGN.CENTER
    return PP_ALIGN.LEFT


def _add_background(slide, image, slide_w, slide_h):
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as handle:
        image.save(handle.name, format="JPEG", quality=90)
        path = handle.name
    try:
        slide.shapes.add_picture(path, Emu(0), Emu(0), slide_w, slide_h)
    finally:
        if os.path.exists(path):
            os.remove(path)


def _measure_overflow(text, width_pt, size_pt):
    chars = max(1, len(text or ""))
    # Arial-ish average width. Used only as a conservative fit check.
    needed = chars * size_pt * 0.52
    return needed > max(8.0, width_pt)


def _place_textbox(slide, item, page_w, page_h, slide_w, slide_h):
    x0, y0, x1, y1 = [float(value) for value in item["box"]]
    inset = float(item.get("inset_px") or 0)
    x0 += inset
    y0 += inset
    x1 -= inset
    y1 -= inset
    left = max(0, _px_to_emu(x0, page_w, slide_w))
    top = max(0, _px_to_emu(y0, page_h, slide_h))
    width = max(Emu(9525), _px_to_emu(max(1.0, x1 - x0), page_w, slide_w))
    height = max(Emu(9525), _px_to_emu(max(1.0, y1 - y0), page_h, slide_h))
    if left + width > slide_w:
        width = max(Emu(9525), slide_w - left)
    if top + height > slide_h:
        height = max(Emu(9525), slide_h - top)

    requested = float(item.get("font_size_pt") or 0)
    minimum = float(item.get("min_font_size_pt") or 10)
    height_pt = (height / 914400.0) * POINTS_PER_INCH
    width_pt = (width / 914400.0) * POINTS_PER_INCH
    font_size = requested if requested > 0 else max(6.0, height_pt * 0.78)
    if item.get("strict_fit"):
        while font_size >= minimum and _measure_overflow(item.get("text") or "", width_pt, font_size):
            font_size -= 1
        if _measure_overflow(item.get("text") or "", width_pt, font_size):
            raise ValueError(f"PPTX_OVERFLOW: {item.get('text', '')[:48]}")

    textbox = slide.shapes.add_textbox(left, top, width, height)
    textbox.fill.background()
    textbox.line.fill.background()
    frame = textbox.text_frame
    frame.word_wrap = True
    inset_in = max(0.0, inset / 300.0)
    frame.margin_left = Inches(inset_in if item.get("strict_fit") else 0)
    frame.margin_right = Inches(inset_in if item.get("strict_fit") else 0)
    frame.margin_top = Inches(0)
    frame.margin_bottom = Inches(0)
    frame.vertical_anchor = MSO_ANCHOR.MIDDLE

    paragraph = frame.paragraphs[0]
    paragraph.text = item["text"]
    requested_align = str(item.get("align") or "").lower()
    if requested_align == "center":
        paragraph.alignment = PP_ALIGN.CENTER
    elif requested_align == "right":
        paragraph.alignment = PP_ALIGN.RIGHT
    else:
        paragraph.alignment = _align_for_box(item["box"], page_w)

    ink = item["ink"]
    for target in (paragraph.font, (paragraph.runs[0].font if paragraph.runs else None)):
        if target is None:
            continue
        target.name = item["font_family"]
        target.size = Pt(font_size)
        target.bold = item["is_bold"]
        target.color.rgb = RGBColor(int(ink[0]), int(ink[1]), int(ink[2]))
    return True


def _reshape_vertical(box, page_w):
    x0, y0, x1, y1 = [float(value) for value in box]
    width = max(1.0, x1 - x0)
    height = max(1.0, y1 - y0)
    if height / width <= 2.8:
        return [x0, y0, x1, y1]
    center_x = (x0 + x1) / 2.0
    center_y = (y0 + y1) / 2.0
    new_w = min(page_w * 0.72, max(height * 3.0, 720.0))
    new_h = max(72.0, min(height * 0.18, 140.0))
    return [
        max(page_w * 0.04, center_x - new_w / 2.0),
        max(24.0, center_y - new_h / 2.0),
        min(page_w * 0.96, center_x + new_w / 2.0),
        center_y + new_h / 2.0,
    ]


def _analyse_run(array, run, page_w):
    box = run.get("box")
    text = (run.get("text") or "").strip()
    if not box or len(box) != 4 or not text:
        return None
    if (float(box[3]) - float(box[1])) < MIN_TEXT_HEIGHT_PX:
        return None
    width = max(1.0, float(box[2]) - float(box[0]))
    height = max(1.0, float(box[3]) - float(box[1]))
    if height / width > 3.6 and not run.get("repaired"):
        return None
    if height / width > 2.8 and run.get("repaired"):
        box = _reshape_vertical(box, page_w)
    background = _ring_stats(array, box) or (255, 255, 255)
    ink = _ink_colour(array, box, background)
    family, is_bold = _clean_font_name(run.get("font") or run.get("fontFamily"), run.get("topology") or "SANS_SERIF")
    if run.get("repaired") and len(text) > 18:
        family = "Comic Sans MS"
        is_bold = True
    return {
        "box": box,
        "text": text,
        "background": background,
        "ink": ink,
        "font_family": family,
        "is_bold": is_bold,
    }


def _place_manifest_zone(slide, zone, page_w, page_h, slide_w, slide_h):
    box = zone.get("bbox_px")
    text = (zone.get("text") or "").strip()
    if not box or len(box) != 4 or not text:
        return False
    hex_color = (zone.get("color_hex") or "#2B2B2B").lstrip("#")
    if len(hex_color) != 6:
        hex_color = "2B2B2B"
    ink = tuple(int(hex_color[index:index + 2], 16) for index in (0, 2, 4))
    return _place_textbox(slide, {
        "box": box,
        "text": text,
        "ink": ink,
        "font_family": (
            "Comic Sans MS"
            if not zone.get("font_family_hint") or zone.get("font_family_hint") == "hand-lettered / marker"
            else zone.get("font_family_hint")
        ),
        "is_bold": zone.get("role") in {"heading", "title"},
        "align": zone.get("align"),
        "font_size_pt": zone.get("font_size_pt"),
        "min_font_size_pt": zone.get("min_font_size_pt"),
        "inset_px": zone.get("inset_px") or 0,
        "strict_fit": bool(zone.get("strict_fit")),
    }, page_w, page_h, slide_w, slide_h)


def compose_pptx(spec):
    output_path = spec.get("outputPath")
    if not output_path:
        return {"ok": False, "code": "OUTPUT_MISSING", "error": "outputPath is required."}
    pages = spec.get("pages") or []
    if not pages:
        return {"ok": False, "code": "NO_PAGES", "error": "At least one page is required."}

    first_image_path = pages[0].get("imagePath")
    if not first_image_path or not os.path.exists(first_image_path):
        return {"ok": False, "code": "IMAGE_MISSING", "error": f"Missing image: {first_image_path}"}

    presentation = Presentation()
    blank = presentation.slide_layouts[6]
    with Image.open(first_image_path) as probe:
        first_w, first_h = probe.size
    source_dpi = float(spec.get("sourceDpi") or DEFAULT_DPI)
    presentation.slide_width = Inches(first_w / source_dpi)
    presentation.slide_height = Inches(first_h / source_dpi)
    slide_w = presentation.slide_width
    slide_h = presentation.slide_height

    report = []
    failures = []

    for index, page_spec in enumerate(pages):
        image_path = page_spec.get("imagePath")
        page_label = page_spec.get("pageLabel") or f"Slide {index + 1}"
        fallback = False
        erase_stats = {"inpainted": False, "engine": "none"}
        placed = 0

        try:
            if not image_path or not os.path.exists(image_path):
                raise FileNotFoundError(f"Missing image: {image_path}")

            with Image.open(image_path) as source:
                original = source.convert("RGB")
            array = np.array(original)
            page_w, page_h = original.size
            if spec.get("mode") in {"editable", "rebuild"}:
                manifest = page_spec.get("manifest") or {}
                zones = manifest.get("zones") or []
                if spec.get("mode") == "editable" and not zones:
                    raise ValueError("editable mode requires a manifest with zones")
                slide = presentation.slides.add_slide(blank)
                _add_background(slide, original, slide_w, slide_h)
                for zone in zones:
                    if _place_manifest_zone(slide, zone, page_w, page_h, slide_w, slide_h):
                        placed += 1
                report.append({
                    "slide": index + 1,
                    "pageLabel": page_label,
                    "textRuns": len(zones),
                    "textBoxesPlaced": placed,
                    "erased": False,
                    "engine": "manifest",
                    "fallback": False,
                })
                continue
            vision = page_spec.get("vision") or {}
            details = []
            payload = []
            repaired = 0
            skipped = 0
            for run in repair_runs(vision.get("text") or [], page_spec.get("prompt") or "", page_size=(page_w, page_h)):
                if not run.get("place", True):
                    skipped += 1
                    continue
                detail = _analyse_run(array, run, page_w)
                if not detail:
                    skipped += 1
                    continue
                if run.get("repaired"):
                    repaired += 1
                details.append(detail)
                erase_box = run.get("eraseBox") or run.get("box")
                if run.get("erase", True) and erase_box and len(erase_box) == 4:
                    pad = 8 if run.get("wipeBox") else 4
                    padded = [erase_box[0] - pad, erase_box[1] - pad, erase_box[2] + pad, erase_box[3] + pad]
                    background = _ring_stats(array, padded) or (255, 255, 255)
                    payload.append({
                        "text": run.get("ocrText") or run.get("text") or "",
                        "box": padded,
                        "background": background,
                        "wipeBox": bool(run.get("wipeBox")),
                    })

            cleaned = original
            if payload:
                try:
                    cleaned_np, erase_stats = erase_text(array, payload, use_sam=False)
                    cleaned = Image.fromarray(cleaned_np).convert("RGB")
                except Exception as error:  # noqa: BLE001
                    fallback = True
                    erase_stats = {"inpainted": False, "engine": "fallback", "error": str(error)[:200]}
                    cleaned = original

            # Supervisor: never ship a page that was wiped and not rewritten.
            if erase_stats.get("inpainted") and not details:
                cleaned = original
                erase_stats = {**erase_stats, "inpainted": False, "restored": True}

            slide = presentation.slides.add_slide(blank)
            _add_background(slide, cleaned, slide_w, slide_h)
            if not fallback:
                for item in details:
                    if _place_textbox(slide, item, page_w, page_h, slide_w, slide_h):
                        placed += 1
            else:
                failures.append({"page": index + 1, "label": page_label, "error": erase_stats.get("error")})
            # #region agent log
            try:
                import json as _json
                import time as _time
                with open("/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-702e49.log", "a", encoding="utf-8") as _dbg:
                    _dbg.write(_json.dumps({"sessionId":"702e49","runId":"post-fix","hypothesisId":"B","location":"versa_layered_pptx.py:compose_pptx","message":"erase-place pair","data":{"pageLabel":page_label,"ocrRuns":len((vision.get("text") or [])),"details":len(details),"erasePayload":len(payload),"placed":placed,"erased":bool(erase_stats.get("inpainted")),"restored":bool(erase_stats.get("restored")),"skipped":skipped},"timestamp":int(_time.time()*1000)}) + "\n")
            except Exception:
                pass
            # #endregion
            pictures = sum(1 for shape in slide.shapes if shape.shape_type == MSO_SHAPE_TYPE.PICTURE)
            overflow = 0
            for shape in slide.shapes:
                if int(shape.left) < 0 or int(shape.top) < 0:
                    overflow += 1
                if int(shape.left) + int(shape.width) > int(slide_w) + 2:
                    overflow += 1
                if int(shape.top) + int(shape.height) > int(slide_h) + 2:
                    overflow += 1
        except Exception as error:  # noqa: BLE001
            fallback = True
            failures.append({"page": index + 1, "label": page_label, "error": str(error)[:200]})
            slide = presentation.slides.add_slide(blank)
            if image_path and os.path.exists(image_path):
                with Image.open(image_path) as source:
                    _add_background(slide, source.convert("RGB"), slide_w, slide_h)

        report.append({
            "slide": index + 1,
            "pageLabel": page_label,
            "textRuns": len((page_spec.get("vision") or {}).get("text") or []),
            "textBoxesPlaced": placed,
            "erased": bool(erase_stats.get("inpainted")),
            "engine": erase_stats.get("engine"),
            "fallback": fallback,
        })

    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
    presentation.save(output_path)
    written_bytes = os.path.getsize(output_path) if os.path.isfile(output_path) else 0
    if not os.path.isfile(output_path) or written_bytes < MIN_PPTX_BYTES:
        return {
            "ok": False,
            "code": "PPTX_INVALID",
            "error": f"PPTX was not written or is empty: {output_path}",
            "detail": report,
            "failures": failures,
        }
    if len(presentation.slides) != len(pages):
        return {
            "ok": False,
            "code": "PPTX_SLIDE_COUNT",
            "error": f"Expected {len(pages)} slides, wrote {len(presentation.slides)}.",
            "detail": report,
            "failures": failures,
        }

    return {
        "ok": True,
        "outputPath": output_path,
        "slides": len(presentation.slides),
        "bytes": os.path.getsize(output_path),
        "detail": report,
        "failures": failures,
    }


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1].endswith(".json"):
        with open(sys.argv[1], "r", encoding="utf-8") as handle:
            spec = json.load(handle)
        print(json.dumps(compose_pptx(spec), indent=2))
    else:
        print(__doc__)
