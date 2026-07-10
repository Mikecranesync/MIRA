"""Telegram wiring loop — photo -> proposed rows; text -> verified-only cited Q&A.

PR-4. The GRAPH (`wiring_connections`, migration 026) is the source of truth,
NOT the LLM. This module is pure logic + thin DB glue that wires the existing,
already-merged seams together for the Telegram surface:

    photo (ELECTRICAL_PRINT + "add this wiring" caption)
        -> engine.Supervisor._extract_schematic()        (PR-2, unedited)
        -> wiring_schematic_import.kg_payload_to_rows()  (PR-2, unedited)
        -> wiring_schematic_import.base.write_rows()     (PR-1, unedited)
        -> approval_state='proposed' rows in wiring_connections

    text ("Where does W200 land?")
        -> shared.wiring_profile.load_profile()          (PR-3, unedited)
        -> shared.wiring_profile.answer_wiring_question() (PR-3, unedited)
        -> verified-only, cited answer OR an honest refusal — never a guess

**No second wiring table. No parallel wiring architecture.** Every function in
this module either reuses an already-merged seam verbatim or is pure
formatting logic over that seam's inputs/outputs.

## Doctrine (non-negotiable, tested)

- No auto-verify of vision-derived rows — every intake row lands
  `approval_state='proposed'`. This module never sets `verified`.
- Q&A answers ONLY from `verified` rows. `answer_wiring_question` already
  gates to `profile.trusted()` (`approval_state == 'verified'`) — this module
  never bypasses that gate, and `format_wiring_answer` never fabricates a
  citation or a generic sentence to paper over a refusal.
- Every trusted answer carries >=1 citation. A proposed-only match refuses
  ("needs approval before I will assert it"). No record refuses ("I have no
  approved wiring record ... I will not guess."). **No generic LLM fallback
  for wiring questions, ever.**
- Asset scoping: if the asset is missing, ASK for it
  (`MISSING_ASSET_REPLY`) — never write ambiguous rows, never guess an asset.
- Read-only for Q&A; no control writes; tenant-scoped via `chat_tenant`.

## mig-026 doctrine decision (RECORD — already decided, do not re-litigate)

LLM/vision-derived rows are **direct-INSERTed as `proposed`** via the reused
PR-2 seam (`wiring_schematic_import.kg_payload_to_rows` -> `write_rows`), NOT
routed through `ai_suggestions`. Why: `ai_suggestions` has no
`wiring_connection` `suggestion_type` (migration 027's CHECK constraint lists
six types, none of them wiring), `proposal_writer` is `kg_edge`-only, and the
Hub `/proposals` surface has no wiring query/approve path — so routing through
`ai_suggestions` would be a large multi-surface build, not the smallest
doctrine-consistent path available today. The human gate is preserved by
construction: every row this module writes lands `approval_state='proposed'`,
`proposed_by='telegram:<bot>'`, with full evidence in `evidence_summary`; the
reader (`wiring_profile`) trusts `verified` rows only, so a Telegram-submitted
photo can never talk itself into being trusted. Routing wiring intake through
`ai_suggestions` + a Hub review/approve UI is a real follow-up (the
orchestrator is expected to open a GitHub issue for it) — this is Option A
(direct-INSERT, reuse the seam), not Option B (new suggestion type + Hub
surface), and that tradeoff is deliberate, not an oversight.

See also: `tools/wiring_schematic_import.py` module docstring ("Two honest
gaps this surfaces") for the twin, already-recorded gap #2 (schematic output
IS LLM-derived; direct-INSERT is used anyway, for the same reason).
"""

from __future__ import annotations

import logging
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# LAZY `tools/` writer import. `tools/wiring_schematic_import.py` (which does a
# bare `import wiring_map_import as base`) is only ever needed on the wiring
# INTAKE (writer) path — never at import time, and never on the reader Q&A path.
# Loading it eagerly here crash-loops any image that ships `shared/` but not
# `tools/` (e.g. the telegram bot image → `ModuleNotFoundError: No module named
# 'wiring_schematic_import'` at `bot.py` startup). Import it on first *use*
# instead, so `import wiring_intake` (and the reader path) always works. This
# stays the ONE encapsulated `tools/` sys.path insert (per spec).
# ---------------------------------------------------------------------------
_schematic = None  # lazily loaded writer module (see _load_schematic)


