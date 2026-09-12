"""Deterministic pale-band text cleanup. No second image model.

Preferred path: sample the band, isolate ink, replace with the sampled fill.
OpenCV Telea is the only inpaint fallback. LaMa is used only when a caller
explicitly marks a legacy textured page.
"""

from __future__ import annotations

import os

import numpy as np


def _cv2():
    import cv2

    return cv2


def as_rgb(image):
    array = np.asarray(image)
    if array.ndim == 2:
        array = np.stack([array, array, array], axis=-1)
    if array.shape[-1] == 4:
        array = array[..., :3]
    if array.dtype != np.uint8:
        array = np.clip(array, 0, 255).astype(np.uint8)
    return np.ascontiguousarray(array)


def clip_box(box, width, height):
    x0, y0, x1, y1 = [int(round(float(value))) for value in box]
    x0, y0 = max(0, min(width, x0)), max(0, min(height, y0))
    x1, y1 = max(0, min(width, x1)), max(0, min(height, y1))
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 < y0:
        y0, y1 = y1, y0
    return x0, y0, x1, y1


def _pale(pixel):
    r, g, b = [float(value) for value in pixel]
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    chroma = max(r, g, b) - min(r, g, b)
    return luma >= 188 and chroma <= 42


def grow_band(image, box, max_expand=72):
    rgb = as_rgb(image)
    height, width = rgb.shape[:2]
    x0, y0, x1, y1 = clip_box(box, width, height)
    for _ in range(int(max_expand)):
        grew = False
        if y0 > 0 and _pale(np.median(rgb[y0 - 1 : y0, x0:x1], axis=(0, 1))):
            y0 -= 1
            grew = True
        if y1 < height and _pale(np.median(rgb[y1 : y1 + 1, x0:x1], axis=(0, 1))):
            y1 += 1
            grew = True
        if x0 > 0 and _pale(np.median(rgb[y0:y1, x0 - 1 : x0], axis=(0, 1))):
            x0 -= 1
            grew = True
        if x1 < width and _pale(np.median(rgb[y0:y1, x1 : x1 + 1], axis=(0, 1))):
            x1 += 1
            grew = True
        if not grew:
            break
    return [x0, y0, x1, y1]


def sample_colors(image, band_box, glyph_box=None):
    cv2 = _cv2()
    rgb = as_rgb(image)
    height, width = rgb.shape[:2]
    x0, y0, x1, y1 = clip_box(band_box, width, height)
    band = rgb[y0:y1, x0:x1]
    if band.size == 0:
        return (248, 244, 236), (43, 43, 43), 999.0
    gray = cv2.cvtColor(band, cv2.COLOR_RGB2GRAY)
    pale = gray >= 188
    if glyph_box:
        gx0, gy0, gx1, gy1 = clip_box(glyph_box, width, height)
        pad = 2
        pale[max(0, gy0 - y0 - pad) : max(0, gy1 - y0 + pad), max(0, gx0 - x0 - pad) : max(0, gx1 - x0 + pad)] = False
    samples = band[pale]
    if samples.size < 16:
        samples = band.reshape(-1, 3)
    color = tuple(int(round(value)) for value in np.median(samples.astype(np.float32), axis=0))
    sigma = float(np.std(samples.astype(np.float32)))
    reference = np.asarray(color, dtype=np.float32)
    distance = np.linalg.norm(band.reshape(-1, 3).astype(np.float32) - reference, axis=1)
    ink_samples = band.reshape(-1, 3)[distance >= max(np.percentile(distance, 78), 18)]
    if ink_samples.size == 0:
        ink = (43, 43, 43)
    else:
        ink = tuple(int(round(value)) for value in np.median(ink_samples.astype(np.float32), axis=0))
    return color, ink, sigma


