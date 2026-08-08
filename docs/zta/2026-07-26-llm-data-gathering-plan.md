# LLM Data-Gathering Plan of Record — enough data to build the models we need

**Date:** 2026-07-26
**Status:** PLAN OF RECORD for all dataset-construction work in the FactoryLM-owned model program.
**Owner doctrine:** ADR-0028 (Vision ZTA + owned-model program), `.claude/rules/zero-token-architecture.md`.
**Builds on:** `docs/zta/2026-07-23-technician-dataset-inventory-gap-report.md` (the audit),
`docs/zta/factorylm-ai-model-lab.md` (the factory), `docs/zta/together-liquid-model-strategy.md`
(the economics), `docs/zta/2026-07-22-technician-lora-phase0-reconciliation.md` (the PR ladder).

## 0. Executive summary

The question this plan answers: **how do we gather enough data to build the LLM models this
project needs?** The answer, verified against repo truth as of `d89eb18` (PR #2911 merged):

> **The training factory is built and the first dataset already exists. The bottleneck is not
> data volume or tooling — it is two human actions (rights wording + a review sitting), and
> after that, the absence of a *renewable* data source.** This plan sequences: (1) unblocking
> Dataset v0 and running the first ≤$5 LoRA, (2) wiring organic production interactions into
> the flywheel so data accumulates instead of being hand-built, (3) activating the synthetic
> flywheel within its ≤30% cap, (4) expanding the corpus for Dataset v1, and (5) reusing the
> same loop for the wider model fleet (M01–M13).

Current inventory (from `docs/zta/technician-dataset-v0/`, all machine-verified):

| Metric | Value | Gate minimum |
|---|---:|---:|
| Candidate records built | **242** | — |
| — PrintSense / Drive Commander | 172 / 70 | both represented |
| Train-side lineages / held-out lineages | 24 / 5 | ≥20 / ≥5 |
| Uncertainty/refusal/correction records | 147 | ≥20 |
| Safety-sensitive records | 100 | ≥15 |
| Real or human-corrected share | 83.5% | ≥70% |
| **Human review decisions applied** | **0** | ≥100 approved |
| **Eligible training records** | **0** | ≥100 |

Every blocking check in `reports/phase3_paid_gate_report.json` traces to the same root:
zero review decisions. PR #2911's dry-run simulation proved the gate reaches
`PAID_GATE_PASS` 15/15 once decisions land. The data is one review sitting away from trainable.

## 1. Phase 1 — Unblock Dataset v0 → first paid train (human-gated, days not weeks)

The runway, in order. Steps 1–2 are Mike's; everything after is mechanical.

1. **Rights-basis wording.** Complete the `<basis pending>` section of
   `docs/zta/2026-07-25-drive-commander-oem-training-rights.md` in Mike's own words. Per
   `wiki/hot.md` (2026-07-26) this is the sole blocker before the review sitting.
2. **The review sitting.** Work the 242 candidates through the offline review console
   (`tools/factorylm_ai/review_console/` — single file, no server, live gate meter), guided by
   the three packages in `docs/zta/technician-dataset-v0/review-packages/`. To pass the gate the
   approved set needs: ≥100 records spanning **both** `printsense` and `drive_commander`,
   ≥20 lineages, ≥20 uncertainty/refusal/correction, ≥15 safety-sensitive. With 242 candidates
   and 24 lineages there is comfortable headroom — reject freely; do not approve weak records
   to hit counts.
3. **Import + rebuild.** `--import-decisions` (fail-closed, idempotent) →
   `python -m factorylm_ai.dataset.technician_v0 --stage readiness …` → confirm the **real
   ledger** (not the simulation) reports `PAID_GATE_PASS` → regenerate the token/cost estimate.
4. **Authorization + train.** Present the dry-run package; Mike issues the one-time paid
   authorization (PR #2881 trust root). Exactly **one** LoRA SFT job, `Qwen/Qwen3.5-9B`
   (support receipt: `docs/zta/2026-07-25-together-qwen35-9b-model-support-receipt.md`), ≤$5
   (bills at the $4 floor at this corpus size).
5. **Blind evaluation.** Benchmark base-vs-adapter against the frozen references only:
   SimLab/MIRA frozen cases + the 5 held-out lineages (including PowerFlex 40). Use the
   proofpack harness; if a temporary endpoint is unavoidable, ≤$3, `try/finally`-deleted.
   Download the `merged` checkpoint for local serving — there is no serverless LoRA path on
   Together (`together-liquid-model-strategy.md` §2.2): **Together = training factory, local =
   runtime.**

**Invariant:** PowerFlex 40 is 1 of exactly 5 held-out lineages with `MIN_HELD_OUT_LINEAGES=5`.
Granting it training rights would structurally fail the gate. Never flip it.

## 2. Phase 2 — Organic capture: the renewable data source (strategic core)

Hand-built corpora don't scale; production interactions do. Today, technician turns,
corrections, and approvals happening on live surfaces (Telegram, Slack, Hub asset-chat) are
logged for observability but **never accumulate as training-shaped records**. This phase turns
the product into the dataset factory.

1. **Read-only organic-interaction inventory** (gap report §10 item 3 — still not done).
   Count, without exporting content: turns, explicit corrections, approvals, tenants, and
   rights posture across Telegram/Slack episode logs, Hub asset-chat, `benchmark_db`
   episode/groundedness tables, and `agent_trace` JSONL. Deliverable: an inventory doc in
   `docs/zta/` with counts per surface and a rights/tenant classification. This tells us the
   real size of the organic pool before any pipeline is built.
2. **Wire the capture seam.** When a production turn receives an explicit human signal
   (technician correction, admin approval, groundedness flag resolved), convert it via the
   existing builders — `factorylm_ai/flywheel/records.py` (`interaction_record`,
   `feedback_event`) — redacted through `flywheel/redact.py`, tenant- and rights-tagged, with
   `source_interaction_ids` provenance preserved. **No new schema, no second registry**
   (materialized-evidence rule 15); the flywheel contracts are the one shared evidence shape.
   Raw private chat logs are never trained on directly: redact → rights/tenant clearance →
   human approval, per gap-report §8 Batch D.
3. **Make review a cadence, not an event.** A recurring review sitting (monthly to start)
   converts accumulated corrections into approved `training_record`s through the same console
   and gate. The flywheel's Review step becomes routine; Dataset v1+ assembles itself from the
   ledger instead of a bespoke build.

## 3. Phase 3 — Activate the synthetic flywheel (bounded)

`factorylm_ai/synth/` has contracts, a queue, and a state machine — and has produced **zero
records**. Activate the generation stages:

- Blind question generation per lineage → answers produced **deterministically** from
  independent keys (drive-pack gold facts, CV-101 pack facts, verified KG rows) — the target
  model never generates or grades its own answer key → evidence critic → human approval.
- Synthetic share stays **≤30%** of any dataset version; every synthetic record stays labeled.
- SimLab frozen cases remain **evaluation-only forever** — they are the promotion gate's blind
  benchmark, and leaking them into training destroys measurability.

## 4. Phase 4 — Corpus expansion for Dataset v1

| Expansion | Source & mechanism | Rights posture |
|---|---|---|
| +3–5 drive families | `tools/drive-pack-extract/` gold pipeline (currently GS10, PF40, PF525 only — the model must not learn "industrial drive" = two families) | New per-family rights record modeled on `2026-07-25-drive-commander-oem-training-rights.md` |
| CV-101 deepening | 111 distinct approvable facts post-#2911 (up from 42); healthy-idle, comms-loss, E-stop, photo-eye, `field_verify` refusals | Owned — needs the explicit ownership declaration in the corpus registry |
| FactoryLM-authored prints + user-owned lab prints | PrintSense adapters | Owned — declare and go |
| Public-domain patent electrical drawings | New PrintSense lineages | Public domain — cleanest external source |
| Public OEM prints (22 verified in the Print Translator manifest) | Rerun rights-clear subset with production OCR, independent answer keys | **Only after explicit per-document training-rights review** — downloadable ≠ trainable |
| SCU2 package (94/100 gold judgment) | Blocked until Mike records an ownership/rights declaration; reconcile the Sheet-20 page-identity mismatch before using it as a correction record | Blocked |

Every expansion lands through the existing adapters (`factorylm_ai/adapters/`), governance
gates, and lineage-safe splits — no parallel path, no gate-weakening.

## 5. Phase 5 — Data programs for the wider fleet (M01–M13)

The technician LoRA is the template. Each fleet task
(`docs/zta/factorylm-ai-model-lab.md` fleet table) gets data through the same loop —
Infer → Capture → Review → Convert → Split → Train → Benchmark → Promote:

- **Vision (M01 intake classifier, M03 print region extractor):** graded Print Translator
  corpus runs and Print-of-Day crops become `eval_case`s first. Fine-tune only if the
  base-vs-tools benchmark shows a behavior gap a tune can plausibly close (gap-report §10
  item 10 discipline) — prompts + deterministic routing may be enough.
- **M05 intent router / M09 tool selector / M10 answer writer:** eval cases seeded from
  `tests/golden_factorylm.csv` / `tests/golden_hybrid.csv` and proofpack experiments; training
  records only from approved organic interactions (Phase 2 output).
- Every model: benchmark-before-assist promotion gate (`promotion.check_promotion()`), humans
  promote (`registry.allow_runtime()` is human-invoked only), spend law (budget declared
  up front, dry-run default, no re-validation on unchanged inputs).

## 6. Standing rules (apply to every phase)

1. **SimLab/MIRA frozen cases never train.** Evaluation-only, forever.
2. **Held-out lineages are permanent.** ≥5, quarantined from tuning *and* selection.
3. **≥70% real or human-corrected; ≤30% synthetic; synthetic stays labeled.**
4. **Independent answer keys.** The target model never authors or verifies its own key.
5. **Rights fail closed.** No `training_allowed=true` without a governance record; public
   accessibility does not establish training rights.
6. **Humans approve records; humans promote models.** Automation may CHECK, never PROMOTE.
7. **One paid job per authorization**, budget declared before the call, hard-stop at cap.
8. **No second registry, no parallel schema.** Everything flows through `factorylm_ai/`
   governance and the flywheel record shapes.

## 7. Go/no-go recap (unchanged from the audit, restated as the gate to Phase 1 step 4)

Train only when: ≥100 eligible approved records (≥150 recommended) · ≥20 training lineages ·
≥5 untouched held-out lineages · both PrintSense and Drive Commander represented ·
≥20 refusal/correction and ≥15 safety examples · every record has rights + provenance + human
approval + independent answer key · no fixture/frozen-eval/held-out/sensitive leakage ·
base-vs-tools benchmark shows a closable gap · estimated spend within cap · #2881
authorization ledger green · Mike's explicit paid authorization issued last.

## 8. Cross-references

- `docs/zta/2026-07-23-technician-dataset-inventory-gap-report.md` — the audit this plan executes
- `docs/zta/technician-dataset-v0/` — the candidate corpus, reports, review packages
- `docs/zta/factorylm-ai-model-lab.md` — the factory + fleet table
- `docs/zta/together-liquid-model-strategy.md` — pricing/economics, train-on-Together/serve-local
- `docs/zta/2026-07-22-technician-lora-phase0-reconciliation.md` — reuse map + PR ladder
- `docs/zta/2026-07-25-drive-commander-oem-training-rights.md` — the rights-grant pattern
- `docs/zta/2026-07-25-together-qwen35-9b-model-support-receipt.md` — model-support receipt
- `docs/adr/0028-vision-zero-token-architecture.md` — owned-model program charter
- `.claude/rules/zero-token-architecture.md` — the spend law
- `.claude/rules/materialized-evidence.md` — one evidence contract, no second registry
