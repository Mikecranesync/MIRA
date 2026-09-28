# Gate 7 adversarial review — PR #3964

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, authorization, tenant scoping, cross-repository contract, production deployment, concurrency/idempotency/state, broad multi-module (7 top-level dirs)

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `c4afa6de9a21c1fe7e7355ebfb38c2755e2deb96`
- scope (--paths): mira-hub/src/capabilities/observability/turn-ingress.ts, mira-hub/src/capabilities/observability/turn-lifecycle.ts
- excluded by scope (43): .github/workflows/retrieval-acceptance.yml, HANDOFF.md, PLAN.md, docker-compose.staging-vps.yml, docs/env-vars.md, docs/proofs/2026-09-23-3939-evidence-packet.md, docs/proofs/2026-09-23-3962-root-cause.md, docs/proofs/2026-09-23-3963-exemption-attack.md, docs/proofs/2026-09-23-3963-fire-rate-remeasured.md, docs/proofs/2026-09-23-capture-acceptance-staging.md, docs/proofs/2026-09-23-capture-matrix-final.md, docs/proofs/2026-09-23-capture-privacy.md, docs/proofs/2026-09-23-client-received-gap.md, docs/proofs/2026-09-23-gate7-round1-capture.md, docs/proofs/2026-09-23-jev-evaluation-for-capture.md, docs/runbooks/capture-acceptance.md, mira-hub/db/migrations/091_decision_traces_turn_lifecycle.sql, mira-hub/db/migrations/092_decision_traces_lifecycle_append_only.sql, mira-hub/db/migrations/093_turn_ingress.sql, mira-hub/db/migrations/094_decision_traces_lifecycle_invariant.sql, mira-hub/docs/SITEMAP.md, mira-hub/docs/sitemap.snapshot.json, mira-hub/scripts/provision-beta-gate.ts, mira-hub/src/app/api/equipment-notebooks/[id]/chat/__tests__/turn-lifecycle.test.ts, mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts, mira-hub/src/app/api/equipment-notebooks/[id]/look/route.ts, mira-hub/src/app/api/observability/coverage/route.ts, mira-hub/src/capabilities/observability/__tests__/anomalies.test.ts, mira-hub/src/capabilities/observability/__tests__/evidence-consistency.test.ts, mira-hub/src/capabilities/observability/__tests__/outcome-reachability.test.ts, mira-hub/src/capabilities/observability/__tests__/packet.test.ts, mira-hub/src/capabilities/observability/__tests__/turn-ingress.integration.test.ts, mira-hub/src/capabilities/observability/__tests__/turn-reconciler.test.ts, mira-hub/src/capabilities/observability/anomalies.ts, mira-hub/src/capabilities/observability/config.ts, mira-hub/src/capabilities/observability/evidence-consistency.ts, mira-hub/src/capabilities/observability/turn-evidence-packet.ts, mira-hub/src/instrumentation.ts, mira-hub/src/lib/inference/__tests__/persist-usage.test.ts, mira-hub/src/lib/inference/persist-usage.ts, tools/qa/attack_3963.py, tools/qa/capture_acceptance.py, tools/qa/make_notebook.py
- diff chars sent/total: 18,000/37,535 (cap 18,000)
- reviewed-diff sha256 (sent bytes): `1c2ff836629ede4e085a8ef0f14afd043454c0e1608c4531553161314823dbc9`
- full scoped-diff sha256 (pre-cap): `39021a5729e39699b67748087f10429cb92938b786c6ee001bf207dc4d0ae0e2`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Silent‑failure design hides critical ingestion outages** — 
- **[high] Potential cross‑tenant data leakage via the response row** — 
- **[medium] No validation of `attemptId` UUID format** — 
- **[low] Process‑local failure counters are not persisted or exported** — 

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Silent‑failure design hides critical ingestion outages**  
  The `recordArrival` and `recordResponse` helpers swallow any database error, increment a process‑local counter, log the error, and **return `false` without propagating the failure**. If the `turn_ingress` table becomes unavailable (e.g., migration error, connection loss, or malformed `attemptId`), the system will continue processing chat turns while **no arrival or response rows are persisted**.  
  This defeats the primary purpose of the new module – detecting “lost starts” – because the reconciliation query will see no rows and report perfect coverage, giving a false‑positive health signal. The failure counters are kept only in‑process (`failures.arrivalFailed`, `failures.responseFailed`) and are never persisted or surfaced to monitoring, so operators may never notice the outage.  

  Evidence:  
  ```diff
  +/** Never throws. A failed arrival write is counted, not raised. */
  +export async function recordArrival(init: ArrivalInit): Promise<boolean> {
  +  try {
  +    await append("arrived", init, null);
  +    return true;
  +  } catch (err) {
  +    failures.arrivalFailed += 1;
  +    console.error(
  +      "[turn-ingress] arrival write failed (turn continues, reconciliation degraded):",
  +      err instanceof Error ? err.message : err,
  +    );
  +    return false;
  +  }
  +}
  +/** Never throws. */
  +export async function recordResponse(init: ResponseInit): Promise<boolean> {
  +  try {
  +    await append("responded", init, init.httpStatus);
  +    return true;
  +  } catch (err) {
  +    failures.responseFailed += 1;
  +    console.error(
  +      "[turn-ingress] response write failed:",
  +      err instanceof Error ? err.message : err,
  +    );
  +    return false;
  +  }
  +}
  ```
  and the design comment:  
  ```diff
  + * FAIL-OPEN. A counter that can break a chat turn is worse than a counter that
  + * misses one. Every failure increments a visible counter instead of throwing.
  ```

