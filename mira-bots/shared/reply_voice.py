"""Deterministic outbound voice guard — zero tokens, pure text transform.

Live defect (prod, 2026-08-16). A cascade reply ignored the JSON response
contract, so ``response_formatter.parse_response`` fell through to its
plain-text branch and the model's generic chat-assistant voice reached the
technician verbatim::

    parse_response fallback; raw="You are absolutely right! My apologies. I am
    unable to access external files or previous conversation history."

Three separate failures rode in on that one message:

1. **Sycophancy.** "You are absolutely right! My apologies." is not how a
   technician talks to a technician. The ban already exists — but only as
   prose inside a system prompt (``workers/rag_worker.py``: *Never say "Great
   question!"*). A model that has already ignored the response contract is not
   going to honour a tone rule in the same prompt. A prompt is not an
   enforcement layer.
2. **A FALSE capability claim.** "I am unable to access external files" is
   simply untrue of this platform: MIRA ingests PDFs, reads nameplate photos
   and queries an indexed corpus. The model was describing a generic hosted
   chat assistant, not itself, and the technician has no way to know that.
3. **A double admission.** The H4 enforcer
   (``engine.enforce_citation_or_gap_admission``) then appended its canned
   KB-gap line beneath the disclaimer, so one message told the technician
   twice, in two different voices, that it had nothing.

This module is the deterministic floor under all three — stable reasoning
exported as a text artifact rather than re-argued at inference time
(``.claude/rules/zero-token-architecture.md``). No I/O, no model call, no
imports beyond ``re``.

**Ordering.** ``sanitize_voice`` runs BEFORE the H4 enforcer. That is load
bearing, not incidental: :data:`GAP_ADMISSION` and every phrase in
:data:`GAP_MARKER_PHRASES` are deliberately worded so H4's own
``_H4_GAP_PHRASES`` check recognises them, so a reply that already admits a
gap — or that had a false capability claim rewritten into one here — never
earns a second, canned admission underneath. Running after H4 instead would
mean sentence-surgery on H4's own two-part admission block, which is the one
thing this module must not touch (``[KB-gap: …]`` is a marker other code
reads).
"""

from __future__ import annotations

import re
from collections.abc import Iterator

# --------------------------------------------------------------------------- #
# The one replacement line
# --------------------------------------------------------------------------- #

# What a false capability claim becomes. Terse, true of this platform, and it
# says what the technician can DO next. Deliberately contains two phrases from
# H4's `_H4_GAP_PHRASES` ("don't have specific documentation", "consult the
# asset nameplate") so H4 reads it as the turn's gap admission and stays quiet.
GAP_ADMISSION = (
    "I don't have specific documentation indexed for that — consult the asset"
    " nameplate or vendor manual, or send me the page and I'll read it."
)

# --------------------------------------------------------------------------- #
# Sycophancy
# --------------------------------------------------------------------------- #

# Filler that opens a sentence and carries no information. Every alternative
# must be followed by a clause boundary or the end of the sentence, so an
# ordinary adverb survives: "Absolutely necessary to lock out first." does not
# match (no punctuation after "absolutely"), "Absolutely! ..." does.
_SYCOPHANCY_RE = re.compile(
    r"^(?:"
    r"you(?:'re|\s+are|r)\s+"
    r"(?:absolutely\s+|completely\s+|totally\s+|100%\s+|quite\s+|entirely\s+)?"
    r"(?:right|correct)"
    r"|(?:my\s+)?apologies(?:\s+for\s+(?:the|that|any)[^.!?,;:]*)?"
    r"|i\s+(?:sincerely\s+|do\s+|must\s+)?apolog(?:ise|ize)"
    r"(?:\s+for\s+(?:the|that|any)[^.!?,;:]*)?"
    r"|i(?:'m|\s+am)\s+(?:so\s+|very\s+|really\s+|terribly\s+)?sorry"
    r"(?:\s+(?:about|for)\s+(?:that|the|any)[^.!?,;:]*)?"
    r"|sorry\s+about\s+that"
    r"|(?:that(?:'s|\s+is)\s+(?:a|such\s+a)\s+)?"
    r"(?:great|excellent|good|fantastic|interesting|very\s+good)\s+question"
    r"|thank(?:s|\s+you)?\s+for\s+(?:the|your|that)[^.!?,;:]*"
    r"|of\s+course"
    r"|certainly"
    r"|absolutely"
    r"|happy\s+to\s+help"
    r"|glad\s+to\s+help"
    r"|i\s+(?:completely\s+|totally\s+)?understand\s+(?:how|your)[^.!?,;:]*"
    r")"
    r"\s*(?:[,!.:;—–-]+\s*|$)",
    re.IGNORECASE,
)

