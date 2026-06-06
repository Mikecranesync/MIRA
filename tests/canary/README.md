# Proposal-state drift canary (ADR-0017, #1723)

Runtime safety net for the "MIRA proposes, a human verifies" invariant
(ADR-0017, `.claude/skills/managing-the-knowledge-graph`). The three status
projections must stay consistent:

| Table | Column | Vocabulary |
|---|---|---|
| `ai_suggestions` | `status` | pending / accepted / rejected / deferred / superseded |
| `relationship_proposals` | `status` | proposed / reviewed / verified / rejected / deprecated / contradicted |
| `kg_relationships` | `approval_state` | proposed / verified / rejected / needs_review |

## Files
- `proposal_state_drift.sql` — one `-- @check:` query per invariant; each returns the **offending rows** (zero = healthy).
- `run_proposal_canary.py` — runs every check against `NEON_DATABASE_URL`, exits 1 on any drift.
- `test_proposal_canary.py` — pure unit test of the runner (no DB).
- `../../.github/workflows/proposal-state-canary.yml` — nightly (07:00 UTC) + on-demand; the `drift` job runs against staging.

## Run it
```bash
doppler run --project factorylm --config stg -- python3.12 tests/canary/run_proposal_canary.py
```

## The two checks (and why they're legacy-safe)
1. **accepted_suggestion_pairs_unverified_proposal** — an `ai_suggestions(kg_edge)` a human *accepted* must point at a `verified` proposal.
2. **verified_edge_links_unverified_proposal** — a `kg_relationships` row that records `relationship_proposal_id` must link to a `verified` proposal.

Both key off an explicit proposal link, so the ~300 pre-#1716/#1729
auto-verified edges (which have `relationship_proposal_id IS NULL`, no paired
suggestion) are **never** flagged. A naïve "any verified edge without a
proposal" check would false-positive on all of them — these don't. Verified on
staging: PASS clean; FAILS correctly when an accepted-suggestion→unverified-proposal
pair is injected.

## Companion
- **Static** (CI-time, blocks new unguarded *writes*): `scripts/kg_write_guard.py` (#1722).
- **Positive** ("fresh ingest proposes, zero new verified edges"): `mira-crawler/tools/smoke_proposal_writer.py`.

## Known gap / next
The Hub decide route (`mira-hub/.../proposals/[id]/decide/route.ts`) does not
yet populate `kg_relationships.relationship_proposal_id` when it writes the
verified edge, so Check 2 is currently vacuous (no edges carry the link).
Wiring the decide route to set `relationship_proposal_id` makes Check 2
load-bearing — recommended follow-up.
