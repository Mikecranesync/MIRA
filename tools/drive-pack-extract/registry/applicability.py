"""Manual Applicability Artifact (Drive Commander Phase 2, issue #2561).

Pure, read-only, no network / no LLM. Turns a manual-source-registry entry
(``sources.json``, key ``"manuals"`` — see ``registry.py``) into a reshaped
:class:`ManualApplicability` record describing *which drive models a manual
covers*, without inventing anything the entry doesn't already say.

This module is deliberately independent of ``registry.py``'s validation/
classification concerns (new/unchanged/changed-by-hash, trust status). It
only answers "what does this manual claim to apply to, in a normalized
shape" — the input to the parity guard in
``mira-bots/tests/test_manual_applicability_parity.py``, which proves that
claim actually reaches the runtime pack match surface
(``shared.drive_packs.loader`` / ``resolver``).
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

# A "catalog prefix" is a full catalog-number-shaped code (e.g. "GS11N",
# "GS13N") — two uppercase letters, digits, then one-or-more trailing
# uppercase letters, no hyphen. The trailing-letter requirement is what
# distinguishes a catalog code from a bare *series name* like "GS10" (two
# letters + digits, no suffix) or "GS-10" (hyphenated) — both of those are
# marketing/series names, not standalone catalog prefixes, and must NOT be
# classified as one even though they share the same leading shape.
_CATALOG_PREFIX_RE = re.compile(r"^[A-Z]{2}\d+[A-Z]+$")

_DEFAULT_REGISTRY_PATH = Path(__file__).resolve().parent / "sources.json"


@dataclass(frozen=True)
class ManualApplicability:
    """Which drive models a manual (registry entry) applies to.

    A reshaping of a ``sources.json`` manual entry — never a re-extraction.
    Every field traces back to the registry entry it was built from; nothing
    here is inferred beyond the catalog-prefix split of
    ``applies_to_models``.
    """

    manufacturer: str = ""
    brand: str | None = None
    product_family: str = ""
    manual_title: str = ""
    publication: str = ""
    revision: str | None = None
    applies_to_models: list[str] = field(default_factory=list)
    applies_to_catalog_prefixes: list[str] = field(default_factory=list)
    applies_to_catalog_patterns: list[str] = field(default_factory=list)
    excluded_models: list[str] = field(default_factory=list)
    evidence_pages: list[Any] = field(default_factory=list)
    extraction_method: str = "registry"
    confidence: str = "medium"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _catalog_prefixes(models: list[str]) -> list[str]:
    """The subset of ``models`` that are shaped like a full catalog prefix.

    See ``_CATALOG_PREFIX_RE`` docstring above for why "GS10"/"GS-10" are
    excluded while "GS11N"/"GS13N" are included.
    """
    return [m for m in models if isinstance(m, str) and _CATALOG_PREFIX_RE.match(m)]


def applicability_from_source(source_entry: dict[str, Any]) -> ManualApplicability:
    """Map one ``sources.json`` manual entry onto a :class:`ManualApplicability`.

    Never raises and never fabricates: an absent/empty field maps to the
    dataclass's own empty default (``""``, ``None``, or ``[]``), not a
    best-guess value.
    """
    source_entry = source_entry or {}

    raw_models = source_entry.get("applicable_drive_models") or []
    models = [str(m) for m in raw_models]

    raw_excluded = source_entry.get("excluded_models") or []
    excluded = [str(m) for m in raw_excluded]

    raw_evidence_pages = source_entry.get("evidence_pages") or []
    evidence_pages = list(raw_evidence_pages)

    return ManualApplicability(
        manufacturer=str(source_entry.get("vendor") or ""),
        brand=source_entry.get("brand"),
        product_family=str(source_entry.get("product_family") or ""),
        manual_title=str(source_entry.get("manual_title") or ""),
        publication=str(source_entry.get("publication") or ""),
        revision=source_entry.get("revision"),
        applies_to_models=models,
        applies_to_catalog_prefixes=_catalog_prefixes(models),
        applies_to_catalog_patterns=[],
        excluded_models=excluded,
        evidence_pages=evidence_pages,
        extraction_method="registry",
        confidence="medium",
    )


def load_sources(path: str | Path | None = None) -> list[dict[str, Any]]:
    """Read the manual-source registry and return its ``"manuals"`` list.

    Read-only — no validation, no classification (that's ``registry.py``'s
    job). Defaults to the registry file co-located with this module.
    """
    registry_path = Path(path) if path is not None else _DEFAULT_REGISTRY_PATH
    raw = json.loads(registry_path.read_text(encoding="utf-8"))
    manuals = raw.get("manuals", [])
    return list(manuals)