# --------------------------------------------------------------------------- #
# False capability claims
# --------------------------------------------------------------------------- #

# The "I am a chatbot" tell. Enough on its own — there is no sentence in a
# maintenance answer that legitimately opens with it.
_AI_SELF_REF_RE = re.compile(
    r"\bas an ai(?:\s+(?:language\s+)?(?:model|assistant))?\b"
    r"|\bas a language model\b"
    r"|\bi(?:'m|\s+am)\s+(?:just\s+)?an\s+ai\b"
    r"|\bbeing an ai\b",
    re.IGNORECASE,
)

# An inability verb phrase...
_INABILITY_RE = re.compile(
    r"\bi(?:'m|\s+am)\s+(?:unable|not able)\s+to\b"
    r"|\bi\s+(?:cannot|can'?t|can not)\s+"
    r"(?:access|read|open|browse|retrieve|view|see|recall|remember|download|store)\b"
    r"|\bi\s+(?:do\s+not|don'?t)\s+have\s+(?:access\s+to|the\s+ability\s+to)\b"
    r"|\bi\s+(?:do\s+not|don'?t)\s+(?:retain|persist)\b",
    re.IGNORECASE,
)

# ...aimed at something this platform DOES do. Both halves are required, and
# the object list is deliberately narrow: it names the generic-assistant
# disclaimer subjects only. A turn-local limitation is a real, useful statement
# ("I can't see the fault code in the photo you sent") and must survive.
_DISCLAIMER_OBJECT_RE = re.compile(
    r"\bexternal\s+(?:files?|documents?|sources?|systems?|links?|urls?|websites?|data)\b"
    r"|\bthe\s+(?:internet|web)\b"
    r"|\breal[-\s]time\s+(?:data|information)\b"
    r"|\b(?:previous|prior|past|earlier)\s+(?:conversations?|messages?|sessions?|chats?)\b"
    r"|\b(?:conversation|chat|message)\s+history\b"
    r"|\bbrowse\s+the\b",
    re.IGNORECASE,
)

# --------------------------------------------------------------------------- #
# Gap admissions
# --------------------------------------------------------------------------- #

# Wording that constitutes "this reply already admits it has nothing".
#
# Every phrase here is a VERBATIM member of `engine._H4_GAP_PHRASES`, and
# `test_reply_voice.py` asserts the subset relation directly. That coupling is
# the whole point: a gap statement this module keeps must be one H4 also
# recognises, or collapsing the duplicates here would only move the second
# admission downstream. Copy phrases across, never paraphrase them.
GAP_MARKER_PHRASES: tuple[str, ...] = (
    "KB-gap:",
    "consult the asset nameplate",
    "consult the vendor manual",
    "not in the knowledge base",
    "not indexed",
    "no docs for",
    "not explicitly mentioned",
    "I don't have specific documentation",
    "not have specific documentation",
    "I do not have that specific information",
    "I don't have the specific",
    "have documentation for this equipment",
    "have documentation for that in my records",
)

# --------------------------------------------------------------------------- #
# Text mechanics
# --------------------------------------------------------------------------- #

# A bullet or enumerator prefix, kept verbatim so list structure survives.
_MARKER_RE = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+")

# Sentence boundary, capturing the separator so the original spacing between
# the sentences we KEEP is reproduced byte for byte.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])(\s+)")


def _segments(text: str) -> list[tuple[str, str]]:
    """Split ``text`` into ``(sentence, trailing_whitespace)`` pairs."""
    parts = _SENTENCE_SPLIT_RE.split(text)
    out: list[tuple[str, str]] = []
    for i in range(0, len(parts), 2):
        out.append((parts[i], parts[i + 1] if i + 1 < len(parts) else ""))
    return out


