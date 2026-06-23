# Phase 5 — Verification Pass (direct repo reads)

**Read-only confirmation of the load-bearing file:line in the Phase 5 reports — checked against the actual MIRA repo, not just sub-agent claims.** 2026-06-23. No code, no migrations.

## Confirmed references (first-PR critical path)

| Claim | Verified at | Verdict |
|---|---|---|
| `plcReportToSuggestions` (pure transform) | `mira-hub/src/lib/plc-proposals.ts:66` | ✅ exact |
| `insertPlcSuggestions` (writer) | `mira-hub/src/lib/plc-proposals.ts:135` | ✅ exact |
| The `ai_suggestions` INSERT shape | `plc-proposals.ts:151-157` — `INSERT INTO ai_suggestions (tenant_id, suggestion_type, extracted_data, confidence, status, risk_level, proposed_by, title, body) SELECT … 'pending' … FROM jsonb_to_recordset(...)` | ✅ exact — **note: `status` is hardcoded `'pending'`**; the factory-model writer needs a per-row `status` variant to emit `needs_review` |
| `decideSuggestion` (accept entry) | `mira-hub/src/lib/suggestion-accept.ts:155` | ✅ exact |
| `createKgEntity` (kg_entity → `kg_entities`) | `suggestion-accept.ts:57` | ✅ exact |
| `createTagEntity` (tag_mapping → `tag_entities`) | `suggestion-accept.ts:111` | ✅ exact |
| Accept dispatch on `suggestion_type` | `suggestion-accept.ts:186` (`=== "kg_entity"`), `:188` (`=== "tag_mapping"`) | ✅ exact |
| `ai_suggestions.status` CHECK = 5 values, **no `needs_review`** | `mira-hub/db/migrations/027_ai_suggestions.sql:87` (`'pending','accepted','rejected','deferred','superseded'`) | ✅ exact — migration needed |
| `/api/contextualization/import` "P5" comment | `mira-hub/src/app/api/contextualization/import/route.ts:27` ("legacy path; P5 migrates the offline client onto the contract") | ✅ exact (was cited as `:26`) |
| **No existing factory-model writer** in `mira-hub/src` | grep `factory.?model|FactoryModel` → 0 files | ✅ confirmed — the writer is genuinely new (no duplication) |
| MIRA seam: `_make_result` | `mira-bots/shared/engine.py:1062` | ✅ exact |
| MIRA seam: `_evidence_from_parsed` | `engine.py:1093` | ✅ exact |
| MIRA seam: `_schedule_decision_trace` (post-reply) | `engine.py:1292` | ✅ exact |
| MIRA seam: `build_trace_row` (pure) | `mira-bots/shared/decision_trace.py:112` | ✅ exact |
| `decision_traces` has **no `explanation` column** today | `mira-hub/db/migrations/032_decision_traces.sql` grep `explanation` → 0 | ✅ confirmed — the JSONB column is genuinely new |

## Correction surfaced by verification — the version-bump rule

The auto-loaded `mira-hub/AGENTS.md` and the actual lockfile **contradict a prior memory** that the first-PR report had carried:

- **`mira-hub/AGENTS.md`:** a hub PR bumps **both** `/VERSION` (overall, required) **and** `mira-hub/package.json` (hub minor) — "Every meaningful change (feature, **schema migration**, …) bumps the minor."
- **The memory `feedback_mira_hub_pkg_version_frozen_lockfile`** said: *never* bump `mira-hub/package.json` (it breaks `bun install --frozen-lockfile`).
- **Direct check of `mira-hub/bun.lock`** (lockfileVersion 1): the workspace root entry is `{"name": "mira-hub", "dependencies": {…}}` — **no `version` field**, and the string `2.17.2` does not appear anywhere in the lockfile. Therefore a **version-only** `package.json` bump leaves `bun.lock` byte-identical and `--frozen-lockfile` passes.

**Reconciliation (now reflected in `phase5_recommended_first_pr.md`):** bump **both** `/VERSION` and `mira-hub/package.json` (minor) per AGENTS.md; it is lockfile-safe for a dependency-free change; run `bun install` and confirm `bun.lock` is unchanged before push. The memory's blanket "never bump" is stale for the current lockfile (the historical break was likely a coincident dependency change or an older lockfile format).

## Net

All Phase 5 report file:line for the first-PR and MIRA seams are **verified accurate**. One substantive correction (version bumps) applied. The five-term verdict taxonomy (existing / partial / missing / duplication-risk / recommended-seam) is used throughout `spine_to_platform_mapping.md`. No other discrepancies found in the spot-check.
