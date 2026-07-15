# CodeGraph post-merge verification (#2707 + #2708) — 2026-07-14

Evidence captured after merging #2707 and reindexing the live index. **#2707's `.gitignore`
line was inert** (inline comment — fixed in #2708); every other layer works. All six checks below
pass **with #2708 applied**.

## 0. Merge landed
- `origin/main` HEAD `a013ddf5` = "Merge pull request #2707". VERSION `3.146.9`. `tools/codegraph-freshness.sh` + `tests/test_codegraph_freshness.py` present on main.

## 1. `.audit-worktrees/` pollution absent (callers / callees / impact / symbol)
**Only after #2708's corrected `.gitignore` + reindex.** With #2707 alone, pollution persisted (inline-comment bug).
```
git check-ignore .audit-worktrees/  -> IGNORED
callers  check_citation_compliance -> worktree-path hits: 0   (was 10)
callees  check_citation_compliance -> worktree-path hits: 0   (was 17)
impact   check_citation_compliance -> worktree-path hits: 0   (was 20)
query    check_citation_compliance -> worktree hits: 0        (was 9)
real symbol locations: citation_compliance.py:144, engine.py:19, test_unit2_citations.py:480
```

## 2. Real edit → STALE; restore → fresh
```
baseline (just reindexed):        newer-source count = 0   (fresh)
touch mira-bots/shared/uns_resolver.py: newer-source count = 1   (STALE detected)
restore mtime older-than-index:   newer-source count = 0   (fresh again)
```

## 3. Successful rebuild advances `.last-sync`
`tools/codegraph-force-reindex.sh` → `index --force` completed (328s) → canary healthy (20 callers) →
wrote `.codegraph/.last-sync`: `event=force-reindex npx=ok index=present canary=healthy ts=2026-07-14T22:43:57` (was June-13 stale marker).

## 4. Failed rebuild does NOT advance `.last-sync`
Simulated a broken `index --force` (`CG=(false)`) against a seeded marker (`ts=2000-01-01`):
```
force-reindex: FAILED — 'index --force' returned non-zero
marker AFTER: unchanged (YES) — marker NOT advanced on failed rebuild
```

## 5. Tier-1 remains 14/14
`tools/codegraph-benchmark.sh` → **GREEN — Tier-1 14/14, 0 fail, Tier-2 0 regressions**. Canary healthy.
Nested-worktree pollution row: **clean** (0 worktree callers) after #2708 + reindex.

## 6. Aliased `check_citation_compliance` still an honest blind spot
After de-pollution, real `callers` = 1 (`citation_compliance.py:315`, a direct call). The engine.py
**aliased** call (`from .citation_compliance import check_citation_compliance as _check_citation_compliance`)
is still NOT resolved as a caller: `callers … | grep -c engine.py` = **0** — blind spot #3 unchanged, as documented.
