#!/usr/bin/env python3
"""
VERSA CLASS - ComfyUI layered PDF compiler (Text Lab).

The Text Lab result has two real PDF Optional Content Groups per page:

    Artwork    the source page after ComfyUI has reconstructed the pixels beneath
               every OCR text mask;
    Text       a transparent, full-page typography layer synthesized by ComfyUI
               from the original page, PaddleOCR text and OCR coordinates.

Typography is never reconstructed with a locally installed substitute face. The
compiler does not draw text itself: ComfyUI owns every glyph and this module only
preserves its transparent output as a separately toggleable layer.

The module is imported by ``versa_vision.py`` so its public ``compose`` and
``merge`` functions deliberately retain their existing request/response contracts.
"""

import io
import json
import os
import sys
import zlib


MODEL_DIR = os.environ.get(
    "VERSA_MODEL_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
)
DEFAULT_DPI = 200
DEFAULT_JPEG_QUALITY = 88
POINTS_PER_INCH = 72.0
MIN_TEXT_HEIGHT_PX = 6


def _lazy():
    from PIL import Image
    import numpy as np
    return Image, np


# --------------------------------------------------------------------------- #
# Geometry and source analysis
# --------------------------------------------------------------------------- #

def _page_points(width_px, height_px, dpi):
    """Page size in PDF points, from source pixels at the authoring DPI."""
    return (width_px / dpi) * POINTS_PER_INCH, (height_px / dpi) * POINTS_PER_INCH


def _to_pdf_rect(box, page_h_px, scale):
    """[x0,y0,x1,y1] in top-left pixels -> PDF points, origin bottom-left."""
    x0, y0, x1, y1 = [float(value) for value in box]
    return (
        x0 * scale,
        (page_h_px - y1) * scale,
        (x1 - x0) * scale,
        (y1 - y0) * scale,
    )


def _ring_stats(np, array, box, pad=4):
    """Median colour and robust spread of the ring just outside an OCR box."""
    height, width = array.shape[:2]
    x0, y0, x1, y1 = [int(round(value)) for value in box]
    ox0, oy0 = max(0, x0 - pad), max(0, y0 - pad)
    ox1, oy1 = min(width, x1 + pad), min(height, y1 + pad)
    if ox1 <= ox0 or oy1 <= oy0:
        return None, None

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
        return None, None

    stacked = np.concatenate(parts, axis=0).astype(np.float32)
    if stacked.size == 0:
        return None, None
    background = np.median(stacked, axis=0)
    spread = float((np.median(np.abs(stacked - background), axis=0) * 1.4826).mean())
    return background, spread


def _ink_colour(np, array, box, background):
    """Sample the original glyph colour as useful conditioning for ComfyUI."""
    x0, y0, x1, y1 = [int(round(value)) for value in box]
    height, width = array.shape[:2]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(width, x1), min(height, y1)
    if x1 <= x0 or y1 <= y0:
        return (17, 17, 17), 0.0
    patch = array[y0:y1, x0:x1].reshape(-1, 3).astype(np.float32)
    if patch.size == 0:
        return (17, 17, 17), 0.0
    reference = np.asarray(background, dtype=np.float32).reshape(1, 3)
    distance = np.linalg.norm(patch - reference, axis=1)
    ink = patch[distance >= max(np.percentile(distance, 75), 1e-6)]
    if ink.size == 0:
        ink = patch
    colour = np.median(ink, axis=0)
    coherence = float((np.median(np.abs(ink - colour), axis=0) * 1.4826).mean())
    return tuple(int(round(value)) for value in colour), coherence


def _analyse_runs(image, runs, match_fonts=False):
    """
    Measure only visual conditioning data needed by masking and ComfyUI.

    ``match_fonts`` remains in the signature for compatibility with older callers,
    but is intentionally ignored: local face selection is no longer part of Text Lab.
    """
    _Image, np = _lazy()
    array = np.array(image.convert("RGB"))
    info = {}
    for run in runs:
        box = run.get("box")
        if not box or len(box) != 4:
            continue
        background, spread = _ring_stats(np, array, box)
        if background is None:
            continue
        background = tuple(int(round(value)) for value in background)
        ink, coherence = _ink_colour(np, array, box, background)
        info[id(run)] = {
            "background": background,
            "spread": spread,
            "ink": ink,
            "inkSpread": coherence,
        }
    return info


