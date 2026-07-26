# Technician Dataset v0 — Review Console

Offline, single-file review surface for turning candidate records into signed review
decisions at the volume the paid gate needs (100+ approvals in one sitting).

Open `index.html` directly in a browser. No server, no build step, no network call —
the candidate file is parsed in the page and nothing leaves the machine.

## Why this exists

The paid gate needs ≥100 approved records. The hand-authored route costs 6–8 steps and
4 context switches **per decision**: copy a template, hand-edit `reviewer_id` /
`rationale` / an ISO timestamp, look up `candidate_content_hash` and
`candidate_manifest_sha256` in a separate manifest file, run the append CLI, then rebuild.
Only 36 of the candidates were rendered as review cards at all; the rest were raw
single-line JSON. That does not finish in an afternoon.

## What it does differently

- **Only shows records that can actually count.** Filters to `split == "train"` and
  `rights.training_allowed == true`. Approving anything else is refused downstream as
  `DECISION_GOVERNANCE_BLOCKED`, so reviewing it is wasted effort.
- **Puts the evidence on the card.** The `answer_key.withheld_payload` claim, subject,
  kind, sheet, source and status — the ground truth the answer is judged against — is
  shown inline. The markdown review packages omit it, forcing a second file open per
  record.
- **Live gate meter.** Records / lineages / valued / safety-sensitive / sources against
  the real `paid_gate.py` thresholds, updating with every decision, so progress toward
  PASS is visible and you can stop the moment it reads GATE MET.
- **Round-robin lineage ordering.** Records are interleaved across lineages so early
  reviews each unlock a new one and both required sources are covered fast.
- **Preset rationales.** `rationale` is required on *every* decision — that typing, not
  the judgement, is the real bottleneck. Number keys pick a technician-grade reason;
  free text always overrides. The reason recorded is still yours.

## Use

1. Freeze the candidate build (do **not** regenerate afterwards — decisions bind to
   `candidate_manifest_sha256` and a rebuild invalidates every one of them):

   ```
   py -3 -m factorylm_ai.dataset.technician_v0 --stage readiness
   ```

2. Open `index.html`. Enter your `reviewer_id`, then load
   `docs/zta/technician-dataset-v0/candidate_dataset.jsonl` and `candidate_manifest.json`.

3. Review. `A` approve · `C` correct · `R` reject · `H` hold out · `U` undo ·
   `→` skip · `1`–`9` pick a reason · `Enter` confirm · `Esc` cancel.

4. Export `decisions.jsonl`, then import and rebuild:

   ```
   py -3 -m factorylm_ai.dataset.technician_v0 --stage readiness \
     --decisions-path docs/zta/technician-dataset-v0/review-decisions/decisions.jsonl \
     --import-decisions ~/Downloads/decisions.jsonl

   py -3 -m factorylm_ai.dataset.technician_v0 --stage readiness \
     --decisions-path docs/zta/technician-dataset-v0/review-decisions/decisions.jsonl \
     --model-support-receipt docs/zta/2026-07-25-together-qwen35-9b-model-support-receipt.md
   ```

5. Read the verdict in `docs/zta/technician-dataset-v0/reports/phase3_paid_gate_report.json`.

## Constraints worth knowing before you start

- **Decisions are append-only and immutable per record.** A second, non-identical
  decision for the same `record_id` is a hard `DECISION_CONFLICT` with no amend path —
  changing your mind requires a new candidate manifest. Use `U` before confirming.
- **Import is fail-closed.** One bad row rejects the whole batch and leaves the ledger
  untouched. Re-importing the same file is idempotent.
- **`decision_id` is deliberately not emitted.** It is a stable hash the CLI recomputes;
  reproducing that hash in JavaScript would be a second implementation to drift.
- The console computes nothing about eligibility. It mirrors the gate's thresholds for
  display only — `paid_gate.py` remains the sole authority.

## Style

Uses the shared FactoryLM tokens (`factorylm-tokens.css`, bundled here per
`.claude/rules/ui-style.md`). Muted normal state; color reserved for state — amber for
safety-sensitive, green for a met threshold, red for a blocked verdict. Keep the bundled
copy in sync with `docs/design/factorylm-tokens.css`.
