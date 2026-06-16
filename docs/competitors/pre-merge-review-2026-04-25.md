# Pre-merge code review — overnight cowork branches

**Reviewed:** 2026-04-25
**Reviewer:** inline file inspection (`git show <branch>:<path>`)
**Approach:** spot-check the migration + the most security-sensitive file per branch + cross-reference with each branch's `AGENT_NOTES_<N>.md` self-report.
**Companion doc:** `docs/competitors/cowork-gap-report-2026-04-25.md` — universal gaps (auth stubs, no tests, missing npm deps).

---

## Cross-cutting findings (apply to ALL implementation branches)

These three gates must close before any feature branch reaches `main`. They are documented as new issues to file in §6.

| # | Issue | Severity |
|---|---|---|
| 1 | Auth is stubbed (`x-tenant-id` headers) on every route | 🔴 Blocker — RLS will fail-closed otherwise |
| 2 | Zero automated tests across all 14 branches | 🔴 Blocker for prod, 🟡 Acceptable for staging shadow |
| 3 | `package.json` not updated for any of the imports — branches won't build | 🔴 Blocker |

---

## Per-branch findings (in merge order)

### #562 — asset hierarchy (`agent/issue-562-asset-hierarchy-0405`)

**🚫 BLOCKERS:** None for migration itself. Migration is well-formed.

**⚠️ HIGH:**
- Slug regex strips non-alphanumerics. Equipment with `equipment_number = "!!!"` produces empty slug → NULL → no path. ~15 lines of code path-uniqueness check would catch this on insert. **File:** `mira-hub/db/migrations/2026-04-24-003-asset-hierarchy.sql` lines 145–170.
- No DOWN migration. If forward-migration corrupts data, only point-in-time recovery rolls back.
- `path` is denormalized; agent acknowledged path-maintenance trigger is TODO. Until trigger lands, **API layer is the only writer of `path`** — direct DB updates from psql break the invariant.

**🟡 MEDIUM:**
- N+1 risk on tree-listing endpoint not verified — recommend reviewing `mira-hub/src/lib/cmms/hierarchy.ts` for batch loading.
- ON DELETE RESTRICT on `cmms_areas.site_id` is correct, but the API needs a friendly error message — currently fails as a generic 500.

**✅ TESTS NEEDED before merge:**
- Migration round-trip: backfill + validate + insert new equipment in a default-area tenant
- Slug collision: two assets with same equipment_number under same site → must 409
- Path prefix query: `WHERE path LIKE '/site-a/%'` returns expected subtree

**📋 DEPENDENCY ORDER:** First. Nothing depends on it from earlier branches; everything else builds on top.

---

### #568 — ISO 14224 failure codes (`agent/issue-568-failure-codes-iso14224-0405`)

**🚫 BLOCKERS:**
- **Seed file `mira-hub/db/seeds/iso-14224-seed.sql` is NOT idempotent.** Re-run will hit unique-constraint violation and rollback. Self-flagged in seed file header. **Must fix before first prod run** by switching to `uuid_generate_v5(uuid_namespace_iso, code)` + `ON CONFLICT (code) DO NOTHING` per row.
- Seed file is in `db/seeds/` not `db/migrations/` so the standard runner won't touch it. **Document the manual one-time run procedure** before the first prod deploy.

**⚠️ HIGH:**
- Seed has 12 classes × 8 modes × N mechanisms × M causes ≈ 1000 rows in one transaction. Big BEGIN/COMMIT, but acceptable.
- No translation infrastructure (German/Spanish/Portuguese) — agent acknowledged.

**🟡 MEDIUM:**
- Pareto report query was not inspected in this review — recommend a 30-second eyes-on for materialized-view-vs-live-query decision.

**✅ TESTS NEEDED:**
- Idempotency: run seed twice, second run errors gracefully (after fix)
- Custom failure code with `is_custom=true` is tenant-scoped; cross-tenant read returns nothing
- Pareto report on a tenant with 0 closed WOs returns empty array, not 500

