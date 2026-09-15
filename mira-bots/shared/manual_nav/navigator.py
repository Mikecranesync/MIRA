"""Manual Navigator — the experimental retrieval lane.

    question -> scope (vendor/model) -> authoritative manual -> section
             -> passage -> parent expansion -> evidence with a full path

Production retrieval (`neon_recall.recall_knowledge`) is untouched and still the
only lane anything calls. This module is additive and nothing imports it outside
the experiment harness.

## Why this shape

The four systems named in the brief agree on one thing and this lane takes only
that: **do not flatten a structured document into unrelated chunks.** PageIndex
navigates a tree instead of ranking a pile; RAGFlow keeps layout and tables;
WeKnora routes before it retrieves; Kotaemon shows the path it took. What they
share is that the document's own organisation is retrieval signal, and throwing
it away is a choice with a cost.

The measured cost here, from `docmap`'s probe: PF525 is 1.80x duplicated, one
paragraph appears at four different page numbers, and a flat top-k spends its
budget on copies. So the lane's first move is not ranking — it is choosing one
authoritative document, which removes the duplicates before anything is scored.

## Ordering, and what it refuses to do

DOC-SCOPE -> SECTION -> PASSAGE -> PARENT. Each stage narrows, and each stage
can REFUSE:

  * no manual for this vendor/model  -> `INGEST` (never widen to a sibling
    vendor; answering a GS10 question from a PowerFlex manual is the exact
    contamination this lane must not introduce)
  * manual present, no section match -> `no_section`, still doc-scoped
  * section found, no passage        -> `no_passage`, returns the section for
    context but marks the answer unsupported

Refusing is the point. `.claude/rules/fast-path-optimization.md` calls this
citation-or-refuse, and the arc's record is that a lane which degrades to a
plausible answer scores well and teaches the wrong thing.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any

from . import docmap

#: Intent cues -> the section a technician would turn to. Deliberately small
#: and explicit: a learned router here would be one more thing to debug, and
#: the whole value of this lane is that its decisions are inspectable.
_INTENT_SECTIONS: tuple[tuple[re.Pattern, tuple[str, ...]], ...] = (
    (
        re.compile(
            r"\b(clear|reset)\b.{0,30}\b(fault|trip|alarm)\b|\bfault\b.{0,20}\b(clear|reset)\b",
            re.I,
        ),
        ("Troubleshooting", "Fault Codes"),
    ),
    (
        re.compile(
            r"\b[A-Za-z]{1,2}-?\d{2,4}\b.{0,30}\bmean|what (is|does)\b.{0,20}\b[A-Za-z]{1,2}\d{2,4}\b",
            re.I,
        ),
        ("Fault Codes", "Troubleshooting"),
    ),
    (re.compile(r"\bfault|trip|alarm|error code\b", re.I), ("Fault Codes", "Troubleshooting")),
    (re.compile(r"\bwir(e|ing)|terminal|landed|shield\b", re.I), ("Wiring", "Installation")),
    (
        re.compile(r"\bparameter|P\d{3}|A\d{3}|setting\b", re.I),
        ("Programming and Parameters", "Parameter Reference"),
    ),
    (re.compile(r"\bmodbus|rs-?485|comm|baud|register\b", re.I), ("Communications",)),
    (
        re.compile(r"\binstall|mount|enclosure|dimension\b", re.I),
        ("Installation", "Accessories and Dimensions"),
    ),
)


@dataclass
class NavStep:
    """One decision, recorded so the path can be argued with."""

    stage: str
    chose: str
    why: str
    candidates: int = 0


@dataclass
class NavResult:
    """The lane's output. Shaped to drop into existing evidence, not replace it."""

    ok: bool
    reason: str = ""
    citable: bool = False
    manufacturer: str = ""
    model: str = ""
    doc_key: str = ""
    source_url: str = ""
    section: str | None = None
    passages: list[dict] = field(default_factory=list)
    parent_context: list[dict] = field(default_factory=list)
    path: list[NavStep] = field(default_factory=list)

    def retrieval_path(self) -> str:
        """`manual → section → page → passage` — the page segment only when citable.

        When the chosen ingest's page numbers are a chunk index (`citable` is
        False), quoting "p123" would present an internal ordinal as a real page.
        The path then reads `doc → section → passage` with no page segment.
        """
        bits = [self.doc_key or "?"]
        if self.section:
            bits.append(self.section)
        if self.passages:
            if self.citable:
                bits.append(f"p{self.passages[0].get('source_page')}")
            bits.append("passage")
        return " → ".join(bits)

    def as_retrieved_meta(self) -> list[dict]:
        """The SHAPE `TurnEvidence.retrieved_meta` already carries.

        Deliberately not a new evidence format: TRH's oracles, the retrieval
        probe and `gates` all consume this dict, so the navigator's output is
        gradeable by the existing harness with no adapter. The navigation path
        rides along as extra keys, which older detectors ignore.

        Citability is enforced HERE, on emission: when the chosen ingest is not
        citable, `source_page` is suppressed to None on every emitted dict (the
        raw value survives as `nav_ordinal` for internal use). Internal
        retrieval — the parent-window SQL in `navigate()` — keeps using the raw
        `source_page`; suppression applies only to emitted evidence.
        """
        out = []
        for rank, p in enumerate(self.passages + self.parent_context):
            row = {
                **p,
                "nav_rank": rank,
                "nav_path": self.retrieval_path(),
                "nav_doc_key": self.doc_key,
                "nav_section": self.section,
                "nav_role": "passage" if rank < len(self.passages) else "parent_context",
                "nav_ordinal": p.get("source_page"),
                "nav_citable": self.citable,
            }
            if not self.citable:
                row["source_page"] = None
            out.append(row)
        return out


