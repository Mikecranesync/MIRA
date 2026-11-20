"""Post-LLM citation compliance check for MIRA RAG responses (CRA-11 / Unit 2).

This module is intentionally small and dependency-free so it can be imported
by both the engine and offline tests without dragging in psycopg2, sqlalchemy,
or the rest of the bot stack.

Three checks live here:

  1. **Presence** (CRA-11, observational): does a technical reply that had KB
     coverage include a ``[Source: ...]`` tag at all? Logged, never blocks.
  2. **Relevance / conflict** (beta-readiness P0-3 — "stop the lie"): does the
     cited vendor actually match the resolved ``uns_context`` manufacturer? A
     Siemens breaker cited on a Danfoss VLT question is a confidently-wrong
     source — presence alone reads it green.
  3. **Relevance / unsupported attribution** (added 2026-08-03): when NO
     manufacturer is resolved, does the reply cite one anyway? This is the
     failure check 2 structurally could not see — it needs a resolved
     manufacturer to compare against, so the vague turns that fail worst were
     exactly the ones it skipped. Measured live at 24–34 instances per 15
     conversations, rising with conversation length.

Both relevance checks are **alias-aware** (Allen-Bradley / PowerFlex / Rockwell
all canonicalize to "Rockwell Automation") and **fail-open**: an unrecognized
vendor is never treated as a mismatch, so a correct-but-unusual citation is not
suppressed. That fail-open stance has a cost worth knowing — a vendor missing
from ``uns_resolver.VENDOR_ALIASES`` bypasses check 3 entirely, which is how
Demag and Interroll citations went unnoticed until the alias table was
extended. The table is a correctness surface, not a convenience.

When ``enforce=True``, the offending ``[Source: ...]`` tags are stripped and a
short honesty note is appended — worded per reason, since "this cited a
different manufacturer" is false when no manufacturer was ever established.
"""

from __future__ import annotations

import logging
import os
import re
from collections import Counter
from collections.abc import Awaitable, Callable

from .workers.rag_worker import CITATION_TAG_RE, format_source_label

logger = logging.getLogger("mira-gsd")


def citation_enforce_enabled() -> bool:
    """Runtime kill-switch for the P0-3 citation-strip. Default ON; set
    MIRA_CITATION_ENFORCE=0 to disable (detection still logs) without a deploy
    if a false-positive ever surfaces in prod."""
    return os.getenv("MIRA_CITATION_ENFORCE", "1") != "0"


def _canonical_vendor(text: str) -> str | None:
    """Canonical manufacturer for a vendor/alias/label string, or None.

    Delegates to ``uns_resolver.canonical_vendor`` — the single source of truth
    so the citation-relevance gate and the retrieval cross-vendor filter agree
    on "same vendor" (Allen-Bradley ≡ Rockwell, etc.). The import is lazy and
    fail-open so this module stays import-light (uns_resolver pulls neon_recall
    / DB deps) and never hard-fails if the resolver is unimportable.
    """
    if not text:
        return None
    try:
        from .uns_resolver import canonical_vendor
    except Exception:  # pragma: no cover - only when resolver unimportable
        return None
    return canonical_vendor(text)


def _vendors_in_text(text: str) -> set[str]:
    """Canonical vendors named in free text. Lazy + fail-open, like above."""
    if not text:
        return set()
    try:
        from .uns_resolver import vendors_in_text
    except Exception:  # pragma: no cover - only when resolver unimportable
        return set()
    return vendors_in_text(text)


# Generic document/title words that lead a real corpus citation and name no
# party. Kept here rather than in the detector because this module is the single
# place that judges what is citable (`.claude/CLAUDE.md` § "Do not do" — no second
# citation logic); `answer_qc.unrelated_vendor` imports this list instead of
# keeping its own copy.
ATTRIBUTION_STOPWORDS: frozenset[str] = frozenset(
    {
        "source",
        "fault",
        "code",
        "table",
        "manual",
        "manuals",
        "documentation",
        "chapter",
        "page",
        "section",
        "user",
        "guide",
        "drive",
        "drives",
        "motor",
        "conveyor",
        "check",
        "what",
        "this",
        "that",
        "with",
        "from",
        "your",
        "the",
        "and",
        "for",
        "modbus",
        "com",
        "transmission",
        "host",
        "controller",
        "connection",
        "current",
        "state",
        "display",
        "startup",
        "yes",
        "cause",
        "causing",
        "excessive",
        "load",
        "short",
        "circuit",
        "cable",
        "reset",
        "bad",
        "serial",
        "comms",
        "communication",
        "communications",
        "img",
        "image",
        "photo",
        "scan",
        "note",
        "notes",
        "quick",
        "reference",
        "appendix",
        "figure",
        "overview",
        "general",
        "installation",
        "wiring",
        "parameter",
        "parameters",
        "troubleshooting",
        "maintenance",
        "safety",
        "specifications",
        "getting",
        "unknown",
        "document",
        "documents",
    }
)


def attributed_parties(reply: str) -> list[str]:
    """The parties a reply attributes its content to, in order, lowercased.

    The leading token of each ``[Source: …]`` label. That token is the party in a
    well-formed citation ("AutomationDirect GS10 — Fault Codes"); everything else
    in the label names the document.

    Excluded, because they name a document rather than a party:

    * a generic title word (``ATTRIBUTION_STOPWORDS``);
    * a token carrying a digit or a URL escape — ``22comm``, ``2100``,
      ``ch4parameters``, ``cm5003%20vibration%20guide1``, all measured live. That
      `22comm` is a real Rockwell part number is exactly the point: it identifies
      a document, not the party being attributed to.

    Unrecognized ALPHABETIC names are deliberately kept — Demag, Interroll, SKF
    are real attributions the vendor tables do not know, and they are the class
    this exists to expose.
    """
    return [p for p in (_attributed_party(t) for t in CITATION_TAG_RE.findall(reply or "")) if p]


def _attributed_party(tag: str) -> str | None:
    """The party a single ``[Source: …]`` tag attributes to, or None."""
    body = _tag_label(tag).strip()
    if not body:
        return None
    first = re.split(r"[\s—–,;:/|-]+", body)[0].strip().lower()
    if not first or first in ATTRIBUTION_STOPWORDS:
        return None
    if any(c.isdigit() for c in first) or "%" in first:
        return None
    if not first.replace(".", "").replace("'", "").isalpha():
        return None
    # Two characters is a filename/locale prefix, not a brand — measured:
    # "[Source: En Acs880 Drive Application Programming Manual]" reported a
    # vendor called `en`. No OEM in this corpus has a two-letter name.
    if len(first) < 3:
        return None
    return first


