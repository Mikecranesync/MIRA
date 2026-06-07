"""Candidate-only UNS path helpers for connectors.

IMPORTANT — these produce *candidate* paths, not canonical ones. Per
``.claude/rules/uns-compliance.md`` the authoritative ``enterprise.*`` path builders
live in ``mira-crawler/ingest/uns.py`` (``manufacturer_path``, ``model_path``, …) and
``uns.slug()``. A connector is upstream of NeonDB and of that module; it proposes a
candidate path and stashes the structured components so the confirmation gate can
rebuild the canonical path with the real builders before anything is written.

Do NOT use these helpers to write a final UNS path into ``kg_entities``.
"""

from __future__ import annotations

import re

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def candidate_slug(value: str) -> str:
    """Lowercase, collapse runs of non-alphanumerics to ``_``. Candidate use only.

    Mirrors the intent of ``uns.slug()`` so candidate paths look right in review UIs,
    but the gate re-slugs via the canonical builder before persistence.
    """
    return _NON_ALNUM.sub("_", value.strip().lower()).strip("_")


def candidate_uns_path(*segments: str) -> str:
    """Join slugged segments under ``enterprise.`` as a candidate path."""
    slugs = [candidate_slug(s) for s in segments if s]
    return ".".join(["enterprise", *slugs])
