"""Technician dataset v1 — the evidence-contract build.

Plan: ``docs/zta/2026-07-27-technician-dataset-v1-plan.md``. The v0 hold-out
eval proved the flaw this build fixes: every v0 row referenced evidence that
was never present in the prompt, training confident evidence-shaped assertions
with no evidence (the "F41 is the deterministic Drive Commander pack"
collapse). v1 enforces a per-record contract — the assistant answer must be
derivable from the user-visible turn alone:

- **Pattern A (evidence-in-prompt)**: the user turn carries the deterministic
  evidence line; the assistant cites it.
- **Pattern B (evidence-absent)**: the user turn carries only the question;
  the assistant explicitly declines to state the fact, says where it lives,
  and holds the safety floor. B answers NEVER contain the pack claim.
- **Pattern C (valued interactions)**: refusal / uncertainty / correction,
  split into with-evidence (claim stated, evidence in prompt) and
  without-evidence (claim withheld) variants by fact-hash parity.

Because every target is capped at the real fact count (the v0 anti-padding
law), each fact appears in exactly ONE record, so A/B fact-disjointness is
structural: an evidence-absent record's fact is never also trained
evidence-present.

This module REUSES the frozen v0 machinery (fact loaders, record builders,
review-decision ledger, paid gate, report writers) and never edits it — the
v0 build must stay byte-stable because its decision ledger binds to its
manifest hash. The v1 build runs ``technician_v0.write_build`` under a
context-managed override of the version constants and the candidate seam,
restored in ``finally``.
"""

from __future__ import annotations

import argparse
import contextlib
import json
from collections import defaultdict
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from factorylm_ai.dataset import technician_v0 as v0
from factorylm_ai.dataset.technician_v0 import (
    ReviewCandidate,
    _answer_key,
    _drive_record_from_source,
    _printsense_record_from_source,
    _repeat_to_count,
    _stable_hash,
)

DATASET_VERSION = "factorylm-industrial-technician-v1"
BUILD_ID = "2026-07-27-technician-dataset-v1"
BUILD_TIMESTAMP = "2026-07-27T00:00:00Z"
DEFAULT_OUT_DIR = Path("docs/zta/technician-dataset-v1")
PLAN_REF = "docs/zta/2026-07-27-technician-dataset-v1-plan.md"

# Deterministic pattern cycle — 19 slots: 7 A, 5 B, 7 C interleaved, matching
# the plan's ~70/50/70 composition over the ~190-record trainable pool.
_PATTERN_CYCLE = (
    "A",
    "C",
    "B",
    "A",
    "C",
    "B",
    "A",
    "C",
    "A",
    "B",
    "C",
    "A",
    "C",
    "B",
    "A",
    "C",
    "B",
    "A",
    "C",
)


def _pattern_for(sequence: int) -> str:
    return _PATTERN_CYCLE[(sequence - 1) % len(_PATTERN_CYCLE)]


def _with_evidence_variant(fact: dict[str, Any]) -> bool:
    """Deterministic per-fact split for Pattern C: with vs without evidence."""
    return int(_stable_hash(fact)[:8], 16) % 2 == 0


# --------------------------------------------------------------------------
# evidence rendering — the ONLY way a claim may enter a user turn
# --------------------------------------------------------------------------
def _drive_evidence_line(fact: dict[str, Any]) -> str:
    related = ", ".join(fact.get("related_parameters", []) or ["none"])
    return (
        f"Evidence (deterministic Drive Commander pack, page {fact.get('page')}): "
        f"{fact['claim']}. Related parameters: {related}."
    )


def _cv101_evidence_line(fact: dict[str, Any]) -> str:
    return (
        f"Evidence (CV-101 evidence package, sheet {fact['sheet']}, "
        f"status {fact['status']}): {fact['claim']}."
    )


def _style_evidence_line(fact: dict[str, Any]) -> str:
    return f"Evidence (FactoryLM-authored style guide): {fact['claim']}"


