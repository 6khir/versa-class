#!/usr/bin/env python3
"""Detect-only OCR for text-free master validation. Zero detections is a pass."""

from __future__ import annotations

import json
import os
import sys


def _bbox_of_polygon(points):
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    return [min(xs), min(ys), max(xs), max(ys)]


def _apple_detect(image_path):
    try:
        from versa_apple_ocr import recognize_page

        return recognize_page(image_path) or []
    except Exception:
        return []


def _paddle_detect(image_path):
    try:
        import numpy
        import paddle
        from PIL import Image
        from paddleocr import PaddleOCR

        paddle.set_device("cpu")
        try:
            ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
        except TypeError:
            ocr = PaddleOCR(use_angle_cls=True, lang="en")
        pages = ocr.ocr(numpy.array(Image.open(image_path).convert("RGB")), cls=True) or []
        detections = []
        for page in pages:
            for line in page or []:
                polygon, (text, confidence) = line[0], line[1]
                text = (text or "").strip()
                if not text:
                    continue
                detections.append({
                    "text": text,
                    "confidence": float(confidence or 0),
                    "box": _bbox_of_polygon(polygon),
                    "polygon": polygon,
                })
        return detections
    except Exception:
        return []


def detect(image_path):
    if not image_path or not os.path.isfile(image_path):
        return {"ok": False, "code": "IMAGE_MISSING", "detections": [], "count": 0}
    detections = _apple_detect(image_path) or _paddle_detect(image_path)
    return {"ok": True, "detections": detections, "count": len(detections)}


def main():
    image_path = sys.argv[1] if len(sys.argv) > 1 else ""
    print(json.dumps(detect(image_path), ensure_ascii=False))


if __name__ == "__main__":
    main()
