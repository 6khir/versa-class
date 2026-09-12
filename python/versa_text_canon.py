"""Repair OCR strings using the page prompt's allowed copy.

Image models often paint letter-salad that OCR then copies faithfully.
Quoted strings after "ONLY the following text:" are the source of truth.
OCR boxes are used to erase ink and to site the real copy.
"""

from __future__ import annotations

import json
import re
import time
from difflib import SequenceMatcher

_QUOTE = re.compile(r'"([^"]{1,160})"')
_NUMBERED = re.compile(r"(?=\d+\.\s)")
_TOKEN = re.compile(r"[A-Za-z0-9'\[\]]+")
_STOP = {
    "the", "a", "an", "and", "of", "to", "in", "on", "for", "your", "you",
    "with", "by", "or", "as",
}

def extract_canonical_lines(prompt):
    if not prompt:
        return []
    blob = prompt
    marked = re.search(r"ONLY the following text:\s*(.*)$", prompt, re.I | re.S)
    if marked:
        blob = marked.group(1)
    lines = []
    for quoted in _QUOTE.findall(blob):
        text = quoted.strip()
        if not text or text.startswith("@") or len(text) > 160:
            continue
        if text.lower().startswith("do not"):
            continue
        parts = [part.strip(" ,") for part in _NUMBERED.split(text) if part.strip(" ,")]
        lines.extend(parts or [text])
    seen = set()
    unique = []
    for line in lines:
        key = re.sub(r"\s+", " ", line).strip()
        if key and key.lower() not in seen:
            seen.add(key.lower())
            unique.append(key)
    return unique


def prompt_names(prompt):
    return {token for token in re.findall(r"\b([A-Z]{2,12})\b", prompt or "") if token not in {"ONLY", "PAGE", "DPI"}}


def _norm(text):
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _tokens(text):
    return [token for token in _norm(text).split() if token]


def _box(run):
    box = run.get("box") or []
    if len(box) != 4:
        return None
    return [float(value) for value in box]


def _union_box(boxes):
    return [
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    ]


def _iou(a, b):
    if not a or not b:
        return 0.0
    x0 = max(a[0], b[0])
    y0 = max(a[1], b[1])
    x1 = min(a[2], b[2])
    y1 = min(a[3], b[3])
    if x1 <= x0 or y1 <= y0:
        return 0.0
    inter = (x1 - x0) * (y1 - y0)
    area_a = max(1.0, (a[2] - a[0]) * (a[3] - a[1]))
    area_b = max(1.0, (b[2] - b[0]) * (b[3] - b[1]))
    return inter / (area_a + area_b - inter)


def union_runs(*groups, iou=0.45):
    merged = []
    for group in groups:
        for run in group or []:
            item = dict(run)
            if _box(item):
                merged.append(item)
    kept = []
    for run in sorted(merged, key=lambda item: -float(item.get("confidence") or 0)):
        box = _box(run)
        if any(_iou(box, _box(other)) >= iou for other in kept):
            continue
        kept.append(run)
    kept.sort(key=lambda item: (_box(item)[1], _box(item)[0]))
    for index, run in enumerate(kept):
        run["id"] = run.get("id") or f"t{index + 1}"
    return kept


def _score(ocr, canon):
    if "[" in (canon or "") and "]" in (canon or ""):
        return 1.0 if _looks_name_slot(ocr) else 0.0
    left, right = _norm(ocr), _norm(canon)
    if not left or not right:
        return 0.0
    seq = SequenceMatcher(None, left, right).ratio()
    left_tokens, right_tokens = set(_tokens(ocr)), set(_tokens(canon))
    jaccard = len(left_tokens & right_tokens) / max(1, len(left_tokens | right_tokens))
    content_left = {token for token in left_tokens if token not in _STOP and not token.isdigit()}
    content_right = {token for token in right_tokens if token not in _STOP and not token.isdigit()}
    cover = len(content_left & content_right) / max(1, len(content_right)) if content_right else 0.0
    length_ratio = min(len(left), len(right)) / max(1, max(len(left), len(right)))
    contain = 0.92 if (left in right or right in left) and length_ratio >= 0.55 else 0.0
    score = max(jaccard, contain)
    if length_ratio >= 0.5:
        score = max(score, seq)
    if cover >= 0.66 and len(_tokens(ocr)) <= len(_tokens(canon)) + 2:
        score = max(score, cover)
    return score


