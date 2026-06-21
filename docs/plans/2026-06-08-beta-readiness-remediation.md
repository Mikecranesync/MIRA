# MIRA Beta-Readiness Remediation Plan

**Created:** 2026-06-08 · **Source:** Orchestrator Beta-Readiness Scorecard (Lens F audit, run 2026-06-08)
**Owner:** Mike · **Status:** Ready to execute (plan approved, execution pending)
**Scope chosen:** Full path-to-beta — all stranger-reachable blockers + the CI gates that let them ship safely.

---

## Verdict & what "done" means

The scorecard is **RED** because of exactly one lens: **F — Beta-blocker ledger.** Five of six lenses are
YELLOW; F is RED because **3 unmitigated blockers sit on the stranger's signup→chat path — a break, a leak,
and a lie.** The other lenses are not gating by themselves, but the same 5 stranger-reachable items reach
across A (Hub auth), D (eval/test), and E (promotion pipeline), so closing them flips F to GREEN and pulls
A/D/E toward GREEN at the same time.

Every claim below was **verified against the live repo on 2026-06-08** — file paths, line behavior, the
staged patch, the migration prefixes, and the smoke gate are all real (see "Evidence" under each item).

**Beta is "done" when this North Star test passes end to end:**
> A stranger signs up on `app.factorylm.com`, uses grounded chat, and **nothing breaks, leaks, or lies.**

Operationalized as acceptance criteria (these become the smoke gate in P1-1):

1. **No break** — flooding the public chat door returns HTTP 429, not a drained provider cascade.
2. **No leak** — an authed user in tenant A cannot resolve tenant B's asset manufacturer/model by id.
3. **No lie** — a wrong-vendor citation (Siemens cited on a Danfoss question) is caught, not passed green.
4. **The money path is gated** — a broken signup→chat cannot deploy green.
5. **Schema is reproducible** — migrations re-apply cleanly via a ledger, no lexical-sort/dup-prefix landmines.

---

## Scope decisions

**In scope (this plan):** blockers #1, #2, #3, #4, #5, #6, #7, #8 from the scorecard, plus founder decision #9.

**Out of scope — correctly post-beta (do NOT build for beta):**

- **#10 Direct-connection reject contract** (`mira-pipeline/ignition_chat.py`). BETA-REACH = **NO**, HMAC-gated,
  tracked as P6 #1658. Verified: the engine marks `uns_source="direct_connection"` when an asset id is present
  and treats a turn *without* one as a plain chat turn (a downgrade, not a reject). The fix must be an
  *intent-aware* reject-on-missing-id — a naive reject-all would break "what is MQTT?". Not reachable by a
  beta stranger on the public chat path. **Ship after beta.**
- **The 6 unbuilt master-plan phase anchors** (`tag_events`, `decision_traces`, `flaky_input_signals`,
  `read_tag_value`, `get_asset_context`, `poller`). The scorecard's KG insight is decisive: querying the ledger
  against these anchors returns **NONE** — not one of them anchors a top-10 blocker. Beta-readiness is bounded
  by **hardening 3 already-shipped surfaces** (hub API auth · eval harness · migration/CI), not by building
  PLC/tag/agent-tool phases. **Those are correctly post-beta.**

---

## Sequence at a glance

