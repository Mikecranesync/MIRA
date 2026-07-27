# Technician Dataset v1 — Plan (2026-07-27)

**Status:** PROPOSED — no build, no spend, no review sitting until Mike approves this plan.
**Grounds:** the v0 blinded hold-out eval (2026-07-27, `mira-review-v2/data/gate5/out2/SCORECARD.md`)
and a post-eval audit of the shipped v0 training file.

---

## 1. What v0 proved and what it broke

The $4 v0 fine-tune (`mike_578c/Qwen3.5-9B-technician-v0-47089483`, 119 records) was measured
blind against base `Qwen/Qwen3.5-9B` on 25 reserved PowerFlex 40 records (lineage
`rockwell-automation:22b-um001j-en-e`, never trainable). Formal verdict under the ≥18/25 honesty
rule: **insufficient evidence — judged base 13, tuned 7, tie 5.** The split is the real finding:

| Behavior | base | tuned v0 | Read |
|---|---|---|---|
| Refusal cases (judged) | 0/4 | **4/4 sweep** | Trained refusal doctrine transferred |
| Refusal shape (deterministic) | 0/4 | **4/4** | Crisp "No — stop, verify, clear" |
| Unsupported/fabricated numbers | 19 | **3** | 6x less hallucinated specificity |
| Diagnostic cases (judged) | **9/10** | 0/10 (1 tie) | Tune collapses into vacuous tautologies |

The diagnostic failure mode is characteristic: *"F41 is the deterministic Drive Commander pack."*
Confident answer shape, zero content.

## 2. Root cause (dataset audit, smoking gun)

**All 119 v0 training rows reference evidence that is never present in the prompt.**
The system prompt says *"Answer only from the provided evidence"*; the user turn contains only a
question; the assistant turn answers *"From the CV-101 evidence package, [specific fact]…"*.

The model was therefore trained on the pattern **"assert a pack fact with evidence-shaped framing,
given no evidence."** On held-out facts it cannot know, it reproduces the shape without the
content — exactly the vacuous tautologies the eval caught. This is a dataset construction flaw,
not a capacity or hyperparameter problem. v1's job is to fix the contract between prompt,
evidence, and answer.

## 3. The v1 record contract (three grounded patterns)

Every v1 record declares which pattern it instantiates. The assistant answer must be **derivable
from the user-visible turn alone** — if the answer states a pack fact, the pack fact is in the
prompt.

**Pattern A — grounded lookup (evidence IN prompt).**
User turn carries the question **plus the evidence snippet** (pack claim, page ref, status —
the same `answer_key.withheld_payload` shape the builds already carry). Assistant cites it:
*"Per the pack (p. 94): F33 is Auto Rstrt Tries (code 33). This is a lookup, not authorization
to reset or work energized."* Teaches: cite-what-you-see, keep the safety tail.

**Pattern B — evidence-absent diagnostic (the new one; fixes the collapse).**
User asks the diagnostic question with **no evidence attached**. The correct assistant answer is
an explicit, useful cite-or-refuse: *"That fault definition isn't in front of me — I won't guess
a code meaning. It lives in the PowerFlex 40 fault table (Drive Commander pack / manual fault
chapter). What I can tell you without it: F-codes are faults, not parameters; don't clear or
suppress it, and don't work energized. Pull the pack entry and I'll ground the answer."*
Teaches: the honest non-answer that still helps — the behavior base produced accidentally and
verbosely, made crisp.

**Pattern C — valued interactions (keep, they worked).**
Uncertainty / refusal / correction records, unchanged in spirit — v0's 4/4 refusal sweep and the
6x fabrication drop trace to these. Corrections get the same A/B split: with evidence → perform
the correction with the cited fact; without → separate the categories (fault vs parameter) and
ask for the pack entry, never invent the definition.

## 4. Composition targets (build pool → reviewed)

v0 pool was 219 candidates (92 diagnostic / 127 valued) → 119 eligible after review. v1 targets:

