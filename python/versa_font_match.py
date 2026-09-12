#!/usr/bin/env python3
"""
VERSA CLASS - font matching for the editable text layer.

The artwork is a raster, so the font a word was set in is not recorded anywhere; it
only exists as pixels. Recovering it matters because the replacement text has to sit
in the same place looking like the same word - a worksheet header redrawn in
Helvetica reads as a different document.

So the font is identified by rendering, not by lookup: for each text run, the string
is drawn in every candidate face, and the candidate whose ink actually overlaps the
original ink best wins. That compares the thing we care about - glyph shape - rather
than metadata that a raster does not carry.

Scoring is intersection-over-union of the two ink masks after both are normalised to
a common box, multiplied by an aspect-ratio agreement term. IoU alone would rank a
face that is merely the right weight over one that is the right shape, because
thicker strokes cover more of the target.

Candidates are a curated list, not every font installed. Matching against all 224
system faces is slower and *worse*: dozens of near-identical grotesques split the
score, and symbol fonts occasionally win on short strings by accident.
"""

import os
import sys

_FONT_DIRS = [
    "/System/Library/Fonts/Supplemental",
    "/System/Library/Fonts",
    "/Library/Fonts",
    os.path.expanduser("~/Library/Fonts"),
]

# Font *files* to consider. Every face inside a collection is discovered by asking
# the file what it contains - hand-written indices are how "Gill Sans Bold" silently
# became Gill Sans Italic and "Avenir Next Regular" became Avenir Next Bold, because
# collection ordering is arbitrary and differs between macOS versions.
#
# The list is curated rather than "every installed font": matching against all 224
# system faces is slower and worse, because dozens of near-identical grotesques split
# the score and symbol fonts occasionally win on short strings by accident.
_CANDIDATE_FILES = [
    # rounded / comic / handwriting - worksheet display type
    "Arial Rounded Bold.ttf", "Comic Sans MS.ttf", "Comic Sans MS Bold.ttf",
    "Chalkboard.ttc", "ChalkboardSE.ttc", "Bradley Hand Bold.ttf", "MarkerFelt.ttc",
    # grotesques - instructions and labels
    "Arial.ttf", "Arial Bold.ttf", "Arial Black.ttf",
    "Arial Narrow.ttf", "Arial Narrow Bold.ttf",
    "Helvetica.ttc", "Verdana.ttf", "Verdana Bold.ttf",
    "Tahoma.ttf", "Tahoma Bold.ttf",
    "Trebuchet MS.ttf", "Trebuchet MS Bold.ttf",
    "Futura.ttc", "GillSans.ttc", "Optima.ttc", "Avenir Next.ttc", "Impact.ttf",
    # serifs - rarer on worksheets, but present on certificates and headers
    "Georgia.ttf", "Georgia Bold.ttf", "Times New Roman.ttf", "Times New Roman Bold.ttf",
]

# Slanted cuts are excluded. Worksheet type is essentially always upright, and an
# italic scores deceptively well on a vertical ink profile while looking obviously
# wrong on the page - it is what made instruction lines come back slanted.
_EXCLUDED_STYLES = ("italic", "oblique")

_MAX_FACES_PER_FILE = 12

# Rendering size for the comparison. Big enough that stroke weight is expressed in
# more than a couple of pixels, small enough that ~30 candidates stay cheap.
_MATCH_HEIGHT = 64
_MAX_MATCH_CHARS = 24

_resolved = None
_face_cache = {}


def _resolve_candidates():
    """
    Every upright face inside the candidate files present on this machine.

    Faces are discovered by loading each index and asking for its real family and
    style, so the list is correct regardless of how a given macOS orders a collection.
    """
    global _resolved
    if _resolved is not None:
        return _resolved
    from PIL import ImageFont

    found = []
    seen = set()
    for filename in _CANDIDATE_FILES:
        path = next((os.path.join(d, filename) for d in _FONT_DIRS
                     if os.path.exists(os.path.join(d, filename))), None)
        if not path:
            continue
        for index in range(_MAX_FACES_PER_FILE):
            try:
                family, style = ImageFont.truetype(path, 20, index=index).getname()
            except Exception:  # noqa: BLE001 - past the last face in the collection
                break
            style = (style or "Regular").strip()
            if any(token in style.lower() for token in _EXCLUDED_STYLES):
                continue
            name = "".join(ch for ch in f"{family}-{style}" if ch.isalnum() or ch == "-")
            if name in seen:
                continue
            seen.add(name)
            found.append((name, path, index))
    _resolved = found
    return _resolved


def available_fonts():
    return [(name, path, index) for name, path, index in _resolve_candidates()]


