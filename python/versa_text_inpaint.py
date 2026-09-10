"""PaddleOCR + dilated masks + LaMa texture inpaint with a self-healing verify loop.

This module is the only text-removal path for blank masters. It never sends a
text prompt to ComfyUI, Flux, or any LLM inpainting node.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

# Directive 1 + 2: catch weak glyphs and expand DBNet boxes before masking.
PADDLE_OCR_INIT = {
    "lang": "en",
    "use_angle_cls": True,
    "show_log": False,
    "det_db_thresh": 0.25,
    "det_db_box_thresh": 0.40,
    "det_db_unclip_ratio": 2.3,
}

BASE_DILATION_PX = 10  # Directive 3: 8–12px halo expansion
DILATION_STEP_PX = 4  # Directive 7
MAX_INPAINT_RETRIES = 3  # Directive 8
MIN_RESIDUAL_BOX_AREA = 32
GENERATIVE_INPAINT_KEYS = frozenset({
    "prompt",
    "positive_prompt",
    "negative_prompt",
    "text",
    "instruction",
    "llm_prompt",
    "comfy_prompt",
    "positive",
    "negative",
})


class TextInpaintError(RuntimeError):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code = code
        self.details = details

    def to_dict(self):
        payload = {"ok": False, "code": self.code, "error": str(self)}
        payload.update(self.details)
        return payload


def create_paddle_ocr(**overrides):
    """Directive 1–2: PaddleOCR with a low DB thresh and expanded unclip ratio."""
    kwargs = {**PADDLE_OCR_INIT, **overrides}
    try:
        from paddleocr import PaddleOCR
    except ImportError as exc:
        raise TextInpaintError(
            "PADDLE_OCR_MISSING",
            "PaddleOCR is not installed. Install python/requirements-vision.txt before cleaning blank masters.",
        ) from exc
    try:
        return PaddleOCR(**kwargs)
    except TypeError:
        detection = {
            "thresh": kwargs["det_db_thresh"],
            "box_thresh": kwargs["det_db_box_thresh"],
            "unclip_ratio": kwargs["det_db_unclip_ratio"],
        }
        return PaddleOCR(lang=kwargs["lang"], text_detection=detection)


def _as_rgb(image):
    arr = np.asarray(image)
    if arr.ndim == 2:
        arr = np.stack([arr, arr, arr], axis=-1)
    if arr.shape[-1] == 4:
        arr = arr[..., :3]
    if arr.dtype != np.uint8:
        arr = np.clip(arr, 0, 255).astype(np.uint8)
    return np.ascontiguousarray(arr)


def _quad_to_xyxy(points):
    xs = [float(p[0]) for p in points]
    ys = [float(p[1]) for p in points]
    return [int(np.floor(min(xs))), int(np.floor(min(ys))), int(np.ceil(max(xs))), int(np.ceil(max(ys)))]


def _looks_like_ocr_entry(entry):
    return isinstance(entry, (list, tuple)) and len(entry) >= 1 and isinstance(entry[0], (list, tuple))


def _normalize_ocr_items(raw):
    if raw is None:
        return []
    if isinstance(raw, dict) and "box" in raw:
        return [raw]
    if isinstance(raw, list) and raw and isinstance(raw[0], dict) and "box" in raw[0]:
        return list(raw)
    if isinstance(raw, dict):
        boxes = raw.get("dt_polys") or raw.get("det_boxes") or raw.get("rec_boxes") or []
        texts = raw.get("rec_texts") or raw.get("rec_text") or [""] * len(boxes)
        scores = raw.get("rec_scores") or raw.get("rec_score") or [1.0] * len(boxes)
        items = []
        for box, text, score in zip(boxes, texts, scores):
            pts = np.reshape(box.tolist() if hasattr(box, "tolist") else box, (-1, 2))
            items.append({"box": _quad_to_xyxy(pts), "text": str(text or ""), "score": float(score or 0)})
        return items
    if not isinstance(raw, list) or not raw:
        return []
    first = raw[0]
    if isinstance(first, list) and first and _looks_like_ocr_entry(first[0]):
        raw = first
    return [_entry_to_item(entry) for entry in raw if entry]


def _entry_to_item(entry):
    if isinstance(entry, dict):
        return entry
    quad, rest = entry[0], entry[1] if len(entry) > 1 else ("", 1.0)
    text, score = "", 1.0
    if isinstance(rest, (list, tuple)):
        text = rest[0] if rest else ""
        score = rest[1] if len(rest) > 1 else 1.0
    elif isinstance(rest, str):
        text = rest
    pts = np.reshape(quad, (-1, 2)) if np.asarray(quad).ndim >= 2 else np.array([[quad[0], quad[1]], [quad[2], quad[3]]])
    return {"box": _quad_to_xyxy(pts), "text": str(text or ""), "score": float(score or 0)}


def detect_text_boxes(image, ocr=None, score_thresh=0.35):
    rgb = _as_rgb(image)
    if ocr is None:
        engine = create_paddle_ocr()
        raw = engine.ocr(rgb, cls=True) if hasattr(engine, "ocr") else engine.predict(rgb)
    elif callable(ocr) and not hasattr(ocr, "ocr") and not hasattr(ocr, "predict"):
        raw = ocr(rgb)
    elif hasattr(ocr, "ocr"):
        raw = ocr.ocr(rgb, cls=True)
    elif hasattr(ocr, "predict"):
        raw = ocr.predict(rgb)
    else:
        raw = ocr(rgb)
    items = _normalize_ocr_items(raw)
    h, w = rgb.shape[:2]
    boxes = []
    for item in items:
        x1, y1, x2, y2 = [int(v) for v in item["box"][:4]]
        x1, y1 = max(0, min(w, x1)), max(0, min(h, y1))
        x2, y2 = max(0, min(w, x2)), max(0, min(h, y2))
        if x2 < x1:
            x1, x2 = x2, x1
        if y2 < y1:
            y1, y2 = y2, y1
        area = max(0, x2 - x1) * max(0, y2 - y1)
        if area < MIN_RESIDUAL_BOX_AREA or float(item.get("score") or 0) < score_thresh:
            continue
        boxes.append({**item, "box": [x1, y1, x2, y2], "area": area})
    return boxes


def boxes_to_mask(image_shape, boxes):
    height, width = image_shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)
    for item in boxes:
        x1, y1, x2, y2 = item["box"] if isinstance(item, dict) else item
        mask[y1:y2, x1:x2] = 255
    return mask


def dilate_text_mask(mask, dilation_px=BASE_DILATION_PX):
    """Directive 3: morphologically expand OCR boxes by 8–12px (retries add +4px)."""
    import cv2

    radius = int(max(8, dilation_px))
    k = 2 * radius + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    binary = np.where(np.asarray(mask) > 0, 255, 0).astype(np.uint8)
    return cv2.dilate(binary, kernel, iterations=1)


def reject_generative_inpaint_kwargs(kwargs):
    """Directive 5: never allow ComfyUI / LLM prompt nodes into the fill step."""
    blocked = [key for key in kwargs if str(key).lower() in GENERATIVE_INPAINT_KEYS and kwargs[key]]
    if blocked:
        raise TextInpaintError(
            "GENERATIVE_INPAINT_FORBIDDEN",
            "Blank-master inpainting is LaMa texture fill only. Prompted ComfyUI/LLM nodes are disabled.",
            blocked=blocked,
        )


def inpaint_lama(image, mask, inpaint_fn=None, **kwargs):
    """Directive 4: LaMa FFC texture fill. No prompts. No ComfyUI."""
    reject_generative_inpaint_kwargs(kwargs)
    rgb = _as_rgb(image)
    binary = np.where(np.asarray(mask) > 0, 255, 0).astype(np.uint8)
    if inpaint_fn is not None:
        return _as_rgb(inpaint_fn(rgb, binary))
    try:
        from PIL import Image
        from simple_lama_inpainting import SimpleLama
    except ImportError as exc:
        raise TextInpaintError(
            "LAMA_REQUIRED",
            "LaMa is not installed. Install simple-lama-inpainting (python/requirements-vision.txt). "
            "ComfyUI/LLM inpainting is not a fallback.",
        ) from exc
    lama = SimpleLama()
    pil_rgb = Image.fromarray(rgb, mode="RGB")
    pil_mask = Image.fromarray(binary, mode="L")
    filled = lama(pil_rgb, pil_mask)
    return _as_rgb(filled)


def observe_and_verify(image, ocr=None, score_thresh=0.35):
    """Directive 6: secondary OCR on the inpainted page. Pass only if zero text remains."""
    boxes = detect_text_boxes(image, ocr=ocr, score_thresh=score_thresh)
    return {
        "ok": len(boxes) == 0,
        "residual_count": len(boxes),
        "boxes": boxes,
    }


def remove_text_self_heal(
    image,
    ocr=None,
    inpaint_fn=None,
    dilation_px=BASE_DILATION_PX,
    max_retries=MAX_INPAINT_RETRIES,
):
    """Detect → dilate 8–12px → LaMa → OCR verify. On residual text, +4px and retry (max 3)."""
    rgb = _as_rgb(image)
    boxes = detect_text_boxes(rgb, ocr=ocr)
    if not boxes:
        verify = observe_and_verify(rgb, ocr=ocr)
        return {
            "image": rgb,
            "ok": True,
            "attempts": 0,
            "dilation_px": dilation_px,
            "verify": verify,
        }

    last_verify = None
    current_dilation = int(dilation_px)
    inpainted = rgb
    attempts = 0
    while attempts < max_retries:
        attempts += 1
        mask = dilate_text_mask(boxes_to_mask(rgb.shape, boxes), current_dilation)
        inpainted = inpaint_lama(rgb, mask, inpaint_fn=inpaint_fn)
        last_verify = observe_and_verify(inpainted, ocr=ocr)
        if last_verify["ok"]:
            return {
                "image": inpainted,
                "ok": True,
                "attempts": attempts,
                "dilation_px": current_dilation,
                "verify": last_verify,
            }
        boxes = last_verify["boxes"] or boxes
        if attempts >= max_retries:
            break
        current_dilation += DILATION_STEP_PX

    raise TextInpaintError(
        "TEXT_INPAINT_RESIDUAL",
        "Residual text remained after LaMa self-heal (3 retries). The page was not sent to assembly.",
        attempts=attempts,
        dilation_px=current_dilation,
        residual_count=0 if last_verify is None else last_verify["residual_count"],
    )


def inpaint_ok_sidecar(output_path):
    path = Path(output_path)
    return path.with_name(f"{path.stem}.inpaint-ok.json")


def write_image(path, image):
    import cv2

    rgb = _as_rgb(image)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(path), bgr):
        raise TextInpaintError("IMAGE_WRITE_FAILED", f"Could not write {path}")


def read_image(path):
    import cv2

    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise TextInpaintError("IMAGE_READ_FAILED", f"Could not read {path}")
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def clean_blank_master(input_path, output_path=None, ocr=None, inpaint_fn=None):
    dest = output_path or input_path
    rgb = read_image(input_path)
    result = remove_text_self_heal(rgb, ocr=ocr, inpaint_fn=inpaint_fn)
    write_image(dest, result["image"])
    sidecar = {
        "ok": True,
        "attempts": result["attempts"],
        "dilation_px": result["dilation_px"],
        "residual_count": result["verify"]["residual_count"],
        "input": str(input_path),
        "output": str(dest),
        "engine": "lama",
        "prompts": False,
    }
    inpaint_ok_sidecar(dest).write_text(json.dumps(sidecar, indent=2), encoding="utf-8")
    return sidecar
