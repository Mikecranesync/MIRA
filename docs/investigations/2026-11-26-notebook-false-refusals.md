# Investigation: notebook chat false refusals (#5710, #5677, #5998, #6004; PR #6030)

**Status:** final behavior as implemented on `fix/6030-takeover-20261126`. All evidence below is
synthetic regression input or local test output, not an OEM fact and not a staging or production
verification. Component line: `mira-hub` 2.66.13 (hotfix; no root `VERSION`, see `docs/versioning.md`).

## What was wrong

The Equipment Notebook answered "the excerpts do not contain..." although the answer was in text the
retrieval had already returned or pointed to:

1. **Context truncation.** A long table chunk was cut to a fixed prefix, so a late row (F081, P06.53, a
   solid-yellow LED row) never reached the model.
2. **Lost applicability.** Any row selection that kept a row but dropped its heading, column header or
   footnote (`Model B only`, `Type 2 requires manual reset`) would answer for the wrong model.
3. **Unfetched references.** A passage saying "see page 45" never brought page 45 into the prompt or the
   citations.
4. **Validators judged different text than the model saw**, and citation numbers could alias two
   documents that share a file name and page.
5. **Output hygiene.** Draft markers ("rewrite:") or an unexpected script could be released.

## What the code does now

| Area | Behavior | Where |
|---|---|---|
| Row selection | Table-aware, per table. A kept row is shown whole under its own heading block (nearest heading, or the blank-separated one-line captions above it), its own column header and its whole footnote block (including footnotes after a blank line). Omitted spans are marked. Identifier **coverage** ranks requested rows above rows that only repeat the model word. Output is bounded (2400 chars table-heavy, 1200 mixed). If a requested row cannot fit with its qualifiers it is **held whole** behind an explicit marker, never shown partially or unqualified. A mostly-prose passage with a small matching table gets the same selection. | `mira-hub/src/capabilities/context-selection.ts` |
| Page references | One hop, upstream of citations: a retrieved notebook chunk's "see page N" is resolved by printed `page_label` to its single physical page **inside the same document and file**, read under the tenant, the validated document set and the approval predicate, with retrieval's model-admission rule applied. Bounded (5 targets, 8 chunks/page, 20 chunks, 2 queries, per-query timeout capped by a 4 s deadline). Section numbers are not pages. No label means nothing is added. The formatter no longer fetches pages itself. | `capabilities/referenced-pages.ts`, route |
| One evidence set | The added chunks are appended after retrieved and safety-chapter chunks, so the prompt, source chips, citations, cited-page safety read and validators all read the same list. | `chat/route.ts` |
| Source identity | `docId + file + physical page` for document-bound chunks (legacy OEM chunks keep file+page), shared by the prompt, chips, route citations, support/claim validators, safety statement and cited-page read. | `capabilities/citation-source-key.ts` |
| Validators | Support, supporting-quote and claim-shadow checks judge the same bounded, neutralised text the provider was shown (`modelVisibleContent`), for the same context question. A row the model was not shown is still unsupported. | `context-selection.ts`, `supporting-quote.ts`, `claim-verifier-shadow.ts` |
| Output hygiene | One deterministic check for every candidate admitted to buffered release (first draft, quoted recovery, semantic redraft and its shown text). Expected scripts come from the technician's turn(s); an unexpected script run must appear verbatim in the evidence; draft markers are rejected. A failure shows an honest "I could not produce a clean reply" text with no basis and no citations, and is recorded and replayed as status `error` (a durable `output_hygiene_failure` marker; never "insufficient evidence", never a provider-exhaustion reason). A clear Latin-script turn overrides an earlier non-Latin turn; only an identifier-only follow-up keeps the thread's scripts; a non-Latin name is accepted only when it appears in text the model was actually shown. Gate off stays legacy (what was streamed is what is saved). `withAnswerLanguage` no longer calls a non-Latin question English. No new model, translation or judge call. | `capabilities/answer-hygiene.ts`, `answer-language.ts` |

## What this does NOT fix

- **Retrieval ranking.** The #5998 root cause is that retrieval never returned pp.161-162 for "What causes
  overcurrent faults on a PowerFlex 525?". Nothing here touches BM25, vectors or boosts. The 74 fixture and
  tests prove only that those pages' rows **survive context assembly when retrieved**. That remains a
  separate future change.
- **Unlabelled documents** get no page expansion (a printed page is never assumed equal to the PDF page).
  Plural ranges ("pp. 10-12") are not followed. The shared-OEM lane and the asset/namespace/quickstart
  routes are not expanded.
- **Field verification.** No staging, production or physical-device run was made. The notebook route tests
  use controlled auth, domain functions, ordinary retrieval and a stubbed provider; the expansion's SQL
  scope is proven separately on a disposable Postgres.
- **Type debt.** Full `tsc` shows the same 75 diagnostics / 151 lines as accepted `main` (all pre-existing,
  none in the touched files). The Next.js `SecurityFatalError` advisory in the Hub build is a pre-existing,
  unresolved gate and is not addressed by this PR.

## How it is tested (real commands)

From `mira-hub/`:

```bash
# unit + route tests (default CI): context, expansion, identity, hygiene, Hub eval fixtures
npx vitest run src/lib/__tests__/manual-rag-context-survival.test.ts \
  src/capabilities/__tests__/evidence-identity-visibility.test.ts \
  src/capabilities/__tests__/evidence-identity-visibility.route.test.ts \
  src/capabilities/__tests__/referenced-page-expansion.route.test.ts \
  src/capabilities/__tests__/output-hygiene-release.route.test.ts \
  src/capabilities/__tests__/hub-eval-fixtures.route.test.ts \
  src/lib/__tests__/manual-rag-cross-ref.test.ts
# real Postgres (disposable database only: TEST_DATABASE_URL + MIRA_TEST_DB_CONFIRM=DISPOSABLE)
node scripts/setup-integration-db.mjs
npx vitest run --config vitest.integration.config.ts src/capabilities/__tests__/referenced-pages.integration.test.ts
npx tsc --noEmit --incremental false -p .
```

From the repo root: `python3 -m pytest tests/eval/test_hub_profile_fixtures.py` and
`python3 tools/qa/security/check_knowledge_entries_filters.py`.

Fixtures `tests/eval/fixtures/70-76` carry a `hub_notebook` block and `runner: hub_notebook`: they are
executed by the Hub harness (complete row visible to the provider, answered status, resolved citation
document **and** physical page, stream equals persisted reply). The `/v1/chat/completions` pipeline runner
excludes and logs them, because its any-keyword grading cannot distinguish an answer from a refusal that
repeats a keyword.

Every guard was shown to fail on its regression by an applied-and-restored narrow mutation; the first
failures and mutation logs are kept in the PR author's local `.planning/6030/` receipts and summarised in
the PR body.
