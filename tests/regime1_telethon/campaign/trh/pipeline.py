"""Failure -> regression pipeline.

The gap this closes: a live staging/production failure currently costs a manual
investigation, and the investigation's output is prose in a GitHub comment. The
next person re-derives it. `capture()` makes the same failure produce five
durable artifacts in one call:

    1. a reproducible OFFLINE fixture (JSON, replayable with no bot and no LLM)
    2. synthetic NEIGHBOURS anchored to the same oracle
    3. a stage-by-stage DIAGNOSIS
    4. a classified ROOT CAUSE naming the subsystem
    5. a GitHub-ready DEFECT REPORT

and, once repaired, the fixture is already a permanent regression test.

Fixtures are written under `campaign/trh/fixtures/`, which is COMMITTED —
unlike the campaign ledger, which is gitignored and local-only. That is the
whole point: the reason `campaign/manifest.py` had to exist is that the ledgers
could not travel. A captured failure must survive the machine that saw it.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from ..evidence import ConversationEvidence, TurnEvidence
from . import classify as classify_mod
from . import oracles as oracles_mod
from . import synthesize
from .stages import GradeContext, grade_turn

FIXTURE_DIR = Path(__file__).parent / "fixtures"


@dataclass
class CapturedFailure:
    """Everything needed to reproduce, diagnose and eventually regression-test."""

    fixture_id: str
    source: str  # e.g. "staging campaign c12s42" / "prod telegram"
    oracle_id: str | None
    conversation: dict[str, Any]
    diagnosis: list[dict] = field(default_factory=list)
    classification: dict | None = None
    neighbours: list[dict] = field(default_factory=list)
    notes: str = ""

    def path(self) -> Path:
        return FIXTURE_DIR / f"{self.fixture_id}.json"

    def save(self) -> Path:
        FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
        p = self.path()
        p.write_text(json.dumps(asdict(self), indent=2, sort_keys=True), encoding="utf-8")
        return p


def _turn_dict(t: TurnEvidence) -> dict:
    return {
        "index": t.index,
        "technician_message": t.technician_message,
        "mira_reply": t.mira_reply,
        "uns_manufacturer": t.uns_manufacturer,
        "uns_model": t.uns_model,
        "uns_fault_code": t.uns_fault_code,
        "retrieval_query": t.retrieval_query,
        "retrieval_embedded": t.retrieval_embedded,
        "retrieved_meta": t.retrieved_meta,
        "citations": t.citations,
        "param_support": t.param_support,
        "engine_markers": t.engine_markers,
        "fsm_before": t.fsm_before,
        "fsm_after": t.fsm_after,
    }


def load_fixture(path: Path) -> ConversationEvidence:
    """Rebuild a ConversationEvidence from a saved fixture."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    conv = raw["conversation"]
    turns = [TurnEvidence(**t) for t in conv["turns"]]
    return ConversationEvidence(
        conv_id=conv.get("conv_id", raw["fixture_id"]),
        turns=turns,
        backend=conv.get("backend", "fixture"),
        source_campaign=conv.get("source_campaign"),
        notes={"captured_from": raw.get("source", "")},
    )


def diagnose(
    conv: ConversationEvidence,
    oracle: oracles_mod.Oracle | None = None,
    corpus=None,
    conversation_violations=None,
) -> tuple[list, list]:
    """Grade + classify every turn. Returns (diagnoses, classifications)."""
    diagnoses = []
    for i, turn in enumerate(conv.turns):
        ctx = GradeContext(
            oracle=oracle,
            corpus=corpus,
            prior_turns=conv.turns[:i],
            conversation_violations=list(conversation_violations or []),
        )
        diagnoses.append(grade_turn(turn, ctx, conv_id=conv.conv_id))
    return diagnoses, classify_mod.classify_conversation(diagnoses)