def _confident(score, ocr, canon):
    shared = set(_tokens(ocr)) & set(_tokens(canon))
    content = {token for token in shared if token not in _STOP and not token.isdigit()}
    return score >= 0.62 or (score >= 0.46 and len(content) >= 2)


def _is_allow_list_prompt(prompt):
    return bool(re.search(r"ONLY the following text:", prompt or "", re.I))


def _is_folio(text):
    value = (text or "").strip()
    return bool(re.fullmatch(r"page\s*[n\d]+", value, re.I) or re.fullmatch(r"page\s*\d+\s*of\s*\d+", value, re.I))


def _is_heading(text):
    compact = (text or "").strip()
    return bool(re.match(r"^(PAGE\s+\d+|SETUP|FOR THE|STUDENT INSTRUCTIONS|MY CLASS|COLOR LEGEND|EDITABLE|CREDITS|SUCCESS|VERSA CLASS)", compact, re.I))


_HEADING_WORDS = {
    "ONLY", "PAGE", "EDITABLE", "LIST", "CREDITS", "EXAMPLE", "STUDENT",
    "NUMBER", "FIRST", "LAST", "NAME", "TOTAL", "PAGES", "SETUP", "USE",
    "MAKE", "LEARNING", "FUN", "THE", "FOR", "INSTRUCTIONS", "CLASS",
}


def _is_alphabet_strip(text):
    words = re.findall(r"[A-Za-z]+", text or "")
    if not words:
        return False
    compact = "".join(words)
    if not compact.isupper() and not compact.islower():
        return False
    unique = len(set(compact.lower()))
    vowel_ratio = sum(char.lower() in "aeiou" for char in compact) / max(1, len(compact))
    if unique < 8 or vowel_ratio > 0.38:
        return False
    if all(len(word) == 1 for word in words) and len(words) >= 8:
        return True
    if len(words) == 1 and unique / max(1, len(compact)) >= 0.7 and len(compact) >= 8:
        return True
    if any(len(word) >= 4 and sum(char.lower() in "aeiou" for char in word) >= 2 for word in words):
        return False
    return len(words) <= 2 and len(compact) >= 8


def _is_glyph_cluster(text):
    compact = (text or "").strip()
    if re.fullmatch(r"[A-Za-z](?:\s+[A-Za-z]){0,6}", compact):
        return True
    return bool(re.fullmatch(r"[A-Za-z]{1,4}", compact))


def _is_activity(text, names):
    value = (text or "").strip().strip(".:")
    if re.fullmatch(r"[A-Za-z]", value):
        return True
    if re.fullmatch(r"\d{1,3}", value):
        return True
    if value.upper() in names and 2 <= len(value) <= 12:
        return True
    if _is_alphabet_strip(value):
        return True
    return False


def _looks_name_slot(text):
    compact = re.sub(r"[^a-z]", "", (text or "").lower())
    if len(compact) > 24:
        return False
    return "studen" in compact or compact in {"name", "namen"}


def _looks_name_band(box, page_w, page_h, text):
    if _looks_name_slot(text):
        return True
    if not box:
        return False
    if re.match(r"\d+\.", (text or "").strip()):
        return False
    if _is_alphabet_strip(text) or len(re.sub(r"[^A-Za-z]", "", text or "")) >= 8:
        return False
    if len(_tokens(text)) >= 3:
        return False
    width = box[2] - box[0]
    height = max(1.0, box[3] - box[1])
    mid_y = (box[1] + box[3]) / 2.0
    return (
        width >= page_w * 0.5
        and 40 <= height <= 160
        and (width / height) >= 5.0
        and mid_y > page_h * 0.48
    )