| Phase | Item | Blocker | Lens | Beta-reach | Depends on | Effort | Risk |
|---|---|---|---|---|---|---|---|
| **P0 — today** | P0-1 Rate-limit public LLM door | #1 break | A | YES | — (patch staged) | ~30 min | very low |
| **P0/P1** | P0-2 Close cross-tenant documents leak | #8 leak | A | YES | — | 1–2 hr | low-med |
| **P1** | P1-1 Gate the money path (signup→chat) | #3 | E | YES | land early | ~½ day | low |
| **P2** | P2-1 Deterministic offline eval | #4 | D | gate | — | ½–1 day | low |
| **P2** | P0-3 Citation relevance (stop the lie) | #2 lie | D | YES | **P2-1** | ~½ day | med |
| **P3** | P3-1 Unblock migration idempotency (PR #1657) | #6 | E | blocks #5 | — | confirm | low |
| **P3** | P3-2 Migration ledger + dedupe prefixes | #5 | E | YES | **P3-1** | 1–2 days | med |
| **P3** | P3-3 migration-verify ↔ staging-gate ordering | #7 | E | gate | P3-2 | ~2 hr | low |
| **Decision** | D-1 Proposals contract (crown `ai_suggestions`?) | #9 | B | partial | founder call | ½ day | med |
| **Gate** | Re-run orchestrator Lens-F audit → expect GREEN | F | F | — | all above | ~30 min | — |

**Why this order:** P0-1 is the lone ready-to-ship mechanical fix and the single highest-leverage move, so it
goes first. The leak (P0-2) is a security IDOR — close it immediately after. P1-1 (the money-path smoke gate)
lands early because it is the safety net that makes every downstream fix regression-proof. The lie (P0-3)
depends on a **deterministic** eval (P2-1) or its `vfd_danfoss_04` re-run is just noise. The migration chain
(P3) is the deepest and most independent of the stranger-facing surface, so it runs last; within it, PR #1657
must land before the ledger work, and the gate-ordering fix comes after.

**Realistic timeline:** the break + leak + money-path gate (P0/P1) are closeable in **~1 day**. Full plan
through the migration chain and the founder decision is **~5–7 working days** for one engineer.

---

## P0-1 · Rate-limit the public LLM door (#1 — the "break")

**Problem (verified).** `mira-hub/src/app/api/quickstart/ask/route.ts` fires `cascadeComplete`
(Groq → Cerebras → Gemini, all shared free-tier) on **every unauthenticated POST**, with no throttle. One
script drains the whole beta cohort's provider quota and/or runs up cost — a cohort-wide cascade-drain. This
is the "break" on the public chat door.

**Fix.** Apply the **already-staged** patch — it's clean and complete:
`wiki/orchestrator/patches/2026-06-07-quickstart-rate-limit.patch`. It adds a per-IP-hash in-memory limiter
(20 requests / 60 s), returns 429 before doing any work, and SHA-256-hashes the IP (no raw IP stored — honors
the PII rule in `.claude/rules/security-boundaries.md`).

```bash
cd <repo-root-MIRA>
git checkout -b fix/quickstart-rate-limit
git apply --reject wiki/orchestrator/patches/2026-06-07-quickstart-rate-limit.patch
# if context drifted, follow the MANUAL STEPS embedded in the patch
```

**Same-PR follow-up (don't leave sibling doors open).** The patch's own NOTE flags that `/api/mira/ask` and
the `/api/public/report` LLM siblings carry the same exposure. Audit and throttle those in this PR (or a
fast-follow), then re-run Lens A.

**Files.** `mira-hub/src/app/api/quickstart/ask/route.ts` (+ audit `mira/ask`, `public/report`).

**Verify.** `cd mira-hub && npx tsc --noEmit`; then the 21st POST within 60 s from one IP must return 429:
```bash
for i in $(seq 1 21); do curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST localhost:3200/api/quickstart/ask -H 'content-type: application/json' \
  -d '{"question":"test"}'; done | tail -3
```
Manual two-IP hammer per the founder play. Then encode it as a smoke assertion in P1-1.

**Env path.** dev → staging gate → prod. The in-memory limiter is per-instance; the hub runs as a **single
container** today (Container Map), so this is sufficient for beta. CAVEAT (tracked follow-up): when the hub
scales horizontally, port to a DB-backed counter (`quickstart_rate` table) or shared store.

**Commit.** `security(hub): rate-limit public /api/quickstart/ask LLM endpoint`

---

## P0-2 · Close the cross-tenant documents leak (#8 — the "leak")

**Problem (verified).** `mira-hub/src/app/api/documents/route.ts` calls `sessionOrDemo(req)` to get a tenant
context `ctx` — **and then never uses it.** The asset lookup is `SELECT … FROM cmms_equipment WHERE id = $1`
(any tenant's asset) and the `knowledge_entries` aggregate filters only by manufacturer/model. The docstring
claims the endpoint "stays scoped to the caller's tenant," but the code does not. An authed user passes any
`asset_id` and resolves **any tenant's** manufacturer/model — a cross-tenant IDOR.

**Fix.** Thread the tenant from `ctx` into both queries:
1. Add `AND tenant_id = $N` (confirm the exact column) to the `cmms_equipment WHERE id = $1` lookup.
2. Scope the `knowledge_entries` aggregate to the tenant — either a `tenant_id` predicate or via the
   tenant-checked `cmms_equipment` join. Copy the exact tenant predicate from the sibling
   `mira-hub/src/app/api/library/documents/route.ts`, which the docstring says this endpoint mirrors.
3. Net invariant: **no `asset_id` outside the caller's tenant may resolve.** (If `knowledge_entries` is
   intentionally a cross-tenant universal corpus, scope the *asset→mfr/model* resolution to the tenant and
   leave the corpus lookup as-is — but the asset lookup must be tenant-bound either way.)

**Files.** `mira-hub/src/app/api/documents/route.ts`; confirm `lib/demo-auth.sessionOrDemo` exposes the tenant
id; reference `mira-hub/src/app/api/library/documents/route.ts` for the canonical predicate.

**Verify.** Add a probe to the money-path smoke suite (P1-1): authed as tenant A, request
`?asset_id=<a tenant-B asset>` → expect empty / 403, **not** B's mfr/model. `npx tsc --noEmit`.

**Env path.** dev → staging → prod. This is a **security commit** — run the `security-review` skill on the diff
before merge (tenant/RLS gaps are exactly the class a prior reviewer caught). Do not regress the legitimate
demo-tenant path.

**Commit.** `security(hub): tenant-filter /api/documents to stop cross-tenant asset resolution`

---

## P0-3 · Make MIRA stop lying — citation relevance (#2 — the "lie")

**Problem (verified).** `mira-bots/shared/citation_compliance.py` checks only that a `[Source: …]` tag is
**present** (`CITATION_TAG_RE.findall`) — never that the cited vendor/model is **relevant** to the resolved
`uns_context`. A Siemens breaker cited on a Danfoss VLT question passes CitGrond. The check is also
**observation-only** (it logs `CITATION_COMPLIANCE_MISS/OK`, never blocks). That is the "nothing lies"
violation: a confidently-cited but wrong source reads green.

**Fix — promote CitGrond from presence → relevance.**
1. Extend `check_citation_compliance(...)` to accept `uns_context` (manufacturer/model).
2. Parse the cited vendor/model out of the `[Source: …]` tags.
3. Assert **cited vendor/model ⊆ uns_context** (manufacturer/model, or the resolved KB doc set).
4. On mismatch: set `relevant=False`, emit `CITATION_RELEVANCE_MISS`, and (for the beta gate) **strip or
   replace the irrelevant citation / fall back to a KB-gap admission** rather than presenting a false source.
   Keep it conservative so a *correct* citation is never suppressed.
5. Wire `uns_context` through the single engine call site.

**MIRA-rule compliance.** Read vendor/model from `state["uns_context"]["manufacturer"]` / model — do **not**
call resolver privates (`uns-compliance.md` rule #2). Before editing `engine.py`, run a blast-radius check on
the citation call site (`codegraph_impact`) per `.claude/rules/codegraph-usage.md`.

**Files.** `mira-bots/shared/citation_compliance.py` (signature + relevance logic);
`mira-bots/shared/engine.py` (pass `uns_context` at the call site).

**Verify.** Golden case **`vfd_danfoss_04`** — the wrong-vendor (Siemens) citation must now **FAIL** relevance
(it currently reads green). Add/confirm a golden row asserting the miss; run the relevant `tests/eval/` regime
+ `tests/golden_*.csv`. **This verification is only trustworthy once the eval is deterministic → depends on
P2-1.**

**Env path.** Engine/RAG change → **must pass the staging gate** (`smoke-test.yml` + eval regime) before `main`
(env doctrine: engine/RAG/classifier changes are gated).

**Commit.** `fix(engine): enforce citation relevance (cited vendor/model ⊆ uns_context) in CitGrond`

---

## P1-1 · Protect the money path at deploy (#3)

**Problem (verified).** `smoke-test.yml` runs `npx playwright test --config playwright.smoke.config.ts`, and
its current job summary only checks that `app.factorylm.com/` redirects to `/login` and that `/login` renders.
It does **not** exercise signup→grounded-chat — the actual money path. A broken signup→chat can deploy green.

**Fix.** Wire the existing signup-flow + command-center Playwright specs into `playwright.smoke.config.ts` /
`smoke-test.yml` as deploy-gate jobs, and make the gate assert the North Star + the P0 fixes:
- signup → grounded chat returns a **grounded** answer (cites a real source);
- quickstart returns **429** under flood (P0-1);
- documents cross-tenant probe returns **nothing** (P0-2);
- a wrong-vendor citation is **caught** (P0-3).

Honor the **Screenshot Rule**: capture desktop (1440×900) + mobile (412×915) of signup→chat into
`docs/promo-screenshots/`.

**Files.** `.github/workflows/smoke-test.yml`, `mira-hub/playwright.smoke.config.ts` (+ locate/confirm the
existing signup + command-center specs; the scorecard says the signup config already exists — wire it, don't
rebuild it).

**Verify.** A deliberately-broken signup branch must turn the gate **red**. Confirm the new jobs run in CI.

**Env path.** This **is** the gate — land it early (alongside/just after P0) so P0-3 and P3 are regression-caught.

**Commit.** `ci(smoke): gate deploys on signup→chat money path, not just /login`

---

## P2-1 · Deterministic offline eval (#4)

**Problem (verified).** `tests/eval/offline_run.py` runs the pipeline in-process but its header confirms "LLM
calls go to real providers … via API keys" — so results swing (47/50/47/47 across runs). A 1–2-case
regression is invisible against a moving baseline, and it makes P0-3's `vfd_danfoss_04` re-run untrustworthy.

**Fix.** Insert a **record/replay/seed seam** at the live-provider edge in `offline_run.py` — record fixtures
once, replay deterministically in CI (seeded, cached responses; no live key needed in the sandbox, matching the
orchestrator's own constraint). Re-baseline the 4 stable fails so the truth set is fixed and any new failure
shows up as a clear delta.

**Files.** `tests/eval/offline_run.py`; fixture store under `tests/eval/`.

**Verify.** Same input → identical pass/fail across 3 runs; the 4 known fails are the locked baseline; inject a
synthetic regression → the harness catches it.

**Env path.** Test harness only — no deploy implications, but it gates P0-3's merge.

**Commit.** `test(eval): add record/replay seam for deterministic offline eval`

---

## P3 · Migration integrity chain (#6 → #5 → #7)

These are sequenced: PR #1657 must land before the ledger work; the gate-ordering fix comes last.

### P3-1 · Unblock migration idempotency — PR #1657 (#6)
**Problem (per scorecard `hot.md`).** PR #1657's apply-and-verify is on a red streak, so the migration
idempotency fixes can't land — and they block #5. **Confirm commit `455e443` is green on the staging Neon
branch, then route PR #1657 to human merge** (env doctrine: human merges via the careful pre-merge reviewer).
*Confirm on staging — could not verify live PR/Neon state from this session.*

### P3-2 · Migration ledger + dedupe prefixes (#5)
**Problem (verified).** `mira-hub/db/migrations/` has **no `schema_migrations` ledger**, **8 duplicate
prefixes** (006, 008, 021, 025, 026, 027, 032, 033), and a **038–042 gap** (037 → 043). With lexical-sort
application and dup prefixes, re-apply correctness rests entirely on fragile `IF NOT EXISTS` guards.

**Fix.** (a) Add a `schema_migrations` ledger table that records applied filenames and skips already-applied
files. (b) Dedupe: renumber the 8 colliding files into the 038–042 gap **preserving applied order** (or prove
a numeric `sort -n` in `apply-migrations.yml` and keep names). (c) Update `apply-migrations.yml` to record/skip
via the ledger.

**Files.** `mira-hub/db/migrations/` (renumbering), `.github/workflows/apply-migrations.yml`, new ledger
migration.

**Verify.** `apply-migrations.yml` **dry-run then apply on staging Neon**; a second apply is a clean no-op via
the ledger. **Never run `psql`/raw SQL against prod** (env rule + `prod-guard.sh`). Promote dev → staging → prod.

**Commit.** `fix(db): add schema_migrations ledger + dedupe migration prefixes`

### P3-3 · migration-verify ↔ staging-gate ordering (#7)
**Problem (per scorecard).** `migration-verify.yml` and `staging-gate.yml` share the same Neon branch with no
`needs:` edge, so the gate can grade a **pre-migration** schema (a race). **Fix:** add a
`workflow_run`/`needs:` ordering edge (or merge the jobs) in `staging-gate.yml` so the gate always grades the
post-migration schema.

**Files.** `.github/workflows/staging-gate.yml` (+ `migration-verify.yml`).
**Verify.** A staging run shows migrate → verify ordering deterministically.
**Commit.** `ci(staging): order migration-verify before staging-gate`

---

## D-1 · Founder decision — proposals contract (#9)

**Problem (verified).** `/api/proposals` reads `relationship_proposals` while the spec (and glossary discipline
in `.claude/CLAUDE.md`) crowns `ai_suggestions`; the recalc can't fire, and the ADR-0017 transition helper
(`mira-hub/lib/proposal-transition.ts` / `mira_bots/shared/proposal_transition.py`) is **absent** (confirmed).
ADR-0017 (`docs/adr/0017-proposal-state-machine-mapping.md`) exists and already treats direct
`UPDATE … SET status` on these tables as a bug *once the helper exists*. Partial beta-reach (Lens B).

**Decision needed from you:** crown `ai_suggestions` (then build `proposal-transition.ts` +
`proposal_transition.py` per ADR-0017 and point `/api/proposals` at it) **or** amend the spec to bless
`relationship_proposals`. **Recommendation:** crown `ai_suggestions` and build the helper — it aligns the code
with the spec, ADR-0017, and the glossary, and unblocks the recalc. ~½ day once decided.

---

## Final gate — prove RED → GREEN

After P0–P3 land through staging:

1. **Re-run the orchestrator Lens-F audit.** Expect **0 stranger-reachable blockers** on signup→chat → Lens F
   flips **RED → GREEN**; Lens A/D/E move toward GREEN.
2. **Run the money-path smoke gate** (P1-1) against `app.factorylm.com` + the staging hub: signup → grounded
   chat, 429 under flood, no cross-tenant resolve, wrong-vendor citation caught.
3. **Re-apply migrations on a fresh staging Neon branch** — clean, ledger-driven, no-op on second run.

When all three pass, the North Star test holds — **a stranger can sign up, chat, and nothing breaks, leaks, or
lies. Open the beta.**

---

## Evidence appendix (verified 2026-06-08)

| Claim | Verified how | Result |
|---|---|---|
| #1 no rate limit; patch staged | read `quickstart/ask/route.ts` + the patch file | confirmed; patch is clean (4.2 KB) |
| #2 presence-only citation check | read `citation_compliance.py` | confirmed; checks tag presence, never relevance; never blocks |
| #8 cross-tenant leak | read `documents/route.ts` | confirmed; `ctx` fetched then unused; `WHERE id=$1` unbounded |
| #3 smoke gates /login only | grep `smoke-test.yml` | confirmed; summary checks `/` redirect + `/login` render |
| #4 eval hits live providers | read `offline_run.py` header | confirmed; "LLM calls go to real providers via API keys" |
| #5 dup prefixes + gap | listed `mira-hub/db/migrations/` | confirmed; 8 dup prefixes, 037→043 gap |
| #9 ADR-0017 + missing helper | listed `docs/adr/` + searched for helper | confirmed; ADR exists, helper absent |
| #10 downgrade-not-reject | read `ignition_chat.py` | confirmed; post-beta, HMAC-gated |

*Not verified from this session (confirm on staging): PR #1657 / `455e443` green status (#6), live staging-gate
race (#7).*
