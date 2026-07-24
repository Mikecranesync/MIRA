# PrintSense promotion evidence package (xhigh → medium decision)

Durable evidence trail for the production-default decision, per the operator's post-merge
verification and promotion plan (2026-07-14/15). **The production default remains
`opus-4-8 · xhigh` until every promotion-gate item passes AND Mike explicitly approves.**

Chain this package proves, per capability:
`requirement → implementation → automated test → post-merge verification → staging product-path
test → preserved evidence → Mike-verifiable acceptance result`.

## Layout

| path | contents | status |
|---|---|---|
| `environment.json` | code SHAs, versions, model/effort config, grader+rubric identity | ✅ |
| `deployment.json` | staging deployment record (run id, SHA, timestamps, health) | ✅ |
| `corpus-manifest.json` | the six strata: identity, checksums, truth-set status | ✅ (2 strata need images) |
| `truth-sets/unrelated_print.draft.json` | stratum-4 honesty truth set | **DRAFT — pending Mike's review; not frozen** |
| `phone-tests/` | Tests 1–3 evidence (Telegram responses, correlation ids) | ⏳ awaiting Mike's hands-on runs |
| Benchmark records | `../2026-07-14-printsense-cost-benchmark.md`, `../2026-07-15-variance-rerun-post-2701.md`, raw rows JSONs (same dir) | ✅ merged (#2704, `720e2181`) |
| `decision-table.md` | final stratified xhigh-vs-medium table | ⏳ blocked on corpus completion |

## Rules honored

- Raw evidence is never overwritten; corrections are new versions.
- No truth set is frozen without independent human review (drafts are labeled DRAFT).
- Latency numbers come from interactive runs only; batch runs are labeled as such.
- Every record carries UTC timestamps (local = America/New_York, UTC−4 in this period).
