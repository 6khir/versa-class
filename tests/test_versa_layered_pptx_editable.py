#!/usr/bin/env python3
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))

from versa_layered_pptx import compose_pptx  # noqa: E402


class EditableComposeTests(unittest.TestCase):
    def test_editable_compose_skips_erase(self):
        called = []

        def boom(*_args, **_kwargs):
            called.append(True)
            raise AssertionError("erase_text must not run in editable mode")

        with tempfile.TemporaryDirectory() as folder:
            image_path = Path(folder) / "master.png"
            Image.new("RGB", (900, 1200), (255, 250, 240)).save(image_path)
            output = Path(folder) / "book-editable.pptx"
            with patch("versa_layered_pptx.erase_text", boom), patch(
                "versa_layered_pptx.repair_runs",
                side_effect=AssertionError("repair_runs must not run"),
            ):
                result = compose_pptx({
                    "outputPath": str(output),
                    "sourceDpi": 300,
                    "mode": "editable",
                    "pages": [{
                        "imagePath": str(image_path),
                        "pageLabel": "Slide 2",
                        "manifest": {
                            "page_id": "book_page02",
                            "theme_id": "washable-marker",
                            "zones": [{
                                "zone_id": "title",
                                "bbox_px": [80, 40, 820, 140],
                                "text": "Name Tracing",
                                "color_hex": "#2B2B2B",
                                "align": "center",
                                "role": "heading",
                            }],
                        },
                    }],
                })
            self.assertEqual(called, [])
            self.assertTrue(result["ok"])
            self.assertEqual(result["slides"], 1)
            self.assertEqual(result["detail"][0]["engine"], "manifest")
            self.assertFalse(result["detail"][0]["erased"])
            self.assertEqual(result["detail"][0]["textBoxesPlaced"], 1)
            self.assertGreaterEqual(output.stat().st_size, 2048)

    def test_fixed_compose_still_calls_erase(self):
        called = []

        def fake_erase(array, payload, use_sam=False):
            called.append(payload)
            return array, {"inpainted": True, "engine": "lama"}

        with tempfile.TemporaryDirectory() as folder:
            image_path = Path(folder) / "baked.png"
            Image.new("RGB", (900, 1200), (255, 255, 255)).save(image_path)
            output = Path(folder) / "book-fixed.pptx"
            with patch("versa_layered_pptx.erase_text", fake_erase), patch(
                "versa_layered_pptx.repair_runs",
                lambda runs, prompt, page_size=None: [{
                    "text": "Hello",
                    "ocrText": "Hello",
                    "box": [10, 10, 80, 30],
                    "eraseBox": [10, 10, 80, 30],
                    "erase": True,
                    "place": True,
                }],
            ):
                result = compose_pptx({
                    "outputPath": str(output),
                    "sourceDpi": 300,
                    "pages": [{
                        "imagePath": str(image_path),
                        "pageLabel": "Slide 2",
                        "prompt": 'ONLY the following text: "Hello"',
                        "vision": {"text": [{"text": "Hello", "box": [10, 10, 80, 30]}]},
                    }],
                })
            self.assertTrue(result["ok"])
            self.assertTrue(called, "fixed mode must still erase baked text")
            self.assertEqual(result["detail"][0]["engine"], "lama")
            self.assertTrue(result["detail"][0]["erased"])


if __name__ == "__main__":
    unittest.main()
