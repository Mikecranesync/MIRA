# Quarantine round-trip proof — staging, net-zero

**Date:** 2026-08-10 · **Tool:** `tools/corpus/canonicalize_manual.py` (rebuilt version)
**Identity:** `ep-polished-hall-ahcqtcxe-pooler/neondb`, exact-matched on both `--apply`
commands with `MIRA_CORPUS_MUTATION_OK=1` armed per-command.
**Batch:** `pf525-roundtrip-20260810`

This is the verification gate the review required before deleting the incident-era
restore tool: dry-run → pre-state fingerprints → apply → boundary proof → restore →
fidelity proof.

| check | result |
|---|---|
| dry-run plan | 3,362 duplicates (3,316 in `520-um001`, 46 within `520-qs001`) |
| quarantined | **3,362** — scope dropped 7,547 → 4,185, batch count 3,362 |
| distinct `md5(content)` during quarantine | **unchanged at 4,183** (only exact copies moved) |
| document-boundary violations | **0** — every quarantined row's `DedupKey` (manufacturer + publication + revision + content) had a surviving row with an identical key |
| restored | **3,362** |
| **full fingerprint equality** | **pre == post** (`550b05a9469f5702ca49c94316ba4fd0`) |
| timestamps-only drift | none — the fingerprint includes `created_at`, `updated_at` and `md5(embedding::text)` **per row**, so timestamps and embeddings are proven preserved, which is exactly what the old manifest approach silently lost |
| NULL embeddings after | 0 |
| quarantine batch remaining | 0 |

Full command transcripts: scratchpad `quarantine-evidence/` (session-local).

Consequence: `tools/corpus/restore_dedup.py` — the one-off recovery script written for
the P0 incident — is deleted in this commit. The quarantine path supersedes it and is
now proven end-to-end. The incident record
(`docs/testing/2026-08-10-corpus-p0-incident.md`) is retained.
