"""Ingest-side manufacturer name normalization (issue #1596).

This module mirrors ``mira-crawler/ingest/manufacturer_normalize.py`` so the
``mira-core/mira-ingest`` service applies the SAME OCR/variant collapse at its
own DB write boundary (``db/neon.py`` ``insert_knowledge_entry`` /
``insert_knowledge_entries_batch``). The Hub KB manufacturer catalog is
computed by ``GROUP BY knowledge_entries.manufacturer``; without this, OCR /
extraction variants ("Alien-Bradley", "Cofemo", "Orldndo Rigging",
"Deshaco") each mint their own catalog row and fragment one real vendor.

The ``OCR_VARIANT_ALIASES`` map MUST stay identical to the crawler's: a
cross-service consistency test asserts the two maps match, so a vendor groups
the same way no matter which service ingested the chunk. This module is the
deterministic seed-map layer only; the crawler's fuzzy *proposer* is not
needed here (the ingest write boundary applies the seed map, nothing more).
"""

from __future__ import annotations

from dataclasses import dataclass

# Curated manufacturer-variant -> canonical map. Keys are matched
# case-insensitively with internal whitespace collapsed (see ``normalize_
# manufacturer``). MUST stay identical to the crawler's copy in
# ``mira-crawler/ingest/manufacturer_normalize.py`` (guarded by a
# cross-service consistency test). Seeded from issue #1596.
OCR_VARIANT_ALIASES: dict[str, str] = {
    "allen-bradley": "Rockwell Automation",
    "allen bradley": "Rockwell Automation",
    "alien-bradley": "Rockwell Automation",
    "alien bradley": "Rockwell Automation",
    "cofemo": "Coffing",
    "cofing": "Coffing",
    "cottins": "Coffing",
    "orldndo rigging": "Orlando Rigging",
    "deshaco": "Deshazo",
    "desha": "Deshazo",
    "deshao": "Deshazo",
    "deshazzo": "Deshazo",
}


@dataclass(frozen=True)
class NormalizedManufacturer:
    """Result of normalizing a raw manufacturer string."""

    canonical: str  # the string to store / build the catalog row from
    method: str  # "alias" | "identity"
    confidence: float  # 1.0 for deterministic alias/identity
    raw: str  # the original input


def normalize_manufacturer(raw: str | None) -> NormalizedManufacturer:
    """Collapse an OCR/extraction manufacturer variant to its canonical
    spelling, or pass an unknown vendor through unchanged.

    Whitespace is always trimmed and internally collapsed. None / blank input
    yields an empty canonical (the ``manufacturer`` column is nullable; the
    write boundary stores ``None`` for an empty canonical).
    """
    if not raw or not raw.strip():
        return NormalizedManufacturer(
            canonical="", method="identity", confidence=1.0, raw=raw or ""
        )

    key = " ".join(raw.lower().split())
    canonical = OCR_VARIANT_ALIASES.get(key)
    if canonical is not None:
        return NormalizedManufacturer(canonical=canonical, method="alias", confidence=1.0, raw=raw)

    # Unknown vendor — pass through with whitespace cleaned only.
    cleaned = " ".join(raw.split())
    return NormalizedManufacturer(canonical=cleaned, method="identity", confidence=1.0, raw=raw)