**📋 DEPENDENCY ORDER:** After #562. Independent of #565/#566.

---

### #566 — PM procedures + auto-spawn (`agent/issue-566-pm-procedures-0405`)

**🚫 BLOCKERS:** None at the code level. Spawn worker is race-safe.

**⚠️ HIGH:**
- `computeNextRrule` is a STUB until `npm install rrule` runs. Calendar PMs (RRULE-driven) will throw at runtime today. **File:** `mira-hub/src/lib/pms/scheduler.ts`.
- No way to cancel an in-flight PM when its parent asset is archived (`cmms_equipment.archived_at`). The spawn worker will keep generating WOs against a dead asset until the PM itself is archived.

**🟡 MEDIUM:**
- The spawn worker uses `pg_try_advisory_xact_lock(tenant_hash, pm_hash)`. Hash collisions across tenants are vanishingly rare but possible. If two PMs hash-collide, only one can spawn per cron run. Not a correctness issue, but worth a comment.
- "Skip if existing open WO" check happens BEFORE the advisory lock. Read-committed isolation makes this safe (verified), but adding an in-lock recheck would be defense-in-depth.

**✅ TESTS NEEDED:**
- Race: 5 concurrent invocations of `spawnDuePMs()` → exactly one WO created per due PM
- Archived asset: PM points at archived equipment → spawn returns `skipped: archived_asset`
- Grace window: PM due in 3 days, grace=5 → spawns now; PM due in 7 days, grace=5 → skips
- `runtime_hours` PM: meter at 95h, threshold 100h → not yet due; meter at 105h → spawns

**📋 DEPENDENCY ORDER:** After #562 (asset FK). Hard dep on #565 (writes to `work_orders`). Run AFTER both.

---

### #565 — work-order 7-state lifecycle (`agent/issue-565-wo-lifecycle-0405`)

**🚫 BLOCKERS:** None. State machine is pure-functional and clean.

**⚠️ HIGH:**
- `canForceTransition` allows admin to skip states from any non-`closed` state. **But `timestampsForTransition` doesn't backfill missed timestamps** — a force-skip from `assigned` directly to `closed` leaves `started_at` and `completed_at` as NULL. Reports keyed off these will show inconsistent data. Either fix `timestampsForTransition` to backfill on skip, or reject force-skips that orphan timestamps.
- FK to `pms(id)` is tagged `TODO(#566)` — currently a free uuid column with no constraint. **PM-spawned WOs reference orphan ids if a PM is deleted.** Add the FK in the same migration sequence.
- `wo_audit_log` write happens in app code, not via DB trigger. If a route forgets to call it (or fails between INSERT and audit-log insert), audit gaps are possible. **For SOC 2 immutability, move audit-log writes into a DB trigger.**

**🟡 MEDIUM:**
- No optimistic locking (`updated_at` check) on PATCH. Two simultaneous priority changes from different users → last writer wins silently.
- `RETURNING id` on transition INSERT vs full row return inconsistency between routes.

**✅ TESTS NEEDED:**
- All 12 legal transitions succeed
- All ~30 illegal transitions return 409
- Force-skip: assigned → closed; verify timestamps coherent (or that we reject)
- Audit log row written for every transition (count assert)
- Sub-resources: tasks/parts/labor/comments — DELETE cascade on WO delete

**📋 DEPENDENCY ORDER:** After #562 (asset FK). Should come AFTER #568 (failure_code FK) ideally so the FK can be added cleanly. #566 hard-depends on this.

---

### #574 — BYO-LLM asset chat (`agent/issue-574-byo-llm-asset-chat-0331`)

**🔴 SECURITY BLOCKERS:**
- **No KEK rotation story.** If `LLM_KEK` ever rotates, every encrypted record in `llm_keys` becomes unreadable. **Add a `key_id` column referencing the KEK version BEFORE storing real customer keys**, plus a re-encryption migration path. Doing this after launch is a customer-impacting outage.
- **Hex KEK is not validated.** `Buffer.from(hex, "hex")` silently truncates on non-hex chars. Add a regex check `/^[0-9a-f]{64}$/i` at module load.

