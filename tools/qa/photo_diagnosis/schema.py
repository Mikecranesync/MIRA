"""Photo Diagnosis Benchmark — case fixture schema.

Loads and validates `tests/golden_photo/cases/*.yaml` (and the gitignored
`tests/golden_photo/local/` equivalents). Two case kinds share a common
envelope:

- ``kind: diagnosis`` — a branching fault scenario the fixed-fact
  :mod:`photo_diagnosis.simulator` plays out turn by turn.
- ``kind: qa`` — single/short-turn print/nameplate/manual/lookup questions
  with a deterministic answer key.

A case is **scorable** only once a human (``validated_by``) has signed off —
see :func:`scorable`. Unvalidated cases (the shipped format examples) load
and validate cleanly but are never run for score.
"""

from __future__ import annotations

import datetime as _dt
from pathlib import Path
from typing import Any

import yaml

# ---------------------------------------------------------------------------
# Field catalogue

COMMON_FIELDS = {
    "id",
    "kind",
    "type",
    "photo",
    "sources",
    "visible_facts",
    "safety",
    "must_refuse",
    "controls",
    "validated_by",
    "validated_on",
    "privacy",
}
DIAGNOSIS_ONLY_FIELDS = {
    "reported_facts",
    "checks",
    "hidden_facts",
    "hypotheses",
    "unproven",
    "legit_product_asks",
    "max_turns",
}
QA_ONLY_FIELDS = {"questions"}

VALID_KINDS = {"diagnosis", "qa"}
VALID_TYPES = {"P", "N", "M", "L", "D"}
# Case-type table (plan §Case types): P/N/M/L are single/short-turn lookups
# (kind=qa); D is the branching diagnosis (kind=diagnosis).
EXPECTED_KIND_FOR_TYPE = {"P": "qa", "N": "qa", "M": "qa", "L": "qa", "D": "diagnosis"}
VALID_CONTROLS = {
    "no_photo",
    "wrong_manual",
    "misid",
    "blur_retake",
    "multi_device",
    "insufficient",
}
VALID_PRIVACY = {"general", "customer", "bench"}
VALID_HYP_STATUS = {"true_cause", "acceptable_alternative", "ruled_out"}
VALID_PRODUCT_ASK_KEYS = {"identity_confirm", "retake_photo", "manual_upload"}
DEFAULT_MAX_TURNS = 12


class CaseError(Exception):
    """Raised for a single invalid case. Carries every problem found, not
    just the first — a case author fixes one pass, not N."""

    def __init__(self, path: Path, errors: list[str], case_id: str | None = None):
        self.path = path
        self.case_id = case_id
        self.errors = list(errors)
        label = case_id or str(path)
        super().__init__(f"{label}: " + "; ".join(self.errors))


def _resolve_path(raw: str, case_file: Path) -> Path:
    p = Path(raw)
    return p if p.is_absolute() else (case_file.parent / p)


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".heic", ".webp"}
DOC_SUFFIXES = {".pdf"}


def _check_suffix(raw: Any, field: str, allowed: set[str], kind: str, errors: list[str]) -> None:
    """Gate 7: a path the harness uploads to staging (and the judge) must have
    the expected file type, so a case can never point it at, e.g., a secrets
    file. Paths may be absolute or use `..` on purpose (the private photo
    catalog lives outside the repo), so the guard is the type, not the location."""
    if isinstance(raw, str) and raw.strip() and Path(raw).suffix.lower() not in allowed:
        errors.append(f"{field}: must be {kind} ({', '.join(sorted(allowed))}), got {raw!r}")


def _check_text_list(value: Any, field: str, errors: list[str]) -> None:
    """Codex r8: a list the runner consumes as text must hold only non-empty
    strings, rejected here, before any Hub or paid call."""
    if not isinstance(value, list):
        return  # the "must be a list" check reports this shape
    for i, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            errors.append(f"{field}[{i}]: must be a non-empty string, got {item!r}")


