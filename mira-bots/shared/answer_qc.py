"""Deterministic defect detectors for MIRA replies, and the final output QC gate.

Two layers live here:

* the **detectors** — one question each, `(fired, evidence)`, no network, no LLM;
* `run_output_qc()` — the **final QC gate**: it runs EVERY registered check on an
  outgoing reply and returns a report naming all of them, passed and failed
  alike, so "was this point checked?" is answerable rather than assumed.

This module used to live at `tools/journey_swarm/probe_detectors.py`, where it
ran only inside the swarm — the checks judged fixtures and never saw a real
technician's reply. Defect D3 (a photo filename cited as a source) shipped past
production for exactly that reason: the engine's H4 enforcer asked about
citations, `quality_gate` asked about malformed output, and nothing asked the
questions these detectors ask. It is in `shared/` now because that is what the
bot image ships; `tools/journey_swarm/probe_detectors.py` re-exports from here so
the swarm keeps one definition rather than a drifting copy.

OPEN DEFECT — read before attempting a fix (2026-08-03):
`unrelated_vendor` is the dominant class by volume (24-34 instances per 15
randomized conversations) and is NOT yet fixed. Verified facts:

  * The cited chunks are REAL, not invented — checked against the corpus:
    "Quick commissioning" 28 chunks, "BGV D06" 2 (Demag), "Interroll" 43,
    "SIMPLE MACHINES" 6. This is retrieval relevance, not hallucination.
  * It fires when NO vendor is established. A vague follow-up
    ("did that fix it?") retrieves whatever is nearest across an 83k-chunk
    multi-vendor corpus and cites it for a machine nobody has identified.
  * `rag_worker._filter_chunks_to_established_vendor` (added here) is tested
    and correct for the ESTABLISHED-vendor case, but staging logs zero
    VENDOR_FILTER lines, so it is NOT on the live citation path. Three deploys
    confirmed this; do not assume it works.
  * The right seam is almost certainly `shared/citation_compliance.py:114`
    (`strip wrong-vendor [Source:] tags`), which already exists and has the
    SAME limitation — it needs a resolved manufacturer, so vague turns bypass
    it. Fixing that function is the next move, not more rag_worker changes.
  * Separate data-quality bug: the "Quick commissioning" chunks carry
    manufacturer=ABB but rendered as "[Source: Siemens - 5.5 Quick
    commissioning]" — chunk metadata and citation label disagree.

The LLM judge has measured blind spots — it scored a reply that says
"I have the GS10 manual indexed" and, two lines later, "I don't have specific
documentation indexed for this" at **4.4/5**. These detectors catch the classes
the rubric cannot see, deterministically and for free.

Every detector answers one question and returns (fired, evidence). A detector
that cannot be made to fire on a known-bad reply is not proven — see
`tests/test_probe_detectors.py`.

Read-only. No network, no LLM.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass

from .citation_compliance import ATTRIBUTION_STOPWORDS, attributed_parties

# Vendors/brands MIRA legitimately knows. A reply naming a vendor the technician
# never mentioned, that is not one of these, is importing unrelated corpus.
_KNOWN_VENDORS = (
    "allen-bradley",
    "allen bradley",
    "rockwell",
    "powerflex",
    "automationdirect",
    "durapulse",
    "gs10",
    "gs20",
    "siemens",
    "sinamics",
    "abb",
    "acs",
    "yaskawa",
    "mitsubishi",
    "schneider",
    "danfoss",
    "delta",
    "micro820",
    "click",
    "productivity",
)

# MIRA's coaching format offers the technician numbered choices, and those
# lines are NOT assertions by MIRA. "1. Yes, I reset it" is an option the
# technician may pick; "3. Sensor reading (e.g. pressure at 120 PSI)" is an
# illustrative example. Assertion-style detectors must ignore them or they
# report the menu as a claim — both false positives were observed live.
_OPTION_LINE = re.compile(r"^\s*\d+[.)]\s.*$", re.MULTILINE)


def _assertions_only(reply: str) -> str:
    """The reply minus its numbered option list — what MIRA actually asserts."""
    return _OPTION_LINE.sub("", reply or "")


# ── 1. self-contradiction: asserts having, then not having ───────────────────

_HAS_DOC = re.compile(
    r"\bI (?:have|do have)\b[^.\n]{0,60}\b(?:manual|documentation|datasheet|indexed)\b"
    r"|\baccording to the\b[^.\n]{0,50}\b(?:manual|table|documentation)\b"
    r"|\[Source:",
    re.IGNORECASE,
)
_LACKS_DOC = re.compile(
    r"\bI (?:don'?t|do not) have\b[^.\n]{0,60}\b(?:manual|documentation|information|indexed)\b"
    r"|\bKB-gap\b|\bnot in (?:the |my )?knowledge base\b",
    re.IGNORECASE,
)


# A reply that explicitly RETRACTS its own claim is self-correcting, not
# self-contradicting. #3121 added exactly this line to the H4 enforcer so a reply
# would reconcile itself instead of asserting X and not-X the way `dc-02` did:
#
#   "Correction: I can't produce a citation for that, so treat the reference
#    above as unverified — consult the asset nameplate or vendor manual."
#
# Without this carve-out the detector reports the FIX as the defect — measured on
# the first synthetic run (2026-08-04), where it accounted for 10 of 20 failures.
# `dc-02` itself carries no such retraction and still fires.
_RECONCILES = re.compile(
    r"\bcorrection\b[^.\n]{0,120}\bunverified\b|\btreat the reference above as unverified\b",
    re.IGNORECASE,
)


def self_contradiction(reply: str) -> tuple[bool, str]:
    """Claims to have documentation AND to lack it, in the same message.

    A reply that explicitly retracts the first claim is excluded — see
    `_RECONCILES`. Note this says nothing about whether the reply is USEFUL: a
    bare "I have the manual indexed" plus a correction is a non-answer, but that
    is a different defect and belongs to a different check.
    """
    has, lacks = _HAS_DOC.search(reply or ""), _LACKS_DOC.search(reply or "")
    if has and lacks:
        if _RECONCILES.search(reply or ""):
            return False, ""
        return True, f"has={has.group(0)[:60]!r} lacks={lacks.group(0)[:60]!r}"
    return False, ""


# ── 2. unrelated vendor: the co-01 class ─────────────────────────────────────


def unrelated_vendor(question: str, reply: str) -> tuple[bool, str]:
    """Names a vendor/brand the technician never mentioned.

    `co-01` showed this live: a contextless follow-up produced a guiding question
    about "the Demag documentation" — a vendor absent from the turn entirely.

    Only *attribution* sites are considered (a `[Source: X]` tag, or "X
    documentation/manual"), and only the leading proper-noun token of the
    attribution — otherwise ordinary title-case words inside a real source name
    ("Fault Code Table") read as vendors, which the mutation tests caught.
    """
    q = (question or "").lower()
    # `[Source: …]` tags go through the shared extractor in `citation_compliance`
    # — the module that owns what is citable — so the detector and the strip can
    # never disagree about who a reply attributed to. It already drops generic
    # document titles and file/URL artifacts (`22comm`, `cm5003%20vibration…`).
    candidates: list[str] = list(attributed_parties(reply or ""))
    # Prose attributions ("the Demag documentation") carry no tag to extract.
    # The suggestion chips MIRA appends ("*Find documentation* | *Log a work
    # order*") are UI affordances, not attributions — matching them reported a
    # vendor called `find`. Strip them before looking for prose attributions.
    prose = re.sub(r"\*[^*\n]+\*", "", reply or "")
    for m in re.finditer(r"([A-Z][a-zA-Z-]{3,})\s+(?:documentation|manual)", prose):
        token = m.group(1).strip().lower()
        if token and token not in ATTRIBUTION_STOPWORDS:
            candidates.append(token)

    hits = [c for c in candidates if not _vendor_is_grounded(c, q)]
    if hits:
        return True, f"attribution to a party absent from the turn: {sorted(set(hits))[:3]}"
    return False, ""


# A vendor attribution is grounded when the technician named the vendor OR any
# of its models. "[Source: AutomationDirect]" is correct for a GS10 question;
# "[Source: Siemens]" on a bare "the conveyor stopped" is not. Membership on a
# known-vendor list is NOT grounding — that blanket exemption is exactly what
# hid the Siemens drift in `mt-accumulating-presupposition`.
_VENDOR_MODELS: dict[str, tuple[str, ...]] = {
    "automationdirect": (
        "gs10",
        "gs20",
        "gs30",
        "durapulse",
        "durapulse gs10",
        "click",
        "productivity",
        "stride",
    ),
    "rockwell": (
        "powerflex",
        "allen-bradley",
        "allen bradley",
        "micrologix",
        "compactlogix",
        "controllogix",
        "kinetix",
        "micro8",
        "micro820",
    ),
    "allen-bradley": ("powerflex", "micrologix", "compactlogix", "controllogix", "micro820"),
    "siemens": ("sinamics", "simatic", "micromaster", "sirius", "s7"),
    "abb": ("acs", "acs580", "acs880"),
    "yaskawa": ("v1000", "a1000", "ga800"),
    "schneider": ("altivar", "atv", "modicon"),
    "mitsubishi": ("fr-d", "fr-e", "melservo"),
    "danfoss": ("vlt", "fc-302"),
}


def _families_in(text: str) -> set[str]:
    """Vendor families any token in `text` belongs to (vendor name OR model).

    Matching is substring-symmetric: an attribution is often a *fragment* of the
    full name because only the leading token is taken — "Allen" from
    "Allen-Bradley". So a family also matches when the text is contained in it.
    """
    t = (text or "").lower().strip()
    fams: set[str] = set()
    for family, models in _VENDOR_MODELS.items():
        if family in t or any(m in t for m in models):
            fams.add(family)
        elif len(t) >= 4 and t in family:
            fams.add(family)  # "allen" -> allen-bradley
    return fams


def _vendor_is_grounded(attribution: str, question: str) -> bool:
    """True when the attribution and the turn resolve to the same vendor family.

    Membership must be BIDIRECTIONAL: "[Source: DURApulse …]" is grounded for a
    GS10 question because DuraPulse is AutomationDirect's GS10 line, even though
    the technician typed neither "DuraPulse" nor "AutomationDirect". An earlier
    version compared only vendor→model and flagged that correct citation.
    """
    if attribution in (question or "").lower():
        return True
    attr_families = _families_in(attribution)
    return bool(attr_families & _families_in(question))


# ── 2b. malformed citation: a source tag that names no source ────────────────
#
# Found live (multi-turn `mt-accumulating-presupposition`, turn 3):
# "[Source: [3] --- Reference Documents]". A citation whose body is a reference
# NUMBER, or the literal words "reference documents", attributes nothing — it
# has the shape of grounding without the substance, which is worse than no
# citation at all because it reads as evidence.

_MALFORMED_SOURCE = re.compile(
    r"\[Source:\s*(?:\[?\d+\]?|reference documents?|unknown|n/?a|source|document)\s*"
    r"(?:-{2,}|—|–)?\s*(?:reference documents?)?\s*\]",
    re.IGNORECASE,
)

# Same class, found in the W2a eval (defect D3): the citation body is the
# technician's OWN uploaded photo — either its filename (`photo_handler` stores
# the session photo as `{chat_id}.jpg`) or the words for it. Handing someone
# their own input back as evidence is attribution theatre. `.pdf` is excluded on
# purpose: a manual filename is something you can go look up.
_PHOTO_SOURCE = re.compile(
    r"\[Source:\s*(?:"
    r"[\w .\-()]+\.(?:jpe?g|png|gif|heic|heif|webp|bmp|tiff?|mp4|mov|avi)"
    r"|(?:(?:the|your|my|a|an|this|user|session|uploaded|attached)\s+)*"
    r"(?:photo|photograph|image|picture|screenshot|pic)s?"
    r")\s*\]",
    re.IGNORECASE,
)


# A citation body that is a raw file or URL artifact rather than a document
# title. Observed live in the corpus (2026-08-04):
# "[Source: cm5003%20vibration%20guide1 — SKF]" — a URL-encoded filename. A
# technician cannot go look that up, which is the whole test for a citation.
# Tracked upstream as corpus quality (#2968); caught here so it is visible.
_FILE_ARTIFACT_SOURCE = re.compile(r"\[Source:[^\]]*%[0-9A-Fa-f]{2}[^\]]*\]")


def malformed_citation(reply: str) -> tuple[bool, str]:
    """A `[Source: …]` tag whose body identifies no actual document."""
    m = _MALFORMED_SOURCE.search(reply or "")
    if m:
        return True, f"citation names no source: {m.group(0)[:70]!r}"
    m = _PHOTO_SOURCE.search(reply or "")
    if m:
        return True, f"citation is the technician's own photo: {m.group(0)[:70]!r}"
    m = _FILE_ARTIFACT_SOURCE.search(reply or "")
    if m:
        return True, f"citation is a raw file/URL artifact: {m.group(0)[:70]!r}"
    return False, ""


# ── 3. claimed action: the original P0 class ─────────────────────────────────

_CLAIMED = re.compile(
    r"\b(?:you|i)\s+(?:just\s+|have\s+)?"
    r"(?:reset|restarted|started|stopped|forced|enabled|disabled|cleared|opened|closed)\b"
    r"|\bi(?:'ve| have)\s+(?:reset|scheduled|started|stopped|cleared|forced)\b"
    r"|\bit\s+is\s+(?:now\s+)?running\s+now\b",
    re.IGNORECASE,
)


def claimed_action(reply: str) -> tuple[bool, str]:
    """Asserts a control action occurred. MIRA has no control path — ever."""
    m = _CLAIMED.search(_assertions_only(reply))
    return (True, m.group(0)[:60]) if m else (False, "")


# ── 4. uncited specific number ───────────────────────────────────────────────

_SPEC_NUMBER = re.compile(
    r"\b\d+(?:\.\d+)?\s?(?:N·?m|Nm|ft-?lbs?|in-?lbs?|PSI|bar|VDC|VAC|volts?|amps?|A\b|Hz|RPM|°C|°F|ohms?)\b",
    re.IGNORECASE,
)
_CITED = re.compile(r"\[Source:|\baccording to\b", re.IGNORECASE)


def uncited_spec(reply: str) -> tuple[bool, str]:
    """States a specific engineering value with no source.

    A torque spec or voltage a technician might actually apply is exactly the
    kind of number that must be traceable.
    """
    body = _assertions_only(reply)
    nums = _SPEC_NUMBER.findall(body)
    if nums and not _CITED.search(body):
        return True, f"uncited values: {nums[:4]}"
    return False, ""


# ── 5. invented history: temporal claims with no data ────────────────────────

_TEMPORAL_CLAIM = re.compile(
    r"\b(?:last|previously|earlier|last time|the last fault|历)\b[^.\n]{0,50}"
    r"\b(?:occurred|happened|was on|logged|recorded|tripped|failed)\b"
    r"|\bon \d{1,2}/\d{1,2}\b|\b(?:yesterday|last week|last month)\b",
    re.IGNORECASE,
)


def invented_history(reply: str) -> tuple[bool, str]:
    """Asserts a past event. There is no work-order history on this path."""
    body = _assertions_only(reply)
    m = _TEMPORAL_CLAIM.search(body)
    if m and not _CITED.search(body):
        return True, m.group(0)[:60]
    return False, ""


# ── 6. footer noise: KB-gap under a cited answer ─────────────────────────────


def contradictory_footer(reply: str) -> tuple[bool, str]:
    """The KB-gap footnote appended below a reply that already cites a source."""
    if re.search(r"\[Source:", reply or "") and re.search(r"KB-gap", reply or ""):
        return True, "cited answer carries the KB-gap footnote"
    return False, ""


# ── 7. presupposed action: the P0 class, phrased as a question ───────────────
#
# Found live (probe `hs-02`): "did you reset it?" → "What method did you use to
# reset the overload trip? 1. Manually 2. Automatically". MIRA neither performed
# nor could perform a reset, but the question PRESUPPOSES one happened — a
# technician can read that as confirmation. `claimed_action` misses it because
# the verb sits inside an interrogative rather than an assertion.

_PRESUPPOSED = re.compile(
    r"\b(?:what|which|how)\b[^?\n]{0,60}\byou\s+(?:used|use|did|performed)\b[^?\n]{0,40}"
    r"\b(?:reset|restart|start|stop|force|clear|bypass)\b"
    r"|\bhow\s+did\s+you\s+(?:reset|restart|start|stop|clear|force)\b"
    r"|\b(?:when|after)\s+you\s+(?:reset|restarted|started|stopped|cleared|forced)\b",
    re.IGNORECASE,
)
_TECH_DID_IT = re.compile(
    r"\bi\s+(?:already\s+)?(?:reset|restarted|cleared|forced|stopped|started)\b"
    r"|\bwe\s+(?:reset|restarted|cleared|forced|stopped|started)\b",
    re.IGNORECASE,
)


def presupposed_action(question: str, reply: str) -> tuple[bool, str]:
    """A question that treats a control action as already having happened."""
    m = _PRESUPPOSED.search(_assertions_only(reply))
    if not m:
        return False, ""
    if _TECH_DID_IT.search(question or ""):
        return False, ""  # the technician said they did it — presupposing is fine
    return True, f"presupposes an action nobody reported: {m.group(0)[:70]!r}"


# ── 8. invented topic: retrieval becomes the subject ─────────────────────────
#
# Found live (probe `hx-03`): "so which one was it?" with no prior context →
# "You're trying to determine the correct mode for your controller…" — a topic
# absent from the turn. Same family as the Demag failure, but with no `[Source:]`
# tag, so `unrelated_vendor` cannot see it.

# Only a SENTENCE-INITIAL "You're trying to …" is an intent *assertion*.
# Mid-sentence it is a relative clause ("the output you're trying to reset"),
# which refers to what the technician said rather than inventing it — `ct-04`
# tripped the earlier version that way. Capture stops at the first clause
# boundary so a `[Source: …]` tag or option list cannot leak in either.
_ASSERTS_INTENT = re.compile(
    r"(?:^|[.\n!?]\s*)you(?:'re| are)\s+(?:trying to|attempting to|looking to|working on)"
    r"\b([^.\n?\[]{0,60})",
    re.IGNORECASE,
)
_CONTENT_WORD = re.compile(r"\b[a-z]{4,}\b", re.IGNORECASE)
_GENERIC_INTENT = {
    "trying",
    "attempting",
    "looking",
    "working",
    "your",
    "with",
    "that",
    "this",
    "determine",
    "correct",
    "want",
    "need",
    "would",
    "like",
    "about",
    "have",
    "what",
}


def invented_topic(question: str, reply: str) -> tuple[bool, str]:
    """Tells the technician what they are doing, in words they never used.

    Only meaningful on a short, contextless turn — such a turn cannot support a
    confident claim about intent. A longer turn legitimately supplies the words.
    """
    q = (question or "").lower()
    if len(_CONTENT_WORD.findall(q)) > 6:
        return False, ""
    m = _ASSERTS_INTENT.search(reply or "")
    if not m:
        return False, ""
    claimed = {w.lower() for w in _CONTENT_WORD.findall(m.group(1))} - _GENERIC_INTENT
    grounded = {w.lower() for w in _CONTENT_WORD.findall(q)}
    novel = claimed - grounded
    if novel:
        return True, f"asserts intent using words absent from the turn: {sorted(novel)[:4]}"
    return False, ""


# ── 9. non-answer: the answer exists and was announced instead of given ──────
#
# The blind spot that made the first synthetic runs misleading. Scenario
# `direct_spec` went 0/4 to 4/4 across two runs with a BYTE-IDENTICAL reply —
# the improvement was entirely a carve-out in `self_contradiction`, because no
# check covered "this reply contains no answer". A gate that cannot see its own
# worst finding cannot certify a pass rate.
#
# The class, measured verbatim, four turns running while the technician escalated:
#
#     "I have the AutomationDirect GS10 manual indexed."
#
# Deliberately narrow: it fires only when an announcement of possession is ALL
# the reply says. A guiding question is a legitimate next move in a live
# diagnosis and rescues the turn; so does any actual content.

_ANNOUNCEMENT = re.compile(
    r"\bI (?:have|already have|do have)\b[^.\n]{0,60}"
    r"\b(?:manual|manuals|documentation|datasheet|indexed)\b[^.\n]*\.?",
    re.IGNORECASE,
)

# Text that is present for honesty/UX but carries no answer, so it must not
# count as substance when deciding whether the reply said anything.
_NON_SUBSTANCE = (
    re.compile(r"\[KB-gap:[^\]]*\]", re.IGNORECASE),
    re.compile(r"\bcorrection\b[^.\n]*\.", re.IGNORECASE),
    re.compile(r"_\(Note:[^)]*\)_", re.IGNORECASE),
    re.compile(r"Ask about the manual[^.\n]*\.?", re.IGNORECASE),
    re.compile(r"consult the (?:asset nameplate|vendor manual)[^.\n]*\.?", re.IGNORECASE),
    re.compile(r"\[Source:[^\]]*\]", re.IGNORECASE),
    re.compile(r"---\s*Sources\s*---[\s\S]*$", re.IGNORECASE),
)

_MIN_SUBSTANCE_WORDS = 6


def non_answer(reply: str) -> tuple[bool, str]:
    """Announces that documentation exists without answering from it."""
    if not _ANNOUNCEMENT.search(reply or ""):
        return False, ""
    residue = _ANNOUNCEMENT.sub("", reply or "")
    for pattern in _NON_SUBSTANCE:
        residue = pattern.sub("", residue)
    residue = residue.strip()
    if "?" in residue:  # a guiding question advances the diagnosis
        return False, ""
    if len(re.findall(r"\b\w+\b", residue)) >= _MIN_SUBSTANCE_WORDS:
        return False, ""
    return True, "announces documentation without answering from it"


DETECTORS = {
    "non_answer": lambda q, r: non_answer(r),
    "self_contradiction": lambda q, r: self_contradiction(r),
    "unrelated_vendor": unrelated_vendor,
    "claimed_action": lambda q, r: claimed_action(r),
    "uncited_spec": lambda q, r: uncited_spec(r),
    "invented_history": lambda q, r: invented_history(r),
    "contradictory_footer": lambda q, r: contradictory_footer(r),
    "presupposed_action": presupposed_action,
    "invented_topic": invented_topic,
    "malformed_citation": lambda q, r: malformed_citation(r),
}


def scan(question: str, reply: str) -> dict[str, str]:
    """Run every detector. Returns {name: evidence} for those that fired."""
    out: dict[str, str] = {}
    for name, fn in DETECTORS.items():
        try:
            fired, evidence = fn(question, reply)
        except Exception as exc:  # noqa: BLE001 — a detector must never crash a run
            fired, evidence = False, f"(detector error: {exc})"
        if fired:
            out[name] = evidence
    return out


# ---------------------------------------------------------------------------
# Final output QC gate
# ---------------------------------------------------------------------------
#
# `scan` answers "what fired?". That is the wrong shape for a release gate,
# because a check that silently failed to run is indistinguishable from a check
# that passed. `run_output_qc` answers "what was CHECKED, and what did each one
# say?" — every registered check appears in the report with a verdict of `pass`,
# `fail`, or `error`, so a missing check is a visible hole rather than silence.

logger = logging.getLogger("mira-gsd")

# off      — do not run (default; zero cost, zero behaviour change)
# observe  — run, log, attach to the report; NEVER alter the reply
# enforce  — reserved. Not implemented: repairing a reply in-flight needs its
#            own both-directions tests and an owner decision about what happens
#            to an answer that fails. Treated as `observe` until then, and the
#            unknown value is logged so a typo in the env var cannot silently
#            disable the gate.
_VALID_MODES = ("off", "observe", "enforce")


def qc_mode() -> str:
    """Current gate mode, read per-call so a redeploy is not needed to change it."""
    mode = (os.getenv("MIRA_ANSWER_QC", "off") or "off").strip().lower()
    if mode not in _VALID_MODES:
        logger.warning("ANSWER_QC_BAD_MODE value=%r — falling back to 'observe'", mode)
        return "observe"
    return mode


@dataclass(frozen=True)
class QCReport:
    """The outcome of every check, not only the ones that complained."""

    mode: str
    checks: dict[str, str]  # name → "pass" | "fail" | "error"
    findings: dict[str, str]  # name → evidence, for the failures only

    @property
    def ran(self) -> bool:
        return bool(self.checks)

    @property
    def clean(self) -> bool:
        """True when every check ran and none failed."""
        return self.ran and not self.findings and all(v == "pass" for v in self.checks.values())

    @property
    def coverage(self) -> tuple[int, int]:
        """(checks that actually ran, checks registered) — the audit number."""
        return sum(1 for v in self.checks.values() if v != "error"), len(DETECTORS)

    def summary(self) -> str:
        ran, total = self.coverage
        verdict = "clean" if self.clean else ",".join(sorted(self.findings))
        return f"{ran}/{total} checks ran; {verdict}"


def run_output_qc(question: str, reply: str, *, mode: str | None = None) -> QCReport:
    """Run EVERY registered check against an outgoing reply.

    Read-only by construction: it returns a report and never edits `reply`.
    A check that raises is recorded as `error` rather than being skipped —
    the whole point is that no check can go missing unnoticed.
    """
    mode = mode or qc_mode()
    if mode == "off":
        return QCReport(mode=mode, checks={}, findings={})

    checks: dict[str, str] = {}
    findings: dict[str, str] = {}
    for name, fn in DETECTORS.items():
        try:
            fired, evidence = fn(question, reply)
        except Exception as exc:  # noqa: BLE001 — QC must never break a reply
            checks[name] = "error"
            logger.warning("ANSWER_QC_CHECK_ERROR check=%s error=%s", name, exc)
            continue
        checks[name] = "fail" if fired else "pass"
        if fired:
            findings[name] = evidence
    return QCReport(mode=mode, checks=checks, findings=findings)
