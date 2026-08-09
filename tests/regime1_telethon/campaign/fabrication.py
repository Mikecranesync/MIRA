"""Fabricated-specific detector — issue #3165.

MIRA asserted `set P0594 = 1 [Source: Allen-Bradley PowerFlex 525, Parameter
Reference]` live on staging. `P0594` exists nowhere in the corpus, and the
citation attributed to the *correct* vendor, so every existing guard passed:
`_is_grounded` scores a bag-of-words overlap (generic prose clears it) and
`citation_compliance.evaluate_citation_relevance` validates *attribution* only.
Spec: `docs/superpowers/specs/2026-08-09-fabricated-parameter-grounding-hole.md`.

The insight that makes this checkable offline and cheaply: **a per-turn
retrieved-source snapshot is not required.** If a reply asserts a
parameter-shaped token that exists NOWHERE in the corpus, it is fabricated
regardless of what retrieval returned that turn. Corpus-level existence is a
sound lower bound on fabrication, and it is the part that needs no live bot.

Measured over all 13 frozen campaign ledgers (671 MIRA replies) there are only
THREE distinct parameter tokens — `P09.03` (x103), `P09.04` (x1), `P0594` (x1).
Corpus check: 14 rows, 40 rows, and **0 rows**. The detector flags exactly the
one fabrication, with zero false positives on the real tokens.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

# Parameter-shaped tokens as the drive manuals write them:
#   PowerFlex  P045  A551  t071  b007  C101  d301
#   GS10/GS30  P09.03  P02.81
#
# `F` is deliberately EXCLUDED: F004/F111 are FAULT codes, which legitimately
# reach a reply from `uns_context` without appearing in any retrieved chunk.
# Two-to-four digits keeps ordinary tokens ("L1", "P1") out.
_PARAM_TOKEN_RE = re.compile(r"\b([APbtCd]\d{2,4}(?:\.\d{1,2})?)\b")

# A citation label is not a claim — tokens inside it are attribution, and the
# vendor-relevance gate already owns that surface.
_SOURCE_TAG_RE = re.compile(r"\[Source:[^\]]*\]", re.IGNORECASE)


def extract_param_claims(reply: str, supplied: str = "") -> set[str]:
    """Parameter-shaped tokens ASSERTED by ``reply``.

    ``supplied`` is everything the technician (or an earlier turn) already put
    on the table — the user's message and the conversation so far. A token the
    technician themself named is not MIRA's claim to ground.
    """
    body = _SOURCE_TAG_RE.sub(" ", reply or "")
    claimed = set(_PARAM_TOKEN_RE.findall(body))
    if not claimed:
        return set()
    known = set(_PARAM_TOKEN_RE.findall(supplied or ""))
    return {t for t in claimed if t not in known}


class CorpusIndex:
    """Existence oracle for parameter tokens, cached to disk.

    The cache is what makes the offline lab free: the first run resolves unknown
    tokens against the corpus, every later run is pure disk. A token is only
    cached once resolved — an unresolved token is never silently treated as
    absent, because "absent" is the accusation.
    """

    def __init__(self, cache_path: str | Path, fetch=None):
        self.cache_path = Path(cache_path)
        self._fetch = fetch
        self._cache: dict[str, int] = {}
        if self.cache_path.exists():
            self._cache = json.loads(self.cache_path.read_text(encoding="utf-8"))

    def known(self, token: str) -> bool:
        return token in self._cache

    def rows(self, token: str) -> int | None:
        """Row count for ``token``, or None when it has never been resolved."""
        if token in self._cache:
            return self._cache[token]
        if self._fetch is None:
            return None
        count = self._fetch(token)
        if count is None:
            return None
        self._cache[token] = int(count)
        return self._cache[token]

    def exists(self, token: str) -> bool | None:
        n = self.rows(token)
        return None if n is None else n > 0

    def save(self) -> None:
        self.cache_path.write_text(
            json.dumps(dict(sorted(self._cache.items())), indent=2) + "\n", encoding="utf-8"
        )


def find_fabricated_claims(reply: str, supplied: str, corpus: CorpusIndex) -> list[str]:
    """Tokens ``reply`` asserts that are absent from the corpus.

    Fail-safe by construction: a token the corpus cannot resolve (no cache
    entry, no live connection) is NOT reported. Silence means "unproven", never
    "fabricated".
    """
    out: list[str] = []
    for token in sorted(extract_param_claims(reply, supplied)):
        if corpus.exists(token) is False:
            out.append(token)
    return out