**🚫 FUNCTIONAL BLOCKERS:**
- **SSE stream has no `cancel()` handler.** Client disconnect → upstream Anthropic call keeps running, charges tokens, holds connection. **File:** `mira-hub/src/app/api/v1/assets/[id]/chat/route.ts:395`. Add `cancel(reason) { upstreamAbortController.abort(reason) }` and pass an `AbortController` to `callAnthropicStream`.
- **Partial messages aren't persisted on disconnect.** User-message inserted, assistant-message-row never written → orphan threads. Either persist on cancel, or run a cleanup cron.

**⚠️ HIGH:**
- Safety-keyword gate uses substring match. Bypass via Unicode tricks (e.g. `lockоut` with Cyrillic 'о') — wide attack surface. **Recommend NFKC normalize before matching, and word-boundary regex not substring.**
- PII sanitiser is a 3-rule stub; the production rule set lives in `mira-bots/shared/inference/router.py`. Until ported, IPv4/MAC/serial-number redaction is not happening.
- No max-token cap server-side. Customer with a misconfigured prompt could rack up a $50 chat completion.

**🟡 MEDIUM:**
- `assistantText` accumulates unbounded in memory.
- No `reader.releaseLock()` in `finally` block (minor).
- `webpackIgnore: true` comment style is older Next.js syntax — verify it works on Next 15.

**✅ SECURITY TESTS NEEDED:**
- Roundtrip encrypt/decrypt with libsodium installed
- Decrypt fails after KEK swap (proves rotation breaks it — driver for fixing the design)
- Safety keyword: "arc flash" triggers STOP; "arсh flash" with Cyrillic с also triggers STOP
- SSE cancel: client disconnect mid-stream cancels upstream within 1 second
- Concurrent chats from same tenant: no nonce collision in libsodium output

**📋 DEPENDENCY ORDER:** Can land before #578 (uses header-stub auth like everyone else). Should land before customer onboarding either way.

---

### #576 — outbound webhooks (`agent/issue-576-outbound-webhooks-0331`)

**🔴 SECURITY BLOCKERS:** None. Crypto and URL guard are textbook-correct.

**🚫 FUNCTIONAL BLOCKERS:**
- **Event wiring missing.** Worker exists; the dispatcher is not invoked from `api/events/route.ts`, asset routes, alert routes, etc. Webhooks ship but don't fire. Track as a sweep PR (issue #6 in §6 below).

**⚠️ HIGH:**
- **Cron auth uses a Bearer-token shared-secret check.** Verify it uses `crypto.timingSafeEqual` (most "Bearer X === Y" implementations do not). **File:** `mira-hub/src/app/api/v1/webhooks/cron/route.ts`. If it's a `===` comparison, replace.
- **Replay endpoint** (`POST /webhooks/deliveries/{id}/replay`) — verify it scopes by tenant_id; otherwise tenant A could replay tenant B's deliveries via stolen UUID.
- **Auto-pause threshold is 50.** If a webhook flaps every other minute (50 fail / 50 pass / repeat), it never auto-pauses. Use a sliding window or consecutive-fail counter, not "last 50."