def _engine():
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")
    return create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})


def target_sections(question: str) -> tuple[str, ...]:
    for pat, sections in _INTENT_SECTIONS:
        if pat.search(question or ""):
            return sections
    return ()


#: Phrase anchors per target section. Same discipline as RET-001: the LOW
#: frequency phrasings are the useful ones, and a loose term ("fault") matches
#: everything in a drive manual.
_SECTION_ANCHORS: dict[str, tuple[str, ...]] = {
    "Troubleshooting": (
        "clear the fault by one of these methods",
        "press esc to acknowledge the fault",
        "clear fault",
        "drive is faulted",
        "cycle drive power",
    ),
    "Fault Codes": (
        "fault descriptions",
        "fault and diagnostic",
        "corrective action",
        "fault code",
    ),
    "Programming and Parameters": ("stop drive before changing this parameter", "default ="),
    "Parameter Reference": ("parameter cross reference",),
    "Wiring": ("terminal block", "control i/o wiring", "shield"),
    "Communications": ("rs-485", "modbus", "baud"),
    "Installation": ("mounting", "enclosure"),
}

_PASSAGE_SQL = """
SELECT content, manufacturer, model_number, equipment_type, source_type,
       source_url, source_page, metadata, verified
FROM knowledge_entries
WHERE is_private = false
  AND source_url = :url
  AND ({anchor_clause})
ORDER BY source_page
LIMIT :lim
"""

_PARENT_SQL = """
SELECT content, manufacturer, model_number, equipment_type, source_type,
       source_url, source_page, metadata, verified
FROM knowledge_entries
WHERE is_private = false
  AND source_url = :url
  AND source_page BETWEEN :lo AND :hi
ORDER BY source_page
LIMIT :lim
"""


