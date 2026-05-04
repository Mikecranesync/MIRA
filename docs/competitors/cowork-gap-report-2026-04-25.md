# Cowork overnight run — gap report

**Verified:** 2026-04-25
**Scope:** 14 branches created overnight to address Factory AI parity issues #561–#580. Issue #581 (mira-safety-guard) was blocked.
**Source of truth:** `mira-hub/AGENT_NOTES_{N}.md` self-reports on each branch + `git diff origin/main..<branch>` content checks.

---

## 1. Headline assessment

The cowork run delivered **scaffolding + foundations**, not shippable features. Every P1/P0 branch ships a migration, a domain library, and route handlers — but **all 13 P0/P1/P2 implementation branches share three universal gaps**:

1. **No real auth.** Every route uses `x-tenant-id` / `x-user-id` HTTP-header stubs explicitly tagged `TODO(#578)`. Until #578 lands and a sweep PR replaces those stubs, none of these endpoints are safe to expose.
2. **No tests.** Zero unit/integration/e2e tests across all branches. Each AGENT_NOTES has a "manual smoke test" section instead.
3. **NPM deps not installed.** `package.json` was not updated on most branches — the routes import packages that don't yet resolve. Running these branches as-is would fail at build time.

The branches will work correctly **after** a follow-up auth-sweep PR, dependency install, env-var wiring, and a test suite per branch. Estimated total cleanup work: ~5–7 engineering days.

---

## 2. Verified facts (per branch)

| Branch | Issue | Files added | LoC | ADR | Migration | AGENT_NOTES self-report |
|---|---|---|---|---|---|---|
| `agent/issue-562-asset-hierarchy-0405` | #562 | 15 | 2,660 | 0013 | ✅ | ✅ |
| `agent/issue-565-wo-lifecycle-0405` | #565 | 20 | 2,933 | 0014 | ✅ | ✅ |
| `agent/issue-566-pm-procedures-0405` | #566 | 15 | 2,966 | 0015 | ✅ | ✅ |
| `agent/issue-568-failure-codes-iso14224-0405` | #568 | 11 | 2,193 | 0016 | ✅ | ✅ |
| `agent/issue-574-byo-llm-asset-chat-0331` | #574 | 11 | 1,938 | 0017 | ✅ | ✅ |
| `agent/issue-575-mobile-pwa-0445` | #575 | 14 | 2,341 | 0021 | ✅ | ✅ |
| `agent/issue-576-outbound-webhooks-0331` | #576 | 15 | 2,225 | 0018 | ✅ | ✅ |
| `agent/issue-577-api-reference-0445` | #577 | 15 | 3,046 | n/a | n/a | ❌ (commit msg only) |
| `agent/issue-578-multi-tenancy-0445` | #578 | 22 | 3,944 | 0019 | ✅ | ✅ |
| `agent/issue-579-sso-saml-oidc-0445` | #579 | 13 | 2,495 | 0020 | ✅ | ✅ |
| `agent/issue-580-soc2-kickoff-0903` | #580 | 14 | 1,552 | 0030 | n/a | ✅ (at repo root) |
| `agent/p2-batch-563-564-567-0903` | #563/#564/#567 | 19 | 3,642 | 0022/0023/0024 | ✅ | ✅×3 |
| `agent/p2-batch-569-570-571-0903` | #569/#570/#571 | 22 | 3,486 | 0025/0026/0027 | ✅ | ✅×3 |
| `agent/p2-batch-572-573-0903` | #572/#573 | 24 | 4,603 | 0028/0029 | ✅ | ✅×2 |
| `research/competitor-intel` | (docs) | docs prep + 5 API ref | — | — | — | n/a |

**Real LoC across the 14 implementation branches: ~40k.** Total ADRs added: 18 (0013–0030). Total migrations: 13.

---

## 3. Cross-cutting work that is NOT yet captured in any issue

These belong as **new GitHub issues** that should be filed before the first parity branch lands:

