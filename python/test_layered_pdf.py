#!/usr/bin/env python3
"""
Checks for the Interior Text compiler that need the real libraries.

    python/.venv.nosync/bin/python python/test_layered_pdf.py

Composition tests default to overlay mode: replace mode loads LaMa's 196 MB model,
which is far too slow to pay per test case. The erase path has its own test that
stubs the inpainter, plus a real end-to-end run in test_pipeline_e2e.py.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from PIL import Image, ImageDraw

import versa_layered_pdf as lp
import versa_font_match as fm

ARIAL = "/System/Library/Fonts/Supplemental/Arial.ttf"


def page_with_text(boxes, size=(1240, 1754), bg=(250, 250, 250)):
    image = Image.new("RGB", size, bg)
    draw = ImageDraw.Draw(image)
    for box in boxes:
        draw.rectangle(box, fill=(0, 0, 0))
    return image


class Geometry(unittest.TestCase):
    def test_page_size_comes_from_pixels_and_authoring_dpi(self):
        width, height = lp._page_points(2480, 3508, 300)   # A4 at 300 DPI
        self.assertAlmostEqual(width, 595.2, places=1)
        self.assertAlmostEqual(height, 841.92, places=1)

    def test_boxes_flip_from_image_space_to_pdf_space(self):
        scale = 0.24
        x, y, w, h = lp._to_pdf_rect([100, 200, 300, 260], page_h_px=1000, scale=scale)
        self.assertAlmostEqual(x, 100 * scale)
        self.assertAlmostEqual(w, 200 * scale)
        self.assertAlmostEqual(h, 60 * scale)
        self.assertAlmostEqual(y, (1000 - 260) * scale)   # PDF y grows upward

    def test_replacement_is_fitted_to_the_original_footprint(self):
        size, horiz = lp._fit_font("HELLO", 120, 20, "Helvetica")
        self.assertLessEqual(size, 20)
        self.assertGreaterEqual(horiz, lp.MIN_HORIZ_SCALE)
        self.assertLessEqual(horiz, lp.MAX_HORIZ_SCALE)
        small, squeezed = lp._fit_font("A" * 80, 60, 20, "Helvetica")
        self.assertLess(small, size)
        self.assertAlmostEqual(squeezed, lp.MIN_HORIZ_SCALE)


class InkAnalysis(unittest.TestCase):
    def test_ink_colour_is_read_from_the_glyphs_not_assumed_dark(self):
        # White on a coloured banner: "darkest pixel" would return the banner and
        # redraw the header invisibly.
        image = Image.new("RGB", (600, 300), (22, 135, 138))
        ImageDraw.Draw(image).rectangle((100, 100, 400, 150), fill=(255, 255, 255))
        runs = [{"id": "t1", "text": "HEADER", "box": [100, 100, 400, 150]}]
        info = lp._analyse_runs(image, runs)[id(runs[0])]
        self.assertGreater(min(info["ink"]), 200)
        self.assertEqual(info["background"], (22, 135, 138))

    def test_flat_paper_is_measured_robustly_despite_clipping_its_own_glyphs(self):
        image = page_with_text([(100, 100, 400, 140)])
        runs = [{"id": "t1", "text": "WORD", "box": [100, 100, 400, 140]}]
        info = lp._analyse_runs(image, runs)[id(runs[0])]
        self.assertLess(info["spread"], 12.0)
        self.assertEqual(info["background"], (250, 250, 250))


class Topology(unittest.TestCase):
    """The pre-classifier exists because ink statistics alone matched a serif face to
    a plainly sans line."""

    def _classify(self, font_path, index=0):
        import cv2

        mask = fm._render_mask(np, "IHTELOSRNB", font_path, index)
        return fm.classify_topology(np, cv2, mask)[0]

    def test_a_serif_face_classifies_as_serif(self):
        self.assertEqual(self._classify("/System/Library/Fonts/Supplemental/Georgia.ttf"), fm.SERIF)

    def test_a_grotesque_does_not_classify_as_serif(self):
        self.assertNotEqual(self._classify(ARIAL), fm.SERIF)

    def test_every_candidate_face_is_upright(self):
        names = [name for name, _path, _index in fm.available_fonts()]
        self.assertTrue(names)
        for name in names:
            self.assertNotIn("italic", name.lower())
            self.assertNotIn("oblique", name.lower())


class FontSourcing(unittest.TestCase):
    """Font selection resolves to installed faces with real metrics. Raster contour
    tracing is deprecated and must not creep back into the compiler."""

    def test_the_compiler_does_not_trace_outlines(self):
        source = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   "versa_layered_pdf.py"), encoding="utf-8").read()
        self.assertNotIn("versa_glyph_foundry", source)
        self.assertNotIn("synthesize_run_font", source)

    def test_matched_faces_carry_kerning_and_metrics(self):
        from fontTools.ttLib import TTFont

        for name, path, index in fm.available_fonts()[:6]:
            font = TTFont(path, fontNumber=index)
            self.assertIn("hmtx", font, f"{name} has no metrics")
            self.assertIn("cmap", font, f"{name} has no character map")


class Composition(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="versa-lp-")
        self.page = os.path.join(self.dir, "page.png")
        page_with_text([(120, 200, 700, 260), (120, 400, 500, 450)]).save(self.page)
        self.vision = {
            "ok": True, "width": 1240, "height": 1754,
            "text": [
                {"id": "t1", "text": "COUNT THE STARS", "box": [120, 200, 700, 260]},
                {"id": "t2", "text": "WRITE YOUR NAME", "box": [120, 400, 500, 450]},
            ],
        }

    def spec(self, **overrides):
        base = {
            "outputPath": os.path.join(self.dir, "out.pdf"),
            "dpi": 150, "sourceDpi": 300, "quality": 80,
            "textMode": "overlay",
            "pages": [{"imagePath": self.page, "vision": self.vision}],
        }
        base.update(overrides)
        return base

    def test_exactly_two_layers_per_page_and_no_object_segmentation(self):
        import pikepdf

        result = lp.compose(self.spec())
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["layersPerPage"], 2)
        pdf = pikepdf.Pdf.open(result["outputPath"])
        names = [str(ocg.Name) for ocg in pdf.Root.OCProperties.OCGs]
        self.assertEqual(names, ["Artwork p1", "Text p1"])
        forms = pdf.pages[0].Resources.XObject
        self.assertEqual(len(forms), 2)
        for form in forms.values():
            self.assertIn("/OC", form)

    def test_every_layer_is_wired_to_the_catalog(self):
        # Copying a page duplicates its OCG objects, so a catalog built from the source
        # documents would name layers that no content is actually tied to - Acrobat
        # then shows switches that control nothing.
        import pikepdf

        result = lp.compose(self.spec(pages=[{"imagePath": self.page, "vision": self.vision}] * 3,
                                      outputPath=os.path.join(self.dir, "book.pdf")))
        pdf = pikepdf.Pdf.open(result["outputPath"])
        catalog = {ocg.objgen for ocg in pdf.Root.OCProperties.OCGs}
        for page in pdf.pages:
            for _name, form in page.Resources.XObject.items():
                self.assertIn(form.OC.objgen, catalog)

    def test_text_survives_as_real_extractable_text(self):
        from pypdf import PdfReader

        result = lp.compose(self.spec())
        extracted = PdfReader(result["outputPath"]).pages[0].extract_text()
        self.assertIn("COUNT THE STARS", extracted)
        self.assertIn("WRITE YOUR NAME", extracted)

    def test_lower_dpi_and_quality_make_a_smaller_file(self):
        big = lp.compose(self.spec(dpi=300, quality=95, outputPath=os.path.join(self.dir, "big.pdf")))
        small = lp.compose(self.spec(dpi=110, quality=60, outputPath=os.path.join(self.dir, "small.pdf")))
        self.assertLess(small["bytes"], big["bytes"])

    def test_bad_input_is_named_rather_than_raised(self):
        self.assertEqual(lp.compose({"pages": []})["code"], "OUTPUT_MISSING")
        self.assertEqual(lp.compose({"outputPath": "/tmp/x.pdf", "pages": []})["code"], "NO_PAGES")
        missing = lp.compose(self.spec(pages=[{"imagePath": "/nope/none.png", "vision": self.vision}]))
        self.assertEqual(missing["code"], "IMAGE_MISSING")

    def test_replace_mode_does_not_erase_without_a_text_stamper(self):
        import versa_text_inpaint as ti

        seen = {}

        def fake_erase(image, runs, checkpoint=None, use_sam=True):
            seen["runs"] = len(runs)
            return image, {"runs": len(runs), "sam": 0, "inkOnly": len(runs), "inpainted": True}

        original = ti.erase_text
        ti.erase_text = fake_erase
        try:
            result = lp.compose(self.spec(textMode="replace",
                                          outputPath=os.path.join(self.dir, "r.pdf")))
        finally:
            ti.erase_text = original
        self.assertTrue(result["ok"], result)
        self.assertNotIn("runs", seen)
        detail = result["detail"][0]
        self.assertEqual(detail["erased"], False)
        self.assertEqual(detail["textPlaced"], 0)
        self.assertEqual(detail["textLeftBaked"], 2)


class Merge(unittest.TestCase):
    def test_merging_pages_preserves_every_layer(self):
        import pikepdf

        directory = tempfile.mkdtemp(prefix="versa-merge-")
        page = os.path.join(directory, "p.png")
        page_with_text([(120, 200, 700, 260)]).save(page)
        vision = {"ok": True, "width": 1240, "height": 1754,
                  "text": [{"id": "t1", "text": "HELLO", "box": [120, 200, 700, 260]}]}
        inputs = []
        for number in (1, 2, 3):
            out = os.path.join(directory, f"page_{number:03d}.pdf")
            lp.compose({"outputPath": out, "dpi": 120, "sourceDpi": 300, "textMode": "overlay",
                        "pages": [{"imagePath": page, "vision": vision, "pageLabel": f"p{number}"}]})
            inputs.append(out)
        merged = lp.merge({"outputPath": os.path.join(directory, "book.pdf"), "inputs": inputs})
        self.assertTrue(merged["ok"], merged)
        self.assertEqual(merged["pages"], 3)
        self.assertEqual(merged["layers"], 6)
        pdf = pikepdf.Pdf.open(merged["outputPath"])
        self.assertEqual([str(o.Name) for o in pdf.Root.OCProperties.OCGs],
                         ["Artwork p1", "Text p1", "Artwork p2", "Text p2", "Artwork p3", "Text p3"])

    def test_merge_reports_missing_inputs_by_name(self):
        self.assertEqual(lp.merge({"outputPath": "/tmp/b.pdf", "inputs": []})["code"], "NO_PAGES")
        self.assertEqual(
            lp.merge({"outputPath": "/tmp/b.pdf", "inputs": ["/nope/p.pdf"]})["code"],
            "PAGE_PDF_MISSING",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