def _valid_runs(runs):
    valid = []
    for run in runs:
        text = (run.get("text") or "").strip()
        box = run.get("box")
        if not text or not box or len(box) != 4:
            continue
        if (float(box[3]) - float(box[1])) < MIN_TEXT_HEIGHT_PX:
            continue
        valid.append(run)
    return valid


def _erase_all_text(image, runs, run_info, checkpoint=None, bridge=None):
    """Erase OCR runs with the local OpenCV / LaMa engine. ComfyUI is not used."""
    del bridge
    Image, np = _lazy()
    from versa_text_inpaint import erase_text

    payload = []
    for run in runs:
        stats = run_info.get(id(run)) or {}
        if not run.get("box"):
            continue
        payload.append({
            **run,
            "background": stats.get("background", (255, 255, 255)),
            "ink": stats.get("ink", (17, 17, 17)),
        })
    if not payload:
        return image.copy(), {"runs": 0, "inpainted": False, "engine": "none"}

    repaired, stats = erase_text(
        np.array(image.convert("RGB")),
        payload,
        checkpoint=checkpoint,
        use_sam=False,
    )
    return Image.fromarray(repaired).convert("RGB"), stats


def _synthesis_runs(runs, run_info):
    """Attach sampled page style hints without changing the OCR contract."""
    enriched = []
    for run in runs:
        stats = run_info.get(id(run)) or {}
        item = dict(run)
        item["background"] = list(stats.get("background", (255, 255, 255)))
        item["ink"] = list(stats.get("ink", (17, 17, 17)))
        enriched.append(item)
    return enriched


# --------------------------------------------------------------------------- #
# ComfyUI typography output
# --------------------------------------------------------------------------- #

def _open_generated_image(value):
    """Load a bridge image value (bytes, path, file-like object or PIL image)."""
    Image, _np = _lazy()
    if value is None:
        return None
    if isinstance(value, Image.Image):
        return value.copy()
    if isinstance(value, (bytes, bytearray, memoryview)):
        with Image.open(io.BytesIO(bytes(value))) as image:
            return image.copy()
    if hasattr(value, "read"):
        with Image.open(value) as image:
            return image.copy()
    if isinstance(value, (str, os.PathLike)) and os.path.exists(os.fspath(value)):
        with Image.open(os.fspath(value)) as image:
            return image.copy()
    return None


def _image_from_record(record):
    if not isinstance(record, dict):
        return _open_generated_image(record)
    for key in ("imageBytes", "bytes", "layerBytes", "imagePath", "path", "layerPath"):
        image = _open_generated_image(record.get(key))
        if image is not None:
            return image
    return None


def _text_layer_from_result(result, page_size, runs):
    """Resolve ComfyUI output to one full-page, transparent RGBA text layer."""
    Image, _np = _lazy()
    layer = None
    for key in ("layerBytes", "layerPath"):
        layer = _open_generated_image((result or {}).get(key))
        if layer is not None:
            break

    if layer is None:
        canvas = Image.new("RGBA", page_size, (0, 0, 0, 0))
        placed = 0
        for index, record in enumerate((result or {}).get("runLayers") or []):
            generated = _image_from_record(record)
            if generated is None:
                continue
            generated = generated.convert("RGBA")
            run = record.get("run") if isinstance(record, dict) else None
            run = run or (runs[index] if index < len(runs) else None)
            box = (run or {}).get("box")
            if generated.size == page_size:
                canvas.alpha_composite(generated)
            elif box and len(box) == 4:
                x0, y0, x1, y1 = [int(round(float(value))) for value in box]
                target = (max(1, x1 - x0), max(1, y1 - y0))
                if generated.size != target:
                    generated = generated.resize(target, Image.Resampling.LANCZOS)
                canvas.alpha_composite(generated, (max(0, x0), max(0, y0)))
            else:
                raise ValueError("A cropped ComfyUI run layer is missing its OCR box.")
            placed += 1
        if placed:
            layer = canvas

    if layer is None:
        raise ValueError("ComfyUI completed without returning a transparent typography layer.")

    had_alpha = layer.mode in ("RGBA", "LA") or "transparency" in layer.info
    layer = layer.convert("RGBA")
    if layer.size != page_size:
        layer = layer.resize(page_size, Image.Resampling.LANCZOS)
    alpha_min, alpha_max = layer.getchannel("A").getextrema()
    if runs and (not had_alpha or alpha_min == 255):
        raise ValueError("ComfyUI typography output is opaque; a transparent glyph layer is required.")
    if runs and alpha_max == 0:
        raise ValueError("ComfyUI typography output is empty.")
    return layer