def _load_schematic():
    """Import & cache the `tools/` writer on first use. Only the wiring-intake
    (writer) code paths call this; the reader Q&A path never does."""
    global _schematic
    if _schematic is None:
        _tools_dir = (
            Path(__file__).resolve().parents[2] / "tools"
        )  # shared/ -> mira-bots/ -> repo root
        if str(_tools_dir) not in sys.path:
            sys.path.insert(0, str(_tools_dir))
        import wiring_schematic_import as _mod  # noqa: E402 — writer (pulls in `_mod.base`)

        _schematic = _mod
    return _schematic


from .wiring_profile import (  # noqa: E402
    WiringAnswer,
    answer_wiring_question,
    load_profile,
    profile_from_rows,
)

__all__ = [
    "MISSING_ASSET_REPLY",
    "WiringIntent",
    "answer_wiring_question",
    "build_intake_preview",
    "count_connections",
    "extract_asset",
    "format_wiring_answer",
    "load_profile",
    "normalize_asset",
    "open_neon_conn",
    "parse_wiring_intent",
    "payload_to_proposed_rows",
    "profile_from_rows",
    "sample_wires_terminals",
    "write_proposed_rows",
]

logger = logging.getLogger("mira.wiring_intake")


# ---------------------------------------------------------------------------
# Intent parsing — pure, no I/O
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WiringIntent:
    """What a Telegram message wants to do with wiring, if anything."""

    kind: str  # "intake" | "question" | "none"
    asset: Optional[str]  # normalized asset slug (e.g. "cv-101") or None
    question: Optional[str]  # the wiring question text (for kind=="question")


# Canonical intake phrasing (matched as substrings of the lower-cased text).
INTAKE_PHRASES = (
    "add this wiring",
    "add to documentation",
    "document this wiring",
    "add wiring",
)

# Question markers — presence of one of these PLUS a parseable wire/terminal
# token (below) is what makes a text turn a wiring "question".
QUESTION_MARKERS = (
    "where does",
    "land",
    "connected to",
    "what is on",
    "trace",
    "wired to",
    "terminal",
)

# Asset token: >=2 letters (so a single-letter wire prefix like "W200" can
# never match), then an optional separator, then 2-4 digits. Deliberately
# conservative — see module docstring examples (CV-101, GS10, filler01) vs.
# the wire/terminal tokens it must NOT catch (W200, X1:3). Known limitation:
# a 2-3 letter wire-style token with no separator (e.g. "AB123") is
# ambiguous between "asset" and "wire" — out of scope for this pass; the
# graph write path still requires an explicit/known asset before it writes
# anything, so a misclassification here fails safe (asks, never guesses).
_ASSET_RE = re.compile(r"\b[A-Za-z]{2,12}[-_ ]?\d{2,4}\b")

# Wire/terminal token detector — mirrors `shared.wiring_profile.ask`'s
# private `_TERMINAL_RE`/`_WIRE_RE` (not exported from that module, so this
# is a deliberate local mirror per the spec, not a reimplementation of the
# answer logic itself — `answer_wiring_question` remains the sole authority
# on matching/citing).
_TERMINAL_TOKEN_RE = re.compile(r"\b[A-Za-z]{1,4}\d{0,3}[-:]\d{1,4}\b")
_WIRE_TOKEN_RE = re.compile(r"\b[A-Za-z]{0,3}\d{1,4}[A-Za-z]?\b")


def normalize_asset(token: str) -> str:
    """`"CV-101"`/`"CV 101"` -> `"cv-101"`; lowercase, whitespace/underscore -> `-`."""
    return re.sub(r"[\s_]+", "-", token.strip()).lower()


def extract_asset(text: str) -> Optional[str]:
    """Find a conservative asset token in `text` (e.g. CV-101, GS10, filler01).

    Returns the normalized slug, or `None` if nothing asset-shaped is found.
    Deliberately does NOT match wire/terminal tokens (W200, X1:3) — see
    `_ASSET_RE`.
    """
    if not text:
        return None
    m = _ASSET_RE.search(text)
    if not m:
        return None
    return normalize_asset(m.group(0))


