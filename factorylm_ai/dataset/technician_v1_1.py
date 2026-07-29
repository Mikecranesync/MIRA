"""Technician dataset v1.1 — the enriched-answer build.

Recipe source: the two v1 hold-out scorecards
(``docs/zta/technician-dataset-v1/holdout-eval/SCORECARD.md`` and
``…/holdout-eval/track2/SCORECARD.md``). The v1 model won the discipline
lenses outright (Track 1 grounding 18-0-7, Track 2 no-overreach 23-1-1) but
lost richness: its answers stated the bare fact with no citation wrapper, no
safety elaboration, and no next step — and the usefulness/citation/safety
judges rewarded exactly those. v1.1 keeps the v1 evidence contract UNCHANGED
and enriches every answer with three standardized elements:

1. an explicit **citation phrase** naming the evidence source (A / C-with-
   evidence) or the exact place the fact lives (B / C-without-evidence);
2. a **"Safety floor:"** sentence holding the no-energized-work / no-bypass /
   LOTO line;
3. a **"Next step:"** line telling the technician the immediate verify/act
   move.

The markers are literal (``Per the``/``It lives in``, ``Safety floor:``,
``Next step:``) so the invariant is testable and the trained output shape is
consistent. Pattern B / C-without-evidence answers still NEVER contain the
claim.

Like v1 over v0, this module reuses the frozen machinery and never edits it:
the build runs ``technician_v0.write_build`` under a context-managed override
of the version constants and the candidate seam. Record ids use the
``techv11-`` prefix so a review-console instance can never confuse v1.1 cards
with replayed v1 decisions.
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
from factorylm_ai.dataset.technician_v1 import (
    _cv101_evidence_line,
    _drive_evidence_line,
    _pattern_for,
    _pattern_tag,
    _style_evidence_line,
    _v1_interaction,
    _with_evidence_variant,
)

DATASET_VERSION = "factorylm-industrial-technician-v1.1"
BUILD_ID = "2026-07-28-technician-dataset-v1.1"
BUILD_TIMESTAMP = "2026-07-28T00:00:00Z"
DEFAULT_OUT_DIR = Path("docs/zta/technician-dataset-v1.1")
PLAN_REF = (
    "docs/zta/2026-07-27-technician-dataset-v1-plan.md + "
    "docs/zta/technician-dataset-v1/holdout-eval/SCORECARD.md (v1.1 enrichment recipe)"
)


def _messages(user: str, assistant: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": v0.SYSTEM_PROMPT},
        {"role": "user", "content": user},
        {"role": "assistant", "content": assistant},
    ]


# --------------------------------------------------------------------------
# v1.1 enriched message templates — citation + "Safety floor:" + "Next step:"
# --------------------------------------------------------------------------
def _drive_v1_1_messages(
    source: dict[str, Any], fact: dict[str, Any], pattern: str, interaction: str
) -> list[dict[str, str]]:
    family = source["drive_model"]
    subject = fact["subject"]
    evidence = _drive_evidence_line(fact)
    page = fact.get("page")
    if pattern == "A":
        user = (
            f"{family}: identify {subject} from the deterministic Drive Commander pack.\n{evidence}"
        )
        answer = (
            f"Per the provided Drive Commander pack evidence (page {page}): {fact['claim']}. "
            "Safety floor: this is a grounded lookup, not authorization to reset, clear, "
            "bypass, or perform energized work — follow LOTO/site procedure for any physical "
            f"action. Next step: confirm the entry against pack page {page} for your unit's "
            "firmware before acting on it."
        )
        return _messages(user, answer)
    if pattern == "B":
        user = f"{family}: identify {subject} from the deterministic Drive Commander pack."
        answer = (
            f"That definition is not in the evidence in front of me, so I will not guess "
            f"what {subject} means — a wrong fault definition sends you at the wrong hazard. "
            f"It lives in the {family} fault/parameter table of the Drive Commander pack or "
            "the manual's fault chapter. Safety floor: F-codes are faults, not parameters — "
            f"treat {subject} as active; do not clear, suppress, or bypass it, and no "
            f"energized work. Next step: pull the {family} pack entry and share it, and I "
            "will ground the answer."
        )
        return _messages(user, answer)
    with_ev = _with_evidence_variant(fact)
    if interaction == "refusal":
        user = f"{family} shows {subject}. Can I suppress it and keep the line running?"
        if with_ev:
            user = f"{user}\n{evidence}"
            answer = (
                f"No. Do not suppress or bypass a drive fault to keep running. Per the "
                f"provided Drive Commander pack evidence (page {page}): {fact['claim']}. "
                "Safety floor: an active fault means stop — no bypass, no jumper, no "
                "energized work. Next step: stop the drive, follow site procedure, and "
                "diagnose the recorded cause before any restart."
            )
        else:
            answer = (
                f"No. Do not suppress or bypass a drive fault to keep running, whatever "
                f"{subject} turns out to be — I will not guess its definition without the "
                f"pack entry; it lives in the {family} fault table. Safety floor: treat "
                "the fault as active — no bypass, no jumper, no energized work. Next step: "
                f"stop the drive, follow site procedure, and pull the {family} fault table "
                "before inspection."
            )
    elif interaction == "uncertainty":
        user = f"I see {subject} on a {family}. What is known, and what is still uncertain?"
        if with_ev:
            user = f"{user}\n{evidence}"
            related = ", ".join(fact.get("related_parameters", []) or ["none"])
            answer = (
                f"Known, per the provided Drive Commander pack evidence (page {page}): "
                f"{fact['claim']}. Related parameters: {related}. Uncertain: the live cause "
                "and drive state. Safety floor: until the cause is verified, do not clear "
                "the fault, bypass safety devices, or work energized. Next step: verify at "
                "the machine against the pack entry before acting."
            )
        else:
            answer = (
                f"Known: {subject} is an identifier the {family} pack defines; without the "
                "pack entry in front of me its definition is NOT known here, and I will not "
                "guess it — it lives in the pack's fault/parameter table. Uncertain: the "
                "definition, cause, and drive state. Safety floor: do not clear the fault, "
                "bypass safety devices, or work energized. Next step: pull the pack entry "
                "and re-ask with it in front of you."
            )
    else:  # correction
        user = f"Correct this {family} lookup for {subject}; I may be mixing parameters and faults."
        if with_ev:
            user = f"{user}\n{evidence}"
            faults = ", ".join(fact.get("related_faults", []) or ["none"])
            related = ", ".join(fact.get("related_parameters", []) or ["none"])
            answer = (
                f"Correction: keep fault IDs and parameter IDs separate. Per the provided "
                f"Drive Commander pack evidence (page {page}): {fact['claim']}. Related "
                f"faults: {faults}; related parameters: {related}. Safety floor: a corrected "
                "lookup is still not authorization for resets, bypass, or energized work. "
                "Next step: carry the corrected IDs exactly and verify them against the pack "
                "entry before acting."
            )
        else:
            answer = (
                "Correction: keep fault IDs and parameter IDs separate — F-prefixed codes "
                f"are faults, P/A/d-prefixed codes are parameters. The specific definition "
                f"of {subject} is not in front of me and I will not guess it; it lives in "
                f"the {family} pack entry. Safety floor: until it is grounded, no resets, "
                "no bypass, no energized work. Next step: pull the pack entry and I will "
                "ground the corrected lookup."
            )
    return _messages(user, answer)


def _cv101_v1_1_messages(
    fact: dict[str, Any], pattern: str, interaction: str
) -> list[dict[str, str]]:
    subject = fact["subject"]
    status = fact["status"]
    sheet = fact["sheet"]
    evidence = _cv101_evidence_line(fact)
    if pattern == "A":
        user = f"CV-101 sheet {sheet}: what should I know about {subject}?\n{evidence}"
        answer = (
            f"Per the provided CV-101 evidence package (sheet {sheet}, status {status}): "
            f"{fact['claim']}. Safety floor: do not lift, land, or jumper conductors from "
            "this lookup alone, and no energized work. Next step: carry the source status "
            "exactly and field-verify anything marked field_verify before relying on it."
        )
        return _messages(user, answer)
    if pattern == "B":
        user = f"CV-101 sheet {sheet}: what should I know about {subject}?"
        answer = (
            f"That detail is not in the evidence in front of me, so I will not describe "
            f"{subject} from memory — inventing terminal or wiring detail is how wrong "
            f"landings happen. It lives in the CV-101 evidence package for sheet {sheet} "
            "(components/connections/terminals tables). Safety floor: treat the wiring as "
            "unverified — do not lift or land conductors on an assumption, and no energized "
            "work. Next step: pull the sheet's evidence row and share it, and I will ground "
            "the answer."
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
                f"provided CV-101 evidence package (sheet {sheet}): {fact['claim']} "
                f"(status {status}). Safety floor: de-energize and follow LOTO/site "
                "procedure before touching conductors. Next step: use the drawing only to "
                "identify what must be verified, then verify it de-energized."
            )
        else:
            answer = (
                f"No. Do not bypass or jumper around {subject}, and I will not guess its "
                "wiring detail without the CV-101 evidence row — it lives in the sheet's "
                "evidence package. Safety floor: de-energize and follow LOTO/site procedure "
                "before touching conductors. Next step: pull the sheet's evidence package, "
                "then verify the circuit de-energized."
            )
    elif interaction == "uncertainty":
        user = f"Can I rely on the CV-101 {subject} detail without checking the machine?"
        if with_ev:
            user = f"{user}\n{evidence}"
            answer = (
                f"Use calibrated uncertainty. Per the provided CV-101 evidence package "
                f"(sheet {sheet}): {fact['claim']}. Because the status is {status}, that is "
                "the ceiling of what is known. Safety floor: do not act on unverified "
                "wiring, and no energized work. Next step: preserve the status and "
                "field-verify anything marked field_verify before relying on it for work."
            )
        else:
            answer = (
                f"Not without evidence. The {subject} detail is not in front of me and I "
                "will not restate it from memory — it lives in the CV-101 evidence package "
                "for the sheet. Safety floor: treat the wiring as unverified and do no "
                "energized work. Next step: pull the evidence row, carry its source status "
                "exactly, and field-verify anything marked field_verify."
            )
    else:  # correction
        user = f"Correct my CV-101 note for {subject}; I may have treated an uncertain item as verified."
        if with_ev:
            user = f"{user}\n{evidence}"
            answer = (
                f"Correction: carry the source status exactly. Per the provided CV-101 "
                f"evidence package (sheet {sheet}): {fact['claim']}. Do not promote it "
                f"beyond {status}. Safety floor: an uncertain item is not a basis for "
                "physical work — no energized work on unverified detail. Next step: put the "
                "remaining uncertainty into the open-items/review flow before closing the "
                "note."
            )
        else:
            answer = (
                "Correction: carry the source status exactly, and never promote an "
                f"uncertain item to verified without the evidence row — the {subject} "
                "detail is not in front of me and I will not restate it from memory; it "
                "lives in the CV-101 evidence package. Safety floor: no physical work on "
                "unverified detail. Next step: pull the evidence package and re-ground "
                "the note against its recorded status."
            )
    return _messages(user, answer)


def _style_v1_1_messages(
    fact: dict[str, Any], pattern: str, interaction: str
) -> list[dict[str, str]]:
    subject = fact["subject"]
    evidence = _style_evidence_line(fact)
    if pattern == "A":
        user = f"What is the PrintSense guidance for {subject}?\n{evidence}"
        answer = (
            f"Per the provided FactoryLM-authored guidance: {fact['claim']} Safety floor: "
            "style pressure never justifies inventing unseen terminals or safety behavior. "
            "Next step: apply the rule as written and route any claim it cannot support to "
            "review."
        )
        return _messages(user, answer)
    if pattern == "B":
        user = f"What is the PrintSense guidance for {subject}?"
        answer = (
            f"The specific {subject} rule text is not in front of me, so I will not "
            "paraphrase it from memory — style rules are exact by design. It lives in the "
            "FactoryLM print-style guide. Safety floor: cite evidence, keep "
            "verified/field-verify/reviewer boundaries explicit, and never invent unseen "
            "terminals or safety behavior. Next step: pull the rule text and share it, and "
            "I will apply it."
        )
        return _messages(user, answer)
    with_ev = _with_evidence_variant(fact)
    if interaction == "refusal":
        user = f"Can I ignore the PrintSense rule for {subject} and just answer confidently?"
        if with_ev:
            user = f"{user}\n{evidence}"
            answer = (
                f"No. Per the provided FactoryLM-authored rule: {fact['claim']} Safety "
                "floor: confidence without evidence is the exact failure mode this rule "
                "stops — never invent unseen terminals or safety behavior. Next step: if "
                "the evidence is missing, refuse the unsupported claim and route it to "
                "review."
            )
        else:
            answer = (
                f"No. Confidence without evidence is the failure mode the {subject} rule "
                "exists to stop, and I will not restate the rule from memory — it lives in "
                "the FactoryLM print-style guide. Safety floor: unsupported claims get "
                "refused, not asserted. Next step: pull the rule from the style guide; "
                "until then refuse unsupported claims and route them to review."
            )
    elif interaction == "uncertainty":
        user = f"What uncertainty should I preserve for PrintSense {subject}?"
        if with_ev:
            user = f"{user}\n{evidence}"
            answer = (
                f"Per the provided FactoryLM-authored guidance, preserve the evidence "
                f"boundary: {fact['claim']} Safety floor: never blur "
                "verified/field-verify/reviewer boundaries to sound complete. Next step: "
                "state what is verified, what is field-verify, and what needs a reviewer."
            )
        else:
            answer = (
                f"Preserve the evidence boundary itself: without the {subject} rule text in "
                "front of me I will not paraphrase it — it lives in the FactoryLM "
                "print-style guide. Safety floor: never blur verified/field-verify/reviewer "
                "boundaries to sound complete. Next step: pull the rule before asserting "
                "its specifics, and state what is verified, field-verify, or "
                "reviewer-needed."
            )
    else:  # correction
        user = f"Correct a PrintSense answer that violates the {subject} rule."
        if with_ev:
            user = f"{user}\n{evidence}"
            answer = (
                f"Correction, per the provided FactoryLM-authored rule: {fact['claim']} "
                "Safety floor: the rewrite must not invent unseen terminals or safety "
                "behavior. Next step: rewrite the answer so it cites its evidence and "
                "strips every unsupported claim."
            )
        else:
            answer = (
                f"Correction: the answer must cite the {subject} rule, and I will not "
                "restate that rule from memory — it lives in the FactoryLM print-style "
                "guide. Safety floor: the rewrite must not invent unseen terminals or "
                "safety behavior. Next step: pull the rule text, rewrite the answer to "
                "cite it, and strip anything unsupported."
            )
    return _messages(user, answer)


# --------------------------------------------------------------------------
# v1.1 candidate builders — v1 structure, techv11- ids, enriched messages
# --------------------------------------------------------------------------
def _cv101_candidates_v1_1() -> list[ReviewCandidate]:
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
                record_id=f"techv11-cv101-{sequence:03d}",
                messages=_cv101_v1_1_messages(item, pattern, interaction),
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
                    notes=(f"v1.1 enriched-answer pattern {pattern}; recipe {PLAN_REF}.",),
                )
            )
    return candidates


def _drive_candidates_v1_1() -> list[ReviewCandidate]:
    sources = {s["source_id"]: s for s in v0._drive_sources()}
    candidates: list[ReviewCandidate] = []
    sequence = 0
    for source_id, target in v0._DRIVE_TARGETS.items():
        source = sources[f"drive-{source_id}"]
        gold = v0._read_json(v0.REPO_ROOT / source["source_reference"])
        facts = v0._drive_facts(source_id, gold)
        for fact in _repeat_to_count(facts, min(target, len(facts))):
            sequence += 1
            pattern = _pattern_for(sequence)
            interaction = _v1_interaction(pattern, sequence, safety=bool(fact["safety_sensitive"]))
            record = _drive_record_from_source(
                source,
                record_id=f"techv11-drive-{sequence:03d}",
                messages=_drive_v1_1_messages(source, fact, pattern, interaction),
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
                    notes=(f"v1.1 enriched-answer pattern {pattern}; recipe {PLAN_REF}.",),
                )
            )
    return candidates


def _printsense_style_candidates_v1_1() -> list[ReviewCandidate]:
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
            record_id=f"techv11-ps-style-{sequence:03d}",
            messages=_style_v1_1_messages(fact, pattern, interaction),
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
                notes=(f"v1.1 enriched-answer pattern {pattern}; recipe {PLAN_REF}.",),
            )
        )
    return candidates


def build_review_candidates_v1_1(stage: v0.BuildStage = "readiness") -> list[ReviewCandidate]:
    candidates: list[ReviewCandidate] = []
    if v0.STAGE_ORDER[stage] >= v0.STAGE_ORDER["cv101"]:
        candidates.extend(_cv101_candidates_v1_1())
    if v0.STAGE_ORDER[stage] >= v0.STAGE_ORDER["drive"]:
        candidates.extend(_drive_candidates_v1_1())
    if v0.STAGE_ORDER[stage] >= v0.STAGE_ORDER["printsense"]:
        candidates.extend(_printsense_style_candidates_v1_1())
    return candidates


# --------------------------------------------------------------------------
# build under a context-managed v0 override (v0/v1 module code untouched)
# --------------------------------------------------------------------------
@contextlib.contextmanager
def _v1_1_build_context() -> Iterator[None]:
    saved = {
        "DATASET_VERSION": v0.DATASET_VERSION,
        "BUILD_ID": v0.BUILD_ID,
        "BUILD_TIMESTAMP": v0.BUILD_TIMESTAMP,
        "build_review_candidates": v0.build_review_candidates,
    }
    v0.DATASET_VERSION = DATASET_VERSION
    v0.BUILD_ID = BUILD_ID
    v0.BUILD_TIMESTAMP = BUILD_TIMESTAMP
    v0.build_review_candidates = build_review_candidates_v1_1
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
    """Write the v1.1 artifacts through the proven v0 pipeline."""
    with _v1_1_build_context():
        return v0.write_build(
            out_dir,
            stage=stage,
            decisions_path=decisions_path,
            model_support=model_support,
        )


def candidate_manifest_v1_1() -> dict[str, Any]:
    with _v1_1_build_context():
        return v0.candidate_manifest_for(build_review_candidates_v1_1())


def import_review_decisions_v1_1(
    ledger_path: str | Path, decisions_path: str | Path
) -> dict[str, Any]:
    with _v1_1_build_context():
        candidates = build_review_candidates_v1_1()
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
        imported = import_review_decisions_v1_1(args.decisions_path, args.import_decisions)
        print(json.dumps(imported, indent=1))
        return 0

    if args.validate_only:
        with _v1_1_build_context():
            candidates = [c.to_dict() for c in build_review_candidates_v1_1(args.stage)]
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
