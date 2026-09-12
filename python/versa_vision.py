#!/usr/bin/env python3
"""
VERSA CLASS — local page vision worker.

Runs MobileSAM (segmentation) and PaddleOCR (text) over a rendered page image and
returns a single layer model that aligns every text run to the object it sits on.
That model is what lets the app move an object and carry its text with it, or
rewrite a text run without touching the artwork underneath.

Protocol: newline-delimited JSON on stdin, newline-delimited JSON on stdout.
The process stays alive so the models load once (~3-6s) instead of per page.

  -> {"cmd": "ping"}
  <- {"ok": true, "ready": true, "device": "cpu", "models": {...}}

  -> {"cmd": "analyze", "imagePath": "/abs/page_1.png", "maxSide": 1400}
  <- {"ok": true, "width": .., "height": .., "layers": [...], "orphanText": [...]}

  -> {"cmd": "compose", "spec": { ... see versa_layered_pdf.compose ... }}
  <- {"ok": true, "outputPath": "/abs/book.pdf", "bytes": .., "detail": [...]}

Every response is one line. Errors are {"ok": false, "code": "...", "error": "..."}
so the Node side can degrade instead of crashing.
"""

import base64
import io
import json
import os
import sys
import traceback

# Lazy singletons — importing torch/paddle costs seconds, so it happens on first use.
_STATE = {"sam": None, "ocr": None, "np": None, "Image": None}

MODEL_DIR = os.environ.get(
    "VERSA_MODEL_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "models"),
)
MOBILE_SAM_CHECKPOINT = os.path.join(MODEL_DIR, "mobile_sam.pt")


# --- stdout protection -------------------------------------------------------
# PaddleOCR, tqdm and Paddle's C++ core all write progress and banners to fd 1.
# That is the same channel this protocol uses, so an unguarded run interleaves
# "download https://..." with JSON and the Node bridge fails to parse. Claim the
# real stdout on a private descriptor, then point fd 1 at stderr so *anything*
# else that prints - Python or native - lands on the diagnostic channel instead.
_PROTOCOL_FD = os.dup(1)
os.dup2(2, 1)
_PROTOCOL = os.fdopen(_PROTOCOL_FD, "w", encoding="utf-8", buffering=1)
sys.stdout = sys.stderr


def _emit(payload):
    _PROTOCOL.write(json.dumps(payload, ensure_ascii=False) + "\n")
    _PROTOCOL.flush()


def _fail(code, error):
    return {"ok": False, "code": code, "error": str(error)}


def _numpy():
    if _STATE["np"] is None:
        import numpy

        _STATE["np"] = numpy
    return _STATE["np"]


def _pil():
    if _STATE["Image"] is None:
        from PIL import Image

        _STATE["Image"] = Image
    return _STATE["Image"]


def _load_sam():
    """MobileSAM: ~40MB, CPU-friendly, designed for exactly this class of machine."""
    if _STATE["sam"] is not None:
        return _STATE["sam"]
    import torch
    from mobile_sam import SamAutomaticMaskGenerator, sam_model_registry

    if not os.path.exists(MOBILE_SAM_CHECKPOINT):
        raise FileNotFoundError(
            f"MobileSAM checkpoint missing at {MOBILE_SAM_CHECKPOINT}. "
            "Run python/setup_models.sh first."
        )
    model = sam_model_registry["vit_t"](checkpoint=MOBILE_SAM_CHECKPOINT)
    # M2 has MPS, but SAM's mask decoder is unstable there on some torch builds and
    # a page is a one-shot job, so CPU keeps it predictable and avoids fallback spam.
    model.to(device="cpu")
    model.eval()
    _STATE["sam"] = SamAutomaticMaskGenerator(
        model,
        points_per_side=16,          # 16x16 probes is plenty for worksheet-scale objects
        pred_iou_thresh=0.86,
        stability_score_thresh=0.90,
        min_mask_region_area=1200,   # drop speckle; a real frame or illustration is bigger
    )
    return _STATE["sam"]


def _load_ocr():
    if _STATE["ocr"] is not None:
        return _STATE["ocr"]
    import paddle
    from paddleocr import PaddleOCR

    # Pin the device before the predictors are built. Paddle 3.x otherwise leaves the
    # place undefined on some pages and raises "No allocator found for the place,
    # Place(undefined:0)" partway through a run - it fails on page 2 of a book while
    # pages 1 and 3 succeed, because the first call happens to set it implicitly.
    paddle.set_device("cpu")
    # Torch also runs on this CPU alongside Paddle; letting both size their own pools
    # against all 8 cores oversubscribes an M2 and is where the interop stalls appear.
    try:
        import torch

        torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))
    except Exception:  # noqa: BLE001 - thread tuning is an optimisation, never fatal
        pass

    try:
        _STATE["ocr"] = PaddleOCR(
            use_angle_cls=True,
            lang="en",
            show_log=False,
            use_gpu=False,
            det_db_thresh=0.25,
            det_db_box_thresh=0.40,
            det_db_unclip_ratio=2.3,
        )
    except TypeError:
        _STATE["ocr"] = PaddleOCR(
            use_angle_cls=True,
            lang="en",
            show_log=False,
            use_gpu=False,
        )
    return _STATE["ocr"]


