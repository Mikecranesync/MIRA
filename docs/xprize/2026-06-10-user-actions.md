# Outstanding USER ACTIONS — consolidated & refreshed (2026-06-10)

Single source of truth for what needs **Mike's** decision/hands. Items I could safely do
autonomously are already done (see bottom). Everything here is either a judgment call, a
credential/infra action, or work I'll do **on your word**.

---

## TIER 1 — blockers

### 1. Gemini API project is BANNED (cascade degraded)
- **State:** both `factorylm/prd` AND `factorylm/dev` `GEMINI_API_KEY` return **403 "project denied access"** on every call form. The "use dev key" workaround is also dead.
- **Impact:** the LLM cascade (Groq → Cerebras → Gemini) still works via the first two providers, but the **Gemini leg is dead**. Blocks **XPRIZE Gate A** (per `docs/xprize/2026-06-08-xprize-alignment-audit.md`).
- **ACTION (Mike):** the fix is **not** a new key — it's a **new GCP project** (or move to **Vertex AI**). Create it, mint a fresh `GEMINI_API_KEY`, set it in Doppler `factorylm/prd` (+ `dev`).

---

## TIER 2 — PR backlog decisions (72 open after this session's cleanup)

### 2. Dependabot (12 open; I closed #1802 = Anthropic, per the no-Anthropic rule)
- **Safe to batch-merge** (patch/minor): **#1805 #1804 #1803 #1800 #1799 #1798 #1797 #1794 #1793.** Say the word and I'll update-branch + merge each through the new staging-gate protection.
- **Test before merge** (major / breaking): **#1801** starlette 0.52→1.2 · **#1795** redis 5→8 · **#1796** actions/upload-artifact v4→v7.
- **Code follow-up:** remove the `anthropic` dependency from `mira-bots/telegram` requirements so dependabot stops re-proposing it (I closed the bump, but the dep line still exists).

### 3. Old conflicting feature PRs (>30 days, all still OPEN, behind/conflicting)
`#1072 #1069 #1030 #1025 #1020 #1004 #991 #885 #652 #642 #608` — likely several are obsolete.
- **ACTION (Mike):** for each, **keep** (I'll refresh onto current main like I did #1638→#1865) or **close**. Give me the list and I'll execute.

### 4. SAFETY-HOLD PRs still open (touch engine/guardrails/uns/citation — need human review)
From the original triage, still open and **not** to be auto-merged: **#1840** (citation enforce-mode), **#1563** (conversational layer v2), **#1573** (uns family-marker), **#1718** (guardrails param-lookup), **#1668** (self-serve Ignition + Walker), **#1264 / #1126** (inference/router), **#891 / #890 / #646** (engine).
- **ACTION (Mike):** review + `mira-run-hallucination-audit` before any merge. Tell me which to shepherd.

### 5. Keep-newest auto-gen PRs (I closed the older duplicates)
`#1850` (COMPETITOR_ANALYSIS) and `#1701` (gap-closure sync) are the surviving newest of their families — **merge them or let the routine keep refreshing.** Your call.

---

## TIER 3 — cosmetic / tracked follow-ups (I can do these on request)

### 6. Stale canonical doc (from the #1841 investigation)
`docs/migrations/001_knowledge_entries.sql:13` declares `tenant_id TEXT`, but prod/staging are `uuid`. Want me to add a corrective note? (Historical migration — I'd annotate, not rewrite.)

### 7. db-inspect probe branch
`chore/db-inspect-ke-tenant-type` adds genuinely useful **read-only** `db-inspect` queries (knowledge_entries column types + tenant breakdown). **Merge** it (handy for future schema questions) or I'll **delete** it.

### 8. knowledge_entries hybrid-filter rollout (the rest of the #1833 program)
#1841 fixed `/api/documents`. The tracked follow-up (per `.claude/rules/knowledge-entries-tenant-scoping.md`): apply the `(is_private = false OR tenant_id = $caller)` filter to the other ~13 per-tenant read surfaces (`/api/assets/[id]/documents`, `lib/manual-rag.ts`, `lib/agents/asset-intelligence.ts`) **and** set `is_private = true` in the production folder=brain write path (`mira-crawler/ingest/store.py`). This is the remaining beta tenant-isolation work — scope it when ready.

---

## ✅ Done this session (no action needed — for reference)
- **15 PRs landed** (merged + deployed + verified + rollback-tagged): #1848 #1786 #1791 #1753 #1745 #1710 #1746 #1522 #1748 #1750 #1711 #1841 (+ #1824 #1844 confirmed, #1807 by peer); **#1865** (refreshed #1638).
- **#1638 closed** → superseded by merged **#1865**.
- **Prod migrations 038/039 applied** (staging→prod, verified).
- **#1841 resolved (Option A):** prod-verified the schema (`tenant_id uuid`, single system tenant), dropped the dangerous migration 045, shipped the route-code fix. See `docs/xprize/2026-06-09-1841-schema-drift-resolution.md`.
- **GitHub branch protection** installed (`staging-gate` required + strict up-to-date; admins bypass).
- **Housekeeping:** closed #1802 (Anthropic), #1819/#1820 (lockfile dups, already closed), 7 COMPETITOR_ANALYSIS dups, 3 gap-closure dups → open PRs 94 → 72.
- Rollback tags: `rollback/2026-06-09-00-baseline` … `rollback/2026-06-10-13-after-1865`.

Records: `docs/xprize/2026-06-09-pr-triage.md`, `…-pr-merge-log.md`, `…-1841-schema-drift-resolution.md`, this file.
