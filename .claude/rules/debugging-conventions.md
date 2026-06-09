# Debugging & Verification Conventions

Two recurring failure modes, codified from the 2026-06-08 /insights review.
These complement `karpathy-principles.md` (behavior) — they govern *diagnosis
discipline*, not syntax.

## 1. Performance problems are multi-cause by default

Do NOT declare a latency or slowness fix done after killing one bottleneck.
After every fix, **re-measure**, then look for the next compounding layer.

- State the dominant layer, fix it, re-measure, repeat until a numeric target
  is met — not until the first fix lands.
- Layers stack and hide each other: the AskMira `/ask` 45s→2.3s work took four
  PRs (#1775/#1780/#1784/#1785) because BM25, fault/product extraction,
  embedding, and an ILIKE scan each surfaced only *after* the previous fix.
  A single-cause "it was BM25" call would have shipped a still-slow endpoint.
- A status spike or one slow query is evidence of *a* cause, not *the* cause.
  An HNSW index was a red herring there; the real cost was an ILIKE scan.

**Rule:** for any perf task, report the per-layer reduction (p50/p95 before →
after at each layer), not a single before/after number.

## 2. Verify schema and API paths from the codebase before guessing

Wrong table/column names produce **false negatives** (a db-inspect check
reported `MISSING` because the table name was wrong, not because data was
absent). Wrong auth paths waste cycles (`/api/auth/signin` vs `/auth/signin`,
bcrypt prefix guesses on the Atlas signin work).

- Resolve exact table/column names from migrations (`docs/migrations/`,
  `mira-*/migrations/`) or CodeGraph before writing a query or asserting a row
  is missing.
- Resolve exact API auth paths from the route definitions (NextAuth subpath is
  `/<base>/api/auth/...`; see the hub auth memory) — don't infer from the app
  base URL.
- A "MISSING" / 404 / 401 result against an unverified name or path is
  **inconclusive**, not a finding. Confirm the name first, then trust the result.

## When this applies

- Any perf/latency/slowness diagnosis in `mira-bots/`, `mira-hub/`,
  `mira-pipeline/`, `mira-web/`, or infra.
- Any db-inspect / row-existence check, any new SQL, any auth-path probe.

## When this does NOT apply

- A genuinely single-step fix from a stack trace you already have open.
- A perf change with one obvious cause already measured end-to-end.
