# #5241 continuation — fixes verified; authenticated journey blocked

Mike explicitly requested continuation from `152f6d39a`, resolving #5242, #5243
and #5244 in this same draft. That instruction supersedes the previous reviewed
handoff freeze for these findings. The previous commit, review and body remain
in history; no old approval is reused for the new head.

Product source: `3fd4d1b6ac628342e72ec25a6456d03c4353a9d8`.
No new graph, registry, framework, migration, paid service, production change,
merge or deployment. This is not MERGE READY: the required full authenticated
journey has missing source relationships and history.

## Three corrections

| Issue | Change and verification |
|---|---|
| #5242 | Bounded imported performed-work, readings, notes/resolutions and photo references now enter the same projection used by chat and screen/print. Actor claims, import user/time and original packet identity remain explicit; no current-job completion is inherited. Raw images/opaque fields stay in the full record. Regression covers missing event counterparts, unresolved reports, both operational Guide copies, clipping and counted omissions. |
| #5243 | Ordered edits reuse one private clone and the existing field/copy/history engine. An accepted 6.3 MB fixture with420 decisions fell from420 full serializations/2,081.49 ms to1/6.20 ms (6.85 ms within the full suite). Measurements exclude DB/HTTP; no universal latency promise. Output equals sequential edits, original input stays unchanged, and late failure is atomic. |
| #5244 | Saved-record links use existing API_BASE. Both `/hub` and root deployments match the client endpoint, including the exact selector, in screen and print. The actual browser `/hub` click returned200 and the same snapshot/selector. |

Red-first tests reproduced the missing imported facts, incorrect `/hub` link and
420 serializations. Final focused run:37 passed. Full Hub after an isolated
lockfile install:13,138 passed/53 existing skips;592 passing files/4 skipped.
Typecheck still matches the exact159-line baseline (SHA256
`1183f05bfa9611f78df9870ecacf249465c2c8cebf7a25817922755be8648ff3`), not a
green project typecheck. Changed files lint clean; sitemap70 pages/207 routes
and whitespace checks pass. The actual Next16.4.1 build succeeds.

The prior dependency symlink pointed to an incomplete peer worktree install.
Only this task's symlink was replaced using the existing lockfile; no peer
dependency tree, manifest or lockfile changed. A production-mode Next build
served on loopback avoids the dev-only eval/CSP incompatibility. It used the
existing staging DB and a task-local stable session secret, with no LLM,
industrial or Atlas credentials in its environment. Normal notebook access
metadata/auth schema checks remain existing behavior, not a claim of strict
database SELECT-only execution.

## Actual authenticated evidence

Existing synthetic QA technician and tenant99 authenticated through the normal
NextAuth password/session flow on staging and on the candidate. No auth mocks,
manual session minting, role bypass or seeded relationships. Deployed staging
is still `090c8e15bfcbd85f0091103cf5a6f5fc6b221056`; the candidate was tested on
task-owned loopback, not deployed there. These are real service/database/UI
reads of fictional QA data, distinct from the pure synthetic performance and
regression fixtures. No paid answer was requested.

