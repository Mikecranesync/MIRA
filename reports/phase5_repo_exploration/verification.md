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

## The version-bump rule — three sources, reconciled honestly

This is the one place the inputs disagree. **I initially over-corrected; here is the evidence-respecting answer.**

- **`mira-hub/AGENTS.md`:** a hub PR bumps **both** `/VERSION` (overall, required) **and** `mira-hub/package.json` (hub minor) — "Every meaningful change (feature, **schema migration**, …) bumps the minor" — but its ship sequence pairs that bump with a lockfile regen.
- **Memory `feedback_mira_hub_pkg_version_frozen_lockfile` — EMPIRICAL, do NOT dismiss:** on **PR #2145 (2026-06-20)**, bumping `package.json` made the **Hub Unit Tests** `bun install --frozen-lockfile` step fail fast (**19s FAILURE**); reverting the bump turned it green (**34s PASS**). Observed CI behavior, not a guess.
- **My static check of `mira-hub/bun.lock`** (lockfileVersion 1): workspace root = `{"name":"mira-hub","dependencies":{…}}`, **no `version` field**; `2.17.2` absent. This *suggests* a version-only bump may now be lockfile-neutral — but it **does not override** the PR-#2145 failure, and a static read cannot prove `--frozen-lockfile`'s dynamic check.

**Correct, conservative guidance (now in `phase5_recommended_first_pr.md`):**
1. **Always** bump root `/VERSION` (the required Version Gate).
2. Bump `mira-hub/package.json` (hub minor, per AGENTS.md) **only together with `bun install` to regenerate + commit `bun.lock`** — a package.json bump WITHOUT a lockfile regen is empirically known to fail (PR #2145).
3. **Safest for PR-1:** bump `/VERSION` only and do the hub-release minor as a separate `chore(hub): release` PR. Do not assert "lockfile-safe" without re-running `bun install --frozen-lockfile` locally.

**I withdraw the earlier "version-only bump is lockfile-safe, AGENTS.md wins" claim — it ignored the empirical PR-#2145 evidence. The memory is NOT stale.** A static lockfile read is not a substitute for the observed CI result — a verify-before-asserting lesson on myself.

## Net

All Phase 5 report file:line for the first-PR and MIRA seams are **verified accurate**. The version-bump guidance was corrected *twice* — overturned, then restored to respect the empirical CI evidence (final: `/VERSION` always; `package.json` only with a lockfile regen, or defer to a release PR). The five-term verdict taxonomy (existing / partial / missing / duplication-risk / recommended-seam) is used throughout `spine_to_platform_mapping.md`. No other discrepancies found in the spot-check.
