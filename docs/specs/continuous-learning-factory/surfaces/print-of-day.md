# Print of the Day — CLF delivery surface (reconciled into the regime)

**Status:** Proposed surface spec, folded into the Continuous Learning Factory regime. **Docs only — no runtime, no production behavior change** (same posture as ADR-0030 PR 0).
**Decision record:** [`docs/adr/0030-continuous-learning-factory.md`](../../../adr/0030-continuous-learning-factory.md).
**Source of record:** [`print-of-day-prd.md`](print-of-day-prd.md) — the submitted PRD, verbatim (2026-07-21).
**Date:** 2026-07-21 (`main` @ `1feaf906e`, v3.184.x).

This document reconciles the **"Print of the Day: Private Email Learning Flywheel"** PRD against the
existing CLF (ADR-0030 + this spec tree). It records what POTD **reuses**, what it **adds**, and the
handful of **schema decisions owed at build time** — so the POTD build PRs extend the regime instead
of forking it. It changes no runtime and adds no schema; it is the governance layer that makes POTD a
first-class citizen of the regime.

---

## 0. What POTD is, and how it sits in the regime

**Print of the Day (POTD) is the CLF's first end-user delivery surface — not a parallel program.**

The CLF (ADR-0030) is the *factory*:

```
corpus source → page render → evaluation → human correction → gold → rule candidate → frozen regression + training export
```

POTD is a *product surface on that factory*:

> One difficult, verifiable electrical print per day → run PrintSense **blind** → deterministic grade +
> independent judge → verify against independent evidence → build a claim-by-claim ledger + corrected
> explanation + a complete YouTube script → **email one review package to Mike** → he corrects/approves →
> only then promote into gold / rule / test / retrieval / training / public-candidate.