def _strip_asset_token(text: str) -> str:
    """Remove the first asset-shaped token from `text` so the remaining
    wiring question can be parsed cleanly.

    Without this, a question like ``"CV-101 where does W200 land?"`` would
    reach ``answer_wiring_question`` with ``"CV-101"`` still in it — and that
    reader classifies ``"CV-101"`` as a TERMINAL token (it has a `-`
    separator, checked before the bare-wire pattern), so it would look up
    terminal ``CV-101``, find nothing, and answer "no record of CV-101"
    instead of matching the wire ``W200``. Stripping the asset (which the
    caller has already captured separately) leaves a clean
    ``"where does W200 land?"`` for the reader.
    """
    return _ASSET_RE.sub("", text, count=1).strip()


def _has_wire_or_terminal_token(text: str) -> bool:
    return bool(_TERMINAL_TOKEN_RE.search(text) or _WIRE_TOKEN_RE.search(text))


def _is_intake_text(lowered: str) -> bool:
    if any(p in lowered for p in INTAKE_PHRASES):
        return True
    # Graceful widening for phrasing like "Add this to documentation for
    # CV-101" — doesn't literally contain the "add to documentation" phrase
    # (the word "this" sits in between) but is unambiguously the same intent.
    return "add" in lowered and "documentation" in lowered


def _is_question_text(lowered: str, original: str) -> bool:
    """A wiring QUESTION requires a marker AND a parseable wire/terminal
    token. Both, not either — a bare marker word ("terminal") in unrelated
    chat must not claim the turn; see module docstring / PR notes for the
    conservative-boundary rationale.
    """
    if not any(marker in lowered for marker in QUESTION_MARKERS):
        return False
    return _has_wire_or_terminal_token(original)


def parse_wiring_intent(text: str) -> WiringIntent:
    """Classify a Telegram text/caption as wiring intake, a wiring question,
    or neither. Pure — no I/O, no DB, no LLM call."""
    if not text or not text.strip():
        return WiringIntent(kind="none", asset=None, question=None)

    lowered = text.lower()

    if _is_intake_text(lowered):
        return WiringIntent(kind="intake", asset=extract_asset(text), question=None)

    if _is_question_text(lowered, text):
        asset = extract_asset(text)
        # Strip the asset token from the question so the wire/terminal reader
        # doesn't mis-read the asset (e.g. "CV-101") as a terminal token.
        question = _strip_asset_token(text) if asset else text.strip()
        return WiringIntent(kind="question", asset=asset, question=question)

    return WiringIntent(kind="none", asset=None, question=None)


# ---------------------------------------------------------------------------
# DB glue — thin; the connection open is excluded from coverage (network I/O)
# ---------------------------------------------------------------------------


def open_neon_conn():  # pragma: no cover - network I/O
    """Open a psycopg2 connection to NeonDB.

    No shared cursor-returning Neon helper exists in `mira-bots/shared`
    today: `neon_recall.py`'s helpers build SQLAlchemy `create_engine(...,
    poolclass=NullPool)` engines and run named-parameter `text(...)` queries,
    which is a different contract than the `%s`-placeholder psycopg2 cursor
    the reused writer/reader (`wiring_schematic_import.base.write_rows`,
    `wiring_profile.load_profile`) require. `mira-bots/shared/integrations/
    hub_neon.py` DOES use a direct `psycopg2.connect(...)` — this mirrors
    that existing pattern (and `tools/wiring_map_import.py::main()`'s own
    glue) rather than inventing a third connection style.
    """
    import psycopg2  # local import: only DB glue needs the driver

    url = os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL (or DATABASE_URL) not set — cannot reach NeonDB")
    return psycopg2.connect(url)


def payload_to_proposed_rows(
    payload: dict[str, Any],
    asset: str,
    *,
    drawing_ref: Optional[str],
    proposed_by: str,
    source: str,
) -> list:
    """Wrap `wiring_schematic_import.kg_payload_to_rows` (pure, PR-2, unedited).

    Passes provenance straight through; every returned row is
    `approval_state='proposed'` by construction of the reused converter.
    """
    return _load_schematic().kg_payload_to_rows(
        payload,
        asset,
        drawing_ref=drawing_ref,
        proposed_by=proposed_by,
        source=source,
    )