# --------------------------------------------------------------------------
# v1 message templates
# --------------------------------------------------------------------------
def _messages(user: str, assistant: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": v0.SYSTEM_PROMPT},
        {"role": "user", "content": user},
        {"role": "assistant", "content": assistant},
    ]


def _drive_v1_messages(
    source: dict[str, Any], fact: dict[str, Any], pattern: str, interaction: str
) -> list[dict[str, str]]:
    family = source["drive_model"]
    subject = fact["subject"]
    evidence = _drive_evidence_line(fact)
    if pattern == "A":
        user = (
            f"{family}: identify {subject} from the deterministic Drive Commander pack.\n{evidence}"
        )
        answer = (
            f"Per the provided pack evidence (page {fact.get('page')}): {fact['claim']}. "
            "This is a grounded lookup, not authorization to reset, bypass, or perform "
            "energized work."
        )
        return _messages(user, answer)
    if pattern == "B":
        user = f"{family}: identify {subject} from the deterministic Drive Commander pack."
        answer = (
            f"That definition is not in the evidence in front of me, so I will not guess "
            f"what {subject} means — a wrong fault definition sends you at the wrong hazard. "
            f"It lives in the {family} fault/parameter table of the Drive Commander pack or "
            "the manual's fault chapter. What holds without it: F-codes are faults, not "
            f"parameters; treat {subject} as active — do not clear, suppress, or bypass it, "
            "and no energized work. Share the pack entry and I will ground the answer."
        )
        return _messages(user, answer)
    # Pattern C — valued interactions, with/without-evidence variants.
    with_ev = _with_evidence_variant(fact)
    if interaction == "refusal":
        user = f"{family} shows {subject}. Can I suppress it and keep the line running?"
        if with_ev:
            user = f"{user}\n{evidence}"
            answer = (
                f"No. Do not suppress or bypass a drive fault to keep running. Per the "
                f"provided evidence: {fact['claim']}. Stop and follow site procedure "
                "before inspection."
            )
        else:
            answer = (
                f"No. Do not suppress or bypass a drive fault to keep running, whatever "
                f"{subject} turns out to be — I will not guess its definition without the "
                "pack entry. Stop the drive, follow site procedure, and pull the "
                f"{family} fault table before inspection."
            )
    elif interaction == "uncertainty":
        user = f"I see {subject} on a {family}. What is known, and what is still uncertain?"
        if with_ev:
            user = f"{user}\n{evidence}"
            related = ", ".join(fact.get("related_parameters", []) or ["none"])
            answer = (
                f"Known from the provided evidence: {fact['claim']}. Related parameters: "
                f"{related}. Uncertain: the live cause and drive state — verify at the "
                "machine before acting."
            )
        else:
            answer = (
                f"Known: {subject} is an identifier the {family} pack defines; without the "
                "pack entry in front of me its definition is NOT known here, and I will "
                "not guess it. Uncertain: the definition, cause, and drive state. Next "
                "step: pull the pack entry; until then do not clear the fault, bypass "
                "safety devices, or work energized."
            )
    else:  # correction
        user = f"Correct this {family} lookup for {subject}; I may be mixing parameters and faults."
        if with_ev:
            user = f"{user}\n{evidence}"
            faults = ", ".join(fact.get("related_faults", []) or ["none"])
            related = ", ".join(fact.get("related_parameters", []) or ["none"])
            answer = (
                f"Correction: keep fault IDs and parameter IDs separate. Per the provided "
                f"evidence, {fact['claim']}. Related faults: {faults}; related parameters: "
                f"{related}."
            )
        else:
            answer = (
                "Correction: keep fault IDs and parameter IDs separate — F-prefixed codes "
                f"are faults, P/A/d-prefixed codes are parameters. The specific definition "
                f"of {subject} is not in front of me and I will not guess it; pull the "
                f"{family} pack entry and I will ground the corrected lookup."
            )
    return _messages(user, answer)


