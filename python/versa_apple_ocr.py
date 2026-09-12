"""Apple Vision OCR for macOS. Falls back to empty when the helper is missing."""

from __future__ import annotations

import json
import os
import subprocess

_ROOT = os.path.dirname(os.path.abspath(__file__))
_BIN = os.path.join(_ROOT, "bin", "recognize-page-text")
_SRC = os.path.join(os.path.dirname(_ROOT), "src", "recognize-page-text.swift")


def _ensure_binary():
    if os.path.isfile(_BIN) and (not os.path.isfile(_SRC) or os.path.getmtime(_BIN) >= os.path.getmtime(_SRC)):
        return _BIN
    os.makedirs(os.path.dirname(_BIN), exist_ok=True)
    subprocess.check_call(["xcrun", "swiftc", "-O", "-o", _BIN, _SRC], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    return _BIN


def recognize_page(image_path, timeout=90):
    if os.name != "posix" or not image_path or not os.path.isfile(image_path):
        return []
    try:
        binary = _ensure_binary()
        raw = subprocess.check_output([binary, image_path], timeout=timeout, stderr=subprocess.DEVNULL)
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return []
    runs = []
    for index, item in enumerate(payload.get("text") or []):
        text = (item.get("text") or "").strip()
        box = item.get("box") or []
        if not text or len(box) != 4:
            continue
        runs.append({
            "id": f"t{index + 1}",
            "text": text,
            "confidence": round(float(item.get("confidence") or 0), 4),
            "box": [round(float(value), 2) for value in box],
            "engine": "apple-vision",
        })
    return runs
