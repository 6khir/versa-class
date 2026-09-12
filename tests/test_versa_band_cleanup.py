import os
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from versa_band_cleanup import cleanup_bands, inspect_band, watchdog


def _draw_page(path, text="Name Hunt", folio=None, textured=False):
    image = Image.new("RGB", (640, 480), (255, 248, 236) if not textured else (210, 170, 120))
    draw = ImageDraw.Draw(image)
    if textured:
        for y in range(0, 480, 4):
            draw.line((0, y, 640, y), fill=(180, 120, 70))
    else:
        draw.rectangle((40, 40, 600, 140), fill=(252, 248, 238))
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    draw.text((70, 70), text, fill=(40, 40, 45), font=font)
    if folio:
        draw.text((520, 440), folio, fill=(30, 30, 30), font=font)
    image.save(path)
    return path


class BandCleanupTests(unittest.TestCase):
    def test_flat_band_removes_ink_and_passes_watchdog(self):
        with tempfile.TemporaryDirectory() as folder:
            source = os.path.join(folder, "flat.png")
            _draw_page(source)
            rgb = np.array(Image.open(source).convert("RGB"))
            repaired, stats = cleanup_bands(rgb, [[60, 60, 320, 120]], expand_px=2)
            self.assertGreater(stats["maskPixels"], 0)
            self.assertTrue(any(band["flat"] for band in stats["bands"]))
            verify = watchdog(repaired, [{"box": [40, 40, 600, 140], "color": [252, 248, 238]}])
            self.assertTrue(verify["ok"], verify)

    def test_textured_band_is_reported_nonflat(self):
        with tempfile.TemporaryDirectory() as folder:
            source = os.path.join(folder, "texture.png")
            _draw_page(source, textured=True)
            rgb = np.array(Image.open(source).convert("RGB"))
            info = inspect_band(rgb, [40, 40, 600, 140])
            self.assertFalse(info["flat"])


if __name__ == "__main__":
    unittest.main()
