"""Lossless lexer (D1/D15). Every input character is accounted for: the
concatenation of ``token["raw"]`` over the token list reproduces the input
byte-for-byte (proven by test). OCR variants are attached as CANDIDATES with
reason+confidence — never applied."""

from __future__ import annotations

import re

# Always-separator characters. '-' between digits (contact pair 13-14) and at
# aspect positions both separate; en/em dashes are OCR/typography variants of
# the pair hyphen. '.' and ',' are separators ONLY when not between
# alphanumerics (protects 4.4, X24V.3, E1.0, 4G1,5 — the Phase B
# decimal-comma guard carried forward).
_HARD_SEP = set("=+:/;()[]")
_DASHES = {"-", "–", "—"}
_SOFT_DOT = {".", ","}

_TEXT_TOKEN = re.compile(r"[A-Za-z0-9_.,]+")

# Bounded OCR-variant families (D15): substitutions offered only in the
# character class + position where the confusion is real.
_OCR_TAIL = [("O", "0"), ("I", "1"), ("l", "1"), ("Z", "2"), ("B", "8")]
_OCR_WHOLE = {"Al": ("A1", "l->1 after letter"), "AZ": ("A2", "Z->2 after letter"),
              "I3": ("13", "I->1 before digit")}


def _ocr_candidates(text: str) -> list[dict]:
    """Return bounded candidate corrections (max 3), never applied."""
    out: list[dict] = []
    if text in _OCR_WHOLE:
        fixed, reason = _OCR_WHOLE[text]
        out.append({"kind": "ocr_correction", "text": fixed,
                    "reason": reason, "confidence": 0.6})
    m = re.match(r"^([A-Za-z]+)([0-9OIlZB]+)$", text)
    if m and re.search(r"[OIlZB]", m.group(2)):
        tail = m.group(2)
        for bad, good in _OCR_TAIL:
            if bad in tail:
                cand = m.group(1) + tail.replace(bad, good)
                if cand != text:
                    out.append({"kind": "ocr_correction", "text": cand,
                                "reason": f"{bad}->{good} in numeric tail",
                                "confidence": 0.55})
            if len(out) >= 3:
                break
    return out[:3]


def lex(raw: str) -> dict:
    """Tokenize ``raw`` losslessly into text and separator tokens."""
    tokens: list[dict] = []
    i, n = 0, len(raw)

    def emit(kind: str, start: int, end: int) -> None:
        text = raw[start:end]
        tok = {"raw": text, "text": text, "kind": kind,
               "start": start, "end": end}
        if kind == "text":
            cands = _ocr_candidates(text)
            if cands:
                tok["ocr_candidates"] = cands
        tokens.append(tok)

    while i < n:
        ch = raw[i]
        if ch.isspace():
            j = i
            while j < n and raw[j].isspace():
                j += 1
            emit("sep", i, j)
            i = j
            continue
        if ch in _HARD_SEP or ch in _DASHES:
            emit("sep", i, i + 1)
            i += 1
            continue
        if ch in _SOFT_DOT:
            prev_ok = i > 0 and raw[i - 1].isalnum()
            next_ok = i + 1 < n and raw[i + 1].isalnum()
            if not (prev_ok and next_ok):
                emit("sep", i, i + 1)
                i += 1
                continue
            # internal dot/comma: fall through into the text scan below
        m = _TEXT_TOKEN.match(raw, i)
        if m:
            # trim trailing dot/comma that is not followed by alnum (it is a
            # sentence/list separator, not a decimal)
            end = m.end()
            while end > i + 1 and raw[end - 1] in _SOFT_DOT and \
                    not (end < n and raw[end].isalnum()):
                end -= 1
            emit("text", i, end)
            i = end
            continue
        emit("sep", i, i + 1)  # any other character: preserved as separator
        i += 1

    return {"raw": raw, "tokens": tokens}