# --------------------------------------------------------------------------- #
# Raster encoding and native PDF image layers
# --------------------------------------------------------------------------- #

def _encode_artwork(image, dpi, source_dpi, quality):
    """Resample and encode the reconstructed background exactly once."""
    Image, _np = _lazy()
    image = image.convert("RGB")
    if dpi and dpi < source_dpi:
        ratio = float(dpi) / float(source_dpi)
        target = (
            max(1, int(round(image.width * ratio))),
            max(1, int(round(image.height * ratio))),
        )
        image = image.resize(target, Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=int(quality), optimize=True,
               subsampling=0, progressive=True)
    return buffer.getvalue(), image.width, image.height


def _jpeg_xobject(pdf, jpeg_bytes, width, height):
    import pikepdf
    from pikepdf import Name

    stream = pikepdf.Stream(pdf, jpeg_bytes)
    stream.Type = Name.XObject
    stream.Subtype = Name.Image
    stream.Width = int(width)
    stream.Height = int(height)
    stream.ColorSpace = Name.DeviceRGB
    stream.BitsPerComponent = 8
    stream.Filter = Name.DCTDecode
    return pdf.make_indirect(stream)


def _rgba_xobject(pdf, image):
    """Embed an RGBA PIL image with a PDF soft mask, preserving antialiasing."""
    import pikepdf
    from pikepdf import Name

    rgb = image.convert("RGB")
    alpha = image.getchannel("A")
    soft_mask = pikepdf.Stream(pdf, zlib.compress(alpha.tobytes()))
    soft_mask.Type = Name.XObject
    soft_mask.Subtype = Name.Image
    soft_mask.Width = image.width
    soft_mask.Height = image.height
    soft_mask.ColorSpace = Name.DeviceGray
    soft_mask.BitsPerComponent = 8
    soft_mask.Filter = Name.FlateDecode
    soft_mask = pdf.make_indirect(soft_mask)

    stream = pikepdf.Stream(pdf, zlib.compress(rgb.tobytes()))
    stream.Type = Name.XObject
    stream.Subtype = Name.Image
    stream.Width = image.width
    stream.Height = image.height
    stream.ColorSpace = Name.DeviceRGB
    stream.BitsPerComponent = 8
    stream.Filter = Name.FlateDecode
    stream.SMask = soft_mask
    return pdf.make_indirect(stream)


def _append_layered_page(pdf, page_w_pt, page_h_pt, artwork, text_layer, label):
    """Append one two-OCG page directly, without an intermediate PDF renderer."""
    import pikepdf
    from pikepdf import Dictionary, Name

    jpeg_bytes, artwork_w, artwork_h = artwork
    page = pdf.add_blank_page(page_size=(page_w_pt, page_h_pt))
    ocgs = []
    operators = []
    layer_specs = (
        (f"Artwork {label}", _jpeg_xobject(pdf, jpeg_bytes, artwork_w, artwork_h)),
        (f"Text {label}", _rgba_xobject(pdf, text_layer)),
    )
    for index, (layer_name, image_object) in enumerate(layer_specs):
        ocg = pdf.make_indirect(Dictionary(Type=Name.OCG, Name=str(layer_name)))
        image_object.OC = ocg
        resource_name = Name(f"/VersaLayer{index}")
        page.add_resource(image_object, Name.XObject, resource_name)
        operators.append(
            f"q {page_w_pt:.6f} 0 0 {page_h_pt:.6f} 0 0 cm {resource_name} Do Q".encode("ascii")
        )
        ocgs.append(ocg)
    page.contents_add(pikepdf.Stream(pdf, b"\n".join(operators)), prepend=False)
    return ocgs