def _cv101_v1_messages(
    fact: dict[str, Any], pattern: str, interaction: str
) -> list[dict[str, str]]:
    subject = fact["subject"]
    status = fact["status"]
    evidence = _cv101_evidence_line(fact)
    if pattern == "A":
        user = f"CV-101 sheet {fact['sheet']}: what should I know about {subject}?\n{evidence}"
        answer = (
            f"Per the provided CV-101 evidence: {fact['claim']}. Source status is {status} — "
            "carry it exactly, and field-verify anything marked field_verify. Do not infer "
            "missing landings."
        )
        return _messages(user, answer)
    if pattern == "B":
        user = f"CV-101 sheet {fact['sheet']}: what should I know about {subject}?"
        answer = (
            f"That detail is not in the evidence in front of me, so I will not describe "
            f"{subject} from memory — inventing terminal or wiring detail is how wrong "
            "landings happen. It lives in the CV-101 evidence package for sheet "
            f"{fact['sheet']} (components/connections/terminals tables). Until you pull it: "
            "treat the wiring as unverified, do not lift or land conductors on an assumption, "
            "and no energized work. Share the evidence row and I will ground the answer."
        )
        return _messages(user, answer)
    with_ev = _with_evidence_variant(fact)
    if interaction == "refusal":
        user = (
            f"For CV-101, can I bypass or jumper around {subject} so I can keep "
            "troubleshooting live?"
        )
        if with_ev:
            user = f"{user}\n{evidence}"
            answer = (
                f"No. Do not bypass safety or protective wiring for {subject}. Per the "
                f"provided evidence: {fact['claim']} (status {status}). De-energize, follow "
                "LOTO/site procedure, and use the drawing only to identify what must be "
                "verified."
            )
        else:
            answer = (
                f"No. Do not bypass or jumper around {subject}, and I will not guess its "
                "wiring detail without the CV-101 evidence row. De-energize, follow "
                "LOTO/site procedure, and pull the sheet's evidence package before touching "
                "conductors."
            )
    elif interaction == "uncertainty":
        user = f"Can I rely on the CV-101 {subject} detail without checking the machine?"
        if with_ev:
            user = f"{user}\n{evidence}"
            answer = (
                f"Use calibrated uncertainty. The provided evidence says: {fact['claim']}. "
                f"Because the status is {status}, preserve that status and field-verify "
                "anything marked field_verify before relying on it for work."
            )
        else:
            answer = (
                f"Not without evidence. The {subject} detail is not in front of me and I "
                "will not restate it from memory. Pull the CV-101 evidence row, carry its "
                "source status exactly, and field-verify anything marked field_verify "
                "before relying on it."
            )
    else:  # correction
        user = f"Correct my CV-101 note for {subject}; I may have treated an uncertain item as verified."
        if with_ev:
            user = f"{user}\n{evidence}"
            answer = (
                f"Correction: carry the source status exactly. Per the provided evidence, "
                f"{fact['claim']}. Do not promote it beyond {status}; put remaining "
                "uncertainty into the open-items/review flow."
            )
        else:
            answer = (
                "Correction: carry the source status exactly, and never promote an "
                f"uncertain item to verified without the evidence row. I will not restate "
                f"the {subject} detail from memory — pull the CV-101 evidence package and "
                "re-ground the note against its recorded status."
            )
    return _messages(user, answer)


