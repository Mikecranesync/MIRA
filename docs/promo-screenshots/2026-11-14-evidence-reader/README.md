# Real-answer evidence adapter — local proof

Issue #5511; 2026-11-14. Screenshots exercise the actual Hub `CitedAnswer` and
`DocumentPageViewer`, with the authored two-page synthetic PDF served through a
local route matching the authenticated upload endpoint. This is synthetic
browser evidence, not live tenant authorization or physical-tablet acceptance.

- Hub focused suite: 1,175 passing tests in 66 files, including existing answer
  safety/markdown behavior and new exact quote/reading-order tests.
- Browser: four passing tests. 800×1280, 1280×800, 412×915; same-page and cross-page
  navigation in both directions; table text runs; missing quote; invalid page;
  focus return; browser Back and Escape; expired-session unavailable state.
- Hub production build: passed. Existing dynamic-filesystem tracing warnings
  remain; one concurrent test-artifact copy warning was emitted.
- Shared workspace verify: 496 tests, TypeScript, ordinary build, gzip budget
  (213,582 / 307,200 bytes), dependency license audit all passed.

Reproduce from `mira-hub`:

```sh
npx vitest run src/factorylm-ui src/components/equipment/notebook-markdown.test.tsx
npx playwright test --config tests/e2e/evidence-reader.playwright.config.ts
npm run build
```

Browser fixture requires Bun on PATH and Chrome. It uses no tenant credentials,
private manuals, live inference or external services. New direct Hub imports
`unified@11.0.5` and `remark-parse@11.0.0` are MIT and were already transitive deps.

## Drive-walk acceptance still required

Deploy the independently reviewed candidate to the chosen Hub environment.
Open an answer with a citation tied to an uploaded PDF; tap its bold superscript
or Review evidence. Compare the quoted passage against the original page, move
Previous/Next, and return to the same answer. Check at least one real manual in
portrait and landscape. Test missing/ambiguous text honestly shows unavailable.

Limits: only uploaded file citations receive in-reader PDF anchoring. External
web/image citations retain their existing source action. Each source is visited
once in first-mention order. Matching is exact after whitespace normalization,
not fuzzy/OCR; highlighted areas cover complete matching PDF text runs. Each
navigation currently reloads/parses the cited PDF; large manuals may be slow.
No immutable-revision proof, applicability verdict or answer-correctness claim
is added. Independent review, CI, deployment and real-manual tablet acceptance
remain outstanding.