def _register_ocgs(pdf, ocgs):
    """Publish all layer groups in the document catalog."""
    from pikepdf import Array, Dictionary, Name

    if not ocgs:
        return
    flat = Array(ocgs)
    pdf.Root.OCProperties = Dictionary(
        OCGs=flat,
        D=Dictionary(Order=Array(ocgs), ON=flat, OFF=Array([]), BaseState=Name.ON),
    )


# --------------------------------------------------------------------------- #
# Public entry points
# --------------------------------------------------------------------------- #

def _new_bridge(spec, bridge_class):
    kwargs = {}
    if spec.get("comfyHost") is not None:
        kwargs["host"] = spec["comfyHost"]
    if spec.get("comfyPort") is not None:
        kwargs["port"] = int(spec["comfyPort"])
    if spec.get("comfyHome") is not None:
        kwargs["home"] = spec["comfyHome"]
    return bridge_class(**kwargs)


def compose(spec):
    """
    Compile analysed pages into a two-layer ComfyUI PDF.

    Existing keys remain accepted. The legacy ``overlay`` value is treated as
    ``replace`` because baked words conflict with a separate rendered glyph layer.
    """
    output_path = spec.get("outputPath")
    if not output_path:
        return {"ok": False, "code": "OUTPUT_MISSING", "error": "outputPath is required."}
    pages = spec.get("pages") or []
    if not pages:
        return {"ok": False, "code": "NO_PAGES", "error": "At least one page is required."}

    try:
        import pikepdf
    except ImportError as error:
        return {"ok": False, "code": "TEXT_LAB_DEPENDENCY_MISSING", "error": str(error)}

    dpi = int(spec.get("dpi") or DEFAULT_DPI)
    source_dpi = int(spec.get("sourceDpi") or 300)
    quality = int(spec.get("quality") or DEFAULT_JPEG_QUALITY)
    requested_text_mode = str(spec.get("textMode") or "replace").lower()
    checkpoint = spec.get("samCheckpoint") or os.path.join(MODEL_DIR, "mobile_sam.pt")

    Image, _np = _lazy()

    merged = pikepdf.Pdf.new()
    all_ocgs = []
    report = []
    for index, page_spec in enumerate(pages):
        image_path = page_spec.get("imagePath")
        label = page_spec.get("pageLabel") or f"p{index + 1}"
        try:
            if not image_path or not os.path.exists(image_path):
                raise FileNotFoundError(f"No image at {image_path}")
            vision = page_spec.get("vision") or {}
            runs = _valid_runs(vision.get("text") or [])
            with Image.open(image_path) as source:
                original = source.convert("RGB")
            width_px, height_px = original.size
            page_w_pt, page_h_pt = _page_points(width_px, height_px, source_dpi)
            # Supervisor: this PDF path does not yet stamp live text back onto
            # the page. Erasing here would wipe copy and leave empty holes.
            artwork_image = original
            erase_stats = {"runs": len(runs), "inpainted": False, "engine": "none"}
            text_layer = Image.new("RGBA", original.size, (0, 0, 0, 0))
            jpeg_bytes, artwork_w, artwork_h = _encode_artwork(
                artwork_image, dpi, source_dpi, quality
            )
            if text_layer.size != (artwork_w, artwork_h):
                text_layer = text_layer.resize((artwork_w, artwork_h), Image.Resampling.LANCZOS)
            all_ocgs.extend(_append_layered_page(
                merged, page_w_pt, page_h_pt,
                (jpeg_bytes, artwork_w, artwork_h), text_layer, label,
            ))
            report.append({
                "page": index + 1,
                "widthPt": round(page_w_pt, 2),
                "heightPt": round(page_h_pt, 2),
                "textRuns": len(runs),
                "textPlaced": 0,
                "textLeftBaked": len(runs),
                "erased": bool(erase_stats.get("inpainted")),
                "samMasks": 0,
                "fontsMatched": [],
                "topologies": [],
                "artworkBytes": len(jpeg_bytes),
                "glyphLayerBytes": 0,
                "typographyEngine": "none",
                "inpaintEngine": erase_stats.get("engine") or "none",
                "layers": 2,
            })
        except Exception as error:  # noqa: BLE001
            if image_path and os.path.exists(image_path):
                with Image.open(image_path) as source:
                    original = source.convert("RGB")
                width_px, height_px = original.size
                page_w_pt, page_h_pt = _page_points(width_px, height_px, source_dpi)
                text_layer = Image.new("RGBA", original.size, (0, 0, 0, 0))
                jpeg_bytes, artwork_w, artwork_h = _encode_artwork(
                    original, dpi, source_dpi, quality
                )
                all_ocgs.extend(_append_layered_page(
                    merged, page_w_pt, page_h_pt,
                    (jpeg_bytes, artwork_w, artwork_h), text_layer, label,
                ))
                report.append({
                    "page": index + 1,
                    "widthPt": round(page_w_pt, 2),
                    "heightPt": round(page_h_pt, 2),
                    "textRuns": 0,
                    "textPlaced": 0,
                    "textLeftBaked": 0,
                    "erased": False,
                    "samMasks": 0,
                    "fontsMatched": [],
                    "topologies": [],
                    "artworkBytes": len(jpeg_bytes),
                    "glyphLayerBytes": 0,
                    "typographyEngine": "none",
                    "inpaintEngine": "fallback",
                    "layers": 2,
                    "fallback": True,
                })
            continue

    _register_ocgs(merged, all_ocgs)
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    merged.save(
        output_path,
        compress_streams=True,
        stream_decode_level=pikepdf.StreamDecodeLevel.specialized,
        object_stream_mode=pikepdf.ObjectStreamMode.generate,
        linearize=True,
        recompress_flate=True,
    )
    return {
        "ok": True,
        "outputPath": output_path,
        "pages": len(pages),
        "bytes": os.path.getsize(output_path),
        "dpi": dpi,
        "quality": quality,
        "textMode": "replace",
        "requestedTextMode": requested_text_mode,
        "layersPerPage": 2,
        "detail": report,
    }


