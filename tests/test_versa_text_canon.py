#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))

from versa_text_canon import extract_canonical_lines, repair_runs


PAGE2 = (
    '@image A page titled "SETUP & USE: MAKE LEARNING NAME FUN!". '
    'The image must contain ONLY the following text: '
    '"SETUP & USE: MAKE LEARNING NAME FUN!", "FOR THE TEACHER:", '
    '"STUDENT INSTRUCTIONS:", "My Class List:". Do not render any other text.'
)
PAGE5 = (
    'The image must contain ONLY the following text: '
    '"PAGE 5 — NAME HUNT & MATCH", '
    '"Find all the letters to spell your name in the marker grid below. '
    'Connect them with lines and write your name!", "[STUDENT NAME]".'
)


class CanonTests(unittest.TestCase):
    def test_extracts_quoted_allow_list(self):
        lines = extract_canonical_lines(PAGE2)
        self.assertEqual(lines, [
            "SETUP & USE: MAKE LEARNING NAME FUN!",
            "FOR THE TEACHER:",
            "STUDENT INSTRUCTIONS:",
            "My Class List:",
        ])

    def test_erases_letter_salad_and_keeps_titles(self):
        runs = repair_runs([
            {"text": "SETUP & USE: MAKE LEARNING NAME FUN!", "box": [125, 124, 2369, 256], "confidence": 0.97},
            {"text": "FOR THE TEACHER:", "box": [144, 406, 1070, 523], "confidence": 0.98},
            {"text": "Teacher types as name to the usel schoot.", "box": [358, 581, 2159, 702], "confidence": 0.99},
            {"text": "Remain ooliwturs showing on the aJin.", "box": [358, 862, 1986, 998], "confidence": 0.98},
            {"text": "Enanma", "box": [845, 1476, 1140, 1564], "confidence": 0.99},
            {"text": "STUDENT INSTRUCTIONS:", "box": [144, 1845, 1391, 1962], "confidence": 0.99},
            {"text": "My Class List:", "box": [181, 2828, 834, 2967], "confidence": 0.96},
        ], PAGE2, page_size=(2480, 3508))
        placed = [run["text"] for run in runs if run.get("place")]
        skipped = [run["ocrText"] for run in runs if not run.get("place")]
        self.assertIn("SETUP & USE: MAKE LEARNING NAME FUN!", placed)
        self.assertIn("FOR THE TEACHER:", placed)
        self.assertIn("STUDENT INSTRUCTIONS:", placed)
        self.assertIn("My Class List:", placed)
        self.assertTrue(any("usel schoot" in text for text in skipped))
        self.assertIn("Enanma", skipped)
        self.assertTrue(all(run.get("erase") for run in runs if not run.get("place")))

    def test_replaces_cropped_title_and_merges_instruction(self):
        runs = repair_runs([
            {"text": "JNT & MATCH", "box": [0, 113, 1141, 370], "confidence": 0.95},
            {"text": "Find all the letters to spell yo", "box": [29, 522, 2462, 754], "confidence": 0.99},
            {"text": "grid below.", "box": [20, 707, 939, 937], "confidence": 0.99},
            {"text": "Connect them with lines and", "box": [29, 910, 2454, 1096], "confidence": 0.97},
            {"text": "F", "box": [1402, 1348, 1583, 1564], "confidence": 0.99},
        ], PAGE5, page_size=(2480, 3508))
        placed = [run["text"] for run in runs if run.get("place")]
        self.assertIn("PAGE 5 — NAME HUNT & MATCH", placed)
        self.assertTrue(any("Find all the letters" in text for text in placed))
        self.assertIn("F", placed)
        self.assertNotIn("JNT & MATCH", placed)
        self.assertNotIn("[STUDENT NAME]", placed)

    def test_quality_pages_stamp_leftover_ocr_in_place(self):
        runs = repair_runs([
            {"text": "SUPPLIES & FLEXIBLE SEATING", "box": [120, 80, 2200, 220], "confidence": 0.98},
            {"text": "I. Carefully cut along the solid lines for all flipbook pages and cover.", "box": [180, 520, 2300, 680], "confidence": 0.97},
            {"text": "page N", "box": [2100, 3200, 2400, 3320], "confidence": 0.9},
        ], 'Title: "SUPPLIES & FLEXIBLE SEATING". Crayon style.', page_size=(2480, 3508))
        placed = {run["text"]: run for run in runs if run.get("place")}
        folio = next(run for run in runs if run["ocrText"] == "page N")
        self.assertIn("SUPPLIES & FLEXIBLE SEATING", placed)
        self.assertIn("I. Carefully cut along the solid lines for all flipbook pages and cover.", placed)
        self.assertTrue(placed["I. Carefully cut along the solid lines for all flipbook pages and cover."].get("erase"))
        self.assertFalse(folio.get("place"))
        self.assertFalse(folio.get("erase"))

    def test_flat_page_does_not_invent_cover_boxes(self):
        runs = repair_runs([], PAGE2, page_size=(2480, 3508))
        self.assertEqual(runs, [])


if __name__ == "__main__":
    unittest.main()