def trusted_uns_context(state: dict | None) -> dict | None:
    """The session's `uns_context`, with an UNCONFIRMED manufacturer removed.

    The mirror of the rule in `established_context_text`. The conflict check
    compares cited vendors against `uns_context["manufacturer"]` as the *expected*
    one — so an unconfirmed resolver hit does not merely fail to strip a wrong
    citation, it actively BLESSES it: MIRA retrieves a Yaskawa chunk, the
    resolver writes Yaskawa into state, and the gate then reads a Yaskawa
    citation as matching the expected vendor.

    Measured on a GS10 conversation: "[Source: Yaskawa V1000 — Step Display]" and
    "[Source: Rockwell Automation 1769-L33ER]" survived in replies that carried a
    strip note, because they matched an expectation MIRA had invented.

    Blanking the manufacturer does not weaken the gate — it moves the turn to the
    unsupported-attribution branch, which compares against the technician's own
    words instead. That is strictly stricter.
    """
    if not isinstance(state, dict):
        return None
    ctx = state.get("context")
    uns = ctx.get("uns_context") if isinstance(ctx, dict) else None
    if not isinstance(uns, dict):
        return None
    if state.get("asset_identified") or uns.get("source") == "direct_connection":
        return uns
    trimmed = dict(uns)
    trimmed["manufacturer"] = ""
    trimmed["model"] = ""
    return trimmed


def established_context_text(message: str, state: dict | None) -> str:
    """What the TECHNICIAN and trusted state have established, as one string.

    Feeds the unsupported-attribution check: a vendor named here is fair game
    to cite, a vendor absent from it is being attributed to a machine nobody
    identified.

    **Only three sources count, and the exclusion is the point:**

    * the current user message,
    * prior **user** turns,
    * trusted resolved state — the confirmed asset and the UNS context.

    An assistant turn is NEVER a source. Both Supervisor paths append the
    freshly generated reply to history *before* calling the citation check
    (``engine.py`` 3712-3713 and 5027-5028), so a reply containing
    ``[Source: Siemens …]`` would otherwise find "Siemens" in its own text and
    license its own citation. The gate would then pass every time it mattered
    most — a self-referential loop that looks like evidence.

    Prior assistant turns are excluded for the same reason one step back: a
    vendor MIRA hallucinated in turn 3 must not authorise citing that vendor in
    turn 6. Only the technician and resolved state can establish equipment.

    History entries that are bare strings carry no role, so they cannot be
    proven to be the technician's words and are excluded. That is deliberately
    strict: the cost is a missed strip, the alternative is a reply laundering
    its own vendor through an untyped history entry.

    Never raises: a malformed state yields whatever could be read.
    """
    parts: list[str] = [message or ""]
    if not isinstance(state, dict):
        return parts[0]
    asset = str(state.get("asset_identified") or "")
    parts.append(asset)
    ctx = state.get("context")
    if isinstance(ctx, dict):
        uns = ctx.get("uns_context")
        if isinstance(uns, dict):
            # A resolved vendor counts as established ONLY when something outside
            # MIRA's own inference put it there: a technician-confirmed asset
            # (`asset_identified` is written after the UNS gate is answered) or a
            # certified direct connection. A bare resolver hit is NOT evidence —
            # on a vague turn the vendor comes from whatever retrieval surfaced,
            # so counting it here lets a reply authorise its own citation. That
            # is the same self-licensing loop excluded for assistant turns below,
            # one level up, and it was the residual `unrelated_vendor` class on
            # the synthetic QC loop: "it stopped again" answered with
            # "[Source: Rockwell Automation PowerFlex 40P]", kept because the
            # resolver had written Rockwell into state from its own retrieval.
            #
            # Aliases are not lost. `_vendors_in_text` canonicalizes the
            # technician's OWN words, so someone who typed "PowerFlex 525" still
            # establishes Rockwell without this contribution.
            if asset or uns.get("source") == "direct_connection":
                parts.append(str(uns.get("manufacturer") or ""))
                parts.append(str(uns.get("model") or ""))
        history = ctx.get("history")
        if isinstance(history, list):
            for turn in history:
                if isinstance(turn, dict) and turn.get("role") == "user":
                    parts.append(str(turn.get("content") or ""))
    return " ".join(p for p in parts if p)


def _tag_label(tag: str) -> str:
    """Extract the label text from a '[Source: <label>]' tag."""
    inner = tag[1:-1] if tag.startswith("[") and tag.endswith("]") else tag
    return re.sub(r"(?i)^\s*source:\s*", "", inner).strip()


# ── D3: citation ELIGIBILITY — what may be cited at all ─────────────────────
#
# W2a eval case 6: MIRA replied "You think it's a WEG motor.
# [Source: Img 20231106 085404329 — motor]" — an uploaded photo's FILENAME
# cited as documentation. Photo-ingested KB rows carry the image name in their
# manufacturer field, so `format_source_label` faithfully renders it and
# nothing upstream objects: the chunk is real, the label is real, only the
# CLASS of source is wrong. Session artifacts are evidence ABOUT the machine,
# never documentation FOR it. Owner ruling (2026-08-04): an eligibility rule
# set, not merely a filename filter.

_INELIGIBLE_IMAGE_RE = re.compile(
    r"(?i)(?:^img(?:[_\s]|\d)|^image\b|\.(?:jpe?g|png|gif|bmp|heic|webp|tiff?)\b)"
)
_INELIGIBLE_SESSION_RE = re.compile(r"(?i)^(?:photo\b|screenshot\b|session\s+photo|camera\b)")
_INELIGIBLE_TIMESTAMP_RE = re.compile(r"^[\d\s\-:._]{8,}$")


def ineligible_source_reason(label: str) -> str | None:
    """Why ``label`` may NOT be cited as documentation — None when eligible.

    Reasons: "empty" (blank label), "image_artifact" (image filename shapes,
    leading Img/image tokens, image file extensions anywhere in the label),
    "session_artifact" (photo/screenshot/camera session labels),
    "bare_timestamp" (digit-run labels with no words). Eligible labels are
    everything else — manuals, fault tables, datasheets, pack documents.
    Conservative on prose: only labels that START with an artifact token or
    carry a file extension are caught, so a document section that merely
    mentions imaging is untouched.
    """
    text = (label or "").strip()
    if not text:
        return "empty"
    if _INELIGIBLE_IMAGE_RE.search(text):
        return "image_artifact"
    if _INELIGIBLE_SESSION_RE.search(text):
        return "session_artifact"
    if _INELIGIBLE_TIMESTAMP_RE.fullmatch(text):
        return "bare_timestamp"
    return None