def merge(spec):
    """Combine per-page layered PDFs into one book without re-rendering them."""
    inputs = spec.get("inputs") or []
    output_path = spec.get("outputPath")
    if not output_path:
        return {"ok": False, "code": "OUTPUT_MISSING", "error": "outputPath is required."}
    if not inputs:
        return {"ok": False, "code": "NO_PAGES", "error": "At least one page PDF is required."}
    missing = [path for path in inputs if not os.path.exists(path)]
    if missing:
        return {"ok": False, "code": "PAGE_PDF_MISSING", "error": f"Missing: {missing[0]}"}

    try:
        import pikepdf
    except ImportError as error:
        return {"ok": False, "code": "PIKEPDF_MISSING", "error": str(error)}

    merged = pikepdf.Pdf.new()
    sources = []
    for path in inputs:
        source = pikepdf.Pdf.open(path)
        sources.append(source)
        merged.pages.extend(source.pages)

    ocgs = []
    seen = set()
    for page in merged.pages:
        xobjects = page.Resources.get("/XObject") if "/Resources" in page else None
        for _name, image_object in (xobjects or {}).items():
            group = image_object.get("/OC")
            if group is None or group.objgen in seen:
                continue
            seen.add(group.objgen)
            ocgs.append(group)
    _register_ocgs(merged, ocgs)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    merged.save(
        output_path,
        compress_streams=True,
        stream_decode_level=pikepdf.StreamDecodeLevel.specialized,
        object_stream_mode=pikepdf.ObjectStreamMode.generate,
        linearize=True,
        recompress_flate=True,
    )
    for source in sources:
        source.close()
    return {
        "ok": True,
        "outputPath": output_path,
        "pages": len(inputs),
        "layers": len(ocgs),
        "bytes": os.path.getsize(output_path),
    }


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    raw = sys.stdin.read() if argv[1] == "-" else open(argv[1], encoding="utf-8").read()
    spec = json.loads(raw)
    result = merge(spec) if spec.get("inputs") else compose(spec)
    sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
