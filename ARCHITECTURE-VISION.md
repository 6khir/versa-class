# Local Vision Architecture — Interior Artwork and Interior Text

Target machine: MacBook Air M2, 16 GB, Apple Silicon, no discrete GPU, no Xcode required.

The work is split across the two editable stages:

| Stage | Does |
| --- | --- |
| **Interior Artwork** | MobileSAM segmentation + PaddleOCR text extraction, aligned into one layer model per page |
| **Interior Text** | Compiles those layers and coordinates into one **layered PDF** |

## Why this replaces the gem turn

Stage 2 previously uploaded each page to Gemini and asked for text as JSON. That is a
network round trip per page, it drifts between turns, and it cannot tell you *where*
on the page a word sits — so nothing downstream can move an object or rewrite one text
run in place. Reading the page locally gives coordinates, and coordinates are what make
the page editable rather than merely re-describable.

## Pipeline

```
page_N.png (300 DPI)
        │
        ├─► PaddleOCR  (full resolution)      → text runs: string, quad, confidence
        │
        └─► MobileSAM  (downscaled ≤1400px)   → object masks: bbox, area, stability
                        │
                        ▼
              coordinate alignment
                        │
                        ▼
   layer model: [{ id, box, area, textIds[] }] + orphanText[]
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
  four-key page text            object/text manipulation
  (Stage 3 assembly)            (move layer, carry its text)
```

### Why these two models

**MobileSAM** — 40 MB, ViT-Tiny image encoder, ~10 MB of decoder. Runs on CPU in a few
seconds per page on M2 and needs roughly 2 GB peak. Full SAM ViT-H is 2.4 GB and would
swap on a 16 GB machine that is also running Electron and Chrome Canary.

**PaddleOCR** — detection + angle classification + recognition in ~15 MB, strong on the
short, laid-out strings a worksheet contains, and returns a quadrilateral per run rather
than a loose line box. The quad is what makes alignment reliable on rotated banners.

### Resolution split

OCR runs at **full resolution** because small type is the entire point. Segmentation runs
at **≤1400 px on the long side** because SAM cost grows with the square of side length
while object boundaries do not need 300 DPI. Segmentation coordinates are multiplied back
by `1/scale` on the way out, so every number the app sees is in original page pixels.

### Alignment rule

For each text run, walk layers **smallest area first** and bind to the first layer where:

1. ≥60 % of the text box lies inside the layer box, **and**
2. the text-box centre lands on a true pixel of that layer's mask.

Smallest-first matters: a page-sized background mask technically contains every word, so
largest-first would bind everything to the background and produce one useless layer. The
mask-pixel check is the guard against a word that merely overlaps a neighbouring box.

Thin outlined frames are a known exception — a glyph centre can land on background pixels
*inside* the outline — so there is a second pass binding on ≥85 % box containment alone.
Anything still unbound is reported in `orphanText` rather than force-fitted, because a
wrong binding silently moves text with the wrong object later.

## Process model

The Python worker is **long-lived**, spoken to over newline-delimited JSON on stdin/stdout.
Model load is 3–6 s; per-page work is far less. Starting a process per page would pay that
cost 26 times for a 26-page book.

```
{"cmd":"ping"}                                  → readiness + which models are present
{"cmd":"analyze","imagePath":"…","maxSide":1400} → the layer model above
```

Every response carries the request `id`, so replies cannot be mismatched.

## Failure policy

This is the constraint that shaped the whole design: **Interior Text must never take the
pipeline down.** Therefore:

- `VisionBridge.analyzePage()` **never throws** — it resolves to `{ok:false, code, error}`.
- A missing venv, missing checkpoint, timeout, or worker crash all produce a code the UI
  can explain, and Interior Text falls through to the existing gem turn unchanged.
- `useVision` defaults to **false**. Vision is opt-in, so an unprepared machine behaves
  exactly as it does today.
- The Python worker catches every exception per request and answers with an error line
  instead of dying, so one bad page cannot end the run.

## Install

```bash
bash python/setup_models.sh
```

Creates `python/.venv` with Python 3.11, installs the pinned requirements, downloads the
MobileSAM checkpoint, and runs a `ping` to verify. **Python 3.14 will not work** — neither
torch nor PaddlePaddle publishes wheels for it yet; the script looks for 3.11 or 3.12.

## Interior Text — the layered PDF

`python/versa_layered_pdf.py` turns the layer model into one PDF whose content is
split into real **Optional Content Groups**, the thing every viewer with a layers
panel keys off. Each layer is a Form XObject carrying `/OC`; viewers without a panel
simply draw them in order, so the page still looks right.

```
Artwork p1     the page picture, resampled and recompressed
Objects p1     segmented cut-outs, each independently movable   (opt-in)
Text p1        real text objects at the OCR coordinates
```

### Quality against size

