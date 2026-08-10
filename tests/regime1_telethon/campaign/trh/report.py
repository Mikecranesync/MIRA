"""The v2 campaign report.

Sections are exactly the ones the directive specifies, in that order, and the
last one — **the recommended subsystem to repair** — is the reason the harness
exists. Everything above it is the evidence for it.

Two reporting rules carried from v1's mistakes:

  * **Never silently cap.** If coverage was bounded (no oracle, no probe, tiers
    skipped) the report says so. v1's run diff once announced tier-8 findings as
    "now passing" for a run that never executed tier 8.
  * **INCONCLUSIVE and NOT_OBSERVED get their own columns.** Folding them into
    pass rate is how a run with thin telemetry reads as a healthy run.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from pathlib import Path

from .classify import Classification, primary_counts
from .stages import CAUSAL_ORDER, FAIL, INCONCLUSIVE, NOT_OBSERVED, PASS, Stage, TurnDiagnosis

# parents: [0]=trh [1]=campaign [2]=regime1_telethon [3]=tests [4]=repo root.
# [3] wrote reports into `tests/docs/` — a directory that does not otherwise
# exist, so nothing failed and the report simply went missing.
REPORT_DIR = Path(__file__).parents[4] / "docs" / "testing" / "campaign-reports"


def _stage_matrix(diagnoses: list[TurnDiagnosis]) -> str:
    counts: dict[Stage, Counter] = {s: Counter() for s in (*CAUSAL_ORDER, Stage.POLICY)}
    for d in diagnoses:
        for g in d.grades:
            counts[g.stage][g.verdict] += 1
    lines = [
        "| stage | ✅ pass | ❌ fail | · inconclusive | – not observed |",
        "|---|---|---|---|---|",
    ]
    for stage in (*CAUSAL_ORDER, Stage.POLICY):
        c = counts[stage]
        lines.append(
            f"| **{stage.value}** | {c[PASS]} | {c[FAIL]} | {c[INCONCLUSIVE]} | {c[NOT_OBSERVED]} |"
        )
    return "\n".join(lines)


def render(
    campaign: str,
    diagnoses: list[TurnDiagnosis],
    classifications: list[Classification],
    mutation_summary: str = "",
    deploy_sha: str = "",
    coverage_notes: list[str] | None = None,
    generated_at: str | None = None,
) -> str:
    total = len(diagnoses)
    failed = [d for d in diagnoses if d.verdict() == FAIL]
    passed = [d for d in diagnoses if d.verdict() == PASS]
    undecided = [d for d in diagnoses if d.verdict() == INCONCLUSIVE]
    by_class = primary_counts(classifications)
    cls_by_stage: dict[str, list[Classification]] = {}
    for c in classifications:
        if c.primary is not None:
            cls_by_stage.setdefault(c.primary.value, []).append(c)

    stamp = generated_at or datetime.now().strftime("%Y-%m-%d %H:%M")
    out: list[str] = [
        f"# TRH v2 campaign report — `{campaign}`",
        "",
        f"**Generated:** {stamp}" + (f" · **Build:** `{deploy_sha}`" if deploy_sha else ""),
        "",
        "## 1. Overall",
        "",
        f"- turns graded: **{total}**",
        f"- ✅ pass: **{len(passed)}**",
        f"- ❌ fail: **{len(failed)}**",
        f"- · undecided (no layer could be judged): **{len(undecided)}**",
        "",
        "> A pass is not a proof of correctness — a defect can survive by hiding from "
        "every guard at once (c6/c7). Undecided turns say nothing about MIRA; they say "
        "the run lacked telemetry or an oracle.",
        "",
        "## 2. Failures by root cause",
        "",
    ]

    if by_class:
        out += ["| class | failures | subsystem to repair |", "|---|---|---|"]
        for label, n in by_class.items():
            sub = cls_by_stage[label][0].subsystem
            out.append(f"| **{label}** | {n} | {sub} |")
    else:
        out.append("_No classified failures._")

    out += ["", "## 3. Stage-by-stage grades", "", _stage_matrix(diagnoses), ""]

    # -- ingest ---------------------------------------------------------
    ingest = cls_by_stage.get("INGEST", [])
    out += ["## 4. Ingest coverage problems", ""]
    if ingest:
        out.append(
            "**These are NOT retrieval defects.** The content is absent from the "
            "corpus for that vendor; no ranking change can surface it.",
        )
        out.append("")
        for c in ingest:
            missing = (c.evidence or {}).get("missing", [])
            out.append(f"- `{c.conv_id}` turn {c.turn_index} — missing: {missing}")
    else:
        out.append("_None detected._")

    # -- retrieval ------------------------------------------------------
    retrieval = cls_by_stage.get("RETRIEVAL", [])
    out += ["", "## 5. Retrieval misses and expected-evidence ranks", ""]
    if retrieval:
        out += [
            "| conv | turn | expected found at | missing | wrong-sense hits |",
            "|---|---|---|---|---|",
        ]
        for c in retrieval:
            ev = c.evidence or {}
            hits = [h["rank"] for h in ev.get("hits", [])] or "—"
            traps = [t["rank"] for t in ev.get("polysemy_traps", [])] or "—"
            out.append(
                f"| `{c.conv_id}` | {c.turn_index} | {hits} | {len(ev.get('missing', []))} | {traps} |"
            )
        out += [
            "",
            "> Before proposing a query-side fix, measure the **verbatim-quote cosine "
            "ceiling**: embed a query that quotes the target chunk and rank it. If that "
            "ceiling is itself poor, the chunk is semantically far and no rewrite can "
            "reach it (measured for PF525: ceiling rank 5, realistic queries rank 119+).",
        ]
    else:
        out.append("_None detected._")

    # -- grounding ------------------------------------------------------
    grounding = cls_by_stage.get("GROUNDING", [])
    out += ["", "## 6. Unsupported / hallucinated claims", ""]
    if grounding:
        for c in grounding:
            ev = c.evidence or {}
            out.append(
                f"- `{c.conv_id}` turn {c.turn_index} — {ev.get('fabricated_tokens') or ev.get('uncited')}"
            )
    else:
        out.append("_None detected as a PRIMARY cause._")
    out.append("")
    out.append(
        "> A fabricated specific downstream of a retrieval miss is classified "
        "RETRIEVAL, not GROUNDING — fixing the guard there suppresses correct answers "
        "(measured 1 TP / 2 FP, #3168)."
    )

    # -- dialogue -------------------------------------------------------
    dialogue = cls_by_stage.get("DIALOGUE", [])
    out += ["", "## 7. Dialogue failures", ""]
    if dialogue:
        for c in dialogue:
            out.append(f"- `{c.conv_id}` turn {c.turn_index} — {c.explanation.split('.')[0]}")
    else:
        out.append("_None detected._")

    # -- policy ---------------------------------------------------------
    policy = cls_by_stage.get("POLICY", [])
    if policy:
        out += ["", "## 7b. ⛔ SAFETY / POLICY failures — triage first", ""]
        for c in policy:
            out.append(f"- `{c.conv_id}` turn {c.turn_index} — {c.explanation}")

    # -- mutations ------------------------------------------------------
    out += ["", "## 8. Mutation-test status", ""]
    out.append(
        mutation_summary
        or "_Not run. Without it, a green suite is evidence the tests ran, not that "
        "they protect anything._"
    )

    # -- the recommendation ---------------------------------------------
    out += ["", "## 9. Recommended subsystem to repair", ""]
    if by_class:
        top = next(iter(by_class))
        exemplar = cls_by_stage[top][0]
        out += [
            f"### → {top} ({by_class[top]} failure(s))",
            "",
            f"**{exemplar.subsystem}**",
            "",
            "Worked example from this run:",
            "",
            f"> {exemplar.explanation}",
        ]
        if len(by_class) > 1:
            rest = ", ".join(f"{k} ({v})" for k, v in list(by_class.items())[1:])
            out += ["", f"Then, in order: {rest}."]
    else:
        out.append("_Nothing to repair from this run._")

    notes = list(coverage_notes or [])
    if undecided:
        notes.append(
            f"{len(undecided)} turn(s) had no decidable layer — register oracles and "
            "attach a retrieval probe to make them count."
        )
    if notes:
        out += ["", "## Coverage limits (read before trusting the numbers above)", ""]
        out += [f"- {n}" for n in notes]

    return "\n".join(out) + "\n"


def write(campaign: str, body: str) -> Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / f"{datetime.now().strftime('%Y-%m-%d')}-{campaign}-trh.md"
    path.write_text(body, encoding="utf-8")
    return path
