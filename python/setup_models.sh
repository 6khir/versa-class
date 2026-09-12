#!/usr/bin/env bash
# One-time setup for the local vision pipeline. Safe to re-run.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="${VERSA_PYTHON:-$(command -v python3.11 || command -v python3.12 || true)}"
if [ -z "$PY" ]; then
  echo "Need Python 3.11 or 3.12 (torch/paddle publish no wheels for 3.13+)." >&2
  echo "  brew install python@3.11" >&2
  exit 1
fi
echo "Using $PY ($("$PY" -V))"

# The venv directory ends in .nosync deliberately. This project lives on a synced
# Desktop, and iCloud Drive evicts individual files inside a normal directory - it
# took out paddle/utils/__init__.py and cv2/misc/__init__.py mid-run, which surfaces
# as a baffling ImportError rather than as a sync problem. iCloud skips *.nosync.
VENV="$HERE/.venv.nosync"
if [ -d "$HERE/.venv" ] && [ ! -d "$VENV" ]; then
  echo "Moving the existing venv behind a .nosync name so iCloud stops evicting it…"
  mv "$HERE/.venv" "$VENV"
fi
[ -d "$VENV" ] || "$PY" -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip setuptools wheel
"$VENV/bin/pip" install -r "$HERE/requirements.txt"
# These two go in with --no-deps and in this order. simple-lama declares pillow<10 and
# pikepdf declares Pillow>=10.0.1; put both in the requirements file and pip resolves
# nothing at all. simple-lama only actually needs torch and PIL, which are already in.
"$VENV/bin/pip" install --no-deps "simple-lama-inpainting>=0.1.2"
"$VENV/bin/pip" install --no-deps "pillow>=10.2,<11"

mkdir -p "$HERE/models"
CKPT="$HERE/models/mobile_sam.pt"
if [ ! -f "$CKPT" ]; then
  echo "Downloading MobileSAM checkpoint (~40MB)…"
  curl -fL -o "$CKPT" \
    https://raw.githubusercontent.com/ChaoningZhang/MobileSAM/master/weights/mobile_sam.pt
fi

# pip will happily satisfy the pins with a combination that imports fine and then
# segfaults, so check the versions that actually matter and run a real kernel.
echo "Checking the constraints that cause silent crashes…"
"$VENV/bin/python" - <<'PYCHECK'
import sys
problems = []
import numpy
if numpy.__version__.split(".")[0] != "1":
    problems.append(f"numpy {numpy.__version__}: paddle and torch need the 1.x C ABI (pip install 'numpy<2')")
import paddle
if tuple(int(p) for p in paddle.__version__.split(".")[:2]) < (3, 0):
    problems.append(f"paddlepaddle {paddle.__version__}: 2.6.x segfaults on macOS 14+/arm64 (pip install 'paddlepaddle>=3.0')")
import cv2
if cv2.__version__.split(".")[0] != "4":
    problems.append(f"opencv {cv2.__version__}: 5.x forces numpy>=2 (pip install 'opencv-python-headless<5')")
try:
    paddle.set_device("cpu")
    paddle.nn.Conv2D(3, 4, 3)(paddle.zeros([1, 3, 16, 16]))
except Exception as error:  # noqa: BLE001
    problems.append(f"paddle cannot run a convolution on this machine: {error}")
for module in ("simple_lama_inpainting", "mobile_sam", "fontTools", "pikepdf", "reportlab"):
    try:
        __import__(module)
    except Exception as error:  # noqa: BLE001
        problems.append(f"{module} will not import: {error}")
if problems:
    print("\n".join(f"  x {p}" for p in problems), file=sys.stderr)
    sys.exit(1)
import PIL
print(f"  ok numpy {numpy.__version__}, paddle {paddle.__version__}, opencv {cv2.__version__}, pillow {PIL.__version__}")
PYCHECK

echo "Verifying the worker…"
"$VENV/bin/python" "$HERE/versa_vision.py" <<< '{"cmd":"ping"}'
echo "Running the layered PDF checks…"
"$VENV/bin/python" "$HERE/test_layered_pdf.py" 2>&1 | tail -3