Resolution and codec are the only two levers that matter for a raster-backed
worksheet, so both are explicit inputs rather than one opaque "quality" number:

- artwork is resampled to **200 DPI** with LANCZOS — above the ~150 where print
  starts to show, and LANCZOS because bilinear visibly softens line art;
- encoded **once** as JPEG q88 with **4:4:4 chroma** — subsampling is what destroys
  coloured text edges, which is most of a worksheet;
- embedded verbatim: reportlab passes DCTDecode straight through, so there is no
  decode/re-encode generation loss;
- then qpdf recompresses every non-image stream, packs the object table into object
  streams, and linearizes.

Measured on a real 3-page book: **22 MB of source PNG → 2.4 MB**, visually identical.

### Text mode

| Mode | Artwork | Text |
| --- | --- | --- |
| `overlay` *(default)* | untouched, pixel-identical | drawn invisibly (render mode 3) — selectable, searchable, rewritable |
| `replace` | words erased | drawn visibly in the original ink colour — editing the string changes the page |

`replace` only converts runs whose surroundings are provably uniform. Two guards
decide, both calibrated against real pages rather than guessed:

- **ring spread** — the median absolute deviation of the border just outside the run.
  Plain instruction text measures 1.5–7.4; text on banners, shaded boxes and
  illustrations measures 14–80. The threshold sits at **12**, in the gap.
  A *standard* deviation does not work here: OCR boxes are tight enough that the ring
  clips the run's own ascenders, and those few ink pixels drag it from ~2 to ~50, so
  plain white paper would be refused.
- **ink coherence** — how tightly the glyph pixels cluster. A rainbow title cannot be
  honestly redrawn as one colour, so it stays baked in.

Anything that fails a guard is left in the artwork and reported as `textLeftBaked`.
A word that stayed uneditable is a far smaller defect than a grey rectangle stamped
over the illustration.

Erasure is a **flat fill** of the colour already proved uniform. Telea inpainting was
tried first and is wrong for this mask shape: it propagates inward from the boundary,
so across a box as wide as a sentence it leaves a visible smear down the middle.

Replacement text is fitted to the original run's footprint using PDF horizontal
scaling (clamped 72–132%) rather than by shrinking the point size, because the
substitute face is rarely as wide as the artwork's display font — fitting on size
alone leaves the tail of the erased area showing as a pale gap.

## Version constraints that cause silent crashes

These are not arbitrary ranges. Each was found by a segfault, not by reading docs:

| Pin | Why |
| --- | --- |
| `paddlepaddle>=3.0` | 2.6.2 **segfaults (SIGSEGV)** on macOS 14+/arm64 — a bare `Conv2D` kills the process |
| `numpy<2` | paddle and the torch/MobileSAM stack are built against the numpy 1.x C ABI |
| `opencv<5` | opencv 5.x hard-requires `numpy>=2`, contradicting the above |

Two further runtime defects are handled in code rather than by pinning:

- **PaddleOCR writes to stdout.** Progress bars and `download https://…` lines land on
  fd 1, the same channel as the JSON protocol. The worker claims the real stdout on a
  private descriptor and points fd 1 at stderr, so no library can corrupt a reply.
- **Paddle drops its allocator between calls.** Reusing one `PaddleOCR` instance
  raises `No allocator found for the place, Place(undefined:0)` from inside matmul —
  reproducibly on page 2 of a three-page run, while that same page passes when it is
  first. `_run_ocr` retries once with a fresh predictor; reuse stays the fast path.

`setup_models.sh` checks all of this and runs a bare convolution before declaring
success, because pip will happily resolve a combination that imports fine and then
crashes.

## Files

| File | Role |
| --- | --- |
| `python/versa_vision.py` | The worker: OCR, segmentation, alignment |
| `python/versa_layered_pdf.py` | The layered PDF compiler |
| `python/test_layered_pdf.py` | Compiler checks that need the real libraries |
| `python/requirements.txt` | Pinned deps for Python 3.11 on arm64 |
| `python/setup_models.sh` | venv + deps + checkpoint + version checks + verification |
| `src/vision-bridge.cjs` | Long-lived process bridge; never throws |
| `src/editable-vision-pages.cjs` | Interior Artwork: reads every page, caches the layer model |
| `src/editable-layered-pdf.cjs` | Interior Text: compiles the layered PDF |
| `src/editable-page-text.cjs` | Gem fallback when the vision environment is absent |

## What the layer model unlocks

Because every text run carries `layerId` and a box in page pixels:

- **Move an object** — translate the layer box and offset each bound text run by the same
  delta; the text travels with the object it belongs to.
- **Rewrite a text run** — replace `text` and re-render only that box; the artwork under
  it is a separate layer and is untouched.
- **Detect baked-in text** — a page whose OCR returns confident runs *is* a page with text
  drawn into the artwork. This is the reliable version of the check my pixel heuristic
  failed at, and it costs nothing extra once OCR has already run.
