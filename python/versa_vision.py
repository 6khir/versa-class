#!/usr/bin/env python3
"""CLI for blank-master text removal: PaddleOCR → dilated mask → LaMa → verify."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from versa_text_inpaint import TextInpaintError, clean_blank_master  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description="Remove baked text from a blank master with LaMa (no prompts).")
    parser.add_argument("--input", required=True, help="Source PNG")
    parser.add_argument("--output", default="", help="Destination PNG (defaults to --input)")
    args = parser.parse_args(argv)
    try:
        result = clean_blank_master(args.input, args.output or None)
        print(json.dumps(result))
        return 0
    except TextInpaintError as exc:
        print(json.dumps(exc.to_dict()))
        return 2


if __name__ == "__main__":
    sys.exit(main())