def _load(path, index, size):
    key = (path, index, size)
    if key not in _face_cache:
        from PIL import ImageFont

        try:
            _face_cache[key] = ImageFont.truetype(path, size, index=index)
        except Exception:  # noqa: BLE001 - a face that will not load is simply not a candidate
            _face_cache[key] = None
    return _face_cache[key]


def _ink_mask(np, rgb, background):
    """Boolean mask of pixels that are ink rather than the surrounding paper."""
    distance = np.linalg.norm(rgb.astype(np.float32) - np.asarray(background, dtype=np.float32), axis=2)
    # Otsu-style split is overkill here: the background colour is already known, so a
    # midpoint between paper and the furthest ink separates them cleanly.
    peak = float(distance.max())
    if peak < 24.0:
        return None  # no ink worth matching - blank crop
    return distance > (peak * 0.45)


def _crop_to_mask(np, mask):
    """Tighten a mask to its ink and return it, or None if there is none."""
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not rows.any() or not cols.any():
        return None
    y0, y1 = np.where(rows)[0][[0, -1]]
    x0, x1 = np.where(cols)[0][[0, -1]]
    return mask[y0:y1 + 1, x0:x1 + 1]


def _render_mask(np, text, path, index):
    """Render `text` in one face and return its tight ink mask."""
    from PIL import Image, ImageDraw

    font = _load(path, index, _MATCH_HEIGHT)
    if font is None:
        return None
    # Generous canvas: display faces overshoot their nominal box, and a clipped
    # ascender would be scored as a shape difference.
    canvas = Image.new("L", (int(_MATCH_HEIGHT * len(text) * 1.6) + 40, _MATCH_HEIGHT * 3), 0)
    ImageDraw.Draw(canvas).text((20, _MATCH_HEIGHT // 2), text, fill=255, font=font)
    return _crop_to_mask(np, np.array(canvas) > 96)


# --------------------------------------------------------------------------- #
# topological pre-classification
# --------------------------------------------------------------------------- #
#
# Ink statistics alone cannot tell a serif from a sans. A vertical ink profile only
# knows where ink sits, and a bold serif at text size distributes ink much like a
# regular sans - which is how "USE DIFFERENT CRAYONS TO COLOR YOUR NAME", plainly a
# sans, came back as Georgia Bold.
#
# So candidates are filtered by stroke topology before any of that scoring runs. The
# same measurement is applied to the target crop and to every candidate's own
# rendering, so the comparison is self-calibrating rather than resting on absolute
# thresholds tuned to one machine's rasteriser.

SERIF = "SERIF"
SANS_SERIF = "SANS_SERIF"
DISPLAY = "DISPLAY"
MONOSPACE = "MONOSPACE"

# Probe string for classifying a candidate face. Deliberately serif-revealing: I, T
# and E carry the most obvious terminal flares, and the round letters expose stroke
# modulation.
_TOPOLOGY_PROBE = "IHTELOSRNB"


def _stroke_features(np, cv2, mask):
    """
    Stroke statistics that separate the topological classes.

    - modulation: how much stroke width varies within the run. A true sans is close to
      monolinear; serifs and calligraphic display faces are not.
    - terminal_ratio: corner density per unit of ink. Serif brackets and slab ends add
      corners that a sans terminal does not have.
    - complexity: contour perimeter against ink area - handwritten and decorative
      outlines wander far more than either text class.
    """
    if mask.sum() < 40:
        return None
    binary = mask.astype(np.uint8)

    # Distance transform peaks at stroke centres; twice the peak is the stroke width.
    distance = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    widths = distance[distance > 0.6]
    if widths.size < 20:
        return None
    modulation = float(widths.std() / max(widths.mean(), 1e-6))

    corners = cv2.cornerHarris(binary.astype(np.float32), 3, 3, 0.04)
    strong = int((corners > 0.01 * corners.max()).sum()) if corners.max() > 0 else 0
    terminal_ratio = strong / float(max(binary.sum(), 1)) * 100.0

    contours = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[-2]
    perimeter = sum(cv2.arcLength(contour, True) for contour in contours)
    complexity = perimeter / float(max(np.sqrt(binary.sum()), 1e-6))

    return {"modulation": modulation, "terminals": terminal_ratio, "complexity": complexity}


def _column_uniformity(np, mask):
    """Spread of per-glyph column widths. Monospace faces are near-uniform."""
    inked = mask.sum(axis=0) > 0
    spans, start = [], None
    for index, value in enumerate(inked):
        if value and start is None:
            start = index
        elif not value and start is not None:
            spans.append(index - start)
            start = None
    if start is not None:
        spans.append(len(inked) - start)
    spans = [span for span in spans if span >= 2]
    if len(spans) < 4:
        return None
    spans = np.asarray(spans, dtype=np.float32)
    return float(spans.std() / max(spans.mean(), 1e-6))


# Thresholds measured across the installed faces rather than guessed. Rendering the
# probe string in each and reading the three features gives:
#
#   face                     modulation  terminals  complexity  uniformity
#   Georgia                       0.480     28.13       28.34       0.439
#   Georgia Bold                  0.569     19.61       24.88       0.417
#   Times New Roman               0.469     36.70       30.40       0.435
#   Times New Roman Bold          0.568     24.22       25.95       0.409
#   Arial                         0.466     19.75       24.37       0.297
#   Arial Bold                    0.530     13.31       20.07       0.254
#   Verdana                       0.449     19.76       24.44       0.186
#   Tahoma                        0.440     20.63       24.22       0.189
#   Trebuchet MS                  0.464     20.32       22.94       0.299
#   Arial Narrow Bold             0.504     16.20       20.54       0.256
#   Comic Sans MS                 0.447     26.33       24.18       0.136
#   Chalkboard                    0.432     25.55       22.57       0.165
#   Bradley Hand Bold             0.413     55.96       26.15       0.617
#   Marker Felt                   0.488     22.99       20.22       0.224
#
# Modulation, the feature that intuitively ought to separate a serif from a sans,
# overlaps almost completely (0.41-0.57 across all three classes) and is not used to
# decide. What actually separates them is column-width uniformity - serif faces vary
# their letter widths far more (0.41-0.44) than grotesques do (0.19-0.30) - backed by
# contour complexity. Display faces are taken first, on high terminal density with
# low uniformity, because a decorative face otherwise reads as a serif.
_DISPLAY_TERMINALS = 22.0
_DISPLAY_UNIFORMITY = 0.35
_HANDWRITTEN_TERMINALS = 40.0
_SERIF_UNIFORMITY = 0.35
_SERIF_COMPLEXITY = 24.5
_MONOSPACE_UNIFORMITY = 0.10


def classify_topology(np, cv2, mask):
    """Classify one ink mask as SERIF, SANS_SERIF, DISPLAY or MONOSPACE."""
    features = _stroke_features(np, cv2, mask)
    if features is None:
        return None, {}
    uniformity = _column_uniformity(np, mask)
    features = {**features, "uniformity": uniformity}

    # Order matters. Display is tested first: a decorative face has serif-like contour
    # complexity, and calling it a serif would filter the pool the wrong way.
    if features["terminals"] >= _HANDWRITTEN_TERMINALS:
        return DISPLAY, features
    if (features["terminals"] > _DISPLAY_TERMINALS
            and uniformity is not None and uniformity < _DISPLAY_UNIFORMITY):
        return DISPLAY, features
    if uniformity is not None and uniformity < _MONOSPACE_UNIFORMITY:
        return MONOSPACE, features
    if (uniformity is not None and uniformity > _SERIF_UNIFORMITY
            and features["complexity"] > _SERIF_COMPLEXITY):
        return SERIF, features
    return SANS_SERIF, features


_topology_cache = {}


def candidate_topology(name, path, index):
    """The topological class of a candidate face, measured the same way as the target."""
    if name in _topology_cache:
        return _topology_cache[name]
    import cv2
    import numpy as np

    rendered = _render_mask(np, _TOPOLOGY_PROBE, path, index)
    label = classify_topology(np, cv2, rendered)[0] if rendered is not None else None
    _topology_cache[name] = label
    return label


def _profile(np, mask, bins=32):
    """Ink per row, resampled to a fixed number of bins and unit-normalised.

    This is the part of a face's identity that survives horizontal misalignment: where
    the ink sits vertically encodes x-height against cap height, ascender and
    descender depth, and stroke weight. Two renderings of the same string in the same
    face agree here even when their glyph advances differ by a pixel each.
    """
    rows = mask.sum(axis=1).astype(np.float32)
    if rows.sum() <= 0:
        return None
    edges = np.linspace(0, len(rows), bins + 1)
    binned = np.array([rows[int(edges[i]):max(int(edges[i + 1]), int(edges[i]) + 1)].mean()
                       for i in range(bins)], dtype=np.float32)
    norm = np.linalg.norm(binned)
    return binned / norm if norm > 0 else None


def _score(np, target, candidate):
    """
    How much one rendering looks like another.

    Pixel overlap alone is not enough. Across a whole sentence the two renderings
    accumulate different glyph advances, so by the last word they are out of phase and
    IoU collapses even for the correct face - which is exactly why long instruction
    lines scored worse than single words. So overlap is only one of four terms, and
    the two that carry the most weight are the ones that do not depend on horizontal
    alignment at all.
    """
    from PIL import Image

    target_ratio = target.shape[1] / max(target.shape[0], 1)
    candidate_ratio = candidate.shape[1] / max(candidate.shape[0], 1)
    if target_ratio <= 0 or candidate_ratio <= 0:
        return 0.0

    # 1. Natural proportions, before either is distorted to fit the other.
    aspect = min(target_ratio, candidate_ratio) / max(target_ratio, candidate_ratio)

    # 2. Vertical ink profile - alignment-invariant, and the strongest single signal.
    height = 48
    to_own = lambda mask, ratio: np.array(  # noqa: E731
        Image.fromarray(mask.astype(np.uint8) * 255)
        .resize((max(8, int(round(height * ratio))), height), Image.BILINEAR)
    ) > 128
    target_own, candidate_own = to_own(target, target_ratio), to_own(candidate, candidate_ratio)
    target_profile = _profile(np, target_own)
    candidate_profile = _profile(np, candidate_own)
    profile = float(np.dot(target_profile, candidate_profile)) if (
        target_profile is not None and candidate_profile is not None) else 0.0

    # 3. Ink density - separates a bold cut from its regular at the same proportions.
    target_density = target_own.mean()
    candidate_density = candidate_own.mean()
    density = (min(target_density, candidate_density) / max(target_density, candidate_density)
               if max(target_density, candidate_density) > 0 else 0.0)

    # 4. Direct overlap, once both are forced into the same box. Still worth keeping:
    #    on short strings it is the sharpest discriminator of letterform.
    width = max(8, int(round(height * target_ratio)))
    same = lambda mask: np.array(  # noqa: E731
        Image.fromarray(mask.astype(np.uint8) * 255).resize((width, height), Image.BILINEAR)
    ) > 128
    a, b = same(target), same(candidate)
    union = np.logical_or(a, b).sum()
    iou = float(np.logical_and(a, b).sum()) / float(union) if union else 0.0

    return 0.40 * profile + 0.22 * aspect + 0.18 * density + 0.20 * iou


def match_font(image_rgb, box, text, background, minimum_score=0.34):
    """
    Identify the face a text run was set in.

    Returns (name, path, index, score) or None when nothing scores well enough - in
    which case the caller should fall back rather than embed a confident-looking
    wrong answer.
    """
    import numpy as np

    text = (text or "").strip()
    if not text:
        return None
    # Long strings do not improve the match and cost linearly to render.
    sample = text[:_MAX_MATCH_CHARS]

    x0, y0, x1, y1 = [int(round(v)) for v in box]
    height, width = image_rgb.shape[:2]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(width, x1), min(height, y1)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None

    crop = image_rgb[y0:y1, x0:x1]
    mask = _ink_mask(np, crop, background)
    if mask is None:
        return None
    target = _crop_to_mask(np, mask)
    if target is None or target.shape[0] < 6:
        return None

    # Filter to the target's topological class before any ink scoring. This is what
    # stops a serif winning a sans line on ink distribution alone.
    import cv2

    target_class, _features = classify_topology(np, cv2, target)
    pool = _resolve_candidates()
    if target_class:
        same_class = [entry for entry in pool
                      if candidate_topology(entry[0], entry[1], entry[2]) == target_class]
        # Only narrow when the class actually has candidates; an empty pool would be a
        # worse answer than a slightly mixed one.
        if len(same_class) >= 3:
            pool = same_class

    best = None
    for name, path, index in pool:
        rendered = _render_mask(np, sample, path, index)
        if rendered is None:
            continue
        score = _score(np, target, rendered)
        if best is None or score > best[3]:
            best = (name, path, index, score)

    if best is None or best[3] < minimum_score:
        return None
    return best


def match_font_detailed(image_rgb, box, text, background, minimum_score=0.34):
    """match_font plus the topology it detected, for reporting and for the caller's
    confidence gate."""
    import cv2
    import numpy as np

    hit = match_font(image_rgb, box, text, background, minimum_score=minimum_score)
    crop_class = None
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    crop = image_rgb[max(0, y0):y1, max(0, x0):x1]
    mask = _ink_mask(np, crop, background) if crop.size else None
    if mask is not None:
        tight = _crop_to_mask(np, mask)
        if tight is not None:
            crop_class = classify_topology(np, cv2, tight)[0]
    if hit is None:
        return None, crop_class
    return hit, crop_class


if __name__ == "__main__":
    for entry in available_fonts():
        print(entry[0], "->", entry[1], f"[{entry[2]}]")
    print(f"{len(available_fonts())} candidates resolved", file=sys.stderr)