def _run_ocr(image_array):
    """
    OCR one page, rebuilding the predictor if Paddle loses its allocator.

    Paddle 3.0 intermittently drops the current place between calls on the same
    PaddleOCR instance and then raises "No allocator found for the place,
    Place(undefined:0)" from inside matmul. It is reproducible - in a three page
    run, page 2 fails and pages 1 and 3 pass, and that same page 2 succeeds when it
    is the first call - and a fresh predictor always works. Reuse is still the fast
    path (model load is seconds), so this retries once rather than rebuilding for
    every page.
    """
    try:
        return _load_ocr().ocr(image_array, cls=True) or []
    except RuntimeError as error:
        if "allocator" not in str(error).lower():
            raise
        _STATE["ocr"] = None
        return _load_ocr().ocr(image_array, cls=True) or []


def _bbox_of_polygon(points):
    xs = [float(p[0]) for p in points]
    ys = [float(p[1]) for p in points]
    return [min(xs), min(ys), max(xs), max(ys)]


def _iou_contained(text_box, mask_box):
    """Fraction of the text box that falls inside the mask box."""
    tx0, ty0, tx1, ty1 = text_box
    mx0, my0, mx1, my1 = mask_box
    ix0, iy0 = max(tx0, mx0), max(ty0, my0)
    ix1, iy1 = min(tx1, mx1), min(ty1, my1)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    area = max(1e-6, (tx1 - tx0) * (ty1 - ty0))
    return inter / area


def _mask_covers_text(mask, text_box, scale):
    """Pixel-accurate check: is the text centre actually on this mask?"""
    np = _numpy()
    cx = int(((text_box[0] + text_box[2]) / 2) * scale)
    cy = int(((text_box[1] + text_box[3]) / 2) * scale)
    h, w = mask.shape[:2]
    if not (0 <= cx < w and 0 <= cy < h):
        return False
    return bool(np.asarray(mask)[cy, cx])


def analyze(request):
    image_path = request.get("imagePath")
    if not image_path or not os.path.exists(image_path):
        return _fail("IMAGE_MISSING", f"No image at {image_path}")

    np = _numpy()
    Image = _pil()
    original = Image.open(image_path).convert("RGB")
    full_w, full_h = original.size

    # Segmentation runs on a downscaled copy: SAM cost is quadratic in side length and
    # object boundaries do not need 300 DPI. Coordinates are scaled back on the way out.
    max_side = int(request.get("maxSide") or 1400)
    scale = min(1.0, max_side / max(full_w, full_h))
    seg_w, seg_h = max(1, int(full_w * scale)), max(1, int(full_h * scale))
    seg_image = original if scale == 1.0 else original.resize((seg_w, seg_h), Image.LANCZOS)
    seg_array = np.array(seg_image)

    # --- OCR: Apple Vision + Paddle, then prompt-canon repair ---
    apple = []
    try:
        from versa_apple_ocr import recognize_page

        apple = recognize_page(image_path)
    except Exception:
        apple = []
    paddle = []
    raw = _run_ocr(np.array(original))
    for page in raw:
        for line in page or []:
            polygon, (text, confidence) = line[0], line[1]
            text = (text or "").strip()
            if not text or float(confidence) < 0.45:
                continue
            box = _bbox_of_polygon(polygon)
            paddle.append(
                {
                    "id": f"p{len(paddle) + 1}",
                    "text": text,
                    "confidence": round(float(confidence), 4),
                    "box": [round(v, 2) for v in box],
                    "polygon": [[round(float(x), 2), round(float(y), 2)] for x, y in polygon],
                    "engine": "paddle",
                }
            )
    from versa_text_canon import repair_runs, union_runs

    runs = repair_runs(union_runs(apple, paddle), request.get("prompt") or "", page_size=(full_w, full_h))

    # --- Segmentation ---
    generator = _load_sam()
    masks = generator.generate(seg_array)

    layers = []
    for index, mask in enumerate(masks):
        x, y, w, h = mask["bbox"]  # segmentation-space, xywh
        inv = 1.0 / scale if scale else 1.0
        layers.append(
            {
                "id": f"L{index + 1}",
                "box": [round(x * inv, 2), round(y * inv, 2), round((x + w) * inv, 2), round((y + h) * inv, 2)],
                "area": int(mask["area"] * (inv * inv)),
                "stability": round(float(mask.get("stability_score", 0)), 4),
                "predictedIou": round(float(mask.get("predicted_iou", 0)), 4),
                "textIds": [],
                "_mask": mask["segmentation"],
            }
        )

    # Smallest-first so a text run binds to the tightest object that holds it, not the
    # page-sized background mask that technically contains everything.
    layers.sort(key=lambda item: item["area"])

    orphans = []
    for run in runs:
        chosen = None
        for layer in layers:
            if _iou_contained(run["box"], layer["box"]) < 0.6:
                continue
            if _mask_covers_text(layer["_mask"], run["box"], scale):
                chosen = layer
                break
        if chosen is None:
            # Fall back to box containment alone: thin outlined frames often have the
            # glyph centre land on background pixels inside the frame.
            for layer in layers:
                if _iou_contained(run["box"], layer["box"]) >= 0.85:
                    chosen = layer
                    break
        if chosen is None:
            orphans.append(run["id"])
        else:
            chosen["textIds"].append(run["id"])
            run["layerId"] = chosen["id"]

    for layer in layers:
        layer.pop("_mask", None)

    layers.sort(key=lambda item: (-item["area"], item["box"][1]))

    return {
        "ok": True,
        "width": full_w,
        "height": full_h,
        "segmentationScale": round(scale, 4),
        "layers": layers,
        "text": runs,
        "orphanText": orphans,
        "counts": {"layers": len(layers), "text": len(runs), "orphans": len(orphans)},
    }