def _style_v1_messages(
    fact: dict[str, Any], pattern: str, interaction: str
) -> list[dict[str, str]]:
    subject = fact["subject"]
    evidence = _style_evidence_line(fact)
    if pattern == "A":
        user = f"What is the PrintSense guidance for {subject}?\n{evidence}"
        answer = f"Per the provided FactoryLM-authored guidance: {fact['claim']}"
        return _messages(user, answer)
    if pattern == "B":
        user = f"What is the PrintSense guidance for {subject}?"
        answer = (
            f"The specific {subject} rule text is not in front of me, so I will not "
            "paraphrase it from memory — style rules are exact by design. It lives in the "
            "FactoryLM print-style guide. The floor that always holds: cite evidence, keep "
            "verified/field-verify/reviewer boundaries explicit, and never invent unseen "
            "terminals or safety behavior. Share the rule text and I will apply it."
        )
        return _messages(user, answer)
    with_ev = _with_evidence_variant(fact)
    if interaction == "refusal":
        user = f"Can I ignore the PrintSense rule for {subject} and just answer confidently?"
        if with_ev:
            user = f"{user}\n{evidence}"
            answer = (
                f"No. The provided FactoryLM-authored rule is: {fact['claim']} If the "
                "evidence is missing, refuse the unsupported claim and route it to review."
            )
        else:
            answer = (
                f"No. Confidence without evidence is the failure mode the {subject} rule "
                "exists to stop. I will not restate the rule from memory — pull it from "
                "the style guide; until then, refuse unsupported claims and route them "
                "to review."
            )
    elif interaction == "uncertainty":
        user = f"What uncertainty should I preserve for PrintSense {subject}?"
        if with_ev:
            user = f"{user}\n{evidence}"
            answer = (
                f"Preserve the evidence boundary: {fact['claim']} Say what is verified, "
                "what is field-verify, and what needs a reviewer."
            )
        else:
            answer = (
                f"Preserve the evidence boundary itself: without the {subject} rule text in "
                "front of me I will not paraphrase it. State what is verified, what is "
                "field-verify, and what needs a reviewer — and pull the rule before "
                "asserting its specifics."
            )
    else:  # correction
        user = f"Correct a PrintSense answer that violates the {subject} rule."
        if with_ev:
            user = f"{user}\n{evidence}"
            answer = (
                f"Correction per the provided rule: {fact['claim']} Rewrite the answer so "
                "it cites evidence and does not invent unseen terminals or safety behavior."
            )
        else:
            answer = (
                f"Correction: the answer must cite the {subject} rule, and I will not "
                "restate that rule from memory. Pull the rule text, rewrite the answer to "
                "cite it, and strip anything that invents unseen terminals or safety "
                "behavior."
            )
    return _messages(user, answer)


# --------------------------------------------------------------------------
# v1 candidate builders (mirror v0 structure; one record per distinct fact)
# --------------------------------------------------------------------------
_C_INTERACTIONS = ("uncertainty", "correction", "refusal")


def _v1_interaction(pattern: str, sequence: int, *, safety: bool) -> str:
    """A/B are diagnostic; C is ALWAYS a valued interaction.

    v0's cadence (`_interaction_type`) returns "diagnostic" for most
    sequences, which would starve the valued-interaction pool (and the
    ``min_valued_interactions`` gate check) if reused for C slots. Safety
    -sensitive facts force ``refusal``; the rest rotate deterministically.
    """
    if pattern in ("A", "B"):
        return "diagnostic"
    if safety and sequence % 2 == 0:
        return "refusal"
    return _C_INTERACTIONS[sequence % len(_C_INTERACTIONS)]


def _pattern_tag(pattern: str) -> str:
    return f"pattern_{pattern.lower()}"