def validate_case(raw: Any, path: Path) -> dict:
    """Validate and normalize one raw case mapping. Raises CaseError with
    every problem found. Returns a normalized dict on success."""
    if not isinstance(raw, dict):
        raise CaseError(path, [f"case is not a mapping (got {type(raw).__name__})"])

    errors: list[str] = []
    case_id = raw.get("id")
    if not case_id or not isinstance(case_id, str):
        errors.append("id: required string field missing")

    kind = raw.get("kind")
    kind_known: str | None = kind if kind in VALID_KINDS else None
    if kind_known is None:
        errors.append(
            f"kind: invalid or missing (got {kind!r}, expected one of {sorted(VALID_KINDS)})"
        )

    # Unknown-field check. When kind itself is broken we allow the union of
    # both kinds' fields so we don't pile a wall of false "unknown field"
    # noise on top of the real "kind" error.
    if kind_known == "diagnosis":
        allowed = COMMON_FIELDS | DIAGNOSIS_ONLY_FIELDS
    elif kind_known == "qa":
        allowed = COMMON_FIELDS | QA_ONLY_FIELDS
    else:
        allowed = COMMON_FIELDS | DIAGNOSIS_ONLY_FIELDS | QA_ONLY_FIELDS
    for key in raw:
        if key not in allowed:
            errors.append(f"unknown field: {key!r}")

    case_type = raw.get("type")
    if case_type not in VALID_TYPES:
        errors.append(
            f"type: invalid or missing (got {case_type!r}, expected one of {sorted(VALID_TYPES)})"
        )
    elif kind_known is not None:
        expected_kind = EXPECTED_KIND_FOR_TYPE[case_type]
        if expected_kind != kind_known:
            errors.append(
                f"kind mismatch: type {case_type!r} requires kind {expected_kind!r}, got {kind_known!r}"
            )

    privacy = raw.get("privacy")
    if privacy not in VALID_PRIVACY:
        errors.append(
            f"privacy: invalid or missing (got {privacy!r}, expected one of {sorted(VALID_PRIVACY)})"
        )

    # photo — required, must resolve to an existing file (relative to the
    # case file, or absolute).
    photo_raw = raw.get("photo")
    photo_path: Path | None = None
    if not photo_raw or not isinstance(photo_raw, str):
        errors.append("photo missing: field not present")
    else:
        _check_suffix(photo_raw, "photo", IMAGE_SUFFIXES, "an image file", errors)
        photo_path = _resolve_path(photo_raw, path)
        if not photo_path.exists():
            errors.append(f"photo missing: file not found at {photo_path}")

    # sources — optional list of PDF paths. Existence is not enforced here
    # (private fixtures may reference not-yet-pulled sources); shape is.
    sources = raw.get("sources")
    if sources is not None and not isinstance(sources, list):
        errors.append("sources: must be a list")

    visible_facts = raw.get("visible_facts")
    if visible_facts is not None and not isinstance(visible_facts, list):
        errors.append("visible_facts: must be a list")
    _check_text_list(sources, "sources", errors)
    for i, src in enumerate(sources if isinstance(sources, list) else []):
        _check_suffix(src, f"sources[{i}]", DOC_SUFFIXES, "a .pdf", errors)
    _check_text_list(visible_facts, "visible_facts", errors)

    safety = raw.get("safety") or []
    if not isinstance(safety, list):
        errors.append("safety: must be a list")
        safety = []
    for s in safety:
        if not isinstance(s, dict) or "trigger" not in s or "required" not in s:
            errors.append(f"safety: malformed entry {s!r} (needs trigger + required)")

    must_refuse = raw.get("must_refuse")
    if must_refuse is not None and not isinstance(must_refuse, list):
        errors.append("must_refuse: must be a list")
    _check_text_list(must_refuse, "must_refuse", errors)

    controls = raw.get("controls") or []
    if not isinstance(controls, list):
        errors.append("controls: must be a list")
        controls = []
    for c in controls:
        if c not in VALID_CONTROLS:
            errors.append(
                f"controls: unknown control {c!r} (expected one of {sorted(VALID_CONTROLS)})"
            )

    validated_by = raw.get("validated_by")
    if validated_by is not None and not isinstance(validated_by, str):
        errors.append("validated_by: must be a string or null")

    validated_on_raw = raw.get("validated_on")
    validated_on: _dt.date | None = None
    if validated_on_raw is not None:
        if isinstance(validated_on_raw, _dt.date):
            validated_on = validated_on_raw
        else:
            try:
                validated_on = _dt.date.fromisoformat(str(validated_on_raw))
            except ValueError:
                errors.append(f"validated_on: invalid date {validated_on_raw!r}")

    max_turns = DEFAULT_MAX_TURNS
    if kind_known == "diagnosis":
        reported_facts = raw.get("reported_facts")
        if not reported_facts or not isinstance(reported_facts, str):
            errors.append("reported_facts: required string field missing")

        checks = raw.get("checks") or []
        if not isinstance(checks, list):
            errors.append("checks: must be a list")
            checks = []
        check_ids: set[str] = set()
        for c in checks:
            if not isinstance(c, dict) or "id" not in c:
                errors.append(f"checks: malformed entry {c!r} (needs id)")
                continue
            check_ids.add(c["id"])

        hidden_facts = raw.get("hidden_facts") or []
        if not isinstance(hidden_facts, list):
            errors.append("hidden_facts: must be a list")
            hidden_facts = []
        fact_ids: set[str] = set()
        for f in hidden_facts:
            if not isinstance(f, dict) or "id" not in f or "text" not in f:
                errors.append(f"hidden_facts: malformed entry {f!r} (needs id + text)")
                continue
            if not isinstance(f["text"], str) or not f["text"].strip():
                errors.append(f"hidden_facts[{f['id']}].text: must be a non-empty string")
                continue
            fact_ids.add(f["id"])
            for rb in f.get("revealed_by") or []:
                if rb not in check_ids:
                    errors.append(
                        f"hidden_facts[{f['id']}].revealed_by -> nonexistent check {rb!r}"
                    )

        hypotheses = raw.get("hypotheses") or []
        if not isinstance(hypotheses, list) or not hypotheses:
            errors.append("hypotheses: must be a non-empty list")
            hypotheses = []
        hyp_ids: set[str] = set()
        true_causes = 0
        for h in hypotheses:
            if not isinstance(h, dict) or "id" not in h:
                errors.append(f"hypotheses: malformed entry {h!r} (needs id)")
                continue
            hyp_ids.add(h["id"])
            text = h.get("text")
            if not isinstance(text, str) or not text.strip():
                # r7 F19: outcome grading quotes every hypothesis's text, so a
                # missing one must fail here, before any paid or Hub call.
                errors.append(f"hypotheses[{h['id']}].text: must be a non-empty string")
            status = h.get("status")
            if status not in VALID_HYP_STATUS:
                errors.append(f"hypotheses[{h['id']}].status: invalid {status!r}")
            if status == "true_cause":
                true_causes += 1
            rob = h.get("ruled_out_by")
            if rob is not None and rob not in fact_ids:
                errors.append(f"hypotheses[{h['id']}].ruled_out_by -> nonexistent fact {rob!r}")
        if true_causes == 0:
            errors.append("no true_cause hypothesis")
        elif true_causes > 1:
            # r8 F2: outcome grading names ONE true cause; two would make the
            # verdict depend on YAML order.
            errors.append(f"hypotheses: exactly one true_cause required, found {true_causes}")

        for c in checks:
            if not isinstance(c, dict) or "id" not in c:
                continue
            for d in c.get("discriminates") or []:
                if d not in hyp_ids:
                    errors.append(
                        f"checks[{c['id']}].discriminates -> nonexistent hypothesis {d!r}"
                    )

        unproven = raw.get("unproven")
        if unproven is not None and not isinstance(unproven, list):
            errors.append("unproven: must be a list")
        _check_text_list(unproven, "unproven", errors)

        legit = raw.get("legit_product_asks") or {}
        if not isinstance(legit, dict):
            errors.append("legit_product_asks: must be a mapping")
        else:
            for k in legit:
                if k not in VALID_PRODUCT_ASK_KEYS:
                    errors.append(f"legit_product_asks: unknown field {k!r}")
            _check_suffix(
                legit.get("retake_photo"),
                "legit_product_asks.retake_photo",
                IMAGE_SUFFIXES,
                "an image file",
                errors,
            )
            _check_suffix(
                legit.get("manual_upload"),
                "legit_product_asks.manual_upload",
                DOC_SUFFIXES,
                "a .pdf",
                errors,
            )

        max_turns = raw.get("max_turns", DEFAULT_MAX_TURNS)
        if not isinstance(max_turns, int) or isinstance(max_turns, bool) or max_turns <= 0:
            errors.append("max_turns: must be a positive int")
            max_turns = DEFAULT_MAX_TURNS

    elif kind_known == "qa":
        questions = raw.get("questions") or []
        if not isinstance(questions, list) or not questions:
            errors.append("questions: must be a non-empty list")
            questions = []
        for i, q in enumerate(questions):
            if not isinstance(q, dict) or "q" not in q:
                errors.append(f"questions[{i}]: malformed entry (needs q)")
                continue
            if not isinstance(q["q"], str) or not q["q"].strip():
                errors.append(f"questions[{i}].q: must be a non-empty string")
            ak = q.get("answer_key")
            if not isinstance(ak, dict) or "value" not in ak:
                errors.append(f"questions[{i}].answer_key: required mapping with 'value'")
            for list_field in ("acceptable", "must_not"):
                if list_field in q and not isinstance(q[list_field], list):
                    errors.append(f"questions[{i}].{list_field}: must be a list")

    if errors:
        raise CaseError(path, errors, case_id=case_id if isinstance(case_id, str) else None)

    normalized = dict(raw)
    normalized["validated_on"] = validated_on
    normalized["max_turns"] = max_turns
    normalized["_photo_path"] = photo_path
    normalized["_source_file"] = path
    return normalized