def ping(_request):
    status = {"mobileSamCheckpoint": os.path.exists(MOBILE_SAM_CHECKPOINT)}
    try:
        import paddleocr  # noqa: F401

        status["paddleocr"] = True
    except Exception:
        status["paddleocr"] = False
    try:
        import mobile_sam  # noqa: F401

        status["mobileSam"] = True
    except Exception:
        status["mobileSam"] = False
    return {
        "ok": True,
        "ready": all(status.values()),
        "device": "cpu",
        "python": sys.version.split()[0],
        "models": status,
        "modelDir": MODEL_DIR,
    }


def compose(request):
    """
    Compile analysed pages into one layered PDF.

    Lives behind the same long-lived worker so a book does not pay a fresh
    interpreter start - and, more to the point, so the PDF stage cannot be reached
    without the vision environment that produced the coordinates it consumes.
    """
    try:
        from versa_layered_pdf import compose as compose_layered
    except ImportError as error:
        return _fail("LAYERED_PDF_UNAVAILABLE", error)
    return compose_layered(request.get("spec") or {})


def merge(request):
    """Combine per-page editable PDFs into one book - the Editable PPTX stage."""
    try:
        from versa_layered_pdf import merge as merge_layered
    except ImportError as error:
        return _fail("LAYERED_PDF_UNAVAILABLE", error)
    return merge_layered(request.get("spec") or {})


def detect_text(request):
    from versa_text_detect import detect

    return detect(request.get("imagePath"))


def compose_pptx(request):
    """
    Compile analysed pages into an editable PowerPoint deck.

    This is the primary editable output for the TPT market: a .pptx opens in
    PowerPoint, Keynote and Google Slides with every text run as a real, draggable,
    retypeable text box. A layered PDF needs Acrobat Pro before a buyer can move or
    retype anything, which most teachers do not have.
    """
    try:
        from versa_layered_pptx import compose_pptx as build_deck
    except ImportError as error:
        return _fail("PPTX_ENGINE_UNAVAILABLE", error)
    return build_deck(request.get("spec") or {})


HANDLERS = {
    "ping": ping,
    "analyze": analyze,
    "detect_text": detect_text,
    "compose": compose,
    "compose_pptx": compose_pptx,
    "merge": merge,
}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as error:
            _emit(_fail("BAD_REQUEST", error))
            continue
        handler = HANDLERS.get(request.get("cmd"))
        if handler is None:
            _emit(_fail("UNKNOWN_COMMAND", request.get("cmd")))
            continue
        try:
            result = handler(request)
            if request.get("id") is not None:
                result["id"] = request["id"]
            _emit(result)
        except Exception as error:  # noqa: BLE001 - the bridge must never see a crash
            payload = _fail(type(error).__name__, error)
            payload["trace"] = traceback.format_exc()[-1200:]
            if request.get("id") is not None:
                payload["id"] = request["id"]
            _emit(payload)


if __name__ == "__main__":
    main()