def capture(
    conv: ConversationEvidence,
    source: str,
    registry: dict[str, oracles_mod.Oracle] | None = None,
    corpus=None,
    conversation_violations=None,
    neighbour_count: int = 3,
) -> CapturedFailure:
    """Turn one observed conversation into a durable, diagnosed fixture."""
    reg = registry if registry is not None else oracles_mod.load()
    oracle = oracles_mod.for_case(conv.conv_id, reg)

    diagnoses, classifications = diagnose(
        conv, oracle=oracle, corpus=corpus, conversation_violations=conversation_violations
    )

    # The worst turn drives the classification: the EARLIEST failing turn, not
    # the last. c12 found all four `pivot_after_fault` failures at turn 2 while
    # the fingerprint named turn 3 — reading the final turn hides the cause.
    failing = [c for c in classifications if c.primary is not None]
    primary_cls = failing[0] if failing else None

    neighbours = (
        synthesize.as_dicts(synthesize.neighbours_for_failure(oracle, count=neighbour_count))
        if oracle
        else []
    )

    return CapturedFailure(
        fixture_id=f"trh_{conv.conv_id}".replace("/", "_"),
        source=source,
        oracle_id=oracle.id if oracle else None,
        conversation={
            "conv_id": conv.conv_id,
            "backend": conv.backend,
            "source_campaign": conv.source_campaign,
            "turns": [_turn_dict(t) for t in conv.turns],
        },
        diagnosis=[
            {
                "turn": d.turn_index,
                "verdict": d.verdict(),
                "grades": [
                    {
                        "stage": g.stage.value,
                        "verdict": g.verdict,
                        "detail": g.detail,
                        "evidence": g.evidence,
                    }
                    for g in d.grades
                ],
            }
            for d in diagnoses
        ],
        classification=primary_cls.as_dict() if primary_cls else None,
        neighbours=neighbours,
        notes=(
            ""
            if oracle
            else "NO ORACLE registered for this case — INGEST/RETRIEVAL/EVIDENCE "
            "cannot be decided. Add one to oracles.yml before drawing conclusions."
        ),
    )


# ---------------------------------------------------------------------------
# Defect report
# ---------------------------------------------------------------------------


def defect_report(cap: CapturedFailure) -> str:
    """A GitHub-ready issue body.

    Deliberately leads with the classification and the subsystem. A reader who
    stops after two lines should still know which module to open — that is the
    directive's success criterion, and prose-first reports fail it.
    """
    cls = cap.classification or {}
    label = cls.get("primary", "UNCLASSIFIED")
    lines = [
        f"## {label} — {cap.fixture_id}",
        "",
        f"**Subsystem to repair:** {cls.get('subsystem') or 'unknown — no oracle registered'}",
        f"**Confidence:** {cls.get('confidence', 'n/a')}  ·  **Source:** {cap.source}",
        f"**Oracle:** `{cap.oracle_id or 'NONE'}`",
        "",
        "### Why this class",
        "",
        cls.get("explanation", "_no classification — see notes_"),
    ]
    if cap.notes:
        lines += ["", f"> ⚠️ {cap.notes}"]

    lines += [
        "",
        "### Stage grades",
        "",
        "| turn | "
        + " | ".join(g["stage"] for g in (cap.diagnosis[0]["grades"] if cap.diagnosis else []))
        + " |",
    ]
    if cap.diagnosis:
        lines.append("|" + "---|" * (len(cap.diagnosis[0]["grades"]) + 1))
        for d in cap.diagnosis:
            cells = []
            for g in d["grades"]:
                v = g["verdict"]
                cells.append(
                    {"PASS": "✅", "FAIL": "❌", "INCONCLUSIVE": "·", "NOT_OBSERVED": "–"}.get(v, v)
                )
            lines.append(f"| {d['turn']} | " + " | ".join(cells) + " |")
        lines += [
            "",
            "_✅ pass · ❌ fail · `·` inconclusive · `–` not observed. "
            "The last two are NOT passes._",
        ]

    lines += ["", "### Transcript", ""]
    for t in cap.conversation["turns"]:
        if t.get("technician_message"):
            lines.append(f"**tech:** {t['technician_message']}")
        if t.get("mira_reply"):
            lines.append(f"**MIRA:** {t['mira_reply']}")
        lines.append("")

    ev = cls.get("evidence") or {}
    if ev:
        lines += [
            "### Evidence",
            "",
            "```json",
            json.dumps(ev, indent=2, sort_keys=True)[:1800],
            "```",
            "",
        ]

    if cap.neighbours:
        lines += [
            "### Neighbouring cases to run",
            "",
            "Same oracle, different phrasing — answers *is this one bad phrasing, or "
            "is the whole question class broken?*",
            "",
        ]
        for n in cap.neighbours:
            sends = " → ".join(t["send"] for t in n["turns"])
            lines.append(f"- **{n['register']}**: {sends}")
        lines.append("")

    lines += [
        "### Reproduce offline (no bot, no LLM, $0)",
        "",
        "```bash",
        "py -3 -m tests.regime1_telethon.campaign.trh.cli diagnose \\",
        f"    --fixture tests/regime1_telethon/campaign/trh/fixtures/{cap.fixture_id}.json",
        "```",
        "",
        "### After the fix",
        "",
        "This fixture is already the regression test — re-run the command above and "
        "the classified stage must flip to ✅. Do not close on a single passing "
        "campaign run: a pass is not a fix, and a defect can survive a green cell.",
    ]
    return "\n".join(lines)