def ink_mask(image, band_box, band_color, expand_px=2):
    cv2 = _cv2()
    rgb = as_rgb(image)
    height, width = rgb.shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)
    x0, y0, x1, y1 = clip_box(band_box, width, height)
    if x1 - x0 < 2 or y1 - y0 < 2:
        return mask
    crop = rgb[y0:y1, x0:x1].astype(np.float32)
    reference = np.asarray(band_color, dtype=np.float32).reshape(1, 1, 3)
    distance = np.linalg.norm(crop - reference, axis=2)
    glyphs = distance >= 18
    if int(np.count_nonzero(glyphs)) == 0:
        gray = cv2.cvtColor(rgb[y0:y1, x0:x1], cv2.COLOR_RGB2GRAY)
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        glyphs = binary > 0
    halo = (distance >= 9) & cv2.dilate(glyphs.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=1).astype(bool)
    binary = np.where(glyphs | halo, 255, 0).astype(np.uint8)
    radius = max(1, min(3, int(expand_px)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
    binary = cv2.dilate(binary, kernel, iterations=1)
    mask[y0:y1, x0:x1] = binary
    return mask


def inspect_band(image, box):
    rgb = as_rgb(image)
    band = grow_band(rgb, box)
    color, ink, sigma = sample_colors(rgb, band, box)
    return {
        "box": band,
        "glyphBox": [int(value) for value in box],
        "color": list(color),
        "ink": list(ink),
        "sigma": round(sigma, 2),
        "flat": sigma <= 18.0,
    }


def cleanup_bands(image, boxes, expand_px=2, fill_inner=None, legacy_textured=False):
    cv2 = _cv2()
    rgb = as_rgb(image)
    repaired = rgb.copy()
    report = []
    combined = np.zeros(rgb.shape[:2], dtype=np.uint8)
    for box in boxes or []:
        info = inspect_band(rgb, box)
        band = info["box"]
        color = tuple(info["color"])
        x0, y0, x1, y1 = clip_box(band, rgb.shape[1], rgb.shape[0])
        inset = max(4, int(round((y1 - y0) * 0.12)))
        inner = [x0 + inset, y0 + inset, x1 - inset, y1 - inset]
        uniform = info["sigma"] <= 8.0 if fill_inner is None else bool(fill_inner)
        if uniform and inner[2] > inner[0] and inner[3] > inner[1]:
            repaired[inner[1] : inner[3], inner[0] : inner[2]] = color
            combined[inner[1] : inner[3], inner[0] : inner[2]] = 255
            engine = "flat-inner-fill"
        else:
            mask = ink_mask(rgb, band, color, expand_px=expand_px)
            selected = mask > 0
            if not selected.any():
                engine = "none"
            elif info["flat"] and not legacy_textured:
                repaired[selected] = color
                combined[selected] = 255
                engine = "flat-ink-fill"
            elif legacy_textured:
                from versa_blank_master import inpaint_lama

                filled = inpaint_lama(repaired, mask)
                repaired[selected] = filled[selected]
                combined[selected] = 255
                engine = "lama-legacy"
            else:
                filled = cv2.inpaint(repaired, mask, 3, cv2.INPAINT_TELEA)
                repaired[selected] = filled[selected]
                combined[selected] = 255
                engine = "opencv-telea"
        info["engine"] = engine
        info["inner"] = inner
        report.append(info)
    return repaired, {"bands": report, "maskPixels": int(np.count_nonzero(combined))}


def watchdog(image, zones, detections=None):
    cv2 = _cv2()
    rgb = as_rgb(image)
    residuals = []
    for zone in zones or []:
        box = zone.get("box") or zone.get("bbox_px")
        color = zone.get("bandColor") or zone.get("color") or (248, 244, 236)
        if not box:
            continue
        x0, y0, x1, y1 = clip_box(box, rgb.shape[1], rgb.shape[0])
        crop = rgb[y0:y1, x0:x1]
        if crop.size == 0:
            continue
        reference = np.asarray(color, dtype=np.float32).reshape(1, 1, 3)
        distance = np.linalg.norm(crop.astype(np.float32) - reference, axis=2)
        binary = (distance >= 26).astype(np.uint8)
        count, labels, stats, _centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)
        del labels
        for index in range(1, count):
            area = int(stats[index, cv2.CC_STAT_AREA])
            if area >= 10:
                residuals.append({"box": box, "area": area})
    leftover = []
    for item in detections or []:
        text = str(item.get("text") or "").strip()
        if len(text) >= 2:
            leftover.append(text)
    return {
        "ok": len(residuals) == 0 and len(leftover) == 0,
        "residuals": residuals[:12],
        "leftoverText": leftover[:12],
    }


def save_rgb(path, image):
    from PIL import Image

    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    Image.fromarray(as_rgb(image), mode="RGB").save(path)
    return path
