"""Ingest-side manufacturer name normalization (issue #1596).

Problem
-------
OCR / extraction noise fragments one real vendor into several catalog
entries — ``Allen-Bradley`` vs ``Alien-Bradley``, ``Coffing`` vs
``Cofemo``/``Cofing``/``Cottins``, ``Orlando Rigging`` vs
``Orldndo Rigging``, ``Deshazo`` vs ``Deshaco``/``Desha``/``Deshazzo``.
Each variant mints its own ``enterprise.knowledge_base.<slug>`` node, which
inflates the manufacturer count and scatters chunks/manuals across spurious
vendors, hurting retrieval grouping.

Scope (deliberately narrow)
---------------------------
This module does **OCR/typo collapse only** — it maps misspellings toward
the cleanest observed spelling. It does NOT do brand→corporate-parent
canonicalization (e.g. ``Allen-Bradley`` → ``Rockwell Automation``). That
brand-vs-parent question is a *separate, pre-existing* split between the KB
catalog (which stores ``Allen-Bradley``) and the query-side resolver
(``mira-bots/shared/uns_resolver.py`` ``VENDOR_ALIASES``, which maps to
``Rockwell Automation``). Resolving it changes both surfaces and is carved
out of #1596 as an open product decision — see the issue.

Divergence safety
-----------------
The query-side resolver returns "no opinion" (``_match_vendor`` →
``(None, None, None)``) for any vendor not in its ~15-vendor VFD-focused
alias table, so unknown vendors flow straight to ``uns.slug()`` on both the
ingest and query sides. The long-tail rigging/hoist OEMs this module cleans
are all in that "no opinion" set, so collapsing their misspellings cannot
create new ingest-vs-query divergence. We therefore **pass unknown vendors
through unchanged** rather than imposing any canonical of our own.

Two layers
----------
1. ``OCR_VARIANT_ALIASES`` — a curated, deterministic seed map of the
   variants named in #1596. Applied at ingest time (``confidence=1.0``).
2. ``propose_fuzzy_canonical`` — a high-threshold fuzzy *proposer* that
   LOGS a candidate collapse but never merges. Intended for the gated,
   review-gated catalog backfill, not for silent ingest-time merging
   (merging two genuinely distinct vendors is the only irreversible failure
   mode here).

Wired into ``kg_writer`` (the boundary where the manufacturer string becomes
a UNS path), so every path that mints a manufacturer node — not just the
chunk-store hot path — benefits.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from difflib import SequenceMatcher

logger = logging.getLogger("mira-crawler.manufacturer_normalize")

# Minimum token-sorted similarity for the fuzzy proposer to surface a
# candidate. Tuned high: at 0.88, real-vendor pairs like Banner/Bauer (~0.72)
# and ABB/ABM (~0.67) stay below it, while single-character OCR typos
# (Deshazoo/Deshazo ~0.93) clear it.
FUZZY_THRESHOLD = 0.88

# Curated OCR / extraction-variant → cleanest-observed-spelling map.
# Keys are matched case-insensitively with internal whitespace collapsed
# (see ``_norm_key``). Seeded from the cases named in issue #1596; extend as
# new variants surface in QA. NOTE: keep canonical *brands* here, never
# corporate parents (see module docstring "Scope").
OCR_VARIANT_ALIASES: dict[str, str] = {
    # Allen-Bradley (the brand spelling — NOT "Rockwell Automation")
    "alien-bradley": "Allen-Bradley",
    "alien bradley": "Allen-Bradley",
    # Coffing (hoists)
    "cofemo": "Coffing",
    "cofing": "Coffing",
    "cottins": "Coffing",
    # Orlando Rigging
    "orldndo rigging": "Orlando Rigging",
    # Deshazo
    "deshaco": "Deshazo",
    "desha": "Deshazo",
    "deshao": "Deshazo",
    "deshazzo": "Deshazo",
}


@dataclass(frozen=True)
class NormalizedManufacturer:
    """Result of normalizing a raw manufacturer string."""

    canonical: str  # the string to store / build the UNS path from
    method: str  # "alias" | "identity"
    confidence: float  # 1.0 for deterministic alias/identity
    raw: str  # the original input


@dataclass(frozen=True)
class FuzzyProposal:
    """A *proposed* (never applied) collapse of ``raw`` onto a known vendor."""

    raw: str
    canonical: str
    score: float


def _norm_key(value: str) -> str:
    """Lowercase + collapse internal whitespace for stable lookup/compare."""
    return " ".join(value.lower().split())


def normalize_manufacturer(raw: str) -> NormalizedManufacturer:
    """Collapse an OCR/extraction manufacturer variant to its canonical
    spelling, or pass an unknown vendor through unchanged.

    Whitespace is always trimmed and internally collapsed. Empty / blank
    input yields an empty canonical (downstream callers already guard on a
    falsy manufacturer and skip the KG write).
    """
    if not raw or not raw.strip():
        return NormalizedManufacturer(canonical="", method="identity", confidence=1.0, raw=raw)

    key = _norm_key(raw)
    canonical = OCR_VARIANT_ALIASES.get(key)
    if canonical is not None:
        return NormalizedManufacturer(canonical=canonical, method="alias", confidence=1.0, raw=raw)

    # Unknown vendor — pass through with whitespace cleaned only. We do NOT
    # impose a canonical of our own (see module docstring "Divergence safety").
    cleaned = " ".join(raw.split())
    return NormalizedManufacturer(canonical=cleaned, method="identity", confidence=1.0, raw=raw)


def propose_fuzzy_canonical(
    raw: str, known: set[str], threshold: float = FUZZY_THRESHOLD
) -> FuzzyProposal | None:
    """Propose (and LOG) collapsing ``raw`` onto the most similar name in
    ``known`` when similarity clears ``threshold``. Never merges.

    Returns ``None`` when ``raw`` is blank, ``known`` is empty, ``raw`` is
    already an exact (normalized) member of ``known``, or no candidate clears
    the threshold. Similarity is a token-sorted ``SequenceMatcher`` ratio so
    word-order noise ("Rigging Orlando") doesn't defeat the match.
    """
    if not raw or not raw.strip() or not known:
        return None

    raw_norm = _norm_key(raw)
    raw_sorted = " ".join(sorted(raw_norm.split()))

    best: FuzzyProposal | None = None
    for candidate in known:
        cand_norm = _norm_key(candidate)
        if cand_norm == raw_norm:
            # Already canonical — nothing to propose.
            return None
        cand_sorted = " ".join(sorted(cand_norm.split()))
        score = SequenceMatcher(None, raw_sorted, cand_sorted).ratio()
        if score >= threshold and (best is None or score > best.score):
            best = FuzzyProposal(raw=raw, canonical=candidate, score=score)

    if best is not None:
        logger.info(
            "manufacturer fuzzy-collapse PROPOSED (not applied): %r → %r (score=%.3f); "
            "needs gated backfill review",
            best.raw,
            best.canonical,
            best.score,
        )
    return best
