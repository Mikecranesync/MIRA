# A9c handoff — `/api/workflows` cross-tenant disclosure (VERIFY ON origin/main FIRST)

**Run:** 2026-06-16 A9c (degraded — bash sandbox down, file-tools only).
**Status:** UNVERIFIED on deploy truth. Independently corroborated on the **local tree
@`26531db9` (~170 commits behind `origin/main @ba79b4de`)**. This is the third sighting
of the lead A9b quarantined; recording the exact mechanism + fix so the next *healthy*
run (or the founder) can confirm-and-fix in one pass.

> ⚠️ No literal `.patch` is shipped: the only code reachable this run is 170 commits behind
> deploy truth, so a context-diff would likely fail to apply. The change is described
> precisely instead. **Do not apply blind — first re-read `mira-hub/src/app/api/workflows/route.ts`
> on `origin/main`.**

## The finding (local tree, `mira-hub/src/app/api/workflows/route.ts`)

- Auth gate is `sessionOrDemo(req)` → **any authenticated tenant user** (or the demo bearer)
  passes. It is NOT `requireCapability(...)` — there is no platform-admin/ops gate.
- `tenant_id` is an **optional** query param (`route.ts:34,47-50`). Omit it and the
  `SELECT … FROM workflow_runs … ORDER BY started_at DESC LIMIT n` returns rows for **every
  tenant**, exposing `tenant_id`, `workflow_name`, `status`, `error_detail`, `step_artifacts`,
  `output`, timings, `retry_count`.
- The 24h rollup (`route.ts:67-75`) has **no tenant filter at all** — always cross-tenant.
- The route comment asserts "operational metadata, no customer plant data (migration 044 no-RLS)."
  That is the design intent, but `output` / `step_artifacts` / `error_detail` for
  `document_ingest` / `cmms_sync` runs can carry tenant-identifying strings (filenames,
  manufacturer/asset names, error text). In a stranger-beta, tenant A can enumerate tenant B's
  ingest/sync activity, counts, and timing.

## Why it may already be resolved (don't over-claim)

Today's deploy-truth run **A9 audited Lens A on `origin/main @ba79b4de` → GREEN**, but its scope
was the *newly-mutated* route diff `80f5da18..ba79b4de`; `/api/workflows` was not necessarily in
that window. So A9's GREEN does **not** specifically clear this file. Prior rounds (A8/B8/F8)
repeatedly verified raw-pool routes are tenant-scoped, which is mild evidence it may have been
hardened in the 170-commit gap. **Verify, don't assume.**

## Verify (next healthy run / founder, ≤10 min)

```bash
cd "$M" && git fetch origin main
git show origin/main:mira-hub/src/app/api/workflows/route.ts | sed -n '24,75p'
# Look for: is tenant_id still optional? is the gate still sessionOrDemo (not requireCapability)?
# is the 24h summary still unscoped?
```

If the optional-`tenant_id` cross-tenant read is **gone** (forced `ctx.tenantId`, or
capability-gated) → close this lead. If still present → apply the fix below.

## Fix (beta-safe default: scope to caller; keep ops view behind a capability)

1. Default every caller to their own tenant — make `tenant_id = ctx.tenantId` **mandatory**,
   not an optional param:
   ```ts
   const ctx = await sessionOrDemo(req);
   if (ctx instanceof NextResponse) return ctx;
   // Force caller-tenant scope. Cross-tenant ops view is a separate, gated branch.
   params.push(ctx.tenantId);
   where.push(`(tenant_id = $${params.length} OR tenant_id IS NULL)`); // NULL = infra runs, no customer data
   ```
   (Drop the client-supplied `tenant_id` param entirely, or honor it only when it equals
   `ctx.tenantId`.)
2. Scope the 24h summary the same way (add the same `WHERE tenant_id = $1 OR tenant_id IS NULL`).
3. If a true cross-tenant ops dashboard is still wanted, gate it explicitly:
   `const denied = requireCapability(session, "platform.workflows.read"); if (denied) return denied;`
   and only then allow the unscoped query.
4. Add a regression test mirroring `tests/e2e/api-unauth-returns-401.spec.ts`: a normal-session
   GET with no `tenant_id` must NOT return another tenant's `run_id`s.

## Verify the fix

```bash
cd mira-hub && npm test -- workflows         # add a route unit test asserting tenant scope
npx playwright test tests/e2e/api-unauth-returns-401.spec.ts   # auth-shape regression still green
```

**Owner:** founder / next healthy orchestrator run. **Do not** edit code from a degraded run.
