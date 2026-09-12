#!/usr/bin/env python3
"""VERSA CLASS - local text removal (OpenCV + LaMa).

PaddleOCR supplies text runs. Each run is masked with Otsu/adaptive ink
isolation inside its box, dilated with a 3x3 kernel (1-2 iterations), then
filled:

  * solid sampled paper colour when the ring around the box is uniform (σ < 10)
  * SimpleLama only on illustrated / high-variance backgrounds

ComfyUI is not part of this path.
"""

import os
import sys

_DILATE_KERNEL = (3, 3)
_DILATE_ITERATIONS = 2
_SOLID_SIGMA = 10.0
_LAMA_MAX_SIDE = 1024
_STATE = {"predictor": None}


def _lazy():
    import cv2
    import numpy as np
    return cv2, np


class ComfyTextInpaintError(RuntimeError):
    """Stable error boundary. Name kept so existing callers still catch it."""

    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code = code
        self.details = details

    def to_dict(self):
        return {"ok": False, "code": self.code, "error": str(self), **self.details}


TextInpaintError = ComfyTextInpaintError


def _as_rgb_array(image):
    _cv2, np = _lazy()
    array = np.asarray(image)
    if array.ndim == 2:
        array = np.stack((array, array, array), axis=-1)
    if array.ndim != 3 or array.shape[2] not in (3, 4):
        raise ComfyTextInpaintError(
            "IMAGE_INVALID",
            f"Expected an RGB/RGBA image, received shape {getattr(array, 'shape', None)}.",
        )
    if array.shape[2] == 4:
        array = array[:, :, :3]
    if array.dtype != np.uint8:
        array = np.clip(array, 0, 255).astype(np.uint8)
    return np.ascontiguousarray(array)


def _as_mask_array(mask, image_shape):
    _cv2, np = _lazy()
    array = np.asarray(mask)
    if array.ndim == 3:
        array = array[:, :, 0]
    if array.ndim != 2:
        raise ComfyTextInpaintError(
            "MASK_INVALID",
            f"Expected a one-channel mask, received shape {getattr(array, 'shape', None)}.",
        )
    if tuple(array.shape) != tuple(image_shape[:2]):
        raise ComfyTextInpaintError(
            "MASK_SIZE_MISMATCH",
            "The inpainting mask must have the same pixel dimensions as the source image.",
            imageSize=[int(image_shape[1]), int(image_shape[0])],
            maskSize=[int(array.shape[1]), int(array.shape[0])],
        )
    return np.where(array > 0, 255, 0).astype(np.uint8)


def _clip_box(box, width, height):
    x0, y0, x1, y1 = [int(round(float(value))) for value in box]
    x0, y0 = max(0, min(width, x0)), max(0, min(height, y0))
    x1, y1 = max(0, min(width, x1)), max(0, min(height, y1))
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 < y0:
        y0, y1 = y1, y0
    return x0, y0, x1, y1


def _ring_stats(image, box, pad=4):
    _cv2, np = _lazy()
    height, width = image.shape[:2]
    x0, y0, x1, y1 = _clip_box(box, width, height)
    ox0, oy0 = max(0, x0 - pad), max(0, y0 - pad)
    ox1, oy1 = min(width, x1 + pad), min(height, y1 + pad)
    parts = []
    if oy0 < y0:
        parts.append(image[oy0:y0, ox0:ox1].reshape(-1, 3))
    if y1 < oy1:
        parts.append(image[y1:oy1, ox0:ox1].reshape(-1, 3))
    if ox0 < x0:
        parts.append(image[oy0:oy1, ox0:x0].reshape(-1, 3))
    if x1 < ox1:
        parts.append(image[oy0:oy1, x1:ox1].reshape(-1, 3))
    if not parts:
        return (255, 255, 255), 999.0
    stacked = np.concatenate(parts, axis=0).astype(np.float32)
    if stacked.size == 0:
        return (255, 255, 255), 999.0
    median = tuple(int(round(value)) for value in np.median(stacked, axis=0))
    sigma = float(np.std(stacked))
    return median, sigma