def _cv101_candidates_v1() -> list[ReviewCandidate]:
    sources = {s["source_id"]: s for s in v0._cv101_sources()}
    facts = v0._cv101_facts()
    by_sheet: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for fact in facts:
        by_sheet[fact["sheet"]].append(fact)

    candidates: list[ReviewCandidate] = []
    sequence = 0
    for source in v0._cv101_sources():
        count = int(source["target_record_count"])
        if count <= 0:
            continue
        sheet = source["source_id"].split("-", 1)[1].upper()
        rows = by_sheet[sheet] or by_sheet["E-001"]
        for item in _repeat_to_count(rows, count):
            sequence += 1
            pattern = _pattern_for(sequence)
            interaction = _v1_interaction(pattern, sequence, safety=bool(item["safety_sensitive"]))
            record = _printsense_record_from_source(
                source,
                record_id=f"techv1-cv101-{sequence:03d}",
                messages=_cv101_v1_messages(item, pattern, interaction),
                tags=("printsense", "cv101", item["kind"], item["sheet"], _pattern_tag(pattern)),
                interaction_type=interaction,
                safety_sensitive=bool(item["safety_sensitive"]),
            )
            candidates.append(
                ReviewCandidate(
                    record=record,
                    source_entry=sources[source["source_id"]],
                    answer_key=_answer_key(
                        key_type="verified_machine_evidence",
                        key_ref=f"{source['answer_key_ref']}#{item['id']}",
                        evidence_hash=_stable_hash(item),
                        producer_type="deterministic",
                        payload=item,
                    ),
                    origin="human_corrected",
                    source_class="owner_generated",
                    review_batch="cv101",
                    notes=(f"v1 evidence-contract pattern {pattern}; plan {PLAN_REF}.",),
                )
            )
    return candidates


def _drive_candidates_v1() -> list[ReviewCandidate]:
    sources = {s["source_id"]: s for s in v0._drive_sources()}
    candidates: list[ReviewCandidate] = []
    sequence = 0
    for source_id, target in v0._DRIVE_TARGETS.items():
        source = sources[f"drive-{source_id}"]
        gold = v0._read_json(v0.REPO_ROOT / source["source_reference"])
        facts = v0._drive_facts(source_id, gold)
        # One record per DISTINCT fact — v0's `_DRIVE_TARGETS` over-draws
        # durapulse_gs10 (target 20, 12 real facts -> 8 cycled duplicates in
        # the v0 pool). v1 hard-caps at the real fact count so the A/B
        # evidence-contract disjointness stays structural.
        for fact in _repeat_to_count(facts, min(target, len(facts))):
            sequence += 1
            pattern = _pattern_for(sequence)
            interaction = _v1_interaction(pattern, sequence, safety=bool(fact["safety_sensitive"]))
            record = _drive_record_from_source(
                source,
                record_id=f"techv1-drive-{sequence:03d}",
                messages=_drive_v1_messages(source, fact, pattern, interaction),
                tags=("drive_commander", source_id, fact["kind"], _pattern_tag(pattern)),
                interaction_type=interaction,
                safety_sensitive=bool(fact["safety_sensitive"]),
            )
            candidates.append(
                ReviewCandidate(
                    record=record,
                    source_entry=source,
                    answer_key=_answer_key(
                        key_type="deterministic_pack",
                        key_ref=f"{source['answer_key_ref']}#{fact['id']}",
                        evidence_hash=_stable_hash(fact),
                        producer_type="deterministic",
                        payload=fact,
                    ),
                    origin="human_corrected",
                    source_class="human_corrected_pack",
                    review_batch="drive",
                    notes=(f"v1 evidence-contract pattern {pattern}; plan {PLAN_REF}.",),
                )
            )
    return candidates


def _printsense_style_candidates_v1() -> list[ReviewCandidate]:
    sources = v0._printsense_style_sources()
    facts = v0._style_facts()
    candidates: list[ReviewCandidate] = []
    sequence = 0
    for index, fact in enumerate(facts):
        source = sources[index % len(sources)]
        sequence += 1
        pattern = _pattern_for(sequence)
        interaction = _v1_interaction(pattern, sequence, safety=bool(fact["safety_sensitive"]))
        record = _printsense_record_from_source(
            source,
            record_id=f"techv1-ps-style-{sequence:03d}",
            messages=_style_v1_messages(fact, pattern, interaction),
            tags=("printsense", "style", fact["kind"], _pattern_tag(pattern)),
            interaction_type=interaction,
            safety_sensitive=bool(fact["safety_sensitive"]),
        )
        candidates.append(
            ReviewCandidate(
                record=record,
                source_entry=source,
                answer_key=_answer_key(
                    key_type="factorylm_authored_rule",
                    key_ref=f"{source['answer_key_ref']}#{fact['id']}",
                    evidence_hash=_stable_hash(fact),
                    producer_type="deterministic",
                    payload=fact,
                ),
                origin="human_corrected",
                source_class="owner_generated",
                review_batch="printsense",
                notes=(f"v1 evidence-contract pattern {pattern}; plan {PLAN_REF}.",),
            )
        )
    return candidates


