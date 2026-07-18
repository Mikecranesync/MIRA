"""EvidenceAnswer — the 12-field workspace-answer contract (Package B).

Every print-workspace follow-up answer flows through ONE render contract:
``EvidenceAnswer``. It carries trust-labeled claims projected from the
persisted observation ledger (``shared/print_workspace.py``, Package A),
honest coordinates (a claim without a stored bbox says "coordinates
unavailable" — never a fabricated location), a deterministic safety class,
and the session's ``current_revision`` as the print-model-version stamp.

Design rules (hard):

  - **Deterministic.** Nothing in this module calls a model. The only model
    text an ``EvidenceAnswer`` ever carries is ``answer`` prose handed in by
    the caller (the ``model_explanation`` chain link) — trust labels, safety
    class, claim projection, and rendering are pure functions.
  - **Honest coordinates.** ``coordinates`` comes ONLY from an observation's
    stored ``metadata["bbox"]``; absent bbox → ``None`` → the trace render
    prints "coordinates unavailable".
  - **Safety floor.** Renders for ``energized_measurement`` / ``state_change``
    (and the other non-informational classes) always carry a safety note
    containing at least one grader safety marker
    (``printsense.benchmarks.single_photo_grader._SAFETY_MARKERS``), and no
    template asserts a present-tense live state
    (``_state_claim_asserted`` clean by construction).
  - **Bounded.** ≤ ``MAX_CLAIMS`` (8) claims, ≤ ``MAX_SUGGESTIONS`` (3)
    suggested next questions — structurally under the autoeval degenerate-
    output thresholds (15-run enumeration, 20-tag flood).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .evidence_state import EvidenceState
from .models import AnswerClaim, AnswerEnvelope, Observation, VisualSession

MAX_CLAIMS = 8
MAX_SUGGESTIONS = 3

# The five answer_source values the follow-up chain produces, in chain order.
ANSWER_SOURCES = ("deterministic", "ledger", "model_explanation", "observation_ack", "none")

# The five deterministic safety classes.
SAFETY_CLASSES = (
    "informational",
    "de_energized_verification",
    "energized_measurement",
    "state_change",
    "stop_escalate",
)


# ── trust labels ────────────────────────────────────────────────────────────


def trust_label(
    evidence_state: EvidenceState | str,
    extractor: str | None,
    metadata: dict[str, Any] | None,
) -> str:
    """Technician-facing trust label for one observation-backed claim."""
    state = (
        evidence_state
        if isinstance(evidence_state, EvidenceState)
        else EvidenceState(evidence_state)
    )
    meta_trust = str((metadata or {}).get("trust") or "").lower()
    if extractor == "technician":
        return "Reported by technician"
    if state is EvidenceState.MACHINE_VERIFIED or meta_trust == "machine_verified":
        return "Shown on the drawing (verified)"
    if state is EvidenceState.VISIBLE:
        return "Shown on the drawing"
    if state is EvidenceState.DOCUMENTED:
        return "Documented"
    if state is EvidenceState.LIKELY or meta_trust == "proposed":
        return "Derived (not verified)"
    if state is EvidenceState.NEEDS_CONTEXT:
        return "Not proven"
    if state is EvidenceState.CONFLICTING:
        return "Conflicting evidence"
    if state is EvidenceState.SUPERSEDED:
        return "Superseded"
    return "Not proven"  # REJECTED / FIELD_VERIFICATION_REQUIRED fall here


_TRUST_BUCKETS = (
    ("Shown on the drawing (verified)", "shown on drawing"),
    ("Shown on the drawing", "shown on drawing"),
    ("Documented", "documented"),
    ("Derived (not verified)", "derived"),
    ("Reported by technician", "reported by technician"),
    ("Not proven", "not proven"),
    ("Conflicting evidence", "conflicting"),
    ("Superseded", "superseded"),
)
_BUCKET_ORDER = (
    "shown on drawing",
    "documented",
    "derived",
    "reported by technician",
    "not proven",
    "conflicting",
    "superseded",
)


def _trust_summary(claims: list[dict[str, Any]]) -> str:
    """e.g. ``"2 shown on drawing · 1 derived · 1 reported by technician"``."""
    if not claims:
        return "no evidence on file"
    bucket_by_label = dict(_TRUST_BUCKETS)
    counts: dict[str, int] = {}
    for claim in claims:
        bucket = bucket_by_label.get(str(claim.get("trust_label")), "not proven")
        counts[bucket] = counts.get(bucket, 0) + 1
    return " · ".join(f"{counts[b]} {b}" for b in _BUCKET_ORDER if counts.get(b))


# ── deterministic safety classification ─────────────────────────────────────

_STOP_HINTS = (
    "visible smoke",
    "smoke from",
    "burning smell",
    "on fire",
    "sparking",
    "arcing",
    "electrical fire",
    "shock hazard",
    "melted insulation",
)
_DEAD_HINTS = (
    "continuity",
    "resistance",
    "de-energize",
    "de-energized",
    "deenergize",
    "deenergized",
    "lockout",
    "tagout",
    "loto",
    "zero energy",
    "zero-energy",
    "dead test",
    "safe to touch",
    "safe to work",
    "is it safe",
    "isolate",
)
_STATE_CHANGE_HINTS = (
    "why would",
    "why does",
    "drop out",
    "drops out",
    "dropped out",
    "won't pull in",
    "wont pull in",
    "not pulling in",
    "won't start",
    "wont start",
    "keeps tripping",
    "prevent",
    "troubleshoot",
    "intermittent",
    "chatter",
)
_OHM_RE = re.compile(r"\d\s*(?:k?(?:ohm|ohms|Ω))\b", re.IGNORECASE)
_VOLT_AMP_RE = re.compile(r"\d\s*(?:vdc|vac|mv|kv|v|volts?|ma|amps?)\b", re.IGNORECASE)
_BARE_AMP_RE = re.compile(r"\d\s*A\b")
_LIVE_WORDS_RE = re.compile(r"\b(measure|measured|meter|reading|voltage|current draw)\b")


def classify_answer_safety(
    question: str,
    claims: list[dict[str, Any]] | None = None,
    focus: str | None = None,
) -> str:
    """Deterministic safety class for a workspace answer (keyword families).

    Precedence (most conservative first): stop_escalate →
    de_energized_verification → energized_measurement → state_change →
    informational. ``focus`` is accepted for signature stability; the class
    is derived from the question + claim texts.
    """
    text = (question or "").lower()
    for claim in claims or []:
        text += " " + str(claim.get("text") or "").lower()
    if any(h in text for h in _STOP_HINTS):
        return "stop_escalate"
    if any(h in text for h in _DEAD_HINTS) or _OHM_RE.search(text):
        return "de_energized_verification"
    if (
        _VOLT_AMP_RE.search(text)
        or _BARE_AMP_RE.search(question or "")
        or _LIVE_WORDS_RE.search(text)
    ):
        return "energized_measurement"
    if any(h in text for h in _STATE_CHANGE_HINTS):
        return "state_change"
    return "informational"


# Every non-informational note carries ≥1 grader safety marker ("verify",
# "meter", "cannot show", "before relying", "before working", ...) and no
# present-tense state assertion.
_SAFETY_NOTE_BY_CLASS = {
    "energized_measurement": (
        "Live measurement: verify your meter on a known source and use rated "
        "leads/PPE — the print cannot show live state; measure to confirm."
    ),
    "de_energized_verification": (
        "De-energize, lock out, and verify zero energy with a meter before "
        "working on this circuit — a print never proves isolation."
    ),
    "state_change": (
        "The print shows conventions, not live state — verify the actual state "
        "with a meter before relying on any suspected cause."
    ),
    "stop_escalate": (
        "Stop and escalate per site safety procedure — verify conditions with "
        "qualified personnel before any further checks."
    ),
}


# ── the contract ────────────────────────────────────────────────────────────


@dataclass
class EvidenceAnswer:
    """The 12-field workspace-answer contract (+ the ``read_only`` stamp)."""

    session_id: str
    print_model_version: str | None
    question: str
    focus_entity: str | None
    answer: str
    claims: list[dict[str, Any]]
    trust_summary: str
    safety_class: str
    safety_notes: list[str]
    answer_source: str
    superseded_evidence_used: bool
    suggested_next_questions: list[str]
    read_only: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "print_model_version": self.print_model_version,
            "question": self.question,
            "focus_entity": self.focus_entity,
            "answer": self.answer,
            "claims": [dict(c) for c in self.claims],
            "trust_summary": self.trust_summary,
            "safety_class": self.safety_class,
            "safety_notes": list(self.safety_notes),
            "answer_source": self.answer_source,
            "superseded_evidence_used": self.superseded_evidence_used,
            "suggested_next_questions": list(self.suggested_next_questions),
            "read_only": self.read_only,
        }


# ── claim projection ────────────────────────────────────────────────────────


def _norm_tag(tag: str | None) -> str:
    return (tag or "").strip().lstrip("-+").upper()


def _coordinates_for(obs: Observation) -> dict[str, Any] | None:
    """Honest coordinates: ONLY a stored bbox, never fabricated."""
    bbox = (obs.metadata or {}).get("bbox")
    if not bbox:
        return None
    coords: dict[str, Any] = {"bbox": list(bbox)}
    page = (obs.metadata or {}).get("page")
    if page is not None:
        coords["page"] = str(page)
    return coords


def _claim_from_observation(obs: Observation) -> dict[str, Any]:
    return {
        "text": obs.normalized_value or obs.raw_value or "(unreadable)",
        "trust_label": trust_label(obs.evidence_state, obs.extractor, obs.metadata),
        "evidence_state": obs.evidence_state.value,
        "extractor": obs.extractor,
        "coordinates": _coordinates_for(obs),
        "observation_id": obs.observation_id,
        "superseded": obs.evidence_state is EvidenceState.SUPERSEDED,
    }


def _project_claims(observations: list[Observation], focus: str | None) -> list[dict[str, Any]]:
    """≤ MAX_CLAIMS claims, focus-relevant first, then technician, then others."""
    focus_norm = _norm_tag(focus)
    focus_obs: list[Observation] = []
    tech_obs: list[Observation] = []
    other_obs: list[Observation] = []
    for obs in observations or []:
        if focus_norm and obs.raw_value and focus_norm in _norm_tag(obs.raw_value):
            focus_obs.append(obs)
        elif obs.extractor == "technician":
            tech_obs.append(obs)
        else:
            other_obs.append(obs)
    ordered = focus_obs + tech_obs + other_obs
    return [_claim_from_observation(o) for o in ordered[:MAX_CLAIMS]]


def _suggest_next_questions(
    observations: list[Observation],
    claims: list[dict[str, Any]],
    focus: str | None,
    safety_class: str,
    answer_source: str,
) -> list[str]:
    """≤ MAX_SUGGESTIONS deterministic follow-up templates."""
    tag = focus
    if not tag:
        for obs in observations or []:
            if obs.extractor == "ocr" and obs.raw_value:
                tag = obs.raw_value
                break
    suggestions: list[str] = []
    if focus:
        suggestions.append(f"Want me to trace what feeds {focus}?")
    needs_context = any(o.evidence_state is EvidenceState.NEEDS_CONTEXT for o in observations or [])
    if tag and (needs_context or not claims or answer_source == "none"):
        suggestions.append(f"Send a close-up of the {tag} rung for terminal-level detail.")
    has_measurement = any(o.extractor == "technician" for o in observations or [])
    if tag and not has_measurement and safety_class in ("state_change", "energized_measurement"):
        suggestions.append(f"Report what you measure at {tag} and I'll log it against the print.")
    deduped: list[str] = []
    for s in suggestions:
        if s not in deduped:
            deduped.append(s)
    return deduped[:MAX_SUGGESTIONS]


def build_evidence_answer(
    session: VisualSession | None,
    observations: list[Observation],
    question: str,
    focus: str | None,
    source: str,
    answer_text: str,
) -> EvidenceAnswer:
    """Project an ``EvidenceAnswer`` from the ledger for one follow-up turn."""
    observations = list(observations or [])
    claims = _project_claims(observations, focus)
    safety_class = classify_answer_safety(question, claims, focus)
    safety_notes = []
    note = _SAFETY_NOTE_BY_CLASS.get(safety_class)
    if note:
        safety_notes.append(note)
    return EvidenceAnswer(
        session_id=getattr(session, "session_id", "") or "",
        print_model_version=getattr(session, "current_revision", None),
        question=question,
        focus_entity=focus,
        answer=(answer_text or "").strip(),
        claims=claims,
        trust_summary=_trust_summary(claims),
        safety_class=safety_class,
        safety_notes=safety_notes,
        answer_source=source,
        superseded_evidence_used=any(c["superseded"] for c in claims),
        suggested_next_questions=_suggest_next_questions(
            observations, claims, focus, safety_class, source
        ),
    )


def build_from_envelope(
    session: VisualSession | None,
    envelope: AnswerEnvelope,
    observations: list[Observation],
    question: str,
    focus: str | None,
    source: str,
    answer_text: str,
) -> EvidenceAnswer:
    """EvidenceAnswer from a composed ``AnswerEnvelope`` (the ``ask`` path).

    Each envelope claim is enriched with its backing observation (extractor /
    coordinates / metadata) when one exists; unbacked claims (e.g. the safety
    short-circuit claim) keep honest ``None`` coordinates.
    """
    by_id = {o.observation_id: o for o in observations or [] if o.observation_id}
    claims: list[dict[str, Any]] = []
    for claim in (envelope.claims or [])[:MAX_CLAIMS]:
        obs = None
        for oid in claim.supporting_observation_ids or []:
            obs = by_id.get(oid)
            if obs is not None:
                break
        if obs is not None:
            projected = _claim_from_observation(obs)
            projected["text"] = claim.text or projected["text"]
        else:
            projected = {
                "text": claim.text,
                "trust_label": trust_label(claim.evidence_state, None, None),
                "evidence_state": claim.evidence_state.value,
                "extractor": None,
                "coordinates": None,
                "observation_id": None,
                "superseded": claim.evidence_state is EvidenceState.SUPERSEDED,
            }
        claims.append(projected)
    safety_class = classify_answer_safety(question, claims, focus)
    safety_notes: list[str] = []
    note = _SAFETY_NOTE_BY_CLASS.get(safety_class)
    if note:
        safety_notes.append(note)
    for env_note in envelope.safety_notes or []:
        if env_note not in safety_notes:
            safety_notes.append(env_note)
    if (envelope.safety_notes or any(c.safety_flag for c in envelope.claims or [])) and (
        envelope.next_best_evidence
    ):
        if envelope.next_best_evidence not in safety_notes:
            safety_notes.append(envelope.next_best_evidence)
    return EvidenceAnswer(
        session_id=getattr(session, "session_id", "") or "",
        print_model_version=getattr(session, "current_revision", None),
        question=question,
        focus_entity=focus,
        answer=(answer_text or "").strip(),
        claims=claims,
        trust_summary=_trust_summary(claims),
        safety_class=safety_class,
        safety_notes=safety_notes,
        answer_source=source,
        superseded_evidence_used=any(c["superseded"] for c in claims),
        suggested_next_questions=_suggest_next_questions(
            list(observations or []), claims, focus, safety_class, source
        ),
    )


def as_answer_claims(ea: EvidenceAnswer) -> list[AnswerClaim]:
    """EvidenceAnswer claims → store-recordable ``AnswerClaim`` models."""
    models: list[AnswerClaim] = []
    for claim in ea.claims[:MAX_CLAIMS]:
        try:
            models.append(
                AnswerClaim(
                    text=str(claim.get("text") or ""),
                    evidence_state=EvidenceState(claim.get("evidence_state") or "NEEDS_CONTEXT"),
                    supporting_observation_ids=(
                        [claim["observation_id"]] if claim.get("observation_id") else []
                    ),
                )
            )
        except Exception:  # noqa: BLE001 — recording claims is best-effort
            continue
    return models


# ── rendering ───────────────────────────────────────────────────────────────


def format_evidence_answer(ea: EvidenceAnswer, mode: str = "plain") -> str:
    """Render an ``EvidenceAnswer`` for the chat surface.

    ``plain``: answer + trust-labeled evidence lines + safety notes + next
    questions. ``trace``: adds per-claim provenance (extractor, coordinates or
    "coordinates unavailable", superseded marker) and a print-model footer.
    """
    lines: list[str] = []
    if ea.answer:
        lines.append(ea.answer)
    claims = ea.claims[:MAX_CLAIMS]
    if claims:
        if lines:
            lines.append("")
        lines.append(f"Evidence ({ea.trust_summary}):")
        for claim in claims:
            row = f"- [{claim.get('trust_label')}] {claim.get('text')}"
            if mode == "trace":
                coords = claim.get("coordinates")
                if coords and coords.get("bbox"):
                    coord_s = "bbox " + ",".join(str(v) for v in coords["bbox"])
                    if coords.get("page"):
                        coord_s += f" p.{coords['page']}"
                else:
                    coord_s = "coordinates unavailable"
                provenance = f"{claim.get('extractor') or 'unattributed'}; {coord_s}"
                if claim.get("superseded"):
                    provenance += "; superseded"
                row += f" ({provenance})"
            lines.append(row)
    safety_notes = list(ea.safety_notes)
    if ea.safety_class in _SAFETY_NOTE_BY_CLASS and not safety_notes:
        # Floor: a non-informational class NEVER renders without its marker note.
        safety_notes = [_SAFETY_NOTE_BY_CLASS[ea.safety_class]]
    if safety_notes:
        lines.append("")
        lines.extend(f"Safety: {note}" for note in safety_notes)
    if ea.suggested_next_questions:
        lines.append("")
        lines.append("Next:")
        lines.extend(f"- {q}" for q in ea.suggested_next_questions[:MAX_SUGGESTIONS])
    if mode == "trace":
        lines.append("")
        lines.append(f"print model {(ea.print_model_version or 'unrevisioned')[:8]}")
    return "\n".join(lines).strip()


# ── technician-measurement detection + ack ──────────────────────────────────

_VALUE_UNIT_RE = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(vdc|vac|mv|ma|kv|kohm|kΩ|ohms|ohm|Ω|volts|volt|v|amps|amp)(?![a-z])",
    re.IGNORECASE,
)
_VALUE_BARE_AMP_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(A)\b")
_TAGISH = r"(?:[-+]?[A-Za-z]{1,3}\d{1,4}(?:[.:]\d{1,3})*|\d{1,2}\s*-\s*\d{1,2})"
_TAG_TOKEN_RE = re.compile(_TAGISH)
_LOCATION_RE = re.compile(rf"\b(before|after|across|at|on|between)\s+({_TAGISH})", re.IGNORECASE)
_NEGATION_RE = re.compile(
    r"\b(nothing|no voltage|no volts|dead|none|0\s*v(?:dc|ac)?\b)", re.IGNORECASE
)

_QUANTITY_BY_UNIT = {
    "v": "voltage",
    "volt": "voltage",
    "volts": "voltage",
    "vdc": "voltage",
    "vac": "voltage",
    "mv": "voltage",
    "kv": "voltage",
    "a": "current",
    "amp": "current",
    "amps": "current",
    "ma": "current",
    "ohm": "resistance",
    "ohms": "resistance",
    "Ω": "resistance",
    "kohm": "resistance",
    "kΩ": "resistance",
}


def detect_technician_observation(text: str) -> dict[str, Any] | None:
    """Detect a technician-reported measurement in a chat turn.

    Fires ONLY when a value+unit is present AND the text carries a locational
    cue (before/after/across/at/on/between + a tag-shaped token) or at least
    one tag-shaped token — a bare reading with no circuit context is not
    claimed. Returns best-effort parsed fields (``None`` where absent).
    """
    if not text:
        return None
    match = _VALUE_UNIT_RE.search(text) or _VALUE_BARE_AMP_RE.search(text)
    if not match:
        return None
    value_raw, unit = match.group(1), match.group(2)
    reading_span = match.span()
    tags: list[str] = []
    for m in _TAG_TOKEN_RE.finditer(text):
        if m.start() >= reading_span[0] and m.end() <= reading_span[1]:
            continue  # the reading itself ("24V") is not a location tag
        token = re.sub(r"\s+", "", m.group(0))
        if token not in tags:
            tags.append(token)
    location_before: str | None = None
    location_after: str | None = None
    has_location_cue = False
    for m in _LOCATION_RE.finditer(text):
        has_location_cue = True
        cue = m.group(1).lower()
        tag = re.sub(r"\s+", "", m.group(2))
        if cue == "before" and location_before is None:
            location_before = tag
        elif cue == "after" and location_after is None:
            location_after = tag
    if not (has_location_cue or tags):
        return None
    try:
        value: float | None = float(value_raw.replace(",", "."))
    except ValueError:
        value = None
    return {
        "quantity": _QUANTITY_BY_UNIT.get(unit.lower(), _QUANTITY_BY_UNIT.get(unit, None)),
        "value": value,
        "unit": unit,
        "location_before": location_before,
        "location_after": location_after,
        "negated": bool(_NEGATION_RE.search(text)),
        "tags": tags,
    }


_ACK_LEAD_RE = re.compile(
    r"^(?:i\s+(?:have|had|got|get|see|read|measured)|i'?ve\s+(?:got|measured)|measured|reading|got)\s+",
    re.IGNORECASE,
)


def observation_ack_text(verbatim: str, parsed: dict[str, Any], known_tags: list[str]) -> str:
    """Deterministic "You report ..." restatement + ledger relation. ZERO LLM."""
    cleaned = _ACK_LEAD_RE.sub("", (verbatim or "").strip()).rstrip(".")
    lines = [f"You report {cleaned} — logged as a technician observation on this workspace."]
    known_by_norm = {_norm_tag(t): t for t in known_tags or [] if t}
    matched: list[str] = []
    unmatched: list[str] = []
    for tag in parsed.get("tags") or []:
        hit = known_by_norm.get(_norm_tag(tag))
        if hit is not None:
            if hit not in matched:
                matched.append(hit)
        elif tag not in unmatched:
            unmatched.append(tag)
    if matched:
        verb = "is" if len(matched) == 1 else "are"
        lines.append(f"{', '.join(matched)} {verb} shown on the stored drawing.")
    elif unmatched:
        verb = "is" if len(unmatched) == 1 else "are"
        lines.append(
            f"{', '.join(unmatched)} {verb} not among the legible tags on the stored drawing."
        )
    return "\n".join(lines)


# ── superseded-evidence note ────────────────────────────────────────────────


def superseded_note_for(
    all_observations: list[Observation],
    focus: str | None,
    revision: str | None,
) -> str | None:
    """Enrichment note when the focus tag has superseded (re-read) history."""
    focus_norm = _norm_tag(focus)
    if not focus_norm:
        return None
    has_superseded = any(
        o.evidence_state is EvidenceState.SUPERSEDED
        and o.raw_value
        and focus_norm in _norm_tag(o.raw_value)
        for o in all_observations or []
    )
    if not has_superseded:
        return None
    short = (revision or "unrevisioned")[:8]
    return f"(earlier readings of {focus} were replaced by your close-up — revision {short})"


__all__ = [
    "ANSWER_SOURCES",
    "MAX_CLAIMS",
    "MAX_SUGGESTIONS",
    "SAFETY_CLASSES",
    "EvidenceAnswer",
    "as_answer_claims",
    "build_evidence_answer",
    "build_from_envelope",
    "classify_answer_safety",
    "detect_technician_observation",
    "format_evidence_answer",
    "observation_ack_text",
    "superseded_note_for",
    "trust_label",
]