def _iter_sentences(reply: str) -> Iterator[str]:
    """Every sentence in ``reply``, bullet/enumerator markers removed."""
    for line in reply.split("\n"):
        if not line.strip():
            continue
        marker = _MARKER_RE.match(line)
        body = line[marker.end() :] if marker else line
        for sentence, _sep in _segments(body):
            if sentence.strip():
                yield sentence


def is_gap_statement(sentence: str) -> bool:
    """True when the sentence admits the knowledge base has nothing."""
    lowered = sentence.lower()
    return any(phrase.lower() in lowered for phrase in GAP_MARKER_PHRASES)


def gap_statement_count(reply: str) -> int:
    """How many sentences in ``reply`` admit a knowledge-base gap."""
    return sum(1 for sentence in _iter_sentences(reply) if is_gap_statement(sentence))


def is_capability_disclaimer(sentence: str) -> bool:
    """True when the sentence disclaims a capability this platform HAS."""
    if _AI_SELF_REF_RE.search(sentence):
        return True
    return bool(_INABILITY_RE.search(sentence) and _DISCLAIMER_OBJECT_RE.search(sentence))


def _strip_sycophancy(sentence: str) -> str | None:
    """Drop leading filler. ``None`` when nothing of substance is left.

    Leading filler is removed rather than the whole sentence, because a model
    will bolt an apology onto real content ("My apologies, the drive is a
    GS10.") and deleting the technical claim is a worse failure than the tone
    was.
    """
    lead_len = len(sentence) - len(sentence.lstrip())
    lead, core = sentence[:lead_len], sentence[lead_len:]
    for _ in range(3):  # "Of course! My apologies." arrives as one sentence too
        match = _SYCOPHANCY_RE.match(core)
        if not match:
            break
        core = core[match.end() :]
    if not core.strip():
        return None
    if core[:1].islower():
        core = core[0].upper() + core[1:]
    return lead + core


def _needs_sanitize(reply: str) -> bool:
    """Cheap pre-scan. False means the reply is returned byte-identical."""
    gaps = 0
    for sentence in _iter_sentences(reply):
        core = sentence.strip()
        if is_capability_disclaimer(core) or _SYCOPHANCY_RE.match(core):
            return True
        if is_gap_statement(core):
            gaps += 1
            if gaps > 1:
                return True
    return False


def sanitize_voice(reply: str) -> str:
    """Strip the assistant voice out of an outbound reply.

    Three deterministic edits, in this order, per sentence:

    1. a false capability claim becomes :data:`GAP_ADMISSION` (once);
    2. leading sycophancy is removed, and a sentence that was ONLY filler is
       dropped;
    3. a second and any later gap admission is dropped, so the technician is
       told once.

    Returns ``reply`` unchanged — byte for byte — when none of the three fire,
    which is the overwhelmingly common case. Never returns raw model prose that
    still carries a banned phrase, and never returns an empty string.
    """
    if not reply or not reply.strip() or not _needs_sanitize(reply):
        return reply

    out_lines: list[str] = []
    gap_seen = False

    for line in reply.split("\n"):
        if not line.strip():
            out_lines.append("")
            continue
        marker_match = _MARKER_RE.match(line)
        marker = marker_match.group(0) if marker_match else ""
        body = line[len(marker) :]

        kept: list[tuple[str, str]] = []
        for sentence, sep in _segments(body):
            core = sentence.strip()
            if not core:
                continue
            if is_capability_disclaimer(core):
                # The claim is false, so it is replaced rather than trimmed —
                # and only while the reply has not already admitted the gap.
                if gap_seen:
                    continue
                kept.append((GAP_ADMISSION, sep))
                gap_seen = True
                continue
            trimmed = _strip_sycophancy(sentence)
            if trimmed is None:
                continue
            if is_gap_statement(trimmed):
                if gap_seen:
                    continue
                gap_seen = True
            kept.append((trimmed, sep))

        if not kept:
            continue
        out_lines.append((marker + "".join(text + sep for text, sep in kept)).rstrip())

    result = re.sub(r"\n{3,}", "\n\n", "\n".join(out_lines)).strip()
    return result or GAP_ADMISSION
