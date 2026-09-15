# Gate 7 CI lane — operating manual

The CI-side adversarial review lane: `.github/workflows/gate7-review.yml` driving
`tools/gate7_review.py` on the free Groq → Cerebras → Together cascade.

Companion to [`adversarial-review-workflow.md`](./adversarial-review-workflow.md), which
documents the **developer-side** Codex lane. The two are deliberately separate: Codex runs
on locally-authenticated ChatGPT auth on a dev machine, and per the owner decision of
2026-08-16 no OpenAI credentials exist in this repo or its CI. Gate 7 is the lane that can
run in CI at all.

**Status: ADVISORY.** No step can fail a build or block a merge. Read
[Promotion criteria](#promotion-criteria) before changing that.

---

## The two phases

```
push ──► [phase 1] review ──► [GATE7-ADVISORY] comment (findings F1..Fn)
                                      │
                       author files a rebuttal comment
                                      ▼
        [phase 2] adjudication ──► [GATE7-ADJUDICATION] comment (rulings + structural verdict)
```

**Phase 1 — review.** Runs on every same-repo PR push. An adversarial model briefed to
*disprove* the change emits findings. It blocks nothing; it is an accusation, not a verdict.

**Phase 2 — adjudication.** Triggered by the author filing a rebuttal comment. A second
model rules on each finding, and the verdict is computed **structurally** from those
rulings — a `high` SUSTAINED means BLOCK, and no model's stated opinion is ever read.

## Why phase 2 is not optional

Measured across two rounds on PR #3316 (the lane reviewing its own workflow):

| Round | `high` findings | Genuine |
|---|---|---|
| 1 | 3 | 1 |
| 2 | 2 | **0** |

**One of five `high` findings was real.** Gating on raw findings would have been wrong four
times out of five. Round 1's false pair were a factual error (claiming secrets are not
redacted, when `_SECRET_RES` does exactly that) and a self-declared duplicate ("Same
evidence as the first finding").

A second property matters just as much: **the reviewer never runs out of findings.** All
five round-1 findings were fixed; round 2 returned five entirely new ones. "Iterate until
the reviewer is happy" does not terminate. Only adjudication produces a decision.

## Filing a rebuttal

Post a PR comment beginning with `[GATE7-REBUTTAL]`, with one bullet per finding id:

```
[GATE7-REBUTTAL]

- **[id: F1]** — REFUTED. The finding claims X. In fact the code does Y.
  Evidence: [evidence: tools/gate7_review.py:191-212]
- **[id: F2]** — ACCEPTED. Real defect; fixed in <sha>.
```

### `[evidence: path:start-end]` citations

Cite proof that lives **outside the diff**. The tool reads those lines from the repository
itself — you supply only a location, never the text — so a citation can point at evidence
but cannot fabricate it.

This exists because of a structural defect measured on 2026-08-18: the reviewer is briefed
on the whole repository, but the adjudicator could only verify quotes appearing in the
diff, and is instructed to SUSTAIN anything "the diff cannot settle". **Any false finding
whose disproof lived outside the diff was unrefutable by construction** — permanently
sustained, permanently blocking. Citations close that gap.

Citations resolve against the **default branch**, not the PR head. That is the intended
split: the diff already carries your changes, so citations are for proving things about
existing repository code.

### Two rules learned the hard way

1. **Sequence: fix → push → rebut → adjudicate.** A rebuttal filed before the fix is pushed
   quotes evidence that is not yet in the diff, and is correctly SUSTAINED. The first
   attempt at this lost a full adjudication round to exactly that mistake.
2. **A rebuttal answers one report.** Finding ids are positional within a single report. If
   the PR head moves, the ids denote different defects and the job refuses as `STALE`
   rather than judging the wrong commit. Push, let the review re-run, re-file.

### Duplicates

If the reviewer raises the same defect twice, the adjudicator may rule
`[ruling: DUPLICATE] [id: F3] [of: F1]`. F3 then inherits F1's ruling, so one defect is
judged once — and a finding refuted under its primary cannot resurrect under its twin.

---

## Promotion criteria

Do **not** make this a required check until all of these hold.

- [ ] **Truncation is solved.** The reviewed diff is capped at 40 000 chars, and the tool's
      own docstring records that a cut diff "does not merely lose coverage, it manufactures
      false positives" — round 2 produced two false highs from code twenty lines past the
      cut. PR #3300 was 80 files / +12,714 lines. As a blocking check this fails the
      largest, riskiest PRs on invented findings. Either split by `--paths` groups (each
      group needs its own PASS) or refuse to gate a truncated review.
- [ ] **The false-positive rate is known** from ≥10 real PRs, not from this one.
- [ ] **The override path is exercised** at least once, so it is known to work before it is
      needed.
- [ ] **Cascade-failure policy is decided** — see below.

### Intended blocking semantics

| Condition | Result |
|---|---|
| Adjudicated `PASS` | ✅ allowed |
| Adjudicated `BLOCK` (≥1 high SUSTAINED) | ❌ blocked — override available |
| Adjudicated `UNKNOWN` (bijection violation) | ❌ blocked — an unruled finding cannot pass |
| Cascade failure (exit 2) | ❌ blocked — an outage must never read as PASS |
| Review only, no rebuttal filed | ⚠️ pending — **not** a PASS |
| Diff truncated | ⚠️ not gate-quality |

Gate on `--fail-on-block` (exit 3), not on parsing the report. Exit 0 covers *both* PASS
and BLOCK, so a gate reading the exit code alone passes every blocked review; and a gate
grepping for `## VERDICT` reads the model's *stated* verdict out of the embedded raw
section instead of the structural one. Exit 3 is distinct from 1 (usage) and 2 (cascade
dead) so a gate can tell "reviewed and blocked" from "never reviewed".

### The `gate7-override` label

Some findings are **unrefutable and false** — the permanent example is a claim disproved by
platform behaviour, which can never appear in any diff or repository file. Without an
override, one of those strands a PR forever. The label allows the merge and is recorded in
the job summary; it is an audited decision, not a bypass.

---

## Trust boundaries

- **Phase 1 checks out the PR base**, not the head, so a PR that edits `gate7_review.py`
  cannot have its version executed while provider keys are in scope. The PR is still fully
  reviewed — the diff comes from `gh pr diff` (the API), not the working tree.
- **Phase 2 checks out the default branch** for the same reason.
- The workflow *file* still comes from the PR head on `pull_request` (GitHub's behaviour),
  so this narrows the exposure rather than eliminating it.
- Never `pull_request_target`: it runs with secrets in the base-repo context and is the
  standard exploit path for review workflows on public repos.
- Phase 2 triggering is gated on `author_association`. The rebuttal is untrusted data
  regardless, but starting the job spends provider quota.
- Everything crossing the network is redacted (PII **and** credentials). If the canonical
  sanitizer cannot be imported the tool refuses to send, and the workflow's preflight fails
  loudly — a silently skipped redaction step would let the report claim a redaction that
  never happened.

## Known gaps

- Truncation on large PRs (above) — the blocker for promotion.
- `TOGETHERAI_API_KEY` is not a repo secret, so CI runs 2 of the 3 cascade tiers.
- `issue_comment` workflows run from the **default branch's** copy of the workflow file, so
  changes to phase 2 cannot be exercised from a PR branch — they take effect only once
  merged.