- **[severity: high] Potential cross‑tenant data leakage via the response row**  
  The response row is written *after* authentication and includes the `tenant_id` supplied by the caller (`ResponseInit`). The reconciliation query then derives the effective tenant for an attempt using `COALESCE(a.tenant_id, r.tenant_id)`. If a buggy or malicious internal caller supplies an arbitrary `tenantId` in `recordResponse`, the attempt will be attributed to that tenant, even though the arrival row (the only unbiased record) had no tenant. This can cause **turn‑level metrics to appear under the wrong tenant**, leaking operational data across tenant boundaries.  

  Evidence (tenant resolution logic):  
  ```diff
  +  const res = await pool.query(
  +    `WITH arrivals AS (
  +       SELECT a.attempt_id,
  +              r.http_status,
  +              COALESCE(a.tenant_id, r.tenant_id) AS tenant_id,
  ...
  +     FROM turn_ingress a
  +     LEFT JOIN turn_ingress r
  +       ON r.attempt_id = a.attempt_id AND r.phase = 'responded'
  +    WHERE a.phase = 'arrived'
  +      AND a.at > now() - ($1 || ' seconds')::interval
  +   )
  +   SELECT ...
  +   FROM arrivals
  +  WHERE $3::text IS NULL OR tenant_id = $3::text`,
  +    [windowMs / 1000, stale / 1000, opts.tenantId ?? null],
  +  );
  ```
  and the comment explaining the timing of the response write:  
  ```diff
  + // The arrival row is written BEFORE auth, so it has no tenant. The response
  + // row does (the handler sets it the moment `sessionOr401` succeeds), so the
  + // attempt's tenant is whichever of the two knows it. An attempt that never
  + // authenticated has neither, and is visible only in the unscoped operator
  + // view — which is correct: it belongs to no tenant.
  ```

