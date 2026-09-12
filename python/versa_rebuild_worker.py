#!/usr/bin/env python3
"""Long-lived rebuild worker: OCR, band inspect, deterministic cleanup, PPTX compose.

Protocol matches versa_vision.py: one JSON line in, one JSON line out.
The process stays up for the whole book. One command at a time.
"""

from __future__ import annotations

import json
import os
import sys
import traceback

_PROTOCOL_FD = os.dup(1)
os.dup2(2, 1)
_PROTOCOL = os.fdopen(_PROTOCOL_FD, "w", encoding="utf-8", buffering=1)
sys.stdout = sys.stderr

_STATE = {"apple": None, "paddle": None}


def _emit(payload):
    _PROTOCOL.write(json.dumps(payload, ensure_ascii=False) + "\n")
    _PROTOCOL.flush()


def _fail(code, error):
    return {"ok": False, "code": code, "error": str(error)}


def _load_image(path):
    from PIL import Image
    from versa_band_cleanup import as_rgb

    if not path or not os.path.isfile(path):
        raise FileNotFoundError(path)
    with Image.open(path) as image:
        return as_rgb(image.convert("RGB"))


def _apple(path):
    try:
        from versa_apple_ocr import recognize_page

        return recognize_page(path) or []
    except Exception:
        return []


def _paddle(path):
    try:
        from versa_text_detect import _paddle_detect

        return _paddle_detect(path) or []
    except Exception:
        return []


def ocr(request):
    path = request.get("imagePath") or request.get("path")
    mode = str(request.get("mode") or "fast").lower()
    if not path or not os.path.isfile(path):
        return _fail("IMAGE_MISSING", path)
    if mode == "accurate":
        detections = _paddle(path)
        engine = "paddle"
        if not detections:
            detections = _apple(path)
            engine = "apple-vision" if detections else "none"
    else:
        detections = _apple(path)
        engine = "apple-vision"
        if not detections:
            detections = _paddle(path)
            engine = "paddle" if detections else "none"
    return {
        "ok": True,
        "engine": engine,
        "mode": mode,
        "detections": detections,
        "count": len(detections),
    }


def inspect_bands(request):
    from versa_band_cleanup import inspect_band

    path = request.get("imagePath") or request.get("path")
    boxes = request.get("boxes") or []
    rgb = _load_image(path)
    bands = [inspect_band(rgb, box) for box in boxes if box and len(box) == 4]
    del rgb
    return {"ok": True, "bands": bands}


def cleanup(request):
    from versa_band_cleanup import cleanup_bands, save_rgb, watchdog

    path = request.get("imagePath") or request.get("path")
    output = request.get("outputPath") or path
    boxes = request.get("boxes") or []
    rgb = _load_image(path)
    repaired, stats = cleanup_bands(
        rgb,
        boxes,
        expand_px=int(request.get("expandPx") or 2),
        fill_inner=request.get("fillInner"),
        legacy_textured=bool(request.get("legacyTextured")),
    )
    save_rgb(output, repaired)
    verify = watchdog(repaired, [{"box": box} for box in boxes], request.get("detections") or [])
    del rgb, repaired
    return {"ok": verify["ok"], "outputPath": output, "cleanup": stats, "watchdog": verify}


def compose(request):
    try:
        from versa_layered_pptx import compose_pptx
    except ImportError as error:
        return _fail("PPTX_ENGINE_UNAVAILABLE", error)
    spec = request.get("spec") or {}
    spec.setdefault("mode", spec.get("mode") or "rebuild")
    return compose_pptx(spec)


def ping(_request=None):
    return {"ok": True, "ready": True, "worker": "rebuild"}


HANDLERS = {
    "ping": ping,
    "ocr": ocr,
    "inspect_bands": inspect_bands,
    "cleanup": cleanup,
    "compose_pptx": compose,
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
        except Exception as error:  # noqa: BLE001
            payload = _fail("WORKER_CRASH", error)
            payload["trace"] = traceback.format_exc()[-800:]
            if request.get("id") is not None:
                payload["id"] = request["id"]
            _emit(payload)


if __name__ == "__main__":
    main()