POTD does **not** re-implement any factory stage. It **orchestrates** the existing stages and adds only the
four things the factory does not have: a **daily selector**, an **email package**, a **script generator**, and a
**case-aggregate manifest** that ties one day's artifacts together. The PRD itself mandates this
(`print-of-day-prd.md` §4.6 "Reuse the existing PrintSense core" and §25 Phase 0 "reconcile with live
repository truth; do not build a separate learning platform"), which is exactly ADR-0030's two-layer
decision (reuse CORE / build only net-new FLYWHEEL).

## 1. Reuse map — POTD consumes these CLF owners verbatim (never forks them)

| POTD concern (PRD §) | CLF canonical owner | CLF contract |
|---|---|---|
| Source discovery + rights (§8) | corpus registry (PR 1) | `corpus-source.v1` (fail-closed `rights`) |
| One-page identity / render (§6, §12.4) | page owner | `page-render.v1` (`page_sha256`, distinct from document identity) |
| Blind interpret run (§9) | `tools/internet_print_test/runner.py` | `eval-result.v1` (superset of runner output) |
| Deterministic grade / import verdict (§10.4) | `printsense/grade_case.py` (`grade_case()`) | — (verdict fields on `eval-result.v1`) |
| Judge + independence (§11.2) | `tools/internet_print_test/judge.py` | `judge-independence.v1` (controlled enum) |
| Human review action (§14.2 "review_event") | correction owner | **`correction-event.v1`** (immutable, append-only, region-linked) |
| Visual regions (§9.3, §15.5) | **`factorylm.visual-region.v1`** (`mira-bots/shared/visual/`, #2843/#2846) | **reference by `region_id` only — never redefine geometry** |
| Evidence bytes + content addressing (§17 artifacts) | `printsense/cas.py` + `materialized_evidence/` | CAS refs / evidence ids |
| Recall (cost-saving) (§4.6) | `mira-bots/shared/print_recall.py` (prod) + `printsense/recall.py` | already the merged cost-saving seam |
| Gold promotion (§15.1) | promotion-policy gold matrix | `gold-record.v1` |
| Rule / validator promotion (§15.2) | rule miner (PR 8) | `rule-candidate.v1` (≥3 lineages) |
| Typed approvals rail (§14.4) | `ai_suggestions` / `relationship_proposals` (ADR-0017) | the three typed proposal classes |
| Splits / holdout / rights (§16) | [`data-rights-and-leakage.md`](../data-rights-and-leakage.md) | `document_lineage_key`, 70/15/10/5, held-out quarantine |
| Scheduling + budget (§19) | CLF scheduler (PR 6) + [`cost-governor.md`](../cost-governor.md) | approved-provider allowlist, fail-safe budget |

**Consequence:** POTD's "second grading framework / second visual-region schema" non-goals
(`print-of-day-prd.md` §3) are already the regime's law — ADR-0030 principle 1 (additive, never mutate
`visual-region.v1`) and the reference-only region rule. No conflict.

## 2. Net-new to the regime — POTD's own contributions (the only greenfield)

Everything else reuses §1. These are the surface layers the factory genuinely lacks:

1. **Daily controlled-random selector + diversity memory** (§7). Samples one page across difficulty
   dimensions (drawing convention, equipment/process, print type, difficulty factors), scores it
   (`selection_score`, §7.2), and penalizes repetition over a 30-case diversity window (§7.3). It is a
   **consumer of the PR-1 corpus registry**, not a second source store.
2. **Email delivery package** (§12). One email / one print / one case, with the fixed section set (A–L),
   the single-attachment rule (§12.4), and the pre-send gate (§19.3). Env-configured
   (`PRINT_OF_DAY_*`), disabled by default.
3. **YouTube script generator** (§13). A complete production script (cold-open → corrected lesson →
   rerun), honesty-gated (§13.3), never auto-published.
4. **`factorylm.print-of-day.v1` case-aggregate manifest** (§17). A per-case wrapper that **references**
   CLF artifacts by id (`source`, `page_image_ref`, `blind_response_ref`, `grade_report_ref`,
   `claim_ledger_ref`, `corrected_explanation_ref`, `script_ref`, `email_ref`, `review_event_refs`) — an
   index over factory outputs, not a re-store of them. Frozen at the POTD build PR, per §3 decision A/B.
5. **Per-case review lifecycle** (§14.1). An orchestration state machine (`DISCOVERED → … → EMAILED →
   AWAITING_HUMAN_REVIEW → CORRECTIONS_RECEIVED → APPROVED_FOR_{GOLD,RULE,TEST,PUBLIC_CANDIDATE} …`) that
   **wraps** the CLF per-(page,config) state machine — see §3 decision C.
6. **Public-video clearance** (§16.3, §8.4). A *third* separate clearance beyond eval-gold and
   training-gold (`PUBLIC_RIGHTS_APPROVED`), consistent with the CLF "separate clearances" model
   (promotion-policy: evaluation-gold ≠ training-gold). POTD adds one clearance; it does not loosen any.

## 3. Reconciliation decisions owed before POTD schemas freeze

Recorded here so the **POTD build PRs** resolve them by extension, not by forking. None of these is
resolved in this docs change (Karpathy #1 — do not freeze a schema before the reconciliation is settled).

- **A. POTD "review_event" (§14.2) IS `correction-event.v1`.** POTD must not introduce a parallel
  immutable-review type. Its review-event is a `correction-event.v1` (append-only; a revision is a **new**
  event linking `prior_correction_id`, per [`state-machine.md`](../state-machine.md) rule 3). A thin POTD
  envelope may carry `review_event_id` and reference the correction id, but the immutable record of record
  is `correction-event.v1`. **Decided: reuse.**
- **B. Claim ledger (§10) granularity vs `eval-result.v1`.** POTD's per-claim ledger (statuses
  `CONFIRMED / INCORRECT / UNSUPPORTED / PARTIALLY_CORRECT / UNRESOLVED / UNREADABLE / NOT_APPLICABLE`,
  `failure_class`, `region_refs`) is finer than the current grade. **OPEN — resolve at build:** fold it into
  `eval-result.v1` additive fields (it is intentionally an open superset — ADR-0030 § "Migration &
  compatibility") **or** add a linked `print-claim-ledger.v1`. Either way it extends `grade_case`
  validators; it does **not** fork the grader.
- **C. POTD state machine WRAPS, does not replace, the CLF state machine.** The CLF machine tracks
  `(page, config)` work units; POTD tracks the daily *case* lifecycle. POTD `BLIND_RUN_COMPLETE / GRADED`
  delegate to CLF `evaluated / graded`; POTD `APPROVED_FOR_{GOLD,RULE,TEST}` transitions **must** ride the
  promotion-policy typed proposals + gold-authorization matrix — no parallel approval path, no jump to
  `gold` that skips the matrix. **Decided: wrapper + reuse promotion-policy.**
- **D. Selector home.** The selector reads the PR-1 corpus registry and writes only its own **diversity
  memory**; it never becomes a second owner of source/rights metadata. **Decided: consumer, not owner.**

## 4. Ladder placement

POTD is a **surface that spans several CLF rungs**, delivered in its own sub-phases
(`print-of-day-prd.md` §25) that depend on:

| POTD phase (§25) | Depends on CLF rung |
|---|---|
| P1 manual package, P3 selector, P8 rights | **PR 1** corpus registry |
| P1 blind run + grade, P6 verify | **PR 2–4** runner / `grade_case` / judge + independence |
| P5 claim review | **PR 5** review queue on `visual-region.v1` |
| P4 daily scheduler + budget | **PR 6** scheduler + cost governor |
| P6 gold / rule / holdout promotion, P7 public candidate | **PR 7** gold + leakage guard (+ **PR 8** rule miner) |

POTD's net-new layers (§2: selector, email, script, `print-of-day.v1`, per-case lifecycle,
public-video clearance) are additive **surface** PRs layered on those rungs. The **first useful release**
(§26) is not the daily autonomous system — it is *one command* that produces the full inspectable review
bundle (manifest + one-page attachment + blind response + grade + claim ledger + corrected explanation +
script + email preview), **before** any send path is enabled.

## 5. Invariant + safety alignment (nothing new to enforce)

POTD inherits, and does not weaken, the regime's guarantees:

- **Grounded + read-only.** Verification-before-correction (§4.2, §11) and "no control writes" match the
  MIRA read-only-troubleshooting invariant and citation-compliance discipline.
- **Human controls promotion.** "Claude must not approve its own proposal" (§4.3) restates promotion-policy:
  a model never promotes its own output to gold; only `HUMAN_REVIEW` / `DETERMINISTIC_PROOF` / a genuinely
  independent provider+model authorizes gold.
- **Safety hard-gate.** §21 = the existing `SAFETY_KEYWORDS` + safety-critical-unsupported-claim hard-gate
  (promotion-policy / `grade_case`); POTD adds no new safety mechanism, it enforces the existing one.
- **Rights fail closed + leakage control.** §8 rights = `corpus-source.v1` fail-closed `rights`; §16
  public/private/holdout = `data-rights-and-leakage.md` (`document_lineage_key`, quarantined held-out).

## 6. What this change is / is not

- **Is:** a governed surface spec added to the CLF regime, reconciled against ADR-0030, plus the verbatim
  PRD as source-of-record. Docs only.
- **Is not:** any runtime, any schema freeze, any migration, any model call, any change to PrintSense
  recall or the print path. The POTD build (its own PRs on the ladder above) is **not** authorized by this
  document — it is scoped by it.

## Cross-references

- [`print-of-day-prd.md`](print-of-day-prd.md) — the submitted PRD, verbatim (source of record).
- [`../../../adr/0030-continuous-learning-factory.md`](../../../adr/0030-continuous-learning-factory.md) — the CLF decision record + PR ladder + canonical ownership.
- [`../README.md`](../README.md) — CLF spec index + reuse map.
- [`../state-machine.md`](../state-machine.md) — the per-(page,config) machine POTD's case lifecycle wraps.
- [`../promotion-policy.md`](../promotion-policy.md) — the typed proposals + gold matrix POTD promotions must ride.
- [`../data-rights-and-leakage.md`](../data-rights-and-leakage.md) — rights fail-closed + split/holdout POTD §8/§16 reuse.
