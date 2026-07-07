"""Layer B — citation integrity against the source PDF.

Re-reads the manual and, for every citation the candidate pack carries,
confirms the excerpt genuinely appears on the claimed page — reusing
``cite_integrity.verify_excerpt_on_page`` (the anti-fabrication gate the
extractor itself is built on), never a re-implementation of that check.

Citations checked (GRADING_SPEC.md Layer B): every ``source_citation`` in
``pack.parameters[]`` and ``pack.keypad_navigation[]``, plus every
``provenance.sources[]`` entry carrying a ``page``+``excerpt``.
"""

from __future__ import annotations

import logging
import re
import sys
from pathlib import Path
from typing import Any

from report import LayerResult

_TOOL_DIR = Path(__file__).resolve().parent.parent
if str(_TOOL_DIR) not in sys.path:
    sys.path.insert(0, str(_TOOL_DIR))

import cite_integrity  # noqa: E402

logger = logging.getLogger("drive-pack-extract.grading.cite_check")

# provenance.sources[] entries carry no explicit fault_id — but the extractor
# always builds their excerpt from the page's own raw line, which starts with
# the fault/parameter code (e.g. "F081 DSI Comm Loss 2"). Recovering the
# leading id lets diagnostic-critical cross-referencing work for those
# citations too, without inventing a schema field that doesn't exist.
_LEADING_ID_RE = re.compile(r"^([A-Za-z]\d{2,3})\b")


def _diagnostic_critical_ids(gold: dict[str, Any] | None) -> set[str]:
    if not gold:
        return set()
    ids: set[str] = set()
    for gf in gold.get("faults", []):
        if gf.get("diagnostic_critical"):
            ids.add(gf["fault_id"])
    for gp in gold.get("parameters", []):
        if gp.get("diagnostic_critical"):
            ids.add(gp["parameter_id"])
    return ids


def _collect_citations(pack_dict: dict[str, Any]) -> list[dict[str, Any]]:
    """Every checkable citation in the pack, tagged with a best-effort
    identifier (parameter_id / keypad goal / recovered fault id) for
    reporting and diagnostic-critical cross-referencing."""
    citations: list[dict[str, Any]] = []

    for param in pack_dict.get("parameters", []):
        citation = param.get("source_citation") or {}
        if citation.get("excerpt"):
            citations.append(
                {
                    "kind": "parameter",
                    "identifier": param.get("parameter_id"),
                    "page": citation.get("page"),
                    "excerpt": citation.get("excerpt", ""),
                }
            )

    for keypad in pack_dict.get("keypad_navigation", []):
        citation = keypad.get("source_citation") or {}
        if citation.get("excerpt"):
            citations.append(
                {
                    "kind": "keypad_navigation",
                    "identifier": keypad.get("parameter_id") or keypad.get("goal"),
                    "page": citation.get("page"),
                    "excerpt": citation.get("excerpt", ""),
                }
            )

    for source in pack_dict.get("provenance", {}).get("sources", []):
        page = source.get("page")
        excerpt = source.get("excerpt", "")
        if page in (None, "") or not excerpt:
            continue
        match = _LEADING_ID_RE.match(excerpt.strip())
        citations.append(
            {
                "kind": "provenance_source",
                "identifier": match.group(1) if match else None,
                "page": page,
                "excerpt": excerpt,
            }
        )

    return citations


def check_citations(
    pack_dict: dict[str, Any],
    pdf_path: str | Path | None,
    gold: dict[str, Any] | None = None,
) -> LayerResult:
    """Verify every citation in ``pack_dict`` against ``pdf_path``.

    ``pdf_path`` missing/absent -> the layer is ``skipped`` (the manual isn't
    available locally); the trust status caps at ``internal_only`` per the
    spec. ``gold`` (optional) supplies the diagnostic-critical id set so a
    dropped citation on a diagnostic-critical fault/parameter can be flagged
    as the hard-fail case the spec requires.
    """
    if not pdf_path or not Path(pdf_path).is_file():
        return LayerResult(
            name="cite_integrity",
            status="skipped",
            summary="manual not available locally — cite-integrity did not run",
            details=[],
            metrics={
                "verified_count": 0,
                "unverifiable_count": 0,
                "dropped_diagnostic_critical": [],
            },
        )

    diagnostic_critical_ids = _diagnostic_critical_ids(gold)
    citations = _collect_citations(pack_dict)

    verified = 0
    verified_by_label = 0  # verified whole-document via a chapter-section page label
    unverifiable = 0
    dropped_critical: list[str] = []
    details: list[str] = []

    for citation in citations:
        page_raw = citation["page"]
        try:
            page_int = int(page_raw)
        except (TypeError, ValueError):
            page_int = None

        # An integer page is verified ON that page (strong, page-pinned). A
        # chapter-section label ("4-188") can't be resolved to a physical page
        # index, so it is verified WHOLE-DOCUMENT — still catches fabrication,
        # just not pinned to one page. Anything else is unverifiable.
        if page_int is not None:
            ok = cite_integrity.verify_excerpt_on_page(pdf_path, page_int, citation["excerpt"])
        elif cite_integrity.is_chapter_section_label(page_raw):
            ok = cite_integrity.verify_excerpt_in_document(pdf_path, citation["excerpt"])
            if ok:
                verified_by_label += 1
        else:
            ok = False

        if ok:
            verified += 1
            continue

        unverifiable += 1
        details.append(
            f"{citation['kind']} {citation['identifier']!r}: NOT verified on page {page_raw!r}"
        )
        if citation["identifier"] in diagnostic_critical_ids:
            dropped_critical.append(citation["identifier"])
            details.append(
                f"  -> DIAGNOSTIC-CRITICAL citation dropped for {citation['identifier']!r}"
            )

    dropped_critical = sorted(set(dropped_critical))
    status = "fail" if dropped_critical else "pass"
    summary = f"cite-integrity: {verified} verified, {unverifiable} unverifiable"
    if verified_by_label:
        summary += f" ({verified_by_label} whole-document via chapter-section page label)"
    if dropped_critical:
        summary += f"; DROPPED diagnostic-critical citation(s): {dropped_critical}"

    return LayerResult(
        name="cite_integrity",
        status=status,
        summary=summary,
        details=details,
        metrics={
            "verified_count": verified,
            "verified_by_label_count": verified_by_label,
            "unverifiable_count": unverifiable,
            "dropped_diagnostic_critical": dropped_critical,
        },
    )