# ── Provenance: is the cited document evidence for the unit named? (#3049) ────
#
# The two relevance cases above read the vendor out of the citation LABEL. Two
# measured failures are invisible to that:
#
#   * a label with no manufacturer in it — a Drive-ingested copy whose stored
#     `manufacturer` is NULL ("manual SIRIUS circuit breaker 3RV en US"), or a
#     Sources-footer label rendered from a file stem ("2100 — CA 004, p. 1");
#   * the right document stripped because the technician typed only the catalog
#     number ("GS13N-42P0 frame size?") — then the salvage rewrite re-tagged the
#     reply with the next retrieved label, a Siemens PM340 manual.
#
# When the technician's own words carry a catalog-style identifier and the turn's
# retrieved chunks are known, the gate asks the question the label cannot answer:
# does the chunk this tag names mention that identifier, or come from a vendor the
# technician (or trusted state) established? Off when either input is missing, so
# callers that cannot supply chunks get the old behaviour exactly.

_IDENT_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]{3,}[A-Za-z0-9]")
_HAYSTACK_TOKEN_RE = re.compile(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*")
_PAGE_SUFFIX_RE = re.compile(r",\s*p\.\s*\d+\s*$", re.IGNORECASE)
# A rating, not a unit: digits followed by an electrical/mechanical unit
# ("480VAC", "24VDC", "2200RPM", "400VAC50HZ"). Codex #5687 F4: these matched an
# unrelated manual that merely states the same voltage.
_RATING_RE = re.compile(
    r"^(?:\d+(?:V|VAC|VDC|KV|HZ|KHZ|KW|HP|KVA|MVA|VA|MA|A|KA|KAIC|AIC|SCCR|RPM|MM|NM|PH|PHASE|W|UF|OHM|C|F))+$"
)
# A standard or enclosure reference, not a unit: NEMA12, IEC61800, UL508A, IP65.
_STANDARD_RE = re.compile(r"^(?:NEMA|IEC|UL|CSA|ISO|EN|IP|AWG|MCM|KCMIL)\d")
# A mention the technician is moving AWAY from: "GA50U2001, not GS13N-42P0",
# "instead of the GS13N-42P0" (Codex #5687 round 2, F2).
_NEGATED_BEFORE_RE = re.compile(
    r"(?:\bnot|\bisn'?t|\bwasn'?t|\binstead\s+of|\bno\s+longer|\brather\s+than|\bwrong"
    r"|\bswapped(?:\s+out)?|\breplaced|\bmisread(?:\s+it)?\s+as|\bmistook\s+it\s+for"
    r"|\bthought\s+it\s+was)"
    r"\s+(?:an?\s+|the\s+|it'?s\s+an?\s+)?$",
    re.IGNORECASE,
)
# "GS13N-42P0 was wrong", "GS13N-42P0 is a typo" — the negation follows the token.
_NEGATED_AFTER_RE = re.compile(
    r"^\s*(?:was|is|was\s+a|is\s+a)?\s*(?:wrong|incorrect|a\s+typo|typo|a\s+mistake|not\s+right)\b",
    re.IGNORECASE,
)
_MEMORY_BLOCK_RE = re.compile(r"^\[MIRA MEMORY[^\]]*\].*?\[END MEMORY\]\s*\n*", re.DOTALL)


def _norm_ident(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


def catalog_identifiers(text: str) -> set[str]:
    """Catalog-style identifiers in free text, normalized (``GS13N-42P0`` → ``GS13N42P0``).

    Deliberately narrow: at least 6 alphanumerics with at least 2 letters and 2
    digits, and not a rating. That admits catalog numbers (``GS13N-42P0``,
    ``GA50U2001``, ``1769-L33ER``) and rejects the tokens a turn is full of that
    do not name a unit — ``525``, ``F0004``, ``P01-01``, ``CE10``, ``60Hz``,
    ``480VAC``.
    """
    text = text or ""
    out: set[str] = set()
    for m in _IDENT_TOKEN_RE.finditer(text):
        n = _norm_ident(m.group(0))
        if (
            len(n) >= 6
            and sum(c.isalpha() for c in n) >= 2
            and sum(c.isdigit() for c in n) >= 2
            and not _RATING_RE.match(n)
            and not _STANDARD_RE.match(n)
            and not _NEGATED_BEFORE_RE.search(text[max(0, m.start() - 24) : m.start()])
            and not _NEGATED_AFTER_RE.match(text[m.end() : m.end() + 24])
        ):
            out.add(n)
    return out


def active_unit_text(message: str, state: dict | None) -> str:
    """The technician's most recent words that name a unit — the ONLY model
    evidence provenance reads (Codex #5687 rounds 1-2, F2; contract CTX-001).

    In order: this message (minus any injected memory block); else the newest
    user turn in history that names a catalog identifier; else the confirmed
    asset. A correction therefore supersedes every older mention, a pronoun-only
    follow-up keeps the corrected unit, and a remembered model never poses as a
    current one. Returns ``""`` when nothing names a unit, which turns
    provenance OFF rather than falling back to the whole session.
    """
    current = _MEMORY_BLOCK_RE.sub("", message or "").strip()
    if catalog_identifiers(current):
        return current
    if not isinstance(state, dict):
        return ""
    ctx = state.get("context")
    history = ctx.get("history") if isinstance(ctx, dict) else None
    if isinstance(history, list):
        for turn in reversed(history):
            if isinstance(turn, dict) and turn.get("role") == "user":
                text = _MEMORY_BLOCK_RE.sub("", str(turn.get("content") or "")).strip()
                if catalog_identifiers(text):
                    return text
    asset = str(state.get("asset_identified") or "")
    return asset if catalog_identifiers(asset) else ""


def _source_tokens(text: str) -> set[str]:
    """Normalized whole tokens of a source field, plus each hyphen-separated part.

    ``CIPR-GA50U2001ABA`` yields ``CIPRGA50U2001ABA``, ``CIPR`` and ``GA50U2001ABA``;
    ``zx9000_manual.pdf`` yields ``ZX9000``, ``MANUAL`` and ``PDF``.
    """
    out: set[str] = set()
    for tok in _HAYSTACK_TOKEN_RE.findall(text or ""):
        out.add(_norm_ident(tok))
        if "-" in tok:
            out.update(_norm_ident(part) for part in tok.split("-") if part)
    return out


# The one suffix rule: a 2-4 letter option code after a catalog number that ends
# in a digit (Yaskawa CIPR-GA50U2001ABA: enclosure, region, options). A digit
# or a single letter after the number is a different variant (ZX9000B2,
# ZX9000B) and never matches (Codex #5687 round 2, F4).
_OPTION_SUFFIX_RE = re.compile(r"^[A-Z]{2,4}$")


def _names_identifier(token: str, ident: str) -> bool:
    """True when ``token`` IS the identifier, or the identifier plus an option
    suffix that starts at a letter/digit boundary (``GA50U2001`` in
    ``GA50U2001ABA``). ``ZX9000`` never matches ``ZX90000``: the remainder ``0``
    continues the number rather than starting a new field (Codex #5687 F4)."""
    if token == ident:
        return True
    if len(token) > len(ident) and token.startswith(ident):
        return ident[-1].isdigit() and bool(_OPTION_SUFFIX_RE.match(token[len(ident) :]))
    return False


def _label_key(label: str, *, keep_page: bool = True) -> str:
    s = (label or "").strip()
    if not keep_page:
        s = _PAGE_SUFFIX_RE.sub("", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def _documents_by_label(
    chunks: list[dict] | None,
) -> tuple[dict[str, list[list[dict]]], dict[str, list[list[dict]]]]:
    """Every label a retrieved document can appear under → the documents behind it.

    Two renderers exist: the prompt header (``format_source_label``) and the
    Sources footer (``response_formatter._format_citation_label`` over
    ``kb_citation_entry``, which appends ``, p. N``). A tag is recognised under
    either.

    A tag names a DOCUMENT (every retrieved chunk sharing a ``source_url``), not
    just the one chunk whose label it copied: a right manual cited from its fault
    table is still proven by the spec-table chunk beside it that names the unit.

    Returns ``(exact, unpaged)``: ``exact`` keys keep the page suffix; ``unpaged``
    keys drop it and are only a fallback for a tag whose page matches no rendered
    label (Codex #5687 F3 — two "Installation Guide" PDFs must not pool).
    """
    from .response_formatter import _format_citation_label
    from .workers.rag_worker import kb_citation_entry

    valid = [ch for ch in chunks or [] if isinstance(ch, dict)]
    by_url: dict[str, list[dict]] = {}
    for ch in valid:
        url = str(ch.get("source_url") or "").strip()
        if url:
            by_url.setdefault(url, []).append(ch)

    exact: dict[str, list[list[dict]]] = {}
    unpaged: dict[str, list[list[dict]]] = {}
    for ch in valid:
        url = str(ch.get("source_url") or "").strip()
        document = by_url[url] if url else [ch]
        for label in (format_source_label(ch), _format_citation_label(kb_citation_entry(ch))):
            for table, key in (
                (exact, _label_key(label)),
                (unpaged, _label_key(label, keep_page=False)),
            ):
                if key:
                    docs = table.setdefault(key, [])
                    if not any(d is document for d in docs):
                        docs.append(document)
    return exact, unpaged


def _chunk_vendor(chunk: dict) -> str | None:
    return _canonical_vendor(str(chunk.get("manufacturer") or "")) or _canonical_vendor(
        format_source_label(chunk)
    )


_SERIES_ROW_RE = re.compile(r"^([A-Z0-9]*[A-Z])(\d{4,})$")


def _names_series_row(chunk: dict, identifiers: set[str]) -> bool:
    """A series table proves a catalog number by its abbreviated row.

    Yaskawa's GA500 fuse table lists ``GA50U2002`` as row ``2002`` under a chunk
    labelled ``GA500``. Proven only when BOTH hold: the chunk's model label shares
    all but at most one character of the identifier's lead (``GA50U`` vs
    ``GA500`` → ``GA50``), and the identifier's digit tail (4+ digits) appears as
    a whole token in the chunk. Retrieval marks such a chunk ``unknown`` because
    the alias table has no GA50U family, which is why vendor alone is not enough
    (Codex #5687 F5) but the row is.
    """
    label = _norm_ident(str(chunk.get("model_number") or ""))
    if not label:
        return False
    tokens = _source_tokens(str(chunk.get("content") or ""))
    for ident in identifiers:
        m = _SERIES_ROW_RE.match(ident)
        if not m:
            continue
        lead, tail = m.groups()
        shared = len(os.path.commonprefix([lead, label]))
        if not (shared >= 3 and shared >= len(lead) - 1 and tail in tokens):
            continue
        # A ROW, not an incidental number (Codex #5687 round 2, F7): the chunk
        # must read as a model table (another row of the same width and leading
        # digit beside it) and the tail must never sit after a
        # copyright / revision / date marker.
        siblings = {
            t
            for t in tokens
            if t.isdigit() and len(t) == len(tail) and t[0] == tail[0] and t != tail
        }
        content = str(chunk.get("content") or "")
        incidental = re.search(
            rf"(?:copyright|\(c\)|\u00a9|rev\.?|revision|version|edition|date)\s*[:.]?\s*{tail}\b",
            content,
            re.IGNORECASE,
        )
        if siblings and not incidental:
            return True
    return False


def _document_backs_unit(
    document: list[dict], identifiers: set[str], allowed_vendors: set[str]
) -> bool:
    if any(_names_series_row(ch, identifiers) for ch in document):
        return True
    for ch in document:
        tokens = set().union(
            *(
                _source_tokens(str(ch.get(field) or ""))
                for field in ("content", "model_number", "source_url")
            ),
            _source_tokens(format_source_label(ch)),
        )
        if any(_names_identifier(t, i) for t in tokens for i in identifiers):
            return True
    for ch in document:
        # Codex #5687 F5: retrieval marks an excerpt labelled for another model of
        # an undecidable family as "unknown" — general context only. Sharing the
        # manufacturer does not make it evidence for the unit the technician named.
        # When the marker is absent (a photo turn, an unscoped retrieval) it is
        # computed here with retrieval's own helper against the named unit
        # (Codex #5687 round 2, F5).
        if not _applies_to_unit(ch, identifiers):
            continue
        vendor = _chunk_vendor(ch)
        if vendor and vendor in allowed_vendors:
            return True
    return False


def _applies_to_unit(chunk: dict, identifiers: set[str]) -> bool:
    scope = chunk.get("evidence_applicability")
    if scope is not None:
        return scope in ("model", "family", "unlabelled")
    from .workers.rag_worker import evidence_applicability

    return any(
        evidence_applicability(chunk.get("model_number"), ident)
        in ("model", "family", "unlabelled")
        for ident in identifiers
    )


def _tag_provenance(
    tag: str,
    labels: tuple[dict[str, list[list[dict]]], dict[str, list[list[dict]]]],
    identifiers: set[str],
    allowed_vendors: set[str],
) -> bool | None:
    """True = the cited document backs this unit; False = it does not; None = unknown.

    ``None`` (the tag names no retrieved document — a drive pack, a KG fact,
    another renderer) is left to the label-based cases: provenance never strips
    what it cannot see. When a label resolves to more than one document, the tag
    is ambiguous — a reader cannot tell which was meant — so EVERY candidate must
    back the unit; one supporting namesake never vouches for another (F3).
    """
    exact, unpaged = labels
    label = _tag_label(tag)
    documents = exact.get(_label_key(label)) or unpaged.get(_label_key(label, keep_page=False))
    if not documents:
        return None
    return all(_document_backs_unit(d, identifiers, allowed_vendors) for d in documents)


def evaluate_citation_relevance(
    reply: str,
    expected_manufacturer: str | None,
    established_text: str = "",
    chunks: list[dict] | None = None,
    current_text: str | None = None,
) -> dict:
    """Pure, alias-aware citation-relevance check (no I/O).

    Returns::

        {
          "relevant":         bool,   # False on conflict OR unsupported attribution
          "reason":           str,    # "conflict" | "unestablished" | ""
          "expected_vendor":  str | None,   # canonical, when recognized
          "cited_vendors":    list[str],    # canonical vendors named in tags
          "conflicting_tags": list[str],    # tags to strip
        }

    Two independent failures are caught:

    **Conflict** — a manufacturer is resolved and the reply cites a different
    one. Flagged only when ALL of: the expected manufacturer canonicalizes to a
    recognized vendor, the reply names ≥1 recognized cited vendor, and none of
    them equals the expected one. A correct citation alongside a wrong one is
    NOT a miss.

    **Unsupported attribution** — NO manufacturer is resolved, yet the reply
    cites one anyway. `established_text` is the conversation's own words (this
    turn plus history plus any confirmed asset); a cited vendor absent from it
    is being attributed to a machine nobody has identified.

    Both are conservative and fail-open. `established_text` defaults to empty,
    which disables the second check entirely — a caller that cannot supply the
    conversation gets exactly the old behavior rather than a false strip.
    """
    expected = _canonical_vendor(expected_manufacturer or "")
    tags = CITATION_TAG_RE.findall(reply or "")
    cited: list[str] = []
    for tag in tags:
        cv = _canonical_vendor(_tag_label(tag))
        if cv:
            cited.append(cv)

    relevant = True
    conflicting: list[str] = []
    reason = ""

    if expected and cited and expected not in cited:
        # Case 1 — CONFLICT. A vendor is resolved and the reply cites a
        # different one. This is the original P0-3 gate.
        relevant = False
        reason = "conflict"
        conflicting = [
            t for t in tags if (_canonical_vendor(_tag_label(t)) not in (None, expected))
        ]
    elif not expected and (cited or attributed_parties(reply or "")) and established_text:
        # Case 2 — UNSUPPORTED ATTRIBUTION. No vendor is resolved, so the
        # reply is citing a manufacturer's manual for a machine nobody has
        # identified. Measured live: a vague follow-up ("did that fix it?")
        # retrieves whatever is nearest across an 83k-chunk multi-vendor
        # corpus and cites it as authoritative — Siemens, then Demag, then
        # Interroll, a different maker almost every turn. The chunks are
        # real, which is why nothing upstream catches it; the *attribution*
        # is what is unsupported.
        #
        # Case 1 could never see this: it needs a resolved manufacturer to
        # compare against, so exactly the vague turns that fail worst were
        # the ones it skipped.
        # Recognized vendors compare canonically (Allen-Bradley ≡ Rockwell).
        # UNRECOGNIZED parties — Demag, Interroll, SKF, Westward, none of them in
        # the vendor tables — compare by name against the technician's own words.
        # Restricting this to canonical vendors was the remaining hole: those
        # attributions were cited on turns where nobody named them and were never
        # stripped, and they are 13 of 19 failing turns on the synthetic QC loop.
        # `_attributed_party` already excludes document titles and file/URL
        # artifacts, so what reaches here is a name being attributed to.
        established = _vendors_in_text(established_text)
        established_words = set(re.findall(r"[a-z][a-z.'-]{2,}", (established_text or "").lower()))
        unsupported = []
        for t in tags:
            cv = _canonical_vendor(_tag_label(t))
            if cv:
                if cv not in established:
                    unsupported.append(t)
                continue
            party = _attributed_party(t)
            if party and party not in established_words:
                unsupported.append(t)
        if unsupported:
            relevant = False
            reason = "unestablished"
            conflicting = unsupported

    # Case 3 — PROVENANCE (#3049). Only with the turn's chunks AND a catalog
    # identifier in the technician's words. Identifiers in THIS message win over
    # history, so a corrected model ("actually it's a GA50U2001") cannot be
    # vouched for by the manual of the one it replaced (Codex #5687 F2); a
    # follow-up that names no unit keeps the session's.
    identifiers = set()
    if chunks:
        # A caller that knows the active unit passes its text (possibly empty,
        # which turns provenance off); legacy callers pass nothing and get the
        # session-wide reading.
        identifiers = catalog_identifiers(
            established_text if current_text is None else current_text
        )
    if identifiers:
        labels = _documents_by_label(chunks)
        allowed = {expected} if expected else _vendors_in_text(established_text)
        verdicts = {t: _tag_provenance(t, labels, identifiers, allowed) for t in tags}
        unproven = [t for t in tags if verdicts[t] is False]
        if reason == "conflict":
            # Case 1 is never overridden — a vendor conflict stays stripped and
            # keeps its reason — but it no longer exempts the REST of the reply
            # from provenance (Codex #5687 F1: a Siemens conflict let an
            # unrelated vendorless MCC guide ride along).
            conflicting += [t for t in unproven if t not in conflicting]
        else:
            # A Case-2 strip of a tag whose document names the unit is reversed:
            # the technician established the equipment by typing its catalog number.
            conflicting = [t for t in conflicting if verdicts[t] is not True]
            conflicting += [t for t in unproven if t not in conflicting]
            if unproven:
                relevant, reason = False, "unproven"
            elif not conflicting:
                relevant, reason = True, ""

    return {
        "relevant": relevant,
        "reason": reason,
        "expected_vendor": expected,
        "cited_vendors": cited,
        "conflicting_tags": conflicting,
    }


# A trailing `--- Sources ---` block. Defined here, in the module that owns what
# is citable, and imported by the engine's H4 normalizer so the strip and the
# normalizer read the SAME block — they were previously fighting over it.
SOURCES_BLOCK_RE = re.compile(
    r"---\s*Sources\s*---\s*\n((?:\s*\[\d+\]\s+[^\n]+\n?)+)",
    re.IGNORECASE,
)


def _prune_sources_block(text: str, removed_labels: list[str]) -> str:
    """Drop `--- Sources ---` lines naming a citation that was just stripped.

    Removes the whole block when nothing is left in it, so a bare header never
    trails the reply.
    """
    m = SOURCES_BLOCK_RE.search(text or "")
    if not m or not removed_labels:
        return text
    kept = []
    for line in m.group(1).strip().splitlines():
        label = line.split("]", 1)[1].strip() if "]" in line else line.strip()
        if any(label and (label in rem or rem in label) for rem in removed_labels if rem):
            continue
        kept.append(line)
    if not kept:
        return (text[: m.start()] + text[m.end() :]).rstrip()
    body = "\n".join(kept) + "\n"
    return text[: m.start()] + f"--- Sources ---\n{body}" + text[m.end() :]


def strip_conflicting_citations(
    reply: str,
    conflicting_tags: list[str],
    expected_vendor: str | None,
    reason: str = "conflict",
) -> str:
    """Remove unsupportable ``[Source: ...]`` tags and append an honesty note.

    The note differs by reason, because the old wording is actively wrong in
    the unestablished case: telling a technician the citation "pointed to a
    different manufacturer" implies MIRA knows which manufacturer is correct.
    It does not — that is the whole problem — and the useful thing to say is
    which machine it needs.
    """
    out = reply or ""
    for tag in conflicting_tags:
        out = out.replace(tag, "")
    # The same citation is often rendered TWICE — inline, and again in a trailing
    # `--- Sources ---` block. Removing only the inline tag leaves the block
    # listing the source we just refused to stand behind, and the H4 enforcer's
    # `_normalize_sources_block` then turns that surviving line back INTO an
    # inline tag, silently undoing the strip. Measured live (2026-08-04): a GS10
    # question kept "[Source: Rockwell Automation PowerFlex 525 — Parameter
    # Groups]" while carrying the "I removed a citation…" note in the same reply.
    out = _prune_sources_block(out, [_tag_label(t).strip() for t in conflicting_tags])
    out = re.sub(r"[ \t]{2,}", " ", out).rstrip()

    if reason == "admission_conflict":
        # #3213 — the reply itself already says "I don't have documentation";
        # appending another honesty note would be redundant. The strip alone
        # resolves the contradiction.
        return out

    if reason == "ineligible":
        out += (
            "\n\n_(Note: I removed a citation that pointed to a photo or session "
            "artifact — that is not documentation. Treat the statement above as "
            "unverified until confirmed against the equipment's manual.)_"
        )
        return out

    if reason == "unproven":
        out += (
            "\n\n_(Note: I removed a citation because the document it pointed to doesn't "
            "mention the unit you named, so it isn't evidence for your equipment. Treat "
            "the statement above as unverified until it's confirmed against that unit's "
            "manual.)_"
        )
        return out

    if reason == "unestablished":
        out += (
            "\n\n_(Note: I removed a citation because I haven't established which "
            "machine you're working on, so I can't attribute a manufacturer's manual "
            "to it. Tell me the make and model — or the asset tag — and I can cite "
            "the right documentation.)_"
        )
        return out

    who = f"a verified {expected_vendor}" if expected_vendor else "a verified manufacturer"
    out += (
        f"\n\n_(Note: I removed a citation that pointed to a different manufacturer's "
        f"manual — the guidance above is not drawn from {who} source. Confirm against "
        f"your equipment's documentation before acting.)_"
    )
    return out


# Phrases that mean "this answer is technical and a citation is owed".
# Kept conservative so we don't warn on greetings, clarifying questions, or
# short reflective turns.
_TECHNICAL_REPLY_RE = re.compile(
    r"(parameter|fault code|set\s+to\s+\d|torque|current\s*limit|voltage|"
    r"frequency|\d+\s*(?:hz|v|kv|a|ma|rpm|°c|°f|psi|nm|kw|w)|"
    r"replace|wiring|terminal|relay|breaker|contactor|overload|"
    r"check\s+(?:the|wiring|fuse|voltage|continuity)|measure|verify|"
    r"reset|de-energize|lockout)",
    re.IGNORECASE,
)

_TECHNICAL_FSM_STATES = frozenset({"DIAGNOSIS", "FIX_STEP"})

# #3213 — the canonical "I have nothing for this equipment" admissions. A reply
# built around one of these must never simultaneously present [Source:]
# evidence: the staging judge correctly hard-failed such a reply as a
# hallucinated source (run 31662003031, oem-model-fault-powerflex-f004, 4/4
# independent draws). Deliberately scoped to the WHOLE-EQUIPMENT admissions the
# system itself defines (rag_worker rule 16, the H4 stock admission, the kiosk
# direct-answer phrasing) — a partial admission about one aspect ("I don't have
# documentation for the brake circuit, but…") must keep its legitimate
# citations, so free-form phrasings are intentionally NOT matched.
_NO_DOCS_ADMISSION_RE = re.compile(
    r"i\s+(?:don'?t|do\s+not)\s+have\s+(?:any\s+)?(?:specific\s+)?documentation\s+"
    r"(?:for\s+(?:this|that)\s+equipment"
    r"|indexed\s+for\s+this"
    r"|for\s+that\s+in\s+my\s+records)",
    re.IGNORECASE,
)


def is_no_docs_admission(reply: str) -> bool:
    """True when the reply contains a canonical whole-equipment no-docs admission."""
    return bool(_NO_DOCS_ADMISSION_RE.search(reply or ""))


def check_citation_compliance(
    reply: str,
    kb_status: dict | None,
    *,
    fsm_state: str = "",
    chat_id: str = "",
    uns_context: dict | None = None,
    established_text: str = "",
    enforce: bool = False,
    chunks: list[dict] | None = None,
    current_text: str | None = None,
) -> dict:
    """Inspect a final LLM reply for inline ``[Source: ...]`` citations.

    ``chunks`` (optional) is THIS turn's retrieved chunk snapshot. With it, a tag
    is also judged on provenance — does the document it names mention the
    catalog identifier the technician typed (#3049). Without it the gate is
    exactly the label-based one.

    Citation is *required* when:
      * the KB returned chunks (``kb_status['status']`` is ``covered`` or
        ``partial``) — meaning the LLM had docs to cite, AND
      * the reply contains technical advice (parameter values, fault codes,
        wiring instructions, electrical specs, action verbs like
        "replace/measure/reset"), OR the FSM is in a diagnostic state where
        every reply should be grounded.

    The check NEVER blocks the response — it only emits a structured log line.

    Returns a dict suitable for telemetry::

        {
            "required":  bool,
            "present":   bool,
            "tag_count": int,
            "kb_status": str,
        }
    """
    status = (kb_status or {}).get("status", "unknown")
    technical_state = fsm_state in _TECHNICAL_FSM_STATES
    technical_reply = bool(_TECHNICAL_REPLY_RE.search(reply or ""))
    required = status in ("covered", "partial") and (technical_state or technical_reply)

    tags = CITATION_TAG_RE.findall(reply or "")
    present = bool(tags)

    # Relevance: is the cited vendor the resolved manufacturer? (P0-3)
    expected_mfr = (
        (uns_context or {}).get("manufacturer") if isinstance(uns_context, dict) else None
    )
    rel = evaluate_citation_relevance(
        reply or "", expected_mfr, established_text, chunks, current_text=current_text
    )

    result = {
        "required": required,
        "present": present,
        "tag_count": len(tags),
        "kb_status": status,
        "relevant": rel["relevant"],
        "expected_vendor": rel["expected_vendor"],
        "cited_vendors": rel["cited_vendors"],
        "sanitized_reply": None,
    }

    if required and not present:
        logger.warning(
            "CITATION_COMPLIANCE_MISS chat_id=%s kb_status=%s fsm=%s "
            "reply_len=%d — technical reply without [Source:] tag",
            chat_id,
            status,
            fsm_state,
            len(reply or ""),
        )
    elif required and present:
        logger.info(
            "CITATION_COMPLIANCE_OK chat_id=%s kb_status=%s fsm=%s tags=%d",
            chat_id,
            status,
            fsm_state,
            len(tags),
        )

    if not rel["relevant"]:
        logger.warning(
            "CITATION_RELEVANCE_MISS chat_id=%s reason=%s expected=%s cited=%s — %s",
            chat_id,
            rel["reason"],
            rel["expected_vendor"],
            rel["cited_vendors"],
            {
                "conflict": "cited source(s) name a different manufacturer than the resolved asset",
                "unproven": "cited document does not mention the unit the technician named",
            }.get(
                rel["reason"],
                "cited a manufacturer for a machine the conversation never established",
            ),
        )
        if enforce:
            result["sanitized_reply"] = strip_conflicting_citations(
                reply or "",
                rel["conflicting_tags"],
                rel["expected_vendor"],
                rel["reason"],
            )

    # D3 — eligibility: strip tags whose label is a session artifact, never a
    # document. Applied on top of any relevance strip; a reply left with no
    # citation then receives the H4 admission downstream instead of shipping
    # confidently-cited junk (eval case 6).
    ineligible_tags = [t for t in tags if ineligible_source_reason(_tag_label(t)) is not None]
    if ineligible_tags:
        logger.warning(
            "CITATION_ELIGIBILITY_MISS chat_id=%s tags=%d reasons=%s",
            chat_id,
            len(ineligible_tags),
            sorted({ineligible_source_reason(_tag_label(t)) for t in ineligible_tags}),
        )
        if enforce:
            base = result["sanitized_reply"] or (reply or "")
            result["sanitized_reply"] = strip_conflicting_citations(
                base, ineligible_tags, None, "ineligible"
            )

    # #3213 — admission conflict: a reply that says it has no documentation for
    # this equipment must not present [Source:] evidence in the same breath.
    # Whatever tag it carries (model-copied from an irrelevant retrieved chunk,
    # or surviving the passes above) is stripped wholesale — the admission wins.
    if present and is_no_docs_admission(reply or ""):
        logger.warning(
            "CITATION_ADMISSION_CONFLICT chat_id=%s tags=%d — no-docs admission "
            "carried a [Source:] citation; stripping (issue #3213)",
            chat_id,
            len(tags),
        )
        if enforce:
            base = result["sanitized_reply"] or (reply or "")
            remaining = CITATION_TAG_RE.findall(base)
            if remaining:
                result["sanitized_reply"] = strip_conflicting_citations(
                    base, remaining, None, "admission_conflict"
                )

    # Labels removed by ANY enforcement strip this turn — threaded to the
    # salvage rewrite as disallowed_labels so a just-stripped citation cannot
    # be re-inserted (the strip-then-reinsert loop observed live on
    # photo-less-ocr-claim in the same #3213 staging run).
    if enforce and result["sanitized_reply"] is not None:
        before = _emitted_labels(reply or "")
        after = _emitted_labels(result["sanitized_reply"])
        result["stripped_labels"] = sorted(before - after)
    else:
        result["stripped_labels"] = []

    return result


# ---------------------------------------------------------------------------
# Enforce-mode: insertion-only second-pass citation rewrite (#1659)
# ---------------------------------------------------------------------------
#
# `check_citation_compliance` (above) only *observes*. The H4 enforcer in
# engine.py guarantees an uncited reply never reaches the user — but it does so
# by appending a stock "I don't have docs" admission. That is the WRONG outcome
# in the false-negative case: the KB *did* return chunks and the LLM answered
# correctly, it just dropped the inline `[Source:]` tag. Telling the technician
# "no docs" there is misleading and fails the beta gate.
#
# This helper salvages exactly that case with one INSERTION-ONLY second pass:
# re-ask the LLM to return the same answer verbatim with `[Source: <label>]`
# tags inserted, then validate the result. It NEVER changes content and NEVER
# invents a citation — any failure falls back to the original reply, so the H4
# admission still fires downstream. It is therefore safe by construction.

_LABEL_RE = re.compile(r"\[Source:\s*(.+?)\s*\]", re.IGNORECASE)
_WORD_RE = re.compile(r"\w+")

_REWRITE_SYSTEM = (
    "You are a citation formatter for maintenance answers. You are given an "
    "answer and the reference sources it was based on. Return the answer "
    "VERBATIM with one or more inline [Source: <label>] tags inserted next to "
    "the facts they support.\n"
    "Hard rules:\n"
    "1. Change no other character — identical wording, numbers, units, and order.\n"
    "2. Use ONLY the exact labels under AVAILABLE SOURCES. Never invent, alter, "
    "abbreviate, or reformat a label.\n"
    "3. Insert at least one [Source: ...] tag.\n"
    "Output only the answer text with the tags — no preamble, no explanation."
)


def valid_source_labels(chunks: list[dict] | None) -> set[str]:
    """The set of citation labels that legitimately back a reply.

    Built from the retrieved chunks via ``format_source_label`` — the SAME
    function the prompt builders use to wrap chunks — so a rewrite can only
    cite a source that was actually retrieved. Chunks with no usable metadata
    contribute no label (never an empty-string label).
    """
    labels: set[str] = set()
    for chunk in chunks or []:
        label = format_source_label(chunk)
        # D3: session-artifact labels are excluded so the insertion-only
        # salvage can never introduce a photo-filename citation.
        if label and ineligible_source_reason(label) is None:
            labels.add(label)
    return labels


def _emitted_labels(text: str) -> set[str]:
    return {m.group(1).strip() for m in _LABEL_RE.finditer(text or "")}


def _strip_source_tags(text: str) -> str:
    return CITATION_TAG_RE.sub("", text or "")


def _content_preserved(original: str, rewritten: str) -> bool:
    """True when the rewrite differs from the original ONLY by [Source:] tags.

    Compares the multiset (``Counter``) of word tokens after stripping every
    ``[Source:…]`` tag. Multiset (not set) equality so a dropped or altered
    word — e.g. ``60Hz`` → ``50Hz`` — is caught, not just reordering.
    """
    orig = Counter(_WORD_RE.findall(_strip_source_tags(original).lower()))
    new = Counter(_WORD_RE.findall(_strip_source_tags(rewritten).lower()))
    return orig == new


def _build_rewrite_messages(reply: str, labels: set[str]) -> list[dict]:
    sources = "\n".join(f"- {label}" for label in sorted(labels))
    user = (
        f"AVAILABLE SOURCES (use these exact labels only):\n{sources}\n\n"
        f"ANSWER TO TAG (return verbatim with [Source: ...] tags inserted):\n{reply}"
    )
    return [
        {"role": "system", "content": _REWRITE_SYSTEM},
        {"role": "user", "content": user},
    ]


async def enforce_citation_via_rewrite(
    reply: str,
    chunks: list[dict] | None,
    kb_status: dict | None,
    *,
    fsm_state: str = "",
    chat_id: str = "",
    llm_call: Callable[[list[dict]], Awaitable[str]],
    disallowed_labels: set[str] | None = None,
    uns_context: dict | None = None,
    established_text: str = "",
    current_text: str | None = None,
) -> str:
    """Salvage an uncited-but-grounded technical reply via one insertion-only pass.

    Returns the rewritten (cited) reply only when ALL hold:
      * a citation is *required* and *absent* (``check_citation_compliance``),
      * the KB actually returned citable chunks (``valid_source_labels`` non-empty),
      * the rewrite emits ≥1 tag and every emitted label is a real chunk label,
      * the rewrite preserves the original content (tags-only diff).

    Otherwise returns the ORIGINAL ``reply`` unchanged — the H4 enforcer then
    appends its KB-gap admission downstream. Never raises: a failing/​erroring
    ``llm_call`` falls back to the original reply (fail-open).
    """
    # #3213 — an admission of having no documentation is NOT an "uncited-but-
    # grounded technical reply"; stamping a retrieved chunk's label onto it
    # manufactures evidence the reply itself disclaims. Never salvage it.
    if is_no_docs_admission(reply):
        logger.info("CITATION_REWRITE_SKIP_ADMISSION chat_id=%s", chat_id)
        return reply

    compliance = check_citation_compliance(reply, kb_status, fsm_state=fsm_state, chat_id=chat_id)
    if not compliance["required"] or compliance["present"]:
        return reply

    labels = valid_source_labels(chunks)
    # #3213 — a label the relevance/eligibility/admission gates stripped THIS
    # turn was already judged unpresentable; re-inserting it here silently
    # undoes the strip (observed live: photo-less-ocr-claim, run 31662003031).
    if disallowed_labels:
        labels -= set(disallowed_labels)
    # #3049 — subtracting only the labels just stripped is not enough: the gate
    # strips the AutomationDirect tag and the salvage re-tags with the Siemens one.
    # Offer only labels the relevance gate would itself let through on this turn.
    # With no context (legacy callers) the gate has nothing to judge — unchanged.
    if established_text or uns_context:
        expected = (
            (uns_context or {}).get("manufacturer") if isinstance(uns_context, dict) else None
        )
        labels = {
            label
            for label in labels
            if evaluate_citation_relevance(
                f"[Source: {label}]", expected, established_text, chunks, current_text=current_text
            )["relevant"]
        }
    if not labels:
        return reply  # nothing legitimate to cite — leave it to the H4 admission

    try:
        rewritten = (await llm_call(_build_rewrite_messages(reply, labels)) or "").strip()
    except Exception:
        logger.warning(
            "CITATION_REWRITE_LLM_ERROR chat_id=%s — keeping original reply",
            chat_id,
            exc_info=True,
        )
        return reply

    if not rewritten:
        return reply

    emitted = _emitted_labels(rewritten)
    if not emitted or not emitted <= labels:
        logger.info(
            "CITATION_REWRITE_REJECT_LABEL chat_id=%s emitted=%r valid=%r",
            chat_id,
            sorted(emitted),
            sorted(labels),
        )
        return reply

    if not _content_preserved(reply, rewritten):
        logger.warning(
            "CITATION_REWRITE_REJECT_DRIFT chat_id=%s — content changed beyond tag insertion",
            chat_id,
        )
        return reply

    logger.info("CITATION_REWRITE_OK chat_id=%s labels=%d", chat_id, len(emitted))
    return rewritten