| Slice | Target (pool) | Notes |
|---|---|---|
| Pattern A grounded lookups | ~70 | Evidence verbatim in prompt; cited answer |
| Pattern B evidence-absent | ~50 | ≥25 diagnostic-shaped; the anti-tautology set |
| Pattern C valued (unc/ref/corr) | ~70 | Keep ratio; corrections split A/B |
| Safety-sensitive across all | ≥30 | Same phrase-level markers |
| **Pool total** | **~190** | → ≥130 eligible after sitting (gate min 100) |

Balance rule: for every fact used in a Pattern A record, prefer a **different** fact in Pattern B
so the model can't learn "absent evidence → recall the same fact anyway."

## 5. Sources and rights (no new grants needed)

- **printsense** (CV-101 + style/public-domain lineages) and **drive_commander** under the
  existing OEM training-rights grant — **`durapulse_gs10` + `powerflex_525` only**.
- **`powerflex_40` stays blocked and held out** — it is 1 of the 5 reserved lineages and
  `MIN_HELD_OUT_LINEAGES == 5` is a gate invariant. Never grant it.
- **The 13 open review-console cards** (3 re-entry corrections + 10 Tier-B) import as a clean
  append batch at the next sitting — they are v1 candidates, not v0 amendments.
- GS10 packs are pack-architecture data already in-repo; a GS10-heavy Pattern A/B slice also
  diversifies away from the pf525-centric drive facts.

## 6. Process (unchanged governance, same rails as v0)

1. **PR: candidate builder v1** — new patterns A/B in the generator; same `SourceCandidate`
   envelope, rights resolution, lineage splits, manifest freeze. Answer-key independence (§15)
   holds: Pattern A answers derive from the evidence snippet, Pattern B answers are templated
   refusals — neither derives from a target model.
2. **Freeze manifest → Mike's review sitting** (console v2, port 8377) — decisions bind to the
   frozen manifest hash; import via `--import-decisions`; ≥100 eligible incl. the 13 pending cards.
3. **Paid gate** — same 15 checks, no thresholds weakened.
4. **Ceremony + train** — Mike budget declaration (~$4–5, one LoRA SFT job), **packing=True,
   batch_size + n_checkpoints explicit** (Together zero-default trap), same winning v0
   hyperparameters as the starting point, seed 42.
5. **Two-track blinded eval** (same $5-class declaration):
   - **Track 1 (behavior, evidence-absent):** same 25 reserved PF40 prompts as v0 → direct
     comparability, and Pattern B should convert the 0-9-1 diagnostic loss.
   - **Track 2 (grounding, evidence-present):** same 25 held-out facts with the evidence snippet
     IN the prompt — measures cited-lookup quality. Held-out facts are safe to show at eval time;
     they remain untrainable.
   - Same protocol: sealed blinding, deterministic scores, locked-then-unsealed, ≥18/25 rule
     per track. Eval harness gains `--evidence-in-prompt`; v2 deployment path is proven
     (thinking disabled, retries, verified teardown — merged in #2954).

## 7. Success criteria for v1

- **Track 1:** tuned wins ≥18/25 (v0: 7) — vacuous tautologies eliminated; refusal sweep and
  fabrication edge retained (≤5 unsupported numbers).
- **Track 2:** tuned ≥ base with correct citations on ≥20/25 grounded lookups.
- Anything less: publish the scorecard honestly and decide v2 vs stop with data.

## 8. Explicitly out of scope

Second base model, DPO/full FT, standing endpoints, synthetic flywheel agents (substrate exists;
generation stays deterministic), any `powerflex_40` rights change, any prod deploy.

## 9. Mike's gates (nothing moves without them)

1. Approve this plan (or edit targets/patterns).
2. Review sitting on the frozen v1 manifest.
3. Budget declaration + signing ceremony for the train job.
4. Budget declaration + ceremony for the two-track eval.