def _otsu_glyph_mask(image, box, background=None):
    """Isolate ink inside the OCR box. Never fill the whole rectangle."""
    cv2, np = _lazy()
    height, width = image.shape[:2]
    x0, y0, x1, y1 = _clip_box(box, width, height)
    mask = np.zeros((height, width), dtype=bool)
    if x1 - x0 < 2 or y1 - y0 < 2:
        return mask

    crop = image[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    if background is None:
        bg_mean = float(np.mean(gray))
    else:
        bg_mean = float(np.mean(np.asarray(background, dtype=np.float32)))

    if bg_mean >= 80:
        flag = cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    else:
        flag = cv2.THRESH_BINARY + cv2.THRESH_OTSU
    _threshold, binary = cv2.threshold(blur, 0, 255, flag)
    del _threshold
    if int(np.count_nonzero(binary)) == 0:
        adaptive = cv2.ADAPTIVE_THRESH_GAUSSIAN_C
        binary = cv2.adaptiveThreshold(blur, 255, adaptive, cv2.THRESH_BINARY_INV, 11, 2)
    if bg_mean >= 190:
        near = cv2.dilate((binary > 0).astype(np.uint8), np.ones((3, 3), np.uint8), iterations=2)
        halo = (gray < (bg_mean - 6)) & (near > 0)
        binary[halo] = 255
        if int(np.count_nonzero(binary)) < max(12, gray.size // 40):
            binary[gray < (bg_mean - 8)] = 255
    if int(np.count_nonzero(binary)) == 0:
        crop_sigma = float(np.std(crop.astype(np.float32)))
        crop_mean = float(np.mean(gray))
        # Only fill the whole box when it is a uniform ink swatch. Never turn a
        # large OCR title box into a rectangular erase block.
        if crop_sigma < 10.0 and abs(crop_mean - bg_mean) > 25.0:
            binary = np.full(gray.shape, 255, dtype=np.uint8)
    mask[y0:y1, x0:x1] = binary > 0
    return mask


def build_text_mask(image, runs, checkpoint=None, use_sam=False):
    """Tight glyph mask. SAM is unused; the argument stays for older callers."""
    del checkpoint, use_sam
    cv2, np = _lazy()
    source = _as_rgb_array(image)
    height, width = source.shape[:2]
    combined = np.zeros((height, width), dtype=bool)
    stats = {"runs": 0, "sam": 0, "strokeOnly": 0, "solidRings": 0}
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, _DILATE_KERNEL)

    for run in runs or []:
        box = run.get("box")
        if not box or len(box) != 4:
            continue
        stats["runs"] += 1
        background = run.get("background")
        if background is None:
            background, sigma = _ring_stats(source, box)
            if sigma < _SOLID_SIGMA:
                stats["solidRings"] += 1
        if run.get("wipeBox"):
            x0, y0, x1, y1 = _clip_box(box, width, height)
            combined[y0:y1, x0:x1] = True
            stats["strokeOnly"] += 1
            continue
        stroke = _otsu_glyph_mask(source, box, background=background)
        if not stroke.any():
            continue
        iterations = _DILATE_ITERATIONS
        if int(stroke.sum()) < 80:
            iterations = max(iterations, 3)
        dilated = cv2.dilate(stroke.astype(np.uint8), kernel, iterations=iterations)
        combined |= dilated.astype(bool)
        stats["strokeOnly"] += 1

    return combined, stats


def _solid_fill(source, binary_mask, color):
    _cv2, np = _lazy()
    repaired = source.copy()
    repaired[binary_mask > 0] = np.asarray(color, dtype=np.uint8)
    return repaired


def _page_paper_stats(source):
    _cv2, np = _lazy()
    sample = source[::8, ::8].astype(np.float32)
    return float(np.median(sample)), float(np.std(sample))


def _is_worksheet(source, ring_sigma):
    median, std = _page_paper_stats(source)
    del std
    if median >= 248.0:
        return True
    return median >= 220.0 and ring_sigma < 28.0


def _lama_inpaint(source, binary_mask):
    cv2, np = _lazy()
    from versa_blank_master import inpaint_lama

    height, width = source.shape[:2]
    side = max(height, width)
    if side <= _LAMA_MAX_SIDE:
        return inpaint_lama(source, binary_mask), 1.0
    scale = _LAMA_MAX_SIDE / float(side)
    small_size = (max(1, int(round(width * scale))), max(1, int(round(height * scale))))
    small = cv2.resize(source, small_size, interpolation=cv2.INTER_AREA)
    small_mask = cv2.resize(binary_mask, small_size, interpolation=cv2.INTER_NEAREST)
    filled_small = inpaint_lama(small, small_mask)
    filled = cv2.resize(filled_small, (width, height), interpolation=cv2.INTER_LINEAR)
    return filled, scale


def _mask_fill_color(source, binary_mask):
    cv2, np = _lazy()
    kernel = np.ones((5, 5), dtype=np.uint8)
    ring = cv2.dilate(binary_mask, kernel, iterations=2)
    ring[binary_mask > 0] = 0
    samples = source[ring > 0]
    if samples.size == 0:
        return (255, 255, 255), 999.0
    stacked = samples.astype(np.float32)
    color = tuple(int(round(value)) for value in np.median(stacked, axis=0))
    return color, float(np.std(stacked))


def inpaint(
    image,
    mask,
    pad=None,
    *,
    bridge=None,
    workflow=None,
    workflow_path=None,
    timeout=600,
    seed=None,
):
    """Solid paper fill when the page is uniform; SimpleLama on illustrated art."""
    del pad, bridge, workflow, workflow_path, timeout, seed
    cv2, np = _lazy()
    source = _as_rgb_array(image)
    binary_mask = _as_mask_array(mask, source.shape)
    if not binary_mask.any():
        return source.copy(), {
            "engine": "none",
            "inpainted": False,
            "reason": "EMPTY_MASK",
            "maskPixels": 0,
        }

    color, sigma = _mask_fill_color(source, binary_mask)
    selected = binary_mask > 0
    page_median, page_std = _page_paper_stats(source)
    worksheet = _is_worksheet(source, sigma) or min(color) >= 200
    use_solid = sigma < 18.0 or worksheet or page_median >= 220.0
    if use_solid:
        repaired = _solid_fill(source, binary_mask, color)
        return repaired, {
            "engine": "solid-fill",
            "inpainted": True,
            "sigma": round(sigma, 2),
            "maskPixels": int(selected.sum()),
            "worksheet": worksheet,
        }

    try:
        filled, scale = _lama_inpaint(source, binary_mask)
        repaired = source.copy()
        repaired[selected] = filled[selected]
        return repaired, {
            "engine": "simple-lama",
            "inpainted": True,
            "sigma": round(sigma, 2),
            "maskPixels": int(selected.sum()),
            "lamaScale": round(scale, 3),
        }
    except Exception:
        repaired = cv2.inpaint(source, binary_mask, 3, cv2.INPAINT_TELEA)
        return repaired, {
            "engine": "opencv-telea",
            "inpainted": True,
            "sigma": round(sigma, 2),
            "maskPixels": int(selected.sum()),
        }


def erase_text(
    image,
    runs,
    checkpoint=None,
    use_sam=False,
    *,
    bridge=None,
    workflow=None,
    workflow_path=None,
    timeout=600,
    seed=None,
):
    """Build a tight ink mask and erase every detected run locally."""
    del bridge
    source = _as_rgb_array(image)
    enriched = []
    for run in runs or []:
        item = dict(run)
        if item.get("box") and item.get("background") is None:
            color, _sigma = _ring_stats(source, item["box"])
            item["background"] = color
        enriched.append(item)
    mask, mask_stats = build_text_mask(
        source,
        enriched,
        checkpoint=checkpoint,
        use_sam=use_sam,
    )
    repaired, fill_stats = inpaint(
        source,
        mask,
        workflow=workflow,
        workflow_path=workflow_path,
        timeout=timeout,
        seed=seed,
    )
    return repaired, {**mask_stats, **fill_stats}


def _default_sam_checkpoint():
    configured = os.environ.get("VERSA_MOBILE_SAM_CHECKPOINT")
    if configured:
        return configured
    return os.path.join(os.path.dirname(__file__), "models", "mobile_sam.pt")


def _run_cli(input_path, output_path=None, checkpoint=None, use_sam=False):
    from PIL import Image
    from versa_blank_master import create_paddle_ocr, detect_text_boxes, observe_and_verify

    source_path = os.path.abspath(input_path)
    destination = os.path.abspath(output_path or input_path)
    if not os.path.isfile(source_path):
        raise ComfyTextInpaintError("IMAGE_MISSING", f"Input image does not exist: {source_path}")
    source = _as_rgb_array(Image.open(source_path).convert("RGB"))
    ocr = create_paddle_ocr()
    runs = detect_text_boxes(source, ocr=ocr)
    repaired, stats = erase_text(source, runs, checkpoint=checkpoint, use_sam=use_sam)
    verify = observe_and_verify(repaired, ocr=ocr)
    os.makedirs(os.path.dirname(destination) or ".", exist_ok=True)
    Image.fromarray(repaired, mode="RGB").save(destination)
    return {
        "ok": True,
        "outputPath": destination,
        "textRuns": len(runs),
        "verify": verify,
        **stats,
    }


if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Erase baked text using OpenCV and LaMa.")
    parser.add_argument("--input", default="", help="Source PNG")
    parser.add_argument("--output", default="", help="Destination PNG (defaults to --input)")
    parser.add_argument("--checkpoint", default=_default_sam_checkpoint())
    parser.add_argument("--no-sam", action="store_true")
    args, _unknown = parser.parse_known_args()
    if not args.input:
        print(__doc__)
        sys.exit(0)
    try:
        print(json.dumps(_run_cli(args.input, args.output or None, args.checkpoint, use_sam=not args.no_sam)))
        sys.exit(0)
    except ComfyTextInpaintError as error:
        print(json.dumps(error.to_dict()))
        sys.exit(2)
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"ok": False, "code": "TEXT_INPAINT_FAILED", "error": str(error)}))
        sys.exit(2)