def write_proposed_rows(cur, tenant_id: str, rows: list) -> tuple[int, int]:
    """Set RLS then delegate to the reused PR-1/PR-2 writer seam.

    `cur` is a live DB cursor owned by the caller's transaction (mirrors
    `wiring_map_import.main()`). Returns `(inserted, skipped)`. Never sets
    `approval_state='verified'` — that column value is already fixed to
    `'proposed'` on every row by `kg_payload_to_rows`.
    """
    cur.execute("SELECT set_config('app.current_tenant_id', %s, true)", (tenant_id,))
    return _load_schematic().base.write_rows(cur, tenant_id, rows)


# ---------------------------------------------------------------------------
# Pure formatters — fully unit-testable, no I/O
# ---------------------------------------------------------------------------


def count_connections(payload: dict[str, Any]) -> int:
    """Number of `electrically_connected` relationships in a (possibly
    enveloped) `/api/kg/schematic`-shaped payload."""
    payload = _load_schematic().unwrap_payload(payload or {})
    return sum(
        1
        for rel in payload.get("relationships") or []
        if isinstance(rel, dict) and rel.get("relationship_type") == "electrically_connected"
    )


def sample_wires_terminals(payload: dict[str, Any], n: int = 3) -> list[str]:
    """Up to `n` human-readable `"<from> -> <to> (wire <n>)"` samples from
    the payload's `electrically_connected` relationships."""
    payload = _load_schematic().unwrap_payload(payload or {})
    lines: list[str] = []
    for rel in payload.get("relationships") or []:
        if not isinstance(rel, dict) or rel.get("relationship_type") != "electrically_connected":
            continue
        props = rel.get("properties") or {}
        src = props.get("from_terminal") or rel.get("source_entity_id") or "?"
        dst = props.get("to_terminal") or rel.get("target_entity_id") or "?"
        wire = props.get("wire_number")
        line = f"{src} -> {dst}"
        if wire:
            line += f" (wire {wire})"
        lines.append(line)
        if len(lines) >= n:
            break
    return lines


def build_intake_preview(payload: dict[str, Any], inserted: int, skipped: int, asset: str) -> str:
    """The reply sent right after a wiring photo is proposed into the graph."""
    payload_u = _load_schematic().unwrap_payload(payload or {})
    connections = count_connections(payload)
    components = len(payload_u.get("entities") or [])
    samples = sample_wires_terminals(payload, n=3)
    sample_text = "; ".join(samples) if samples else "none parsed"
    return (
        f"Read {asset} wiring diagram: {connections} connections across {components} components.\n"
        f"Proposed {inserted} new (skipped {skipped} already-known).\n"
        f"Sample: {sample_text}.\n"
        "⚠ These are PROPOSED, not trusted yet — a human must approve them "
        "before MIRA will answer from them."
    )


MISSING_ASSET_REPLY = (
    'Which asset is this wiring for? Reply with the asset name (e.g. "CV-101 add this wiring") '
    "— I won't write ambiguous wiring."
)


def format_wiring_answer(answer: WiringAnswer, asset: str) -> str:
    """Render a `WiringAnswer` for a Telegram reply — doctrine-safe by
    construction.

    - Trusted (`answer_source=="wiring_connections"`, has citations): the
      answer text, a "Sources:" block (one line per citation), and a
      read-only/fallback metadata footer.
    - Anything else (refusal, no-record, unparsed question): `answer.answer`
      verbatim — already the doctrine-correct phrasing — with NO citations
      and NO generic sentence appended.

    NEVER emits a Sources block without >=1 citation, even defensively (if
    `answer_source=="wiring_connections"` arrived with no citations, that is
    treated as a refusal-shaped render, not a trusted one).
    """
    if answer.answer_source == "wiring_connections" and answer.citations:
        lines = [answer.answer, "", "Sources:"]
        for c in answer.citations:
            label = c.get("drawing_reference") or c.get("source") or "cited record"
            lines.append(f"- [{c.get('approval_state', '')}] {label}: {c.get('excerpt', '')}")
        lines.append("")
        lines.append(
            f"(read_only={str(bool(answer.read_only)).lower()}, "
            f"fallback_used={str(bool(answer.fallback_used)).lower()}, "
            "source=wiring_connections)"
        )
        return "\n".join(lines)

    return answer.answer