def navigate(
    question: str,
    manufacturer: str,
    model: str,
    limit: int = 5,
    parent_window: int = 2,
    conn=None,
) -> NavResult:
    """Run the lane. Never raises; refuses instead."""
    from sqlalchemy import text

    res = NavResult(ok=False, manufacturer=manufacturer, model=model)
    if not manufacturer and not model:
        res.reason = "no_scope"
        res.path.append(NavStep("scope", "-", "no vendor/model resolved; refusing to guess"))
        return res

    owns = conn is None
    eng = _engine() if owns else None
    conn = conn or eng.connect()
    try:
        # -- 1. doc scope -------------------------------------------------
        docs = docmap.build_docmap(manufacturer, model, conn=conn)
        if not docs:
            res.reason = "no_manual"
            res.path.append(
                NavStep("doc", "-", f"no manual for {manufacturer}/{model} — INGEST, not retrieval")
            )
            return res
        doc = docs[0]
        auth = doc.authoritative()
        if auth is None:
            res.reason = "no_usable_ingest"
            res.path.append(NavStep("doc", doc.doc_key, "no ingest with usable page data"))
            return res
        res.doc_key, res.source_url = doc.doc_key, auth.source_url
        res.citable = auth.citable
        res.path.append(
            NavStep(
                "doc",
                doc.doc_key,
                f"{len(doc.ingests)} ingest(s) of this publication; ranked by pagination "
                f"plausibility, chose pagination={auth.pagination} "
                f"(p{auth.page_min}..{auth.page_max}, citable={auth.citable})",
                candidates=len(docs),
            )
        )

        # -- 2. section ---------------------------------------------------
        wanted = target_sections(question)
        if not wanted:
            res.reason = "no_section_intent"
            res.path.append(NavStep("section", "-", "question maps to no known section"))
            return res

        anchors: list[str] = []
        for s in wanted:
            anchors.extend(_SECTION_ANCHORS.get(s, ()))
        if not anchors:
            res.reason = "no_anchors"
            res.path.append(NavStep("section", ",".join(wanted), "no phrase anchors registered"))
            return res
        res.section = wanted[0]
        res.path.append(
            NavStep("section", res.section, f"intent matched; {len(anchors)} phrase anchor(s)")
        )

        # -- 3. passage (within the chosen doc ONLY) ----------------------
        clause = " OR ".join(f"content ILIKE :a{i}" for i in range(len(anchors)))
        params: dict[str, Any] = {"url": auth.source_url, "lim": limit}
        for i, a in enumerate(anchors):
            params[f"a{i}"] = f"%{a}%"
        rows = (
            conn.execute(text(_PASSAGE_SQL.format(anchor_clause=clause)), params)
            .mappings()
            .fetchall()
        )
        # Drop table-of-contents lines. `docmap.classify_chunk` already detects
        # them and this lane was ignoring it: the first live benchmark returned
        # p23/p24 — dotted-leader TOC entries reading
        # "Manually Clearing Faults . . . . . 160" — as PASSAGES. A TOC line
        # matches every section anchor by construction (it lists the section
        # names), so without this filter phrase-anchoring preferentially
        # retrieves the index instead of the content it points at.
        kept, dropped = [], 0
        for r in rows:
            if docmap.classify_chunk(r["content"]) == "toc":
                dropped += 1
                continue
            kept.append(dict(r))
        if dropped:
            res.path.append(
                NavStep("filter", f"-{dropped} toc", "table-of-contents lines are not passages")
            )
        if not kept:
            res.reason = "no_passage"
            res.path.append(
                NavStep(
                    "passage",
                    "-",
                    f"section {res.section}: {dropped} TOC line(s) only, no real passage"
                    if dropped
                    else f"section {res.section} has no anchored passage in this doc",
                )
            )
            return res
        res.passages = kept
        rows = kept
        res.path.append(
            NavStep("passage", f"{len(rows)} hit(s)", "phrase-anchored, doc-scoped", len(rows))
        )

        # -- 4. parent context --------------------------------------------
        pages = [p["source_page"] for p in res.passages if p.get("source_page") is not None]
        if pages and parent_window:
            lo, hi = min(pages) - parent_window, max(pages) + parent_window
            seen = {(p["source_page"], (p["content"] or "")[:80]) for p in res.passages}
            prows = (
                conn.execute(
                    text(_PARENT_SQL),
                    {"url": auth.source_url, "lo": lo, "hi": hi, "lim": limit * 3},
                )
                .mappings()
                .fetchall()
            )
            res.parent_context = [
                dict(r) for r in prows if (r["source_page"], (r["content"] or "")[:80]) not in seen
            ][:limit]
            res.path.append(
                NavStep(
                    "parent",
                    f"p{lo}..{hi}",
                    f"{len(res.parent_context)} surrounding chunk(s) for context",
                )
            )

        res.ok = True
        res.reason = "ok"
        return res
    except Exception as exc:  # noqa: BLE001 — an experimental lane must never take a caller down
        res.reason = f"error:{type(exc).__name__}"
        res.path.append(NavStep("error", "-", str(exc)[:160]))
        return res
    finally:
        if owns:
            conn.close()


def explain(res: NavResult) -> str:
    lines = [f"path: {res.retrieval_path()}", f"ok={res.ok} reason={res.reason}"]
    for s in res.path:
        lines.append(f"  [{s.stage:8}] {s.chose:34} {s.why}")
    return "\n".join(lines)
