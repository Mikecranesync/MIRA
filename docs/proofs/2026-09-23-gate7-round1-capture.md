# Gate 7 adversarial review — PR #3964

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, authorization, tenant scoping, cross-repository contract, production deployment, deletion/destructive, concurrency/idempotency/state, broad multi-module (7 top-level dirs)

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `c07e22318b6fee5dd7de4fd40feb4843d9630563`
- scope (--paths): mira-hub/src/capabilities/observability, mira-hub/src/app/api/observability, mira-hub/db/migrations
- excluded by scope (17): .github/workflows/retrieval-acceptance.yml, HANDOFF.md, PLAN.md, docker-compose.staging-vps.yml, docs/env-vars.md, docs/proofs/2026-09-23-3963-fire-rate-remeasured.md, docs/proofs/2026-09-23-capture-acceptance-staging.md, docs/proofs/2026-09-23-jev-evaluation-for-capture.md, mira-hub/docs/SITEMAP.md, mira-hub/docs/sitemap.snapshot.json, mira-hub/src/app/api/equipment-notebooks/[id]/chat/__tests__/turn-lifecycle.test.ts, mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts, mira-hub/src/app/api/equipment-notebooks/[id]/look/route.ts, mira-hub/src/instrumentation.ts, mira-hub/src/lib/inference/__tests__/persist-usage.test.ts, mira-hub/src/lib/inference/persist-usage.ts, tools/qa/capture_acceptance.py
- diff chars sent/total: 40,000/89,289 (cap 40,000)
- reviewed-diff sha256 (sent bytes): `93575879bf8006ec9121c643e8818372f6a42ad9fb12db28b9ce641ae297206c`
- full scoped-diff sha256 (pre-cap): `44778f4da91f88ca0731e6a3ec6161dcb94797b037a2f492a30af6fee2ee43a4`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Lifecycle default misconfiguration – start rows may be created with the default `'closed'` value, causing duplicate closed entries and incorrect coverage metrics.** — 
- **[medium] Conflated error handling – a single `readError` variable is used for three independent async calls, masking which operation actually failed.** — 
- **[medium] `publicOrigin` trusts client‑controlled `X‑Forwarded‑Host`/`X‑Forwarded‑Proto` headers, allowing spoofed origin strings in the JSON response.** — 
- **[low] `pct` does not treat `undefined` as “n/a”, producing “NaN%” when a rate is missing.** — 

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Lifecycle default misconfiguration – start rows may be created with the default `'closed'` value, causing duplicate closed entries and incorrect coverage metrics.**  
  The migration adds the column with a default that treats any row lacking an explicit value as already finished:  
  ```diff
  +    lifecycle    TEXT NOT NULL DEFAULT 'closed',
  ```  
  The subsequent migration creates a unique index on `(attempt_id, lifecycle)` (where `attempt_id IS NOT NULL`):  
  ```diff
  +CREATE UNIQUE INDEX IF NOT EXISTS decision_traces_attempt_lifecycle_uk
  +    ON decision_traces (attempt_id, lifecycle) WHERE attempt_id IS NOT NULL;
  ```  
  If the code that records a “started” turn omits the `lifecycle` field (or mistakenly sets it to the default), the row will be stored as `'closed'`. When the later “closed” row is inserted, the unique index will reject the insertion because the combination `(attempt_id, 'closed')` already exists. This leads to runtime errors, loss of capture data, and misleading `lifecycleCoverage` results (inflated `closed` count, missing `started` rows). The schema does not enforce that a start row must set `lifecycle='started'`, and the tests do not cover this case.

- **[severity: medium] Conflated error handling – a single `readError` variable is used for three independent async calls, masking which operation actually failed.**  
  ```diff
  -  let coverage: Awaited<ReturnType<typeof lifecycleCoverage>> | null = null;
  -  let unfinished: Awaited<ReturnType<typeof listUnfinishedTurns>> = [];
  -  let reconciliation: Awaited<ReturnType<typeof ingressReconciliation>> | null = null;
  -  let readError: string | null = null;
  -  try {
  -    coverage = await lifecycleCoverage(...);
  -    unfinished = await listUnfinishedTurns(...);
  -    reconciliation = await ingressReconciliation(...);
  -  } catch (err) {
  -    readError = err instanceof Error ? err.message : String(err);
  -  }
  ```  
  If only one of the three operations throws, the response marks **both** coverage and ingress sections as unreadable (via `readError` and the `copy_text` block). Operators lose granularity needed for debugging, and a transient failure in one subsystem could obscure healthy data from the other.

- **[severity: medium] `publicOrigin` trusts client‑controlled `X‑Forwarded‑Host`/`X‑Forwarded‑Proto` headers, allowing spoofed origin strings in the JSON response.**  
  ```diff
  +  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  +  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  +  return `${proto}://${host}`;
  ```  
  An attacker can supply arbitrary values in these headers, causing the `origin` field (and the `copy_text` block) to contain crafted URLs. If downstream UI renders this field without proper escaping, it creates a vector for reflected XSS or phishing‑style attacks.

- **[severity: low] `pct` does not treat `undefined` as “n/a”, producing “NaN%” when a rate is missing.**  
  ```diff
  +function pct(v: number | null): string {
  +  return v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;
  +}
  ```  
  When a rate field is `undefined` (possible if a metric is omitted), the calculation yields `NaN%`, which is confusing for operators and could be mistaken for a real metric.

## NOT REVIEWED
- The internal implementations of `lifecycleCoverage`, `listUnfinishedTurns`, `ingressReconciliation`, and `reconcileStaleTurns` are not present in the diff, so we cannot verify tenant‑scoping, SQL injection safety, or performance of those queries.  
- The generation and propagation of `attempt_id` from the arrival hook to the ledger insertion are not exercised in the provided tests; race conditions or duplicate UUID generation are not checked.  
- Potential production impact of applying migrations 091‑093 (e.g., lock contention, index bloat, query‑plan changes on large tables) is not evaluated.  
- The behavior of the background reconciler when multiple server instances run concurrently (beyond the single‑process timer test) is not verified; duplicate “abandoned” rows or missed stale turns could still occur.  
- Retention, backup, and GDPR implications of storing `client_request_id` and other request metadata in `turn_ingress` have not been examined.  

The high‑severity lifecycle default issue alone warrants blocking the PR until the schema is corrected (e.g., make `lifecycle` nullable with no default, enforce a CHECK that start rows must set `lifecycle='started'`, or add a trigger to prevent default misuse).

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
