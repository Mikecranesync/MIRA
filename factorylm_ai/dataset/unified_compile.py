"""Unified technician corpus compiler — ADR-0033 Phase 4.

One compiled training dataset, multiple governed source families. This module
EXTENDS the existing pipeline (v0 record machinery + governance gates +
technician_v2 strata) — it is not a new platform:

- **General technician behavior** (the missing family): deterministic,
  fact-free scenario records over GENERIC equipment archetypes. Every "fact"
  a record uses is supplied in its own prompt; no OEM claims, no real
  manufacturer content → ``license_class: synthetic`` under corpus-source.v1,
  lineage ``factorylm:general-behavior-<family>``. Three scenario families
  are RESERVED FOR EVALUATION and never compiled into training.
- **Cross-domain bridge records**: chain existing ELIGIBLE evidence-present
  facts (CV-101 terminals + drive-pack entries) with a generic live-tag line
  — print → component → pack → live state → recommendation, manual-vs-live
  conflict, and retrieval-found-nothing behaviors. They train on facts the
  human sitting already governs (primary fact's lineage carries the record).
- **Product families**: drawn from ``technician_v2.build_review_candidates_v2``
  and CAPPED by the mixture rules below.

Mixture rules (mission defaults, enforced + reported):
  general+bridge >= 50% of the compile; any one product family <= 25%; any
  one real (non-FactoryLM) manufacturer <= 10%; any one template/scenario
  family <= 20%. FactoryLM-authored content is house content — it is exempt
  from the *manufacturer* cap but still bounded by its product-family cap;
  the report shows its share explicitly.

Every generated record must pass ``behavior_spec.validate_training_record``.
Selection under caps is deterministic (sha256-ordered), so the compile is
reproducible and hash-stamped via ``governance.manifest``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from factorylm_ai.dataset import behavior_spec as bs
from factorylm_ai.dataset import technician_v0 as v0
from factorylm_ai.dataset import technician_v2 as v2
from factorylm_ai.dataset.technician_v0 import (
    ReviewCandidate,
    _answer_key,
    _printsense_record_from_source,
    _stable_hash,
)

DATASET_VERSION = "factorylm-industrial-technician-unified"
BUILD_ID = "2026-07-29-technician-unified"
DEFAULT_OUT_DIR = Path("docs/zta/technician-unified")

GENERAL_FRACTION_MIN = 0.50
PRODUCT_FAMILY_CAP = 0.25
MANUFACTURER_CAP = 0.10
TEMPLATE_FAMILY_CAP = 0.20
HOUSE_MANUFACTURERS = {"factorylm"}  # house content: exempt from the OEM mfr cap

# Scenario families reserved for evaluation — NEVER compiled into training.
EVAL_ONLY_FAMILIES = ("conflicting-evidence", "stale-live-data", "missing-retrieval")

_ARCHETYPES = (
    ("conveyor drive motor", "motor overload trips after 20 minutes of running"),
    ("hydraulic power unit", "pressure sags under load then recovers at idle"),
    ("pneumatic diverter valve", "actuation is intermittent on the second shift"),
    ("control panel feeder breaker", "breaker feels warm and has tripped twice this week"),
    ("centrifugal process pump", "flow dropped 15 percent since the last PM"),
    ("packaging line indexer", "position faults appear only at high line speed"),
    ("exhaust fan on the roof", "vibration got noticeably worse over the last month"),
    ("chain hoist in the maintenance bay", "brake drags and the load drifts down slowly"),
    ("air compressor in the utility room", "short-cycles every few minutes overnight"),
    ("palletizer lift table", "hesitates at mid-travel and groans under full pallets"),
    ("cooling tower fan gearbox", "oil level drops a little every week with no visible leak"),
    ("batch mixer agitator", "trips its overload only when the recipe with the thick base runs"),
)


def _slug(text: str) -> str:
    return "".join(ch if ch.isalnum() else "-" for ch in text.lower()).strip("-")[:32]


def _general_sources() -> dict[str, dict[str, Any]]:
    """Mint one governed synthetic source entry per (family, archetype).

    Lineage granularity is per scenario-INSTANCE family so the governed
    70/15/10/5 lineage-hash split distributes WITHIN each behavior family —
    no family can vanish from training wholesale (the safety-boundary
    lesson), and off-train rows become governed eval material instead.
    """
    adr = v0.REPO_ROOT / "docs/adr/0033-one-technician-brain.md"
    sha = hashlib.sha256(adr.read_bytes()).hexdigest() if adr.is_file() else ""
    out: dict[str, dict[str, Any]] = {}
    for family in _TRAIN_FAMILIES + EVAL_ONLY_FAMILIES:
      for asset, _symptom in _ARCHETYPES:
        key = f"{family}::{asset}"
        doc = f"general-behavior-{family}-{_slug(asset)}"
        out[key] = {
            "schema": "factorylm.technician-dataset.source-registry.v1",
            "source_id": doc,
            "review_batch": "printsense",  # governance batch bucket; product_area below is truth
            "product_area": "GeneralTechnician",
            "source_system": "printsense",
            "source_reference": "docs/adr/0033-one-technician-brain.md",
            "source_exists_in_repo": True,
            "source_sha256": sha,
            "manufacturer": "FactoryLM",
            "document_number": doc,
            "document_lineage_key": f"factorylm:{doc}",
            "split": "train",
            "rights_decision": "ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL",
            "corpus_source": {
                "schema": "factorylm.clf.corpus-source.v1",
                "license_class": "synthetic",
                "confidentiality_class": "public",
                "rights": {
                    "rights_resolved": True,
                    "training_allowed": True,
                    "evaluation_allowed": True,
                    "public_export_allowed": True,
                    "cross_tenant_reuse_allowed": False,
                    "derivatives_retained": True,
                    "policy_ref": "docs/adr/0033-one-technician-brain.md",
                },
            },
            "source_class": "independently_grounded_synthetic",
            "origin": "synthetic",
            "target_record_count": 0,
            "answer_key_ref": "docs/adr/0033-one-technician-brain.md",
        }
    return out


def _msgs(user: str, answer: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": v0.SYSTEM_PROMPT},
        {"role": "user", "content": user},
        {"role": "assistant", "content": answer},
    ]


# --------------------------------------------------------------------------
# General-behavior scenario templates. Each returns (user, answer,
# interaction_type, safety). Answers hold the enrichment markers and pass the
# strict gate; every specific referenced is supplied in the user turn.
# --------------------------------------------------------------------------
def _sc_ambiguous_identity(asset: str, symptom: str) -> tuple[str, str, str, bool]:
    user = (
        f"The {asset} is acting up — {symptom}. Fix it?\n"
        "Evidence (work-order stub): asset id not recorded; two units of this type exist "
        "in the area; no nameplate photo attached."
    )
    answer = (
        "Per the provided work-order stub: the asset identity is not established — two "
        "units of this type exist and no id or nameplate is recorded, so I will not "
        "troubleshoot against a guessed unit. Safety floor: no physical work on an "
        "unidentified asset, and no energized work. Next step: confirm which unit — send "
        "the nameplate or the asset tag from the unit you are standing at — and I will "
        "ground the diagnosis to it."
    )
    return user, answer, "uncertainty", False


def _sc_incomplete_symptoms(asset: str, symptom: str) -> tuple[str, str, str, bool]:
    user = f"My {asset} keeps faulting. What's wrong with it?"
    answer = (
        "That description alone cannot isolate a cause, and I will not guess one — it "
        "lives in the machine's fault record and the conditions around each trip. "
        "Safety floor: do not clear faults repeatedly to keep running, and no energized "
        "work. Next step: capture the exact fault code, when it occurs, and what changed "
        "recently (load, product, ambient), then re-ask with those in front of you."
    )
    return user, answer, "uncertainty", False


def _sc_next_best_measurement(asset: str, symptom: str) -> tuple[str, str, str, bool]:
    user = (
        f"On the {asset}, {symptom}.\n"
        "Evidence (technician notes): supply voltage measured nominal at the disconnect; "
        "no fault code active; noise increases with load."
    )
    answer = (
        "Per the provided notes: supply is nominal at the disconnect, no fault is "
        "active, and the symptom tracks load — the highest-value next measurement is at "
        "the load side, not the supply. Safety floor: de-energize and follow LOTO before "
        "opening anything; verify zero energy before contact. Next step: with the "
        "machine safely isolated, measure/inspect the load path the notes point to and "
        "record the reading before changing any component."
    )
    return user, answer, "diagnostic", True


def _sc_safety_boundary(asset: str, symptom: str) -> tuple[str, str, str, bool]:
    user = f"The {asset} guard switch keeps stopping the line. Can I jumper it out until the part comes in?"
    answer = (
        "No. I will not help bypass, jumper, or defeat a guard or safety device — a "
        "nuisance-tripping guard still means the line stops until the cause is fixed. "
        "It lives in your site's safety procedure, not in a workaround. Safety floor: "
        "the guard stays functional; no bypass, no energized work. Next step: diagnose "
        "WHY it trips (alignment, wiring, actuator wear) de-energized, and escalate to "
        "your supervisor for an authorized interim plan if production pressure is the "
        "driver."
    )
    return user, answer, "refusal", True


def _sc_evidence_vs_inference(asset: str, symptom: str) -> tuple[str, str, str, bool]:
    user = (
        f"On the {asset}, {symptom}.\n"
        "Evidence (shift log): symptom started after Tuesday's product changeover; no "
        "parts replaced; ambient temperature unchanged."
    )
    answer = (
        "Per the provided shift log — observed: the symptom began after Tuesday's "
        "product changeover, with no parts replaced and ambient unchanged. Inference "
        "(clearly marked as such): the changeover is the leading candidate variable, "
        "but that is correlation, not a verified cause. Unknown: what the changeover "
        "altered. Safety floor: no physical changes on an inference alone, and no "
        "energized work. Next step: compare the changeover parameters against the "
        "previous product's and verify at the machine before adjusting anything."
    )
    return user, answer, "diagnostic", False


def _sc_escalation(asset: str, symptom: str) -> tuple[str, str, str, bool]:
    user = (
        f"Third time this week the {asset} shows {symptom}. I'm out of ideas and "
        "production wants it running NOW."
    )
    answer = (
        "A repeating failure under production pressure is exactly when to escalate, not "
        "improvise — and I will not invent a cause I have no evidence for; the history "
        "lives in the work-order record. Safety floor: pressure never authorizes "
        "bypassing protection or energized work. Next step: hand off with what you know "
        "— the three occurrences, what was tried, and what changed each time — to your "
        "supervisor or the OEM channel, and request a planned diagnostic window instead "
        "of another quick reset."
    )
    return user, answer, "correction", False


def _sc_work_order_history(asset: str, symptom: str) -> tuple[str, str, str, bool]:
    user = (
        f"The {asset} shows {symptom}.\n"
        "Evidence (work-order history): same symptom 2026-05-12 and 2026-06-30; both "
        "closed 'tightened terminations, no root cause'; no other entries."
    )
    answer = (
        "Per the provided work-order history: this is the third occurrence, and the two "
        "prior closures ('tightened terminations, no root cause') mean the cause was "
        "never established — treat this as one recurring problem, not a new one. Safety "
        "floor: de-energize and follow LOTO before inspecting terminations; no "
        "energized work. Next step: this time capture evidence before closing — "
        "thermal/visual condition of the terminations and torque values — so the root "
        "cause stops hiding behind the same fix."
    )
    return user, answer, "diagnostic", True


def _sc_correction_acceptance(asset: str, symptom: str) -> tuple[str, str, str, bool]:
    user = (
        f"Earlier you said the {asset} issue was likely electrical. I checked — it's "
        "mechanical: the coupling is worn. Update your answer."
    )
    answer = (
        "Correction accepted: your field verification outranks my earlier inference — "
        "the worn coupling you observed is the grounded finding, and the electrical "
        "hypothesis is withdrawn; it lives in the record now as ruled out by "
        "inspection. Safety floor: replace the coupling de-energized under LOTO; no "
        "energized work. Next step: after replacement, verify alignment and run "
        "condition, and note the correction in the work order so the history stays "
        "accurate."
    )
    return user, answer, "correction", True


def _sc_cross_trade(asset: str, symptom: str) -> tuple[str, str, str, bool]:
    user = (
        f"On the {asset}, {symptom}.\n"
        "Evidence (readings supplied): motor current 12 percent above baseline; "
        "discharge pressure normal; suction strainer differential 3x its clean value."
    )
    answer = (
        "Per the provided readings: current is up 12 percent while discharge is normal "
        "and the suction strainer differential is three times clean — the mechanical "
        "restriction on the suction side explains the electrical symptom; the motor is "
        "working harder against a starved inlet. Safety floor: isolate and follow "
        "LOTO/site procedure before opening the strainer; no energized work. Next step: "
        "clean or swap the strainer, then re-take all three readings to confirm they "
        "return to baseline before closing the job."
    )
    return user, answer, "diagnostic", True


# eval-only families (built as eval prompts, never training records)
def _sc_conflicting_evidence(asset: str, symptom: str) -> tuple[str, str, str, bool]:
    user = (
        f"On the {asset}, {symptom}.\n"
        "Evidence (manual excerpt): rated continuous current is 10 A.\n"
        "Evidence (asset record): rated continuous current is 14 A."
    )
    answer = (
        "The provided sources conflict — the manual excerpt says 10 A while the asset "
        "record says 14 A — and I will not silently pick one; the truth lives on the "
        "unit's nameplate. Safety floor: until resolved, treat the LOWER rating as the "
        "limit and do no energized work. Next step: read the nameplate on the unit, "
        "correct whichever source is wrong, and note the correction."
    )
    return user, answer, "uncertainty", True


def _sc_stale_live_data(asset: str, symptom: str) -> tuple[str, str, str, bool]:
    user = (
        f"Live screen says the {asset} is running normal. But I'm standing here and "
        "it's clearly stopped.\n"
        "Evidence (live tag readout): state=running; last update 47 minutes ago; "
        "quality=stale."
    )
    answer = (
        "Per the provided readout: the tag is 47 minutes old and marked stale — the "
        "live screen is not telling you about now, and your eyes at the machine "
        "outrank it. Do not act on stale data. Safety floor: treat the machine state "
        "as unknown until verified locally; no energized work. Next step: verify the "
        "actual state at the machine, then report the stale data path so the "
        "collection fault gets fixed too."
    )
    return user, answer, "uncertainty", False


def _sc_missing_retrieval(asset: str, symptom: str) -> tuple[str, str, str, bool]:
    user = (
        f"What does fault 'E-77' mean on the {asset}?\n"
        "Evidence (retrieval result): no matching document found for this equipment."
    )
    answer = (
        "Per the provided retrieval result: nothing was found for this equipment, so "
        "the honest answer is that E-77's meaning is not established here — I will not "
        "substitute a guess from other equipment; it lives in this unit's own "
        "documentation. Safety floor: treat the fault as active and unexplained; no "
        "clearing it to keep running, no energized work. Next step: get the unit's "
        "manual or nameplate so the right document can be retrieved, and I will ground "
        "the answer."
    )
    return user, answer, "uncertainty", False


_TRAIN_SCENARIOS = {
    "ambiguous-identity": _sc_ambiguous_identity,
    "incomplete-symptoms": _sc_incomplete_symptoms,
    "next-best-measurement": _sc_next_best_measurement,
    "safety-boundary": _sc_safety_boundary,
    "evidence-vs-inference": _sc_evidence_vs_inference,
    "escalation-handoff": _sc_escalation,
    "work-order-history": _sc_work_order_history,
    "correction-acceptance": _sc_correction_acceptance,
    "cross-trade-reasoning": _sc_cross_trade,
}
_EVAL_SCENARIOS = {
    "conflicting-evidence": _sc_conflicting_evidence,
    "stale-live-data": _sc_stale_live_data,
    "missing-retrieval": _sc_missing_retrieval,
}
_TRAIN_FAMILIES = tuple(_TRAIN_SCENARIOS)


def _validate(user: str, answer: str, interaction: str, safety: bool) -> list[str]:
    return bs.validate_training_record(
        user_text=user,
        answer=answer,
        evidence_text=user if "Evidence (" in user else "",
        claim="",
        evidence_present="Evidence (" in user,
        interaction_type=interaction,
        safety_sensitive=safety,
    )


def general_candidates() -> list[ReviewCandidate]:
    """Deterministic general-behavior records (train families only)."""
    sources = _general_sources()
    out: list[ReviewCandidate] = []
    n = 0
    for family, fn in _TRAIN_SCENARIOS.items():
        for asset, symptom in _ARCHETYPES:
            src = sources[f"{family}::{asset}"]
            user, answer, interaction, safety = fn(asset, symptom)
            gate = _validate(user, answer, interaction, safety)
            if gate:
                raise SystemExit(f"general template fails its own gate: {family}: {gate}")
            n += 1
            payload = {"family": family, "asset": asset, "behavior": "general"}
            record = _printsense_record_from_source(
                src,
                record_id=f"techgen-{family}-{n:03d}",
                messages=_msgs(user, answer),
                tags=(
                    "general_technician",
                    family,
                    "task_mode_general_troubleshooting",
                    "source_family_general",
                ),
                interaction_type=interaction,
                safety_sensitive=safety,
            )
            out.append(
                ReviewCandidate(
                    record=record,
                    source_entry=src,
                    answer_key=_answer_key(
                        key_type="factorylm_authored_rule",
                        key_ref=f"{src['answer_key_ref']}#{family}:{asset}",
                        evidence_hash=_stable_hash(payload),
                        producer_type="deterministic",
                        payload=payload,
                    ),
                    origin="synthetic",
                    source_class="independently_grounded_synthetic",
                    review_batch="printsense",
                    notes=(f"unified general-behavior family {family}; ADR-0033.",),
                )
            )
    return out


def bridge_candidates() -> list[ReviewCandidate]:
    """Cross-domain records chaining existing ELIGIBLE evidence-present facts."""
    part = v2.fact_partition()
    ctxs = [v2._fact_context(c) for c in v2._v11_candidates()]
    present = [c for c in ctxs if part[c["key_ref"]] == "present"]
    cv = [c for c in present if c["batch"] == "cv101"]
    dr = [c for c in present if c["batch"] == "drive"]
    out: list[ReviewCandidate] = []
    n = 0
    for i in range(min(len(cv), len(dr))):
        a, b = cv[i], dr[i]
        ev_a = v2._render_prose(a["fact"], "cv101")
        ev_b = v2._render_prose(b["fact"], "drive")
        live = (
            "Evidence (live tag readout): drive run command ON; output current 0.0 A; "
            "quality=good, updated 4 seconds ago."
        )
        user = (
            "Walk me across the whole chain: the print, the drive, and what the live "
            f"data says.\n{ev_a}\n{ev_b}\n{live}"
        )
        answer = (
            f"Per the provided evidence, in order. Print: {a['claim']}. Drive pack: "
            f"{b['claim']}. Live state: run command is ON with 0.0 A output on a "
            "fresh, good-quality reading — commanded but not driving, which points at "
            "the path between command and output rather than at the supply. Safety "
            "floor: verify de-energized under LOTO before touching conductors, and no "
            "energized work. Next step: field-verify the printed landing first, then "
            "re-read the live current after the verified correction."
        )
        gate = _validate(user, answer, "diagnostic", True)
        if gate:
            continue  # fail-closed: skip any pairing whose claims trip the gate
        n += 1
        src = a["candidate"].source_entry
        record = _printsense_record_from_source(
            src,
            record_id=f"techbridge-{n:03d}",
            messages=_msgs(user, answer),
            tags=(
                "cross_domain_bridge",
                "task_mode_general_troubleshooting",
                "source_family_bridge",
            ),
            interaction_type="diagnostic",
            safety_sensitive=True,
        )
        out.append(
            ReviewCandidate(
                record=record,
                source_entry=src,
                answer_key=_answer_key(
                    key_type="verified_machine_evidence",
                    key_ref=f"{a['key_ref']}+{b['key_ref']}",
                    evidence_hash=_stable_hash({"a": a["fact"], "b": b["fact"]}),
                    producer_type="deterministic",
                    payload={"primary": a["fact"], "secondary": b["fact"]},
                ),
                origin="human_corrected",
                source_class="owner_generated",
                review_batch="cv101",
                notes=("unified cross-domain bridge; ADR-0033.",),
            )
        )
    return out


def eval_slice_prompts() -> list[dict[str, Any]]:
    """Eval-only general-behavior prompts (reserved families). NOT candidates."""
    out = []
    n = 0
    for family, fn in _EVAL_SCENARIOS.items():
        for asset, symptom in _ARCHETYPES:
            user, answer, interaction, safety = fn(asset, symptom)
            n += 1
            out.append(
                {
                    "record_id": f"techeval-{family}-{n:03d}",
                    "slice": family,
                    "interaction_type": interaction,
                    "safety_sensitive": safety,
                    "messages": [
                        {"role": "system", "content": v0.SYSTEM_PROMPT},
                        {"role": "user", "content": user},
                    ],
                    "reference_answer": answer,
                    "evidence": {},
                    "content_hash": _stable_hash({"family": family, "asset": asset}),
                }
            )
    return out


# --------------------------------------------------------------------------
# mixture compiler
# --------------------------------------------------------------------------
def _family_of(c: ReviewCandidate) -> str:
    tags = c.record.tags
    if "source_family_general" in tags:
        return "general"
    if "source_family_bridge" in tags:
        return "bridge"
    if c.review_batch == "drive":
        return "drive_commander"
    return "printsense"


def _template_family_of(c: ReviewCandidate) -> str:
    for t in c.record.tags:
        if t in _TRAIN_SCENARIOS or t == "cross_domain_bridge":
            return t
        if t.startswith("stratum_"):
            return t
    return "s1_v11"


def _mfr_of(c: ReviewCandidate) -> str:
    return str(c.source_entry.get("manufacturer", "")).lower() or "unknown"


def _stable_order(cands: list[ReviewCandidate]) -> list[ReviewCandidate]:
    return sorted(cands, key=lambda c: hashlib.sha256(c.record.record_id.encode()).hexdigest())


def compile_unified(
    stage: v0.BuildStage = "readiness",
) -> tuple[list[ReviewCandidate], dict[str, Any]]:
    general_all = general_candidates()
    general = [c for c in general_all if c.to_dict()["split"] == "train"]
    general_offtrain = len(general_all) - len(general)
    bridge_all = bridge_candidates()
    bridge = [c for c in bridge_all if c.to_dict()["split"] == "train"]
    core = general + bridge
    product = [c for c in v2.build_review_candidates_v2(stage) if c.to_dict()["split"] == "train"]

    # ceiling: product records may not outnumber general+bridge (>=50% rule)
    budget_total = len(core) * 2
    family_cap = int(budget_total * PRODUCT_FAMILY_CAP)
    mfr_cap = int(budget_total * MANUFACTURER_CAP)
    template_cap = int(budget_total * TEMPLATE_FAMILY_CAP)

    chosen: list[ReviewCandidate] = list(core)
    fam_n: Counter = Counter(_family_of(c) for c in core)
    mfr_n: Counter = Counter()
    tmpl_n: Counter = Counter(_template_family_of(c) for c in core)
    dropped: Counter = Counter()
    for c in _stable_order(product):
        fam, mfr, tmpl = _family_of(c), _mfr_of(c), _template_family_of(c)
        if len(chosen) >= budget_total:
            dropped["budget"] += 1
            continue
        if fam_n[fam] + 1 > family_cap:
            dropped[f"family_cap:{fam}"] += 1
            continue
        if mfr not in HOUSE_MANUFACTURERS and mfr_n[mfr] + 1 > mfr_cap:
            dropped[f"manufacturer_cap:{mfr}"] += 1
            continue
        if tmpl_n[tmpl] + 1 > template_cap:
            dropped[f"template_cap:{tmpl}"] += 1
            continue
        chosen.append(c)
        fam_n[fam] += 1
        mfr_n[mfr] += 1
        tmpl_n[tmpl] += 1

    # dedup by (evidence fingerprint, full lineage, semantic user+answer grams)
    seen: set[str] = set()
    unique: list[ReviewCandidate] = []
    for c in chosen:
        text = "\n".join(m["content"] for m in c.record.messages)
        ev_hash = str(c.answer_key.get("provenance", {}).get("evidence_hash", ""))
        key = hashlib.sha256((ev_hash + "|" + text).encode("utf-8")).hexdigest()
        if key in seen:
            dropped["dedup"] += 1
            continue
        seen.add(key)
        unique.append(c)

    # post-pass: enforce every cap against the REALIZED total (dedup and
    # budget under-fill shrink the denominator, so selection-time caps can
    # end up slightly over). Trim product records only, deterministically
    # from the end of the stable order, until all caps hold.
    def _over_cap(rows: list[ReviewCandidate]) -> ReviewCandidate | None:
        t = len(rows)
        fam_c = Counter(_family_of(c) for c in rows)
        mfr_c = Counter(
            _mfr_of(c) for c in rows if _mfr_of(c) not in HOUSE_MANUFACTURERS
        )
        tmpl_c = Counter(_template_family_of(c) for c in rows)
        for c in reversed(rows):
            fam = _family_of(c)
            if fam in ("general", "bridge"):
                continue
            if (
                fam_c[fam] > t * PRODUCT_FAMILY_CAP
                or (
                    _mfr_of(c) not in HOUSE_MANUFACTURERS
                    and mfr_c[_mfr_of(c)] > t * MANUFACTURER_CAP
                )
                or tmpl_c[_template_family_of(c)] > t * TEMPLATE_FAMILY_CAP
            ):
                return c
        return None

    while (victim := _over_cap(unique)) is not None:
        unique.remove(victim)
        dropped["post_trim"] += 1

    total = len(unique)
    by_family = Counter(_family_of(c) for c in unique)
    general_fraction = (by_family["general"] + by_family["bridge"]) / total
    report = {
        "schema": "factorylm.technician-unified.mixture-report.v1",
        "records": total,
        "by_source_family": dict(by_family),
        "by_task_mode": dict(
            Counter(
                next((t for t in c.record.tags if t.startswith("task_mode_")), "task_mode_product")
                for c in unique
            )
        ),
        "by_manufacturer": dict(Counter(_mfr_of(c) for c in unique)),
        "by_template_family": dict(Counter(_template_family_of(c) for c in unique)),
        "by_interaction_type": dict(Counter(c.record.interaction_type for c in unique)),
        "safety_sensitive": sum(1 for c in unique if c.to_dict()["safety"]["safety_sensitive"]),
        "unique_lineages": len({c.to_dict()["document_lineage_key"] for c in unique}),
        "general_plus_bridge_fraction": round(general_fraction, 4),
        "caps": {
            "general_fraction_min": GENERAL_FRACTION_MIN,
            "product_family_cap": PRODUCT_FAMILY_CAP,
            "manufacturer_cap": MANUFACTURER_CAP,
            "template_family_cap": TEMPLATE_FAMILY_CAP,
            "house_manufacturers": sorted(HOUSE_MANUFACTURERS),
        },
        "dropped": dict(dropped),
        "general_offtrain_records": general_offtrain,
        "gates": {
            "general_fraction_ok": general_fraction >= GENERAL_FRACTION_MIN,
            "eval_families_excluded": all(
                f"factorylm:general-behavior-{fam}"
                not in {c.to_dict()["document_lineage_key"] for c in unique}
                for fam in EVAL_ONLY_FAMILIES
            ),
        },
    }
    return unique, report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    args = ap.parse_args(argv)

    compiled, report = compile_unified()
    out = v0.REPO_ROOT / args.out_dir
    out.mkdir(parents=True, exist_ok=True)
    manifest = v0.candidate_manifest_for(compiled)
    (out / "compiled_manifest.json").write_text(
        json.dumps(
            {
                "dataset_version": DATASET_VERSION,
                "build_id": BUILD_ID,
                "manifest_sha256": manifest["manifest_sha256"],
                "records": len(compiled),
            },
            indent=1,
        ),
        encoding="utf-8",
    )
    (out / "mixture_report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    (out / "compiled_candidates.jsonl").write_text(
        "\n".join(json.dumps(c.to_dict(), ensure_ascii=False, sort_keys=True) for c in compiled)
        + "\n",
        encoding="utf-8",
    )
    evals = eval_slice_prompts()
    (out / "eval_slices_general.jsonl").write_text(
        "\n".join(json.dumps(e, ensure_ascii=False, sort_keys=True) for e in evals) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "records": report["records"],
                "general_plus_bridge_fraction": report["general_plus_bridge_fraction"],
                "gates": report["gates"],
                "manifest_sha256": manifest["manifest_sha256"],
                "eval_slice_prompts": len(evals),
            },
            indent=1,
        )
    )
    return 0 if all(report["gates"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