**🟡 MEDIUM:**
- `RESPONSE_BODY_LIMIT = 4096` is fine but log the truncation with a flag (currently just truncates silently).
- `secret-storage.ts` duplicates encryption logic from `lib/llm-keys.ts` (#574). Refactor to shared `lib/crypto/secretbox.ts` post-merge.
- HMAC signing format (`t=...,v1=...`) matches Stripe — good. **Document the version-bump procedure** for v2 signatures (key rotation, dual-signing window).

**✅ TESTS NEEDED:**
- Sign-then-verify round trip, valid + tampered + stale (>5min)
- URL guard: 169.254.169.254 rejected; localhost rejected in prod; localhost allowed in dev
- DNS rebinding: pre-resolve to public, post-resolve to private — current code re-validates inside the worker (good); test it
- Replay scoped by tenant_id (cross-tenant replay rejected with 404)
- Worker concurrency: 3 simultaneous `processBatch()` runs claim disjoint deliveries
- Auto-pause after 50 consecutive non-2xx; recovery on first 2xx

**📋 DEPENDENCY ORDER:** Independent of others. Can land any time after #578 for real auth.

---

### #578 — multi-tenancy + RLS (`agent/issue-578-multi-tenancy-0445`) ⭐ GATING

**🔴 SECURITY BLOCKERS:**
- **`tenant_audit_log` allows UPDATE/DELETE under the `FOR ALL` policy.** SOC 2 (CC4.1, CC7.2) requires audit-log immutability. **Replace with two separate policies:** `FOR INSERT WITH CHECK (...)` and `FOR SELECT USING (...)` only. No update/delete grant from the app role. **File:** `mira-hub/db/migrations/2026-04-24-008-tenants-rls.sql` policy block.
- **SSO library files leaked from #579.** `mira-hub/src/lib/auth/sso/{db-helpers,jit,oidc,saml,types}.ts` (842 lines) are present on #578. **#579 has the corresponding routes + migration but is missing these libs entirely.** This is worse than the user's earlier note — the branches are interlocked.
  - **Recommended fix:** rebase to move all 5 files from #578 to #579. Each branch should be reviewable in isolation.
  - **Alternative:** merge #578 first, then #579 — but the PR for #579 will reference files committed by #578, making review confusing.

**🚫 FUNCTIONAL BLOCKERS:**
- **`/api/internal/resolve-tenant` route is referenced by middleware but not implemented.** Middleware will 500 on every request once strict mode flips on.
- **`SUPER_ADMIN_USER_IDS` parsing** — verify it `.split(",").map(s => s.trim()).filter(Boolean)`. If it's `s.split(",")`, a trailing comma or space gives a phantom admin.

**⚠️ HIGH:**
- bcrypt cost factor not yet checked (should be 10–12). Verify in `mira-hub/src/lib/auth/login.ts`.
- JWT signing is HS256 with `TENANT_JWT_SECRET`. Confirm the secret is ≥32 chars and rotation strategy is documented.
- Reserved-subdomain check: case-sensitivity. `App.factorylm.com` vs `app.factorylm.com` — verify the check uses `lower()`.
- Login route: rate limiting + lockout policy. If the route doesn't have a counter, a credential-stuffing attack is unconstrained.

**🟡 MEDIUM:**
- Login error messages: ensure "user not found" and "wrong password" return the same error and same timing (timing-safe-equal on hashed input).
- `current_setting('mira.role', true) = 'service'` escape — verify the worker (cron, webhook dispatcher) explicitly sets this.

**✅ SECURITY TESTS NEEDED:**
- Tenant A user cannot read tenant B's `cmms_equipment` (RLS denial test)
- Tenant audit log INSERT works; UPDATE returns 0 rows affected (after policy fix)
- Subdomain `App.factorylm.com` resolves to same tenant as `app.factorylm.com`
- Reserved subdomain `Admin` (capital A) rejected at signup
- 100 failed logins in 60 seconds → lockout (after rate-limit feature)
- JWT replay across tenants: token signed for tenant A presented to tenant B → rejected
- `mira.tenant_id` not set → no rows visible (fail-closed verification)

**📋 DEPENDENCY ORDER:** Migration runs **AFTER** #562, #565, #566, #568, #574, #576 (RLS gates them). **BEFORE** #579 (which FKs to `tenants` and `users`). Strict-mode rollout: 1-week shadow before strict.

---

### #579 — SAML + OIDC SSO (`agent/issue-579-sso-saml-oidc-0445`)

**🔴 SECURITY BLOCKERS:**
- **All protocol code is stubbed (returns 503 SSO-105).** This is by design until the npm packages install, but until then SSO is not functional. **Do not enable in any tenant until library wiring + XXE test ship.**
- **SAML XML parsing without XXE protection.** `xml2js` allows external entities by default. Configure `{ explicitArray: false, normalize: true, normalizeTags: true }` AND add a custom resolver that rejects external entities. **A test in `tests/security/saml-xxe.test.ts` is REQUIRED before any IdP is configured.**
- **JIT provisioning trusts IdP-asserted email.** If IdP doesn't enforce email verification, a user can register a fake email pointing at a target tenant. Either reject IdPs that don't assert `email_verified=true`, or quarantine new users behind admin approval.

**🚫 FUNCTIONAL BLOCKERS:**
- The SSO library files (`saml.ts`, `oidc.ts`, `jit.ts`, `db-helpers.ts`, `types.ts`) are on **#578**, not #579. See #578 finding. **Resolution required before either branch merges cleanly.**

**⚠️ HIGH:**
- Replay-cache cleanup cron is "deferred to future work" — without it, the `saml_request_cache` table grows unbounded.
- OIDC `state` and `nonce` validation are stubbed; verify both are required + cleared after one-time use post-implementation.
- Group-to-role mapping: case-sensitivity. Many IdPs return groups in arbitrary case (`Admin` vs `admin`). Decide and enforce.
- SP cert/key generation procedure documented but not automated. **Lock down a runbook before customer onboarding** so customer-facing engineers can rotate without operator intervention.

**🟡 MEDIUM:**
- SLO + OIDC logout endpoints stubbed. Acceptable for v1 if 24h max session is enforced.
- SCIM 2.0 promised in `auth.md` but pushed to v2.
- Cert rotation flow not designed beyond the doc.

**✅ SECURITY TESTS NEEDED:**
- XXE: malicious SAML response with `<!DOCTYPE foo SYSTEM "file:///etc/passwd">` rejected without reading
- Replay: same SAML assertion submitted twice → first accepted, second rejected
- OIDC nonce: response nonce mismatch → rejected
- JIT: IdP returns `email_verified=false` → user not provisioned
- Group mapping: `Admin` and `admin` map to same role (or test fails — confirms case behavior)
- Live `samltest.id` against staging tenant

**📋 DEPENDENCY ORDER:** Hard dep on #578 (FK to `tenants`/`users`). Migration runs immediately after #578.

---

### #563 / #564 / #567 — P2 batch (`agent/p2-batch-563-564-567-0903`)

**Status:** Per AGENT_NOTES, all three are scaffold-quality with explicit stubs.

- **#563 (QR codes):** `render.ts` is a stub. Real `pdfkit + qrcode` pipeline not written. **DO NOT MERGE until pipeline implemented and S3 upload routed.** Otherwise the `/api/v1/qr/generate` endpoint returns base64 placeholder PDFs.
- **#564 (component templates):** Schema + 6 seeded templates fine. `cmms_components.attributes` JSONB column is missing — referenced by template instantiation. Add to migration before merge.
- **#567 (maintenance strategies):** Schema + endpoints fine. `spawnDefaults: true` is a no-op (waits for `pm_templates` table). Document this in API ref or strip the parameter.

**📋 DEPENDENCY ORDER:** All three after #562 + #566 + #578.

---

### #569 / #570 / #571 — P2 batch (`agent/p2-batch-569-570-571-0903`)

- **#569 (FFT):** Stubs zeros until `fft-js` installed. ISO 10816-3 default-rule seeder deferred. **Useless without fft-js install.**
- **#570 (external events):** Most handlers stubbed (only `maintenance.requested` writes). Secret storage uses raw utf-8 — depends on #576's encryption helper. **Depends on #576 to ship before being safe.**
- **#571 (sensor reports):** Recharts fallback is a styled div until `npm install recharts`. Functional but visually broken.

**📋 DEPENDENCY ORDER:** All three after #569 (alerts table dependency for #570/#571), and #570 after #576.

---

### #572 / #573 — P2 batch (`agent/p2-batch-572-573-0903`)

- **#572 (inventory):** Cron job for nightly recompute requires Vercel `vercel.json` config that is not in the branch. **Add `vercel.json` cron schedule before merge.** Multi-currency stubbed.
- **#573 (purchasing):** Email notification on PO submission is a stub. Cancel/close endpoints not implemented. Reorder→PO bridge stubbed. **Functional but several documented endpoints don't exist yet.**

**📋 DEPENDENCY ORDER:** Both after #565 + #578. #573 should land after #572 (FK order on `parts` → `po_lines`).

---

### #575 — mobile PWA (`agent/issue-575-mobile-pwa-0445`)

**🚫 FUNCTIONAL BLOCKERS:**
- `/api/v1/sync/upload-blob` route is referenced but doesn't exist. Photo capture posts to a 404. **Must wire blob storage adapter (S3 / Cloudflare R2 / etc.) before merge.**
- `/api/v1/sync/ping` referenced by service worker — stub returning 200 needed.
- App icons (192px, 512px PNGs) not committed — service worker registration will fail validation.

**⚠️ HIGH:**
- 30-day retention sweep on `client_mutations` not wired. Table will grow without bound.
- Server rejects non-UUID idempotency keys; client falls back to `${Date.now()}-${Math.random()}` which fails. **Either enforce UUID generation client-side, or relax the server check.**

**📋 DEPENDENCY ORDER:** After #565. Independent of #578 in spirit but depends on it for real auth.

---

### #577 — API reference docs (`agent/issue-577-api-reference-0445`)

**Status:** Docs only. Confirmed: 13 new pages drafted, OpenAPI 3.1 spec at 776 lines. Each page tagged `[Spec]` (pending implementation) or `[Live]` (already in flight).

**🟡 MEDIUM:**
- No AGENT_NOTES file — this is the only branch without one. Self-report exists in commit message only.
- Pages reference endpoints (`/api/v1/sync/upload-blob`, `/api/v1/qr/generate`) that don't exist on `main` and may not exist on the feature branch either (per #575, #563). **Until features land, mark these pages as "preview" in the rendered site or hide from production nav.**

**📋 DEPENDENCY ORDER:** Mergeable any time. Recommend last so all `[Spec]` → `[Live]` transitions happen on real merged code.

---

### #580 — SOC 2 Type 1 kickoff (`agent/issue-580-soc2-kickoff-0903`)

**Status:** Documentation + policy + scripts. Not engineering.

**🟡 MEDIUM:**
- AGENT_NOTES is at repo root (`AGENT_NOTES_580.md`), not `mira-hub/`. Inconsistent with other branches. Move on rebase.
- 12+ deliverables explicitly deferred (Acceptable Use Policy, risk register, vendor approvals dir, training LMS, etc.). This is a 6-month program, not a single PR.

**📋 DEPENDENCY ORDER:** After #578 (CC6 evidence collection blocked otherwise). Can rebase on top of `main` once #578 lands.

---

## Per-branch verification commands (run before opening each PR)

Save as `docs/competitors/verify-branch.sh`:

```bash
#!/usr/bin/env bash
set -e
B="$1"
[ -z "$B" ] && { echo "usage: $0 <branch>"; exit 1; }

git switch "$B"
cd mira-hub

# 1. Type-check
npx tsc --noEmit -p . || { echo "❌ typecheck"; exit 1; }

# 2. Lint
npx eslint src --max-warnings 0 || { echo "❌ lint"; exit 1; }

# 3. Build
npm run build || { echo "❌ build"; exit 1; }

# 4. Migrations: dry-run on a scratch DB (assumes a local Neon branch or pg)
psql "$DATABASE_URL_SCRATCH" -f db/migrations/$(ls db/migrations/ | sort | tail -1) -1 \
  || { echo "❌ migration"; exit 1; }

# 5. Smoke-test from AGENT_NOTES (prompt the human)
echo "✅ static checks pass — run manual smoke test in AGENT_NOTES_${B##*-}.md before merging"
```

---

## §6. Cross-cutting issues to file (six new GH issues)

These were flagged in `cowork-gap-report-2026-04-25.md` but are repeated here as a merge gate:

1. **Auth-sweep PR** — replace ~80 `x-tenant-id` header stubs with `withTenant()` after #578 ships
2. **NPM dep install + lockfile commit** — single PR consolidating package.json bumps for libsodium, dexie, rrule, fft-js, recharts, pdfkit, qrcode, @anthropic-ai/sdk, jose, bcrypt, @node-saml/node-saml, openid-client, xml2js
3. **Doppler env-var provisioning** — 13 new vars (LLM_KEK, WEBHOOK_KEK, TENANT_JWT_SECRET, etc.)
4. **Webhook event-wiring sweep** — invoke #576 dispatcher from each event source
5. **Test suite per branch** — minimum: smoke + RLS-deny + state-transition coverage
6. **Migration deploy-order doc** — strict order required (sequence in this report)

---

## §7. Recommended merge sequence (binding)

Apply each branch's blockers + tests + the cross-cutting cleanups in this order:

```
[ALWAYS RUN] Cross-cutting #2 first: NPM deps + package.json bump (one PR for all branches)

1.  research/competitor-intel               # docs only — push first as paper trail
2.  agent/issue-562-asset-hierarchy-0405    # base hierarchy
3.  agent/issue-568-failure-codes-iso14224  # FIX seed idempotency first
4.  agent/issue-565-wo-lifecycle-0405       # FIX timestamp invariant on force-skip
5.  agent/issue-566-pm-procedures-0405      # rrule install required
6.  agent/issue-574-byo-llm-asset-chat      # FIX KEK rotation + SSE cancel
7.  agent/issue-576-outbound-webhooks       # verify cron timing-safe; replay scope
8.  agent/issue-578-multi-tenancy           # FIX audit-log immutability + remove SSO files
9.  agent/issue-579-sso-saml-oidc           # ADD SSO files moved from #578; XXE test
10. [SWEEP] auth migration PR — replace all header stubs
11. [SWEEP] webhook event wiring PR
12. agent/p2-batch-563-564-567               # FIX QR pipeline; add components.attributes
13. agent/p2-batch-569-570-571               # fft-js install; recharts install
14. agent/p2-batch-572-573                   # add vercel.json cron config
15. agent/issue-575-mobile-pwa               # add upload-blob route + icons
16. agent/issue-577-api-reference-0445       # docs last — toggles pages from Spec → Live
17. agent/issue-580-soc2-kickoff             # ongoing program; merge whenever #578 lands
```

---

## §8. Top-line risk score

**Production-readiness:** 🔴 **Not ready.** Reasons (in priority order):

1. **No tests** — universal across all 14 branches. Zero CI coverage = guaranteed regression on any future change.
2. **Auth stubs everywhere** — RLS will fail-closed if you flip strict mode on; routes will break.
3. **Missing npm deps** — branches don't build cleanly today.
4. **#574 KEK rotation gap** — design flaw that's expensive to fix post-launch.
5. **#578 audit-log mutability** — SOC 2 blocker.
6. **#579 XXE / SSO file leak** — needs rebase + XXE test.

**Staging-readiness with shadow RLS:** 🟡 **Possible after this 5-day prep:**

1. **Day 1:** Rebase #578 ↔ #579 to move SSO files (3h), fix audit-log policies (1h)
2. **Day 1–2:** NPM dep PR + Doppler env-var provisioning
3. **Day 3:** Auth-sweep + webhook-wiring PRs
4. **Day 4:** Add 1 smoke + 1 RLS-deny test per branch (12 branches × 30 min = 6h)
5. **Day 5:** Stage, run #578 in shadow mode, validate, then strict mode

After Day 5 staging validation: ~1-week soak in staging, then sequenced production merge.

**Customer-facing readiness:** ~3 weeks total (5 days prep + 1 week staging + 1 week production rollout with feature flags).
