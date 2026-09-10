#!/usr/bin/env python3
"""Runtime tests for PaddleOCR dilation, LaMa-only fill, and the self-heal verify loop."""
from __future__ import annotations

import inspect
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))

from versa_text_inpaint import (  # noqa: E402
    BASE_DILATION_PX,
    DILATION_STEP_PX,
    MAX_INPAINT_RETRIES,
    PADDLE_OCR_INIT,
    TextInpaintError,
    dilate_text_mask,
    inpaint_lama,
    observe_and_verify,
    remove_text_self_heal,
)


def _white(h=120, w=160):
    return np.full((h, w, 3), 255, dtype=np.uint8)


class SequenceOcr:
    def __init__(self, box_sets):
        self.box_sets = list(box_sets)
        self.calls = 0

    def ocr(self, image, cls=True):
        idx = min(self.calls, len(self.box_sets) - 1)
        self.calls += 1
        boxes = self.box_sets[idx]
        page = []
        for box in boxes:
            x1, y1, x2, y2 = box
            page.append([[[x1, y1], [x2, y1], [x2, y2], [x1, y2]], ("TRASH", 0.99)])
        return [page]


def _fill_white(image, mask):
    out = np.array(image, copy=True)
    out[mask > 0] = 255
    return out


class VisionPipelineTests(unittest.TestCase):
    def test_paddleocr_init_catches_weak_text_and_expands_unclip(self):
        self.assertEqual(PADDLE_OCR_INIT["det_db_thresh"], 0.25)
        self.assertGreater(PADDLE_OCR_INIT["det_db_unclip_ratio"], 1.5)
        source = inspect.getsource(sys.modules["versa_text_inpaint"].create_paddle_ocr)
        self.assertIn("det_db_thresh", source)
        self.assertIn("det_db_unclip_ratio", source)

    def test_cv2_dilate_expands_mask_8_to_12_px(self):
        import cv2

        self.assertTrue(hasattr(cv2, "dilate"))
        self.assertGreaterEqual(BASE_DILATION_PX, 8)
        self.assertLessEqual(BASE_DILATION_PX, 12)
        mask = np.zeros((81, 81), dtype=np.uint8)
        mask[40, 40] = 255
        dilated = dilate_text_mask(mask, BASE_DILATION_PX)
        self.assertEqual(int(dilated[40, 40]), 255)
        self.assertEqual(int(dilated[40, 40 + BASE_DILATION_PX]), 255)
        self.assertEqual(int(dilated[40 + BASE_DILATION_PX, 40]), 255)
        self.assertEqual(int(dilated[40, 40 + BASE_DILATION_PX + 6]), 0)
        source = inspect.getsource(dilate_text_mask)
        self.assertIn("cv2.dilate", source)
        self.assertIn("MORPH_ELLIPSE", source)

    def test_lama_rejects_comfy_and_llm_prompts(self):
        image = _white()
        mask = np.zeros((120, 160), dtype=np.uint8)
        mask[20:40, 20:80] = 255
        with self.assertRaises(TextInpaintError) as raised:
            inpaint_lama(image, mask, inpaint_fn=_fill_white, prompt="write the word CAT here")
        self.assertEqual(raised.exception.code, "GENERATIVE_INPAINT_FORBIDDEN")
        with self.assertRaises(TextInpaintError):
            inpaint_lama(image, mask, inpaint_fn=_fill_white, comfy_prompt="generate letters")
        filled = inpaint_lama(image, mask, inpaint_fn=_fill_white)
        self.assertEqual(filled.shape, image.shape)
        source = inspect.getsource(inpaint_lama)
        self.assertIn("SimpleLama", source)
        self.assertIn("reject_generative_inpaint_kwargs", source)

    def test_observe_and_verify_requires_zero_residual_text(self):
        image = _white()
        dirty = SequenceOcr([[[10, 10, 60, 40]]])
        clean = SequenceOcr([[]])
        failed = observe_and_verify(image, ocr=dirty)
        self.assertFalse(failed["ok"])
        self.assertEqual(failed["residual_count"], 1)
        passed = observe_and_verify(image, ocr=clean)
        self.assertTrue(passed["ok"])
        self.assertEqual(passed["residual_count"], 0)

    def test_self_heal_increases_dilation_by_4px_then_passes(self):
        image = _white()
        ocr = SequenceOcr([
            [[12, 12, 70, 40]],
            [[12, 12, 70, 40]],
            [],
        ])
        result = remove_text_self_heal(image, ocr=ocr, inpaint_fn=_fill_white)
        self.assertTrue(result["ok"])
        self.assertEqual(result["attempts"], 2)
        self.assertEqual(result["dilation_px"], BASE_DILATION_PX + DILATION_STEP_PX)
        self.assertEqual(result["verify"]["residual_count"], 0)

    def test_self_heal_caps_at_three_retries(self):
        image = _white()
        ocr = SequenceOcr([[[12, 12, 70, 40]]])
        with self.assertRaises(TextInpaintError) as raised:
            remove_text_self_heal(image, ocr=ocr, inpaint_fn=_fill_white)
        self.assertEqual(raised.exception.code, "TEXT_INPAINT_RESIDUAL")
        self.assertEqual(raised.exception.details["attempts"], MAX_INPAINT_RETRIES)
        self.assertEqual(MAX_INPAINT_RETRIES, 3)


if __name__ == "__main__":
    unittest.main()