def _page_size(runs, page_size):
    if page_size and len(page_size) == 2:
        return float(page_size[0]), float(page_size[1])
    boxes = [_box(run) for run in runs if _box(run)]
    if not boxes:
        return 2480.0, 3508.0
    return max(box[2] for box in boxes) + 40.0, max(box[3] for box in boxes) + 40.0


def _expand_heading(box, page_w):
    return [min(box[0], page_w * 0.05), box[1], max(box[2], page_w * 0.95), box[3]]


def _fit_box(box, old_text, new_text, page_w):
    if not old_text or not new_text or len(new_text) <= len(old_text) * 1.2:
        return box
    ratio = min(2.8, len(new_text) / max(1, len(old_text)))
    width = max(1.0, box[2] - box[0])
    extra = width * (ratio - 1.0)
    x0 = max(page_w * 0.04, box[0] - extra * 0.15)
    x1 = min(page_w * 0.96, box[2] + extra * 0.85)
    return [x0, box[1], max(x1, x0 + 40), box[3]]


def repair_runs(runs, prompt="", page_size=None):
    canon = extract_canonical_lines(prompt)
    names = prompt_names(prompt)
    page_w, page_h = _page_size(runs, page_size)
    ordered = [dict(run) for run in (runs or []) if (run.get("text") or "").strip() and _box(run)]
    for item in ordered:
        item["ocrText"] = (item.get("text") or "").strip()
        item["text"] = item["ocrText"]
        item["eraseBox"] = list(_box(item))
        item["place"] = False
        item["repaired"] = False
        item["consumed"] = False
        item["erase"] = True

    used = set()
    matches = []
    limit = min(4, max(1, len(ordered)))
    for start in range(len(ordered)):
        if _is_activity(ordered[start]["ocrText"], names) and len(_tokens(ordered[start]["ocrText"])) <= 2:
            continue
        pieces = []
        boxes = []
        for end in range(start, min(len(ordered), start + limit)):
            if end > start and _is_activity(ordered[end]["ocrText"], names):
                break
            pieces.append(ordered[end]["ocrText"])
            boxes.append(_box(ordered[end]))
            combined = " ".join(pieces)
            union = _union_box(boxes)
            for index, line in enumerate(canon):
                if index in used:
                    continue
                score = _score(combined, line)
                if _confident(score, combined, line):
                    matches.append((score, start, end, index, union, combined))

    matches.sort(key=lambda item: (-item[0], item[2] - item[1]))
    for score, start, end, index, union, combined in matches:
        if index in used or any(ordered[cursor]["consumed"] for cursor in range(start, end + 1)):
            continue
        host = ordered[start]
        line = canon[index]
        box = _expand_heading(union, page_w) if _is_heading(line) else _fit_box(union, combined, line, page_w)
        host["text"] = line
        host["box"] = box
        host["place"] = True
        host["repaired"] = True
        host["matchScore"] = round(score, 3)
        host["consumed"] = True
        for cursor in range(start + 1, end + 1):
            ordered[cursor]["consumed"] = True
            ordered[cursor]["place"] = False
        used.add(index)

    placeholder = next((line for line in canon if "[" in line and "NAME" in line.upper()), None)
    if placeholder:
        named = False
        for item in ordered:
            if item["consumed"]:
                continue
            if _looks_name_band(_box(item), page_w, page_h, item["ocrText"]):
                item["text"] = placeholder
                item["place"] = True
                item["repaired"] = True
                item["consumed"] = True
                item["matchScore"] = 0.99
                named = True
        if named:
            used.add(canon.index(placeholder))

    leftover_canon = [
        line for index, line in enumerate(canon)
        if index not in used and not ("[" in line and "NAME" in line.upper())
    ]
    slots = []
    for item in ordered:
        if item["consumed"]:
            continue
        box = _box(item)
        width = box[2] - box[0]
        height = box[3] - box[1]
        if width >= page_w * 0.28 and height >= 28 and not _is_alphabet_strip(item["ocrText"]):
            slots.append(item)
    slots.sort(key=lambda item: _box(item)[1])
    leftover_canon.sort(key=lambda line: (not _is_heading(line), -len(line)))
    for line, slot in zip(leftover_canon, slots):
        box = _box(slot)
        slot["text"] = line
        slot["box"] = _expand_heading(box, page_w) if _is_heading(line) else _fit_box(box, slot["ocrText"], line, page_w)
        slot["place"] = True
        slot["repaired"] = True
        slot["consumed"] = True
        slot["matchScore"] = 0.4
        used.add(canon.index(line))
    leftover_canon = [
        line for index, line in enumerate(canon)
        if index not in used and not ("[" in line and "NAME" in line.upper())
    ]
    had_ocr = any(item.get("ocrText") for item in ordered)

    synth_y = page_h * 0.06
    if not had_ocr:
        leftover_canon = []
    for line in leftover_canon:
        height = 110 if _is_heading(line) else 72
        box = [page_w * 0.06, synth_y, page_w * 0.94, synth_y + height]
        ordered.append({
            "id": f"canon-{len(ordered) + 1}",
            "text": line,
            "ocrText": "",
            "box": box,
            "eraseBox": None,
            "place": True,
            "repaired": True,
            "consumed": True,
            "matchScore": 0.0,
            "confidence": 1.0,
        })
        synth_y += height + 16

    allow_list = _is_allow_list_prompt(prompt)
    leftover_place = 0
    leftover_drop = 0
    for item in ordered:
        if item["consumed"]:
            continue
        if _is_folio(item["ocrText"]):
            item["place"] = False
            item["erase"] = False
            item["repaired"] = False
            item["consumed"] = True
            leftover_drop += 1
            continue
        if _is_activity(item["ocrText"], names):
            item["place"] = True
            item["repaired"] = False
            item["consumed"] = True
            leftover_place += 1
            continue
        if allow_list:
            # Quoted allow-list books still wipe letter-salad leftovers.
            item["place"] = False
            item["repaired"] = False
            leftover_drop += 1
        else:
            # Quality baked pages: stamp the same OCR text back in its box.
            item["place"] = True
            item["repaired"] = False
            leftover_place += 1
        item["consumed"] = True

    for item in ordered:
        ocr = (item.get("ocrText") or "").strip()
        hunt = bool(re.fullmatch(r"[A-Za-z]", ocr) or re.fullmatch(r"[A-Za-z]{1,3}(?:\s+[A-Za-z]{1,3})+", ocr))
        leftover_blob = bool(re.fullmatch(r"[A-Za-z]{2,4}", ocr)) and not item.get("place")
        changed = (item.get("text") or "").strip() != ocr
        if _is_folio(ocr):
            item["erase"] = False
            item["wipeBox"] = False
            continue
        if allow_list:
            item["erase"] = bool(item.get("eraseBox")) and not hunt and not leftover_blob
        else:
            item["erase"] = bool(item.get("place")) and bool(item.get("eraseBox")) and not hunt and not leftover_blob
        item["wipeBox"] = bool(item.get("repaired") and changed and len(item.get("text") or "") > 18)

    # #region agent log
    try:
        import json as _json
        with open("/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-702e49.log", "a", encoding="utf-8") as _dbg:
            _dbg.write(_json.dumps({"sessionId":"702e49","runId":"post-fix","hypothesisId":"A","location":"versa_text_canon.py:repair_runs","message":"repair leftover decisions","data":{"allowList":allow_list,"runs":len(ordered),"placed":sum(1 for item in ordered if item.get("place")),"erased":sum(1 for item in ordered if item.get("erase")),"leftoverPlace":leftover_place,"leftoverDrop":leftover_drop},"timestamp":int(time.time()*1000)}) + "\n")
    except Exception:
        pass
    # #endregion

    return ordered