def load_case_file(path: Path) -> list[Any]:
    """Load the raw case mapping(s) from one YAML file. Accepts a single
    mapping, a top-level list of mappings, or a multi-document (``---``)
    file — so the shipped ``_example_format.yaml`` can carry one case per
    kind in a single file."""
    text = path.read_text()
    docs = [d for d in yaml.safe_load_all(text) if d is not None]
    out: list[Any] = []
    for d in docs:
        if isinstance(d, list):
            out.extend(d)
        else:
            out.append(d)
    return out


def load_cases(cases_dir: Path) -> tuple[list[dict], list[CaseError]]:
    """Load and validate every ``*.yaml`` case file directly under
    ``cases_dir`` (files starting with ``_`` — the format examples — are
    NOT skipped; they must validate too). Returns (valid_cases, errors)."""
    valid: list[dict] = []
    errors: list[CaseError] = []
    seen_ids: dict[str, Path] = {}
    for yml in sorted(cases_dir.glob("*.yaml")):
        try:
            raws = load_case_file(yml)
        except yaml.YAMLError as e:
            errors.append(CaseError(yml, [f"failed to parse YAML: {e}"]))
            continue
        for raw in raws:
            try:
                case = validate_case(raw, yml)
            except CaseError as ce:
                errors.append(ce)
                continue
            # Gate 7: the report groups by case id, so a duplicate would merge
            # two cases' results silently. First one wins; the rest are errors.
            if case["id"] in seen_ids:
                errors.append(
                    CaseError(
                        yml,
                        [
                            f"duplicate case id {case['id']!r} (first in {seen_ids[case['id']].name})"
                        ],
                        case_id=case["id"],
                    )
                )
                continue
            seen_ids[case["id"]] = yml
            valid.append(case)
    return valid, errors


def scorable(case: dict) -> bool:
    """A case is scored only once a human has validated it."""
    return case.get("validated_by") is not None
