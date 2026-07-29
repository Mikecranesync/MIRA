# Patch — quickstart/ask refuse-on-fallback (C3 wrong-vendor lie)

**Closes:** the one remaining stranger-reachable beta blocker — the C3/F#2
wrong-vendor citation lie on the public money path (`POST /api/quickstart/ask`).
**Status:** apply-ready. Generated via `git diff` in a throwaway worktree of
`origin/main` (NOT hand-counted hunks). `git apply --check` ✅ vs `origin/main`
@f90bdcc. Founder-gated: edits the live money-path route — review before merge.

## What it does
`retrieveManualChunks` silently falls back to an UNSCOPED (cross-vendor) BM25
query when a named manufacturer returns 0 hits (`manual-rag.ts:53-56`), and the
route maps every returned chunk into `citations[]` (`route.ts:172`) with no
vendor filter and no `strip_conflicting_citations` equivalent. So a stranger
who picks a thinly-covered manufacturer can get an answer that **cites another
vendor's manual as if it were theirs** — grounded-looking, but a lie. The
engine path closes this (`citation_compliance.evaluate_citation_relevance` +
enforce-mode), but the hub quickstart route never calls the engine.

Fix (surgical, 2 files):
- `manual-rag.ts`: add `retrieveManualChunksScoped()` returning
  `{ chunks, fellBack }`; `fellBack=true` only when a manufacturer was
  requested, the scoped query found nothing, and the unscoped fallback
  returned rows. `retrieveManualChunks()` is kept as a thin delegating wrapper
  so the OTHER caller (`assets/[id]/chat/route.ts:258`) is unchanged.
- `quickstart/ask/route.ts`: capture `fellBack`; when true, return a
  deterministic honest refusal ("I don't have {mfr} manuals for that … sign up
  to upload your own") with empty `citations[]` and no LLM call.

Zero blast radius: the back-compat wrapper preserves the existing signature;
only the public quickstart route changes behavior.

## Apply
```bash
cd "$(git rev-parse --show-toplevel)"
git checkout -b fix/quickstart-wrong-vendor-refuse origin/main
git apply --check wiki/orchestrator/patches/2026-06-10-quickstart-wrong-vendor-refuse.patch
git apply        wiki/orchestrator/patches/2026-06-10-quickstart-wrong-vendor-refuse.patch
```

## Verify
```bash
cd mira-hub
npx tsc --noEmit                     # NOT run in sandbox — run before merge (typecheck)
npx eslint src/lib/manual-rag.ts src/app/api/quickstart/ask/route.ts
# functional: scoped-hit answers normally; named-mfr w/ 0 scoped hits → refusal + []
npx playwright test --config playwright.smoke.config.ts -g quickstart
```

## Notes / alternative
Primary fix = refuse (matches C3's recommended action; deterministic; no
wrong-vendor cards). Softer alternative if a refusal is judged too aggressive
for thin-coverage vendors: keep answering but pass `fellBack` into the prompt
and force `citations: []` so the model answers off generic text WITHOUT
rendering wrong-vendor citation cards. Refuse is the safer default for a public
beta; flip later if conversion data argues for the softer path.

After merge: D-lens eval can finally catch regressions of this via the landed
`cp_citation_vendor_relevance` grader — but only once the replay seam is
operable (see D3: store is `.gitignore`d + `--replay` wired into 0 workflows).
