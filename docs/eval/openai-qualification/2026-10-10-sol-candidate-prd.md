# Sol notebook candidate — scoped adapter acceptance

Date: 2026-10-10. Owner: #4344, [claim receipt](https://github.com/Mikecranesync/MIRA/issues/4344#issuecomment-6101136131).
Base: accounting `624f3440a57cb3fec039988babc977339723ce3f`, on main `904f7114fba40b88f7b053b271202c18e1f15922`.
Reuse source: immutable #3999 `4fdfc7e9063a8294f7de15f81c1d8fdbc58596cc`, canonical provider seam.

This slice implements the expressly authorized local candidate adapter. It does not authorize publication, merge, deployment, changes to #4332-owned routes, or safety-policy changes. Writer API spend is zero. The coordinator owns the separate $2 additional total API cap, workflow-cost qualification and actual-handler pilot.

## Numbered acceptance requirements

1. `canonicalProviders()` remains Groq → Cerebras → Together with the same objects, environment keys, defaults and ordering. Notebook opt-in must not alter unscoped safety-judge callers.
2. Only `canonicalProviders("notebook")` together with `MIRA_NOTEBOOK_PROVIDER=openai` selects one OpenAI provider. Use the existing `OPENAI_API_KEY` seam and pin `gpt-6.1-sol`; arbitrary model environment overrides have no effect. Missing key or candidate failure must not select an incumbent provider implicitly.
3. Reuse Chat Completions streaming, preserve the supplied messages, request final usage, set `store:false`, `reasoning_effort:medium`, `service_tier:default`, and bound completion tokens including reasoning. Omit temperature, legacy `max_tokens` and model tools. Reject a forged non-Sol OpenAI model or invalid output cap.
4. Model tools remain unimplemented. Sol tools require Responses API; deterministic product retrieval does not establish model-tool coverage. Tool authorization and loop controls belong to a separately authorized slice.
5. Price only exact resolved Sol/default-tier responses with complete valid usage. Use uncached input $2, cached reads $0.10, cache writes $2.50, output $10 per million tokens. Above 272,000 prompt tokens, apply documented long-context rates. Completion totals include reasoning; never add reasoning twice.
6. Missing totals, missing cache-write/read accounting, malformed/overlapping cache counts, inconsistent reasoning, non-default or unknown returned tier, and missing/mismatched response model yield `null` cost. Existing #4343 nullability and known-zero behavior remain intact. Raw token telemetry remains available even when price is unknown.
7. Add offline behavior tests and retain red/green plus mutation receipts. Existing canonical, unknown-cost, provider-policy and safety-judge invariants must pass. No paid call is needed for adapter acceptance.
8. Return the one-line notebook generation selection patch as an unapplied artifact. The active route owner must separately integrate selection, capture actual returned model/tier, preserve final usage frames, and prove real handler/product behavior. The adapter alone is not a deployed or fully integrated product path.

## Primary-source contract

Verified read-only on 2026-10-10: [Sol model](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [pricing](https://developers.openai.com/api/docs/pricing), and [Chat Completions schema](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create). The schema explicitly defines `prompt_tokens_details.cache_write_tokens`, `cached_tokens`, and `completion_tokens_details.reasoning_tokens`. Processing tier is response metadata outside usage; it can differ from the requested tier. Regional endpoints have separate pricing and are outside this global-endpoint candidate. No fabricated cache-write alias is used.

## Implementation plan

Goal: opt in to the existing canonical seam for an offline-testable Sol notebook candidate.
Architecture: preserve the unscoped registry; add the #3999 notebook selection and request branches. Extend `usageFromRaw` with optional actual response metadata; leave legacy callers and the #4343 estimator intact.
Tech stack: existing TypeScript/Vitest only; no new package or framework.
Spec: local mission `TASK-2026-10-10-sol-product-adapter.md` and its full `Task.md`.

- [x] Write candidate tests covering selection, supported payload, model/cap rejection and conservative usage.
- [x] Run the tests against accounting base and retain expected behavioral failures.
- [x] Implement only the provider/request/usage slice in `canonical-cascade.ts`.
- [x] Run affected tests, full applicable Hub suite, and mutation controls; retain receipts outside the repository.
- [ ] Return changed symbols and exact scope to the coordinator for verification before any commit.

Review focus: an opt-in leaking into safety judging; missing returned model/tier; absent cache-write telemetry; cache counts exceeding total input; reasoning already included in billed completion total.

## Remaining gates

Route integration, paid product transport, Responses model tools, actual retrieval/source applicability, safety/JEV enforcement policy, independent exact-head review, CI, staging and physical Pixel acceptance remain separate and unproven by these offline adapter tests.

## Offline verification receipt

Accounting-base candidate run: 8 expected failures / 5 passes. Implemented affected suite: 40 passes (13 candidate, 3 accounting, 24 canonical). Full Hub: 353 test files pass / 4 skipped; 5,636 tests pass / 53 skipped. Nine mutations are caught by assertions; restored source passes the affected suite. The default provider return block and #4343 estimator are byte-equivalent to the accounting base.

Whole-Hub TypeScript has 109 diagnostics, identical to a read-only accounting-base overlay, with zero diagnostics in the candidate test or module. The Next 16.3.8 standalone production build passes its existing compiler-API check; three existing dynamic filesystem tracing warnings remain. Whole-project tsc and the configured production build have different documented test-file coverage. Retained receipts are under the mission evidence directory, each prefixed `sol-adapter-`. No deployment or actual product-call acceptance is implied.