- **[severity: medium] No validation of `attemptId` UUID format**  
  The insert statement unconditionally casts `init.attemptId` to `uuid` (`$1::uuid`). If a caller supplies a non‑UUID string (e.g., malformed client input or a programming error), the query will throw a type error, which is then silently counted as a failure (see the silent‑failure finding). While the failure is counted, the root cause (invalid ID format) is not validated or rejected early, potentially leading to a flood of logged failures and loss of metric data.  

  Evidence:  
  ```diff
  +    `INSERT INTO turn_ingress
  +       (attempt_id, phase, route, tenant_id, notebook_id, client_request_id,
  +        http_status, environment, git_sha)
  +     VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, $9)
  ```

- **[severity: low] Process‑local failure counters are not persisted or exported**  
  The `failures` object lives only for the lifetime of the Node process and is never written to durable storage or exposed to external monitoring (outside the optional `ingressFailureCounters()` helper). If the process restarts, all failure history is lost, making it impossible to detect transient outages that occurred before the restart.  

  Evidence:  
  ```diff
  +const failures = { arrivalFailed: 0, responseFailed: 0, processStart: Date.now() };
  ```

## NOT REVIEWED
- **`turn-lifecycle.ts` implementation** – only the opening comment and a few introductory lines are visible; the actual logic for durable start records, outcome handling, and any interactions with `turn_ingress` are omitted from the diff. We cannot verify correctness of lifecycle recording, RLS enforcement, or any side‑effects introduced there.  
- **Database migration `093_turn_ingress.sql`** – the schema (column names, types, constraints, indexes, and the `ON CONFLICT` unique key) is not shown. Without it we cannot confirm that the table enforces the expected uniqueness, that the `at` column exists and is timestamped, or that appropriate indexes are present.  
- **Integration of `recordArrival` / `recordResponse` into request handlers** – we cannot see whether the functions are called in the correct order, whether `ResponseInit.tenantId` is derived safely from the authenticated session, or whether errors from these functions are logged/monitored elsewhere.  
- **Export / consumption of `ingressFailureCounters()`** – we do not see any code that surfaces these counters to observability pipelines (Prometheus, logs aggregation, alerts). If they are never emitted, the silent‑failure problem is exacerbated.  
- **Tests for edge cases** – the PR claims “Full hub suite 3281/3281” passes, but we cannot verify that tests cover DB‑unavailability, malformed UUIDs, or cross‑tenant misuse of `recordResponse`.  
- **Retention / cleanup policy for `turn_ingress`** – the diff does not show any background job or TTL that purges old rows, which could cause unbounded table growth.  

These items require additional review beyond the visible diff.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`

---

# Adjudication (Claude, 2026-09-23)

Reviewed at the exact current head `c4afa6de9a21c1fe7e7355ebfb38c2755e2deb96`.
The round-1 verdict was stale — 27 commits had landed since it reviewed
`c07e22318`.

## F2 [high] cross-tenant attribution via the response row — **HARDENED**

Not externally exploitable as described: nothing but `ctx.tenantId` ever reaches
`ingress.tenantId` (`chat/route.ts:793`, `look/route.ts:152`), so "a malicious
caller supplying an arbitrary tenantId" requires editing the route.

But the instinct is right — a scoping predicate should not rest on the
least-authoritative row. `turn_ingress` self-reports its tenant from the request
path; `decision_traces` is written inside `withTenantContext`. So both
`ingressReconciliation` and `listAttempts` now resolve tenant as:

```
ledger tenant (decision_traces, started)  →  ingress arrival  →  ingress response
```

The ingress value is only a fallback for attempts the ledger never saw, which by
definition have no stronger source. 12/12 integration tests still pass, including
the cross-tenant leak assertion, whose negative control remains load-bearing.

## F1 [high] silent failure hides ingestion outages — **LARGELY REFUTED**

Two of its three claims are wrong against this tree:

- *"the reconciliation query will see no rows and report perfect coverage"* — that
  is precisely the blind spot `starts_without_arrival` exists to close, and it is
  **durable**, not process-local. Arrivals failing while starts succeed produces a
  non-zero count. The reviewer did not see the mirror query.
- *"counters are never surfaced to monitoring"* — they are:
  `coverage/route.ts:187` returns `ingressFailureCounters()` in `failure_counters`,
  verified live (`arrival_write_failed: 0`).

**One residual is real and worth stating:** if the whole database is unavailable,
both ledgers fail together and every number reads zero. No in-process design can
fix that — there is no durable record anywhere to reconcile against. The honest
mitigation is external: alert on the absence of arrivals, not on their content.

Fail-open itself stands. A counter that can break a technician's turn is worse
than one that misses a row, and that trade is stated in the module header.

## F3 [medium] no `attemptId` UUID validation — **enforced by the column**

`attempt_id` is `UUID NOT NULL`; Postgres rejects anything else, and the wrapper
mints it with `crypto.randomUUID()`. The one caller-supplied path (`openTurn`'s
optional `attemptId`) fails the insert rather than corrupting a row, and that
failure is counted. Accepted as-is.

## F4 [low] counters not persisted or exported — **refuted**

Same evidence as F1's second claim: they are in `failure_counters` on the coverage
endpoint. Process-local by design, with `since_process_start_ms` alongside so a
restart is visible rather than silent.
