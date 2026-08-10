"""Mutation testing — prove a protection has teeth by breaking it on purpose.

A test that passes proves nothing about the code; it proves the test ran. The
only evidence that a test *protects* a behaviour is that it goes RED when the
behaviour is deliberately broken. This arc keeps re-learning that:

  * The RET-001 model-scope test asserted the model string was in the params
    dict — which is built regardless. Deleting `AND model_number ILIKE …` from
    the SQL left **28/28 green**. That scope is the precision guard keeping a
    PowerFlex 40 chunk out of a 525 answer, i.e. the worst possible place for a
    toothless test, and only a mutation exposed it.
  * The RET-001 fail-safe test asserted `out == []`, which `recall_knowledge`'s
    outer handler produces on *any* exception — vacuous for the same reason.
  * The CTX-001d negative control passed BEFORE the fix too (nothing pivoted at
    all). Dropping `AWAITING_UNS_CONFIRMATION` from the exempt set is what
    turned it red and made it evidence.

So mutations are declared as data, run in CI, and **recorded in the campaign
report**. "Mutations proven" is a first-class output, not a thing someone did
once by hand and remembered.

## Safety

Mutations edit real source files. Three guarantees, in order of importance:

1. **Restore is in `finally`**, and verified byte-for-byte afterwards. A crashed
   run must never leave a mutant on disk.
2. **The mutation must actually apply.** If `find` is not present (the code
   moved), that is reported as STALE, never as "proven" — a mutation that
   silently no-ops would certify a protection that no longer exists, which is
   worse than having no mutation at all.
3. **Refuses to run against a dirty target file.** Restoring would clobber
   uncommitted work — the shared-checkout hazard `subagent-worktree-isolation`
   exists for.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]

PROVEN = "PROVEN"
NOT_PROVEN = "NOT_PROVEN"
STALE = "STALE"
SKIPPED = "SKIPPED"


@dataclass(frozen=True)
class Mutation:
    """A deliberate break, and the test that must notice it."""

    id: str
    #: What behaviour this protects, in plain English.
    protects: str
    target: str  # repo-relative path
    find: str
    replace: str
    #: Test selector that MUST fail once the mutation is applied.
    guard_test: str
    #: Why this protection matters — quoted in the report.
    why: str = ""
    #: Unmerged branch/PR this mutation's target lives on, if any. Such a
    #: mutation reports STALE on `main` — which is correct and must be
    #: distinguishable from "the code moved and nobody noticed", the failure
    #: mode STALE otherwise indicates.
    requires: str = ""


@dataclass
class MutationResult:
    mutation: Mutation
    status: str
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.status == PROVEN


# ---------------------------------------------------------------------------
# The registry
#
# Every entry below corresponds to a protection this arc actually paid for.
# ---------------------------------------------------------------------------

MUTATIONS: tuple[Mutation, ...] = (
    Mutation(
        id="model_scope_dropped",
        protects="the fault-clear stream is scoped to the resolved model",
        target="mira-bots/shared/neon_recall.py",
        find='          AND ({" OR ".join(model_conds)})\n',
        replace="",
        guard_test="mira-bots/tests/test_fault_clear_stream.py::TestFaultClearSearch::test_scopes_to_the_resolved_model",
        why=(
            "Unscoped, the phrases match 100+ rows across every vendor and the top hit "
            "for a PowerFlex 525 question was measured to be a PowerFlex 40 chunk. The "
            "params-dict version of this test survived this exact mutation 28/28 green."
        ),
        requires="PR #3176 (fix/retrieval-reset-sense)",
    ),
    Mutation(
        id="fault_clear_intent_gate_removed",
        protects="the fault-clear stream fires only on a fault-clear question",
        target="mira-bots/shared/neon_recall.py",
        find="                and _wants_fault_clear(query_text)\n",
        replace="",
        guard_test="mira-bots/tests/test_fault_clear_stream.py::TestRecallIntegration::test_not_called_without_fault_clear_intent",
        why="Without the gate the stream injects a fault-clear procedure into unrelated answers.",
        requires="PR #3176 (fix/retrieval-reset-sense)",
    ),
    Mutation(
        id="competing_reset_object_suppression_removed",
        protects="'reset to factory defaults' does NOT arm the fault-clear stream",
        target="mira-bots/shared/neon_recall.py",
        find="    if _RESET_OTHER_OBJECT_RE.search(query_text):\n        return False\n",
        replace="",
        guard_test="mira-bots/tests/test_fault_clear_stream.py::TestIntentNegativeControls",
        why=(
            "The negative controls are the load-bearing half. Injecting a fault-clear "
            "procedure into an answer about factory defaults is a fabricated-context bug."
        ),
        requires="PR #3176 (fix/retrieval-reset-sense)",
    ),
    Mutation(
        id="fault_clear_never_injected",
        protects="retrieved fault-clear rows actually reach the result set",
        target="mira-bots/shared/neon_recall.py",
        find="        if fault_clear_results:\n            results = fault_clear_results + results",
        replace="        if False:\n            results = fault_clear_results + results",
        guard_test="mira-bots/tests/test_fault_clear_stream.py::TestRecallIntegration::test_procedure_is_injected_at_the_top",
        why="A stream that runs but is never merged is a no-op that reads as a fix.",
        requires="PR #3176 (fix/retrieval-reset-sense)",
    ),
    Mutation(
        id="ingest_scope_dropped",
        protects="INGEST coverage is checked WITHIN the oracle's vendor scope",
        target="tests/regime1_telethon/campaign/trh/oracles.py",
        find="            got = corpus.contains_phrase(e.match, self.scope)",
        replace="            got = corpus.contains_phrase(e.match)",
        guard_test="tests/regime1_telethon/test_trh_stages.py::TestReferenceCases",
        why=(
            "Unscoped, 'clear the fault by one of these methods' exists (in ROCKWELL's "
            "manual), so the GS10 oracle would score INGEST=PASS and send the next "
            "investigation off to tune retrieval for a vendor with no documentation. "
            "This is the #3177 distinction, mechanised."
        ),
    ),
    Mutation(
        id="upstream_first_precedence_reversed",
        protects="the root cause is the UPSTREAM failing layer, not the loudest symptom",
        target="tests/regime1_telethon/campaign/trh/classify.py",
        find="    primary = next(s for s in CAUSAL_ORDER if s in failed)",
        replace="    primary = next(s for s in reversed(CAUSAL_ORDER) if s in failed)",
        guard_test="tests/regime1_telethon/test_trh_stages.py::TestReferenceCases::test_pf525_classifies_as_RETRIEVAL_not_grounding",
        why=(
            "Reversed, #3165 classifies as GROUNDING — the exact misdiagnosis that "
            "produced a guard measuring 1 TP / 2 FP. This is the harness's core claim."
        ),
    ),
    Mutation(
        id="not_observed_folded_into_pass",
        protects="missing telemetry is never reported as a pass",
        target="tests/regime1_telethon/campaign/trh/stages.py",
        find="        if any(g.verdict == PASS for g in self.grades):\n            return PASS\n        return INCONCLUSIVE",
        replace="        return PASS",
        guard_test="tests/regime1_telethon/test_trh_stages.py::TestVerdictHonesty::test_all_unobserved_rolls_up_to_inconclusive_not_pass",
        why="A grader that reads absent telemetry as success manufactures confidence.",
    ),
    Mutation(
        id="policy_override_removed",
        protects="a safety failure outranks every other layer",
        target="tests/regime1_telethon/campaign/trh/classify.py",
        find="    if policy is not None and policy.verdict == FAIL:",
        replace="    if False:",
        guard_test="tests/regime1_telethon/test_trh_stages.py::TestClassifierPrecedence::test_policy_outranks_everything",
        why="Safety is never a downstream symptom; misclassifying it buries it under a retrieval ticket.",
    ),
    # -- boundaries added by the runner-integration slice (2026-08-10) ------
    Mutation(
        id="ledger_index_ignored",
        protects="turn indices come from the ledger, so the probe join actually lands",
        target="tests/regime1_telethon/campaign/trh/assemble.py",
        find='            raw_i = rec.get("i")',
        replace="            raw_i = None  # mutated",
        guard_test="tests/regime1_telethon/test_trh_integration.py::TestLedgerJoin",
        why=(
            "A local counter looked right (0,1,2...) and silently joined NOTHING: every "
            "retrieval probe record missed, so RETRIEVAL read NOT_OBSERVED across a "
            "campaign that HAD been probed. Invisible, because NOT_OBSERVED is exactly "
            "what an un-probed run should show."
        ),
    ),
    Mutation(
        id="asset_switch_fp_suppression_removed",
        protects="a technician-initiated asset switch is not scored as a dialogue defect",
        target="tests/regime1_telethon/campaign/trh/stages.py",
        find="    if relevant and technician_switched_asset(ctx.prior_turns, turn):",
        replace="    if False:",
        guard_test="tests/regime1_telethon/test_trh_integration.py::TestAssetSwitchFalsePositive",
        why=(
            "gates.check_reasks_supplied_info fires when MIRA correctly re-confirms "
            "identity after the technician changes machine. Measured on c12s42: 6 fake "
            "DIALOGUE failures out of 30 conversations on the first live integration run."
        ),
    ),
    Mutation(
        id="empty_oracle_gets_free_ingest_pass",
        protects="an oracle with no expected evidence does not score INGEST=PASS",
        target="tests/regime1_telethon/campaign/trh/stages.py",
        find="    if not ctx.oracle.expected_evidence:",
        replace="    if False:",
        guard_test="tests/regime1_telethon/test_trh_layers.py::TestF_InsufficientEvidence::test_policy_only_oracle_does_not_get_a_free_ingest_pass",
        why="A free green on a layer nobody examined is the optimistic failure this harness exists to stop.",
    ),
    Mutation(
        id="grounding_generation_order_reversed",
        protects="GROUNDING is upstream of GENERATION",
        target="tests/regime1_telethon/campaign/trh/stages.py",
        find="    Stage.GROUNDING,\n    Stage.GENERATION,\n)",
        replace="    Stage.GENERATION,\n    Stage.GROUNDING,\n)",
        guard_test="tests/regime1_telethon/test_trh_layers.py::TestC_Grounding",
        why=(
            "Reversed, a fabricated parameter that also produced a wrong answer classifies "
            "GENERATION and points at the prompt and provider cascade when the repair is "
            "the citation/support path."
        ),
    ),
    Mutation(
        id="control_claim_contraction_unmatched",
        protects='a contracted control claim ("I\'ve started...") is still caught',
        target="tests/regime1_telethon/campaign/gates.py",
        find=r'r"\bI\s*(?:have\s+|'
        + "'"
        + r've\s+|has\s+)?(?:reset|cleared|started|stopped|jogged)\b"',
        replace=r'r"\bI (?:have |' + "'" + r've )?(?:reset|cleared|started|stopped|jogged)\b"',
        guard_test="tests/regime1_telethon/test_trh_layers.py::TestE_Policy::test_control_claim_classifies_POLICY",
        why=(
            "The original required a literal space after 'I', so the CONTRACTED form never "
            "matched and a claimed control action scored clean. Read-only is a product "
            "claim; this gate is what enforces it."
        ),
    ),
)


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


def _is_dirty(path: Path) -> bool:
    try:
        out = subprocess.run(
            ["git", "status", "--porcelain", "--", str(path)],
            cwd=REPO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
        return bool(out.stdout.strip())
    except Exception:  # noqa: BLE001 - assume dirty; refusing is the safe direction
        return True


def _run_guard(selector: str, timeout: int = 900) -> tuple[bool, str]:
    """Run the guard test. Returns (failed, tail-of-output)."""
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", selector, "-q", "--no-header", "-x"],
        cwd=REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",  # Windows cp1252 disarms text=True without this
        errors="replace",
        timeout=timeout,
    )
    tail = (proc.stdout or "").strip().splitlines()[-3:]
    return proc.returncode != 0, " | ".join(tail)


def _to_file_eol(blob: bytes, find: str, replace: str) -> tuple[bytes, bytes]:
    """Translate a mutation's `\\n` line endings to whatever the file actually uses.

    The other half of going byte-exact. Mutations are authored with `\\n`, but on
    Windows the working tree is CRLF (core.autocrlf), so a multi-line find never
    matched and every multi-line mutation reported STALE while every single-line
    one passed — a perfectly consistent split that looked like code drift and was
    really an encoding bug. Worth catching precisely because STALE is the status
    that means "a protection may have silently disappeared": a false STALE trains
    people to ignore the real ones.
    """
    crlf = blob.count(b"\r\n")
    lf_only = blob.count(b"\n") - crlf
    eol = b"\r\n" if crlf > lf_only else b"\n"
    f = find.encode("utf-8").replace(b"\r\n", b"\n").replace(b"\n", eol)
    r = replace.encode("utf-8").replace(b"\r\n", b"\n").replace(b"\n", eol)
    return f, r


def _restore(path: Path, original: bytes, m: Mutation) -> None:
    """Put the file back, byte for byte, and never leave a mutant on disk.

    A restore that can itself raise is not a restore. An earlier version wrote
    with `write_text` while holding `bytes`; it raised TypeError from inside
    `finally`, and a mutated `oracles.py` — with the vendor scope deleted — was
    left in the working tree. That is the single worst thing this module can do,
    so the restore now has its own belt (byte-exact write), braces (verify), and
    parachute (`git checkout --`).
    """
    try:
        path.write_bytes(original)
    except Exception:  # noqa: BLE001 - fall through to the git parachute
        pass
    if path.read_bytes() == original:
        return
    subprocess.run(
        ["git", "checkout", "--", str(path)],
        cwd=REPO,
        capture_output=True,
        timeout=60,
    )
    if path.read_bytes() != original:  # pragma: no cover - catastrophic
        raise RuntimeError(
            f"FAILED TO RESTORE {m.target} after mutation {m.id} — the working tree "
            f"still holds the mutant. Run: git checkout -- {m.target}"
        )


def run_one(m: Mutation, allow_dirty: bool = False) -> MutationResult:
    """Apply one mutation, run its guard, restore. Never leaves a mutant behind."""
    path = REPO / m.target
    if not path.exists():
        return MutationResult(m, STALE, f"target missing: {m.target}")
    if not allow_dirty and _is_dirty(path):
        return MutationResult(
            m,
            SKIPPED,
            f"{m.target} has uncommitted changes — refusing to mutate a dirty file "
            "(restoring would clobber them)",
        )

    # BYTES, not text. `read_text`/`write_text` round-trip through universal
    # newlines, so on Windows a restore silently rewrote every LF as CRLF: the
    # content compared equal, `git diff` was empty, but `git status` reported the
    # file modified — which then made the NEXT mutation on that file SKIP as
    # "dirty". Byte-exact IO is also what makes the restore verification below an
    # actual guarantee rather than a text-normalised approximation.
    original = path.read_bytes()
    find_b, replace_b = _to_file_eol(original, m.find, m.replace)
    if find_b not in original:
        # Loud on purpose: a mutation that no-ops would certify a protection
        # that may no longer exist.
        return MutationResult(
            m, STALE, "find-string not present — the code moved; update the mutation"
        )

    mutated = original.replace(find_b, replace_b, 1)
    if mutated == original:
        return MutationResult(m, STALE, "replacement produced no change")

    try:
        path.write_bytes(mutated)
        failed, tail = _run_guard(m.guard_test)
    except Exception as exc:  # noqa: BLE001
        return MutationResult(m, NOT_PROVEN, f"runner error: {exc}")
    finally:
        _restore(path, original, m)

    if failed:
        return MutationResult(m, PROVEN, f"guard failed as required: {tail}")
    return MutationResult(
        m,
        NOT_PROVEN,
        f"guard STAYED GREEN with the protection broken — the test is vacuous, rewrite it: {tail}",
    )


def run_all(
    mutations: tuple[Mutation, ...] = MUTATIONS, allow_dirty: bool = False
) -> list[MutationResult]:
    return [run_one(m, allow_dirty=allow_dirty) for m in mutations]


def summarize(results: list[MutationResult]) -> str:
    lines = ["| mutation | protects | status |", "|---|---|---|"]
    for r in results:
        lines.append(f"| `{r.mutation.id}` | {r.mutation.protects} | **{r.status}** |")
    proven = sum(1 for r in results if r.ok)
    lines.append("")
    lines.append(f"**{proven}/{len(results)} protections proven to have teeth.**")
    bad = [r for r in results if r.status == NOT_PROVEN]
    if bad:
        lines.append("")
        lines.append("⚠️ Vacuous tests — they stayed green with the behaviour broken:")
        for r in bad:
            lines.append(f"- `{r.mutation.guard_test}` ({r.mutation.id}): {r.detail}")
    # A mutation whose target lives on an unmerged branch is EXPECTED to be
    # stale here. Lumping it in with "the code moved and nobody noticed" would
    # train readers to ignore the STALE section, which is the section that
    # catches a protection quietly disappearing.
    pending = [r for r in results if r.status == STALE and r.mutation.requires]
    stale = [r for r in results if r.status == STALE and not r.mutation.requires]
    skipped = [r for r in results if r.status == SKIPPED]
    if pending:
        lines.append("")
        lines.append("⏳ Not applicable on this branch (target code is unmerged):")
        for r in pending:
            lines.append(f"- `{r.mutation.id}` — needs {r.mutation.requires}")
    if stale:
        lines.append("")
        lines.append(
            "🚨 STALE — the find-string is gone, so the protection may no longer "
            "exist. NOT evidence of anything; update the mutation and re-run:"
        )
        for r in stale:
            lines.append(f"- `{r.mutation.id}`: {r.detail}")
    if skipped:
        lines.append("")
        lines.append("⚠️ SKIPPED (dirty working tree — commit first, then re-run):")
        for r in skipped:
            lines.append(f"- `{r.mutation.id}`: {r.mutation.target}")
    return "\n".join(lines)
