# Technician Dataset v0 — Review Sitting Record (2026-07-26)

Reviewer: mike@cranesync.com (all decisions recorded under the reviewer's identity).
Frozen build: `2026-07-23-technician-dataset-v0`, candidate manifest
`dd236c86cce8317c21d2fcb35fd554f070b84ac5172565c523984298eae2c71b` (never regenerated;
`review_decision_report.json` records `candidate_jsonl_mutated: false`).

## How the sitting ran

- Reviewed in the v2 review console (server-side state, phone-accessible, tailnet-only),
  which replaced the v1 single-tab console after its export was found to strip
  `correction_messages` (JSON.stringify replacer-array bug; fix staged separately).
- 23 decisions carried over from the 2026-07-26 v1 sitting; 3 v1 corrections lost their
  corrected text to the export bug and were quarantined for re-entry
  (`techv0-ps-style-017`, `techv0-drive-046`, `techv0-drive-001`) — NOT imported.
- Mike hand-reviewed 36+ cards, then ratified a screening policy: every card was
  machine-verified against its frozen evidence (claim-in-answer, evidence-field match,
  field_verify honesty, safe-stance language, known-discrepancy list). Tier A
  (deterministic, 70 undecided) and Tier A* (safety-template-verified, 17 undecided)
  were batch-approved under the ratified policy; every Tier B (judgment) card was
  reviewed by hand. Screen artifact: `confidence_screen_2026-07-26.json` (console data dir).
- Two corrections applied with Mike's exact approved wording (handoff doc 2026-07-26):
  `techv0-drive-002` (CE1) and `techv0-drive-047` (PF525 C129–C132 IP-octet edge).
- `techv0-cv101-001` (+CM0) is deliberately **held out**: it remains an independent
  evaluation example and is excluded from training.

## Import (append-only ledger)

- Pre-import ledger: absent (fresh).
- Import: 120 decisions (117 approve / 2 correct / 1 hold_out), received 120,
  appended 120, duplicates 0. Idempotence proven: immediate re-import appended 0,
  duplicate 120.
- Post-import ledger sha256:
  `7812f843c0578aad780457ca18a306b07824f10470a9ee73489c0de88f96c8e1`
- 13 records remain undecided/quarantined (10 Tier-B judgment cards + 3 re-entry
  corrections); they can be imported in a later append batch without conflict.

## Readiness verdict (official evaluator)

`phase3_paid_gate_report.json`: **PAID_GATE_PASS — 15/15 checks**, including
119 eligible records (≥100), 23 lineages (≥20), 66 valued interactions (≥20),
31 safety-sensitive (≥15), 5 held-out lineages (≥5), both trainable sources present,
est. cost $4.00 within the $5.00 cap, Qwen/Qwen3.5-9B FT support confirmed (Together).

## Known evidence notes carried on the record

- GS10 gold cites printed page 6-8 for the CE-fault family; the manual's fault-table
  rows are on 6-31 (CE1/CE2) and 6-32 (CE3/CE4/CE10; code 58 enumeration). Approved
  wording follows the pack cite; flagged during review, Mike's informed call.
- GS10 P09.03: manual page 4-188 shows range 0.0–100.0 s / default 0.0 vs gold
  "00–1000 sec" / "00". The two P09.03-dependent cards are among the 13 still open.

## Safety / spend

No paid API call, no upload, no fine-tune job, no endpoint, no authorization signed or
consumed, no deployment, $0 spent. Gate 4 (the $5 job) requires Mike's signed
authorization and explicit GO.