### 3.1 Auth-sweep PR (post-#578) — **NEW ISSUE NEEDED**
Once #578 ships its session helper, ~80 routes across 13 branches still read `x-tenant-id` and `x-user-id` from headers. These need a sweep PR that:
- Replaces every `getTenantContext()` stub with real `withTenant()` middleware
- Removes header-based plumbing
- Confirms RLS policies activate (commented out in #574, #576, #579 migrations until `mira.tenant_id` is set)

### 3.2 Dependency install + lockfile commit — **NEW ISSUE NEEDED**
Routes import packages that aren't in `package.json`:
- `libsodium-wrappers` + `@types/libsodium-wrappers` (#574, #576, #579)
- `@anthropic-ai/sdk` (#574)
- `jose`, `bcrypt` (#578)
- `@node-saml/node-saml`, `openid-client`, `xml2js`, `@types/xml2js` (#579)
- `dexie` (#575)
- `rrule` (#566)
- `fft-js` (#569)
- `recharts` (#571)
- `pdfkit`, `qrcode`, types (#563)

Until these are installed and committed, none of the branches build cleanly.

### 3.3 Doppler env-var provisioning — **NEW ISSUE NEEDED**
Add to `factorylm/prd`:
- `LLM_KEK` — 32-byte hex (#574)
- `WEBHOOK_KEK` — 32-byte hex (#576)
- `CRON_SECRET` — 32-byte hex (#566, #572, #576)
- `TENANT_JWT_SECRET` — ≥32 chars HS256 (#578)
- `MIRA_PRIMARY_DOMAIN` — `factorylm.com` (#578)
- `MIRA_INTERNAL_SECRET` (#578)
- `MIRA_STRICT_SUBDOMAIN` — `1` for prod (#578)
- `SUPER_ADMIN_USER_IDS` (#578)
- `SAML_SP_PRIVATE_KEY` — RSA-2048 PEM (#579)
- `SAML_SP_CERT` — matching PEM (#579)
- `SAML_REPLAY_CACHE_TTL_SEC` — default 300 (#579)
- `OIDC_CALLBACK_BASE_URL` — stable URL (#579)
- `SSO_PGCRYPTO_KEY_REF` (#579)

### 3.4 Test suite per branch — **NEW ISSUE NEEDED (each branch)**
Each branch should not merge to main without unit tests for its lib + integration tests for its routes. None ship today.

### 3.5 Webhook event-wiring sweep — **NEW ISSUE NEEDED**
#576's worker exists but the dispatcher is unwired in:
- `api/events/route.ts` (work-order events from #565)
- `api/assets/route.ts` (asset events from #562)
- PM events from #566
- Alert events from #569
- Sensor threshold events from #571
- Chat thread events from #574
- Integration connect/disconnect from #570

### 3.6 Migration deploy-order documentation — **NEW ISSUE NEEDED**
Recommended order (verified against AGENT_NOTES blockers):
```
1. 002-asset-hierarchy.sql (#562)        — base, no deps
2. 003-failure-codes.sql (#568)          — depends nothing in this batch
3. 004-pms.sql (#566)                    — depends on #562
4. 005-work-orders.sql (#565)            — depends on #562, #568, #566
5. 006-llm-keys.sql (#574)               — independent
6. 007-webhooks.sql (#576)               — independent
7. 008-tenants-rls.sql (#578)            — depends on all above (final RLS gate)
8. 009-sso.sql (#579)                    — hard dep on #578
9. 010-pwa-sync.sql (#575)               — depends on #565
10–12. P2 batches in any order after #578 lands
```

⚠️ #568's `iso-14224-seed.sql` is **NOT idempotent**. Do not run via the standard migration runner without first switching to deterministic UUIDs (`uuid_generate_v5`) + `ON CONFLICT DO NOTHING`. Self-flagged in AGENT_NOTES_568.

### 3.7 Issue #581 — mira-safety-guard OSS (still TODO)
Blocked by content filter during cowork run. Do this manually: extract `mira-bots/shared/guardrails.py` directly into a new repo `Mikecranesync/mira-safety-guard`, MIT license, publish to PyPI. No agent mediation needed; the keyword list is already in your codebase.

---

## 4. Per-issue residual work (what's left for "issue closed")

### P0
- **#574 (BYO-LLM chat).** Anthropic SDK swap, OpenAI/Google providers (current 501), full PII sanitiser port, RLS activation. ~1 day after #578.
- **#576 (webhooks).** Event-wiring sweep (3.5 above), rate-limit enforcement. Refactor secret-storage into shared `lib/crypto/secretbox.ts`. ~1 day.

### P1
- **#562 (asset hierarchy).** Path-maintenance trigger for slug renames, NOT NULL constraints post-backfill, cross-site asset moves. Legacy `/api/assets` needs `path` field added. ~0.5 day.
- **#565 (WO lifecycle).** FKs into pms/failure_codes (waiting #566/#568 to land), stock deduction (waiting #572), webhook calls (waiting #576). ~0.5 day after deps merge.
- **#566 (PM procedures).** `npm install rrule` + replace stub `computeNextRrule`, safety-gate column on `wo_tasks` migration follow-up, utilization-rate projection. ~1 day.
- **#568 (failure codes).** **CRITICAL: idempotent seed file fix before first prod run.** Bulk-import endpoint, translations (es/pt/de). ~0.5 day.
- **#575 (PWA).** `/api/v1/sync/upload-blob` route, `/api/v1/sync/ping` stub, icon files (192/512px), 30-day retention sweep, client-side photo downscale. ~1 day.
- **#577 (API ref).** Already complete as a docs deliverable. Pages stay [Spec] until features land.
- **#578 (multi-tenancy).** `/api/internal/resolve-tenant` route, dedicated `tenant_invites` table, session-revocation table for SOC 2, ~80-route auth sweep (3.1 above). ~2 days. **Deploy as late as practical** — recommend 1 week staging shadow-mode before strict RLS in prod.
- **#579 (SSO).** Library wiring (3.2 above), SP cert/key generation, assertion replay cache, SLO + OIDC logout, SCIM 2.0 (v2), directory poll worker, cert rotation cron, XXE hardening test. ~3 days. **Hard depends on #578.**

### P2
- **#563 (QR).** `pdfkit` + `qrcode` install + real `render.ts` body, S3 upload for PDFs, `qr.factorylm.com` short DNS (v2). ~0.5 day.
- **#564 (templates).** `cmms_components.attributes` JSONB column, failure-mode linking, RLS policy body. ~0.5 day.
- **#567 (strategies).** `pm_templates` table for `spawnDefaults: true`, `strategy_compliance_reports` materialized view (90-day window). ~1 day.
- **#569 (FFT).** `npm install fft-js` (Apache-2.0); ISO 10816-3 default-rule seeder; envelope demodulation v2; retention prune cron. ~0.5 day.
- **#570 (external events).** Encrypted secret storage (depends #576), stub handlers for alarm/downtime, rate-limit enforcement, replay endpoint v2. ~1 day.
- **#571 (sensor reports).** `npm install recharts`, `cmms_equipment.running_speed_rpm` column. ~0.5 day.
- **#572 (inventory).** Vercel cron config for nightly recompute, `wo_parts.part_id` FK validation, multi-currency v2. ~0.5 day.
- **#573 (purchasing).** Email approver-pool notifier, reorder-suggestion → PO bridge, cancel/close endpoints, 3-way matching v2, supplier portal v2. ~1 day.

### P0–P1 (tracking)
- **#561 (epic).** Stays open until all 20 children close.
- **#580 (SOC 2).** Vanta procurement, auditor RFP, 4× DR runbooks, risk register, AUP owner, exception tracking, vendor approvals dir, training LMS, pentest scoping (Q3), tabletop exercises, org chart. **6-month timeline; not engineering work.** Hard-blocks on #578 for CC6 evidence collection.

---

## 5. Cleanup chores (not engineering)

1. **Stray local branch:** `agent/issue-574-byo-llm-asset-chat` (no -0331 suffix) has no unique work. Safe to delete with your authorization: `git branch -D agent/issue-574-byo-llm-asset-chat`.
2. **Broken ref:** `.git/refs/heads/agent/issue-574-byo-llm-asset-chat.lock.11215.gone` shows up as a "broken ref" warning. `rm` it when you want a clean `git branch` output.
3. **Unrelated commit on #579 branch:** `9ff5c97 docs(wiki): eval-fixer run 2026-04-25` rides on top of the SSO feature commit. Move to its own branch or drop before opening the PR.
4. **#578 + #579 SSO library duplication:** You called this out in your summary. Either rebase #578 to remove `mira-hub/src/lib/auth/sso/*.ts` (preferred — keeps PR scope clean), or merge #579 first.
5. **#580 AGENT_NOTES is at repo root** (`/AGENT_NOTES_580.md`), not in `mira-hub/`. Move to `mira-hub/AGENT_NOTES_580.md` for consistency.

---

## 6. Suggested next moves (in order)

1. **Push all 14 branches now.** They're complete enough to start review and CI runs in parallel. `for b in $(git branch | grep -E "agent/issue-|agent/p2-|research/comp"); do git push -u origin $b; done`
2. **File the 6 cross-cutting issues from §3** so they don't get lost.
3. **Open #581 (mira-safety-guard) yourself** — extract `guardrails.py`, MIT-license it, publish.
4. **Sequence merges in migration order from §3.6.** Merge #562 → #568 → #566 → #565 → #574 → #576 → #578 → #579 → P2 batches → #575 → #577 (docs).
5. **For each merge, require:**
   - Auth stubs replaced (after #578 lands)
   - NPM deps installed in package.json
   - At minimum a smoke test from the AGENT_NOTES "manual smoke test" section converted into a Playwright e2e
6. **Restore your `feat/hub-google-connector` work**: `git switch feat/hub-google-connector && git stash pop` once `git stash list` confirms the stash is still there.

---

## 7. Bottom line for the morning

You woke up to **40,000+ LoC of working scaffolding** across 14 branches. The hard architectural decisions are made (RLS-first multi-tenancy, HMAC-signed webhooks, JIT SSO provisioning, ISO 14224 taxonomy, SSE chat streaming). What's left is **finishing work**: real auth, tests, dep install, env vars, and event wiring. None of it is hard; all of it is necessary before any of these endpoints face customers.

Approximate finishing budget: **5–7 engineering days** to ship all P0+P1 to production-quality, plus the SOC 2 program track which is its own multi-month effort.
