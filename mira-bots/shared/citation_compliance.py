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


def established_context_text(message: str, state: dict | None) -> str:
    """Everything the conversation has actually established, as one string.

    Feeds the unsupported-attribution check: a vendor named here is fair game
    to cite, a vendor absent from it is being attributed to a machine nobody
    identified. Deliberately generous — this turn, the confirmed asset, the
    resolved UNS manufacturer/model, and the prior turns — because a false
    strip is worse than a missed one, and a vendor established in turn 1 must
    still license a citation in turn 6 (the drift case that motivated this).

    Never raises: a malformed state yields whatever could be read.
    """
    parts: list[str] = [message or ""]
    if not isinstance(state, dict):
        return parts[0]
    parts.append(str(state.get("asset_identified") or ""))
    ctx = state.get("context")
    if isinstance(ctx, dict):
        uns = ctx.get("uns_context")
        if isinstance(uns, dict):
            parts.append(str(uns.get("manufacturer") or ""))
            parts.append(str(uns.get("model") or ""))
        history = ctx.get("history")
        if isinstance(history, list):
            for turn in history:
                if isinstance(turn, dict):
                    parts.append(str(turn.get("content") or ""))
                elif isinstance(turn, str):
                    parts.append(turn)
    return " ".join(p for p in parts if p)


def _tag_label(tag: str) -> str:
    """Extract the label text from a '[Source: <label>]' tag."""
    inner = tag[1:-1] if tag.startswith("[") and tag.endswith("]") else tag
    return re.sub(r"(?i)^\s*source:\s*", "", inner).strip()


def evaluate_citation_relevance(
    reply: str,
    expected_manufacturer: str | None,
    established_text: str = "",
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
    elif not expected and cited and established_text:
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
        established = _vendors_in_text(established_text)
        unsupported = [
            t for t in tags if (cv := _canonical_vendor(_tag_label(t))) and cv not in established
        ]
        if unsupported:
            relevant = False
            reason = "unestablished"
            conflicting = unsupported

    return {
        "relevant": relevant,
        "reason": reason,
        "expected_vendor": expected,
        "cited_vendors": cited,
        "conflicting_tags": conflicting,
    }


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
    out = re.sub(r"[ \t]{2,}", " ", out).rstrip()

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


def check_citation_compliance(
    reply: str,
    kb_status: dict | None,
    *,
    fsm_state: str = "",
    chat_id: str = "",
    uns_context: dict | None = None,
    established_text: str = "",
    enforce: bool = False,
) -> dict:
    """Inspect a final LLM reply for inline ``[Source: ...]`` citations.

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
    rel = evaluate_citation_relevance(reply or "", expected_mfr, established_text)

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
            "cited source(s) name a different manufacturer than the resolved asset"
            if rel["reason"] == "conflict"
            else "cited a manufacturer for a machine the conversation never established",
        )
        if enforce:
            result["sanitized_reply"] = strip_conflicting_citations(
                reply or "",
                rel["conflicting_tags"],
                rel["expected_vendor"],
                rel["reason"],
            )

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
        if label:
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
    compliance = check_citation_compliance(reply, kb_status, fsm_state=fsm_state, chat_id=chat_id)
    if not compliance["required"] or compliance["present"]:
        return reply

    labels = valid_source_labels(chunks)
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
