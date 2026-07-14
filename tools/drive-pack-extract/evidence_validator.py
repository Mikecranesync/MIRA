"""Evidence validator — nothing ships uncited.

Every record from any route (generic or dialect) is proven against the source
PDF before it survives: its ``excerpt`` must genuinely appear on its cited page
(reusing ``cite_integrity`` — the same anti-fabrication gate the original
extractor uses), and each emitted field value must appear in that page's text
(field-level evidence). A record that fails page verification is REJECTED with a
reason, never silently dropped and never silently kept. A field whose value
can't be found on the page is stripped (we don't assert what we can't cite).

Batched: reads each cited page's text once via
``cite_integrity.load_normalized_pages``, then verifies in memory — O(pages),
not O(records). Pure read-only.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import cite_integrity

# id shapes that are almost always NOT a real fault/parameter id — page/section
# numbers and the like. Kept deliberately tiny so recall isn't harmed.
_SECTION_HEADING_HINTS = (
    "summary of parameter", "table of contents", "list of parameters",
    "chapter", "section", "appendix", "revision history",
)


def _is_noise(rec: dict[str, Any]) -> str | None:
    """Return a reason string if the record is structural noise, else None.

    Conservative: only rejects records with strong non-record signals (empty id,
    a section-heading name with no value fields). Real records with sparse
    fields are kept — recall matters more than trimming a little noise here."""
    ident = (rec.get("id") or "").strip()
    if not ident:
        return "empty id"
    name = (rec.get("name") or "").strip()
    fields = rec.get("fields") or {}
    name_low = name.lower()
    if not fields and any(h in name_low for h in _SECTION_HEADING_HINTS):
        return "section heading, no fields"
    # A record with neither a name nor any value field carries no information
    # (a stray section number / page ref caught as an id) — drop it. Safe for
    # recall: a real fault/parameter always has at least a name or a value.
    if not name and not fields:
        return "no name and no fields"
    return None


def validate_records(
    pdf_path: str | Path, records: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return ``(validated, rejected)``. Validated records get ``validated=True``
    and a populated ``field_evidence``; rejected carry a ``reject_reason``."""
    cited_pages = {r["page"] for r in records if isinstance(r.get("page"), int)}
    pages_text = cite_integrity.load_normalized_pages(pdf_path, cited_pages) if cited_pages else {}

    validated: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for rec in records:
        noise = _is_noise(rec)
        if noise:
            rec["reject_reason"] = noise
            rejected.append(rec)
            continue
        page = rec.get("page")
        page_norm = pages_text.get(page, "") if isinstance(page, int) else ""
        excerpt_norm = cite_integrity.normalize(rec.get("excerpt", ""))
        if not excerpt_norm or excerpt_norm not in page_norm:
            rec["reject_reason"] = "excerpt not found on cited page"
            rejected.append(rec)
            continue
        # Field-level evidence: keep only fields whose value is on the page.
        kept_fields: dict[str, str] = {}
        field_ev: dict[str, dict[str, Any]] = {}
        for role, val in rec.get("fields", {}).items():
            val_norm = cite_integrity.normalize(val)
            # Verify a meaningful head of the value (long wrapped values may
            # span a rule the normalizer can't perfectly rejoin).
            head = " ".join(val_norm.split()[:6])
            if head and head in page_norm:
                kept_fields[role] = val
                field_ev[role] = {"excerpt": val, "page": page}
        rec["fields"] = kept_fields
        rec["field_evidence"] = field_ev
        # id itself is evidence too (it's the anchor of the excerpt).
        rec["field_evidence"]["id"] = {"excerpt": rec["excerpt"], "page": page}
        rec["validated"] = True
        validated.append(rec)
    return validated, rejected