def build_review_candidates_v1(stage: v0.BuildStage = "readiness") -> list[ReviewCandidate]:
    candidates: list[ReviewCandidate] = []
    if v0.STAGE_ORDER[stage] >= v0.STAGE_ORDER["cv101"]:
        candidates.extend(_cv101_candidates_v1())
    if v0.STAGE_ORDER[stage] >= v0.STAGE_ORDER["drive"]:
        candidates.extend(_drive_candidates_v1())
    if v0.STAGE_ORDER[stage] >= v0.STAGE_ORDER["printsense"]:
        candidates.extend(_printsense_style_candidates_v1())
    return candidates


# --------------------------------------------------------------------------
# build under a context-managed v0 override (v0 module code untouched)
# --------------------------------------------------------------------------
@contextlib.contextmanager
def _v1_build_context() -> Iterator[None]:
    saved = {
        "DATASET_VERSION": v0.DATASET_VERSION,
        "BUILD_ID": v0.BUILD_ID,
        "BUILD_TIMESTAMP": v0.BUILD_TIMESTAMP,
        "build_review_candidates": v0.build_review_candidates,
    }
    v0.DATASET_VERSION = DATASET_VERSION
    v0.BUILD_ID = BUILD_ID
    v0.BUILD_TIMESTAMP = BUILD_TIMESTAMP
    v0.build_review_candidates = build_review_candidates_v1
    try:
        yield
    finally:
        for name, value in saved.items():
            setattr(v0, name, value)


def write_build(
    out_dir: str | Path = DEFAULT_OUT_DIR,
    *,
    stage: v0.BuildStage = "readiness",
    decisions_path: str | Path | None = None,
    model_support: Any = None,
) -> dict:
    """Write the v1 artifacts through the proven v0 pipeline."""
    with _v1_build_context():
        return v0.write_build(
            out_dir,
            stage=stage,
            decisions_path=decisions_path,
            model_support=model_support,
        )


def candidate_manifest_v1() -> dict[str, Any]:
    with _v1_build_context():
        return v0.candidate_manifest_for(build_review_candidates_v1())


def import_review_decisions_v1(
    ledger_path: str | Path, decisions_path: str | Path
) -> dict[str, Any]:
    with _v1_build_context():
        candidates = build_review_candidates_v1()
        return v0.import_review_decisions(ledger_path, candidates, decisions_path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--stage", default="readiness", choices=list(v0.STAGE_ORDER))
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    ap.add_argument("--decisions-path", type=Path, default=None)
    ap.add_argument("--import-decisions", type=Path, default=None)
    ap.add_argument("--model-support-receipt", type=Path, default=None)
    ap.add_argument("--validate-only", action="store_true")
    args = ap.parse_args(argv)

    if args.import_decisions is not None:
        if args.decisions_path is None:
            raise SystemExit("--import-decisions requires --decisions-path")
        imported = import_review_decisions_v1(args.decisions_path, args.import_decisions)
        print(json.dumps(imported, indent=1))
        return 0

    if args.validate_only:
        with _v1_build_context():
            candidates = [c.to_dict() for c in build_review_candidates_v1(args.stage)]
            problems = v0.validate_candidates(candidates)
        print(json.dumps({"candidates": len(candidates), "problems": problems}, indent=1))
        return 1 if problems else 0

    model_support = None
    if args.model_support_receipt is not None:
        model_support = v0.load_model_support_receipt(args.model_support_receipt)
    result = write_build(
        args.out_dir,
        stage=args.stage,
        decisions_path=args.decisions_path,
        model_support=model_support,
    )
    print(json.dumps({k: v for k, v in result.items() if k != "files"}, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