| Acceptance step | Observed result |
|---|---|
| Open correct asset/job | PASS: CMMS UUID `00000000-0000-0000-0000-000000001005`, KG/domain key `PUMP-01`, notebook `d36d1927-d466-4cb4-8cad-3ce8394c3201`, job `04bce10d-1acc-4a21-b5ba-fa06d3d14b05`, sequence6; current binding is the same confirmed asset. IDs are not equated by display name. |
| Access component | BLOCKED: installed-component API returns0, and the verified graph view supplies only the root equipment, no component edge. |
| Access applicable manual | BLOCKED: attached/suggested manuals0, notebook sources0, graph manual references0. A PM work-order description's manual title is not original source bytes or approved attachment. |
| Review saved work/guide/chat | Saved history and the candidate memory UI open. This legacy job has no imported repair guide; this viewer has0 saved chat turns/threads in the notebook. No complete illustrated/answer history is claimed. |
| Follow evidence link | PASS for exact saved-record link on `/hub`:200, same snapshot and selector. Root deployment is covered by regression. |
| Follow verified Atlas work order | BLOCKED: request status reports `verified_by_readback`, externalRef1652. None of160 inspected Hub work orders maps to atlas_id1652. This is delivery-status evidence, not a verified provider deep link or provider asset FK. No URL was guessed from a display name, environment default or numeric ID. |
| Tenant/auth isolation | PASS on actual staging: anonymous asset read401; authenticated tenant199 gets404 for tenant99 asset, notebook and job. Candidate route-level negative regressions also pass. |
| Restart/persistence | PASS for session and persisted snapshot/selector/source through a real candidate process restart; exact job can be reopened. Automatic selected-job reopening is false, explicitly retained as a navigation limitation, not evidence loss or physical-device proof. |

The historical captured UNS stays unknown. The graph's current knowledge-base
address is a dated overlay; it is not substituted into historical identity or
claimed to have propagated to Atlas.

See [sanitized journey receipt](authenticated-journey.json),
[restart receipt](restart-receipt.json), [timing measurements](performance.json),
[focused test output](focused-tests.txt), [full-suite summary](full-unit-summary.txt)
and [typecheck output](typecheck.txt). Actual screenshots:
[desktop](candidate-desktop.png), [mobile](candidate-mobile.png),
[clicked source](candidate-source-link-mobile.png),
[after restart](candidate-after-restart-desktop.png).
Screenshots capture only the opaque job dialog/current synthetic record;
other project lists, credentials, cookies and raw private inputs are omitted.

Working protected staging reads at capture time:
[asset context](https://app-staging.factorylm.com/api/assets/00000000-0000-0000-0000-000000001005/context/),
[manual associations](https://app-staging.factorylm.com/api/assets/00000000-0000-0000-0000-000000001005/documents/),
[saved job](https://app-staging.factorylm.com/api/equipment-notebooks/d36d1927-d466-4cb4-8cad-3ce8394c3201/sheets/04bce10d-1acc-4a21-b5ba-fa06d3d14b05/?atSeq=6),
[delivery status](https://app-staging.factorylm.com/api/equipment-notebooks/d36d1927-d466-4cb4-8cad-3ce8394c3201/sheets/04bce10d-1acc-4a21-b5ba-fa06d3d14b05/work-order/).
They require authorized authentication. Candidate enriched URLs are loopback
proof only and are not asserted deployed on staging.

## Repeat the checks

```sh
cd mira-hub
npm ci --ignore-scripts --no-audit --no-fund
npm test -- --cache=false
npx tsc --noEmit --incremental false
npm run sitemap:check
```

For the authenticated probe, use the existing normal sign-in flow to save a
private Playwright auth state outside git, then run against the candidate's
loopback build (no source writes or provider calls):

```sh
ASSET_MEMORY_AUTH_STATE=/private/path/auth-state.json \
ASSET_MEMORY_BASE=http://127.0.0.1:55784/hub \
node docs/proofs/asset-memory-5241-continuation/authenticated-read.mjs /tmp/asset-memory-authenticated-proof
```

Exit2 means the existing acceptance data is incomplete; it must not become a
passing test by inventing associations. Staging's current deployed source does
not implement the enriched read. Build/start configuration must remain scoped
to non-production and must not include paid-provider or industrial credentials.

## Smallest next action

Identify one existing approved non-production case with its real component,
applicable original manual, saved imported guide/viewer history and verified
provider/work-order mapping, or have the appropriate source owners establish
those links through existing workflows. Then rerun this same authenticated
journey and provider-link check. No new architecture is needed. The requested
asset/job clarification is pending; no answer or authority is inferred from time.
Merge and deployment remain unperformed and require approval.
