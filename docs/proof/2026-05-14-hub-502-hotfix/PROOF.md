# Hub 502 Hotfix — Proof of Work

**Date:** 2026-05-14
**PR:** [#1281](https://github.com/Mikecranesync/MIRA/pull/1281) — `fix(hub): resolve unresolved merge conflict markers in assets/page.tsx — unblock prod build`
**Merge SHA:** `611e4923`
**Deploy run:** [#25855075232](https://github.com/Mikecranesync/MIRA/actions/runs/25855075232) — `success` in 2m17s

## Root cause

PR #1214 (`feat(hub): ICS calendar export + CSV export buttons`, merged earlier today) committed literal `<<<<<<< / ||||||| / =======` merge-conflict markers to `mira-hub/src/app/(hub)/assets/page.tsx` lines 10–16. Every subsequent prod deploy failed Turbopack build with "Merge conflict marker encountered" → no new image → old container died → `/api/health` returned 502.

The deploy script's hub-health check is non-fatal (`# Don't fail the whole deploy on hub health alone — pipeline is the critical path`), so the workflow reported `success` even with hub broken. That masked the issue from observability.

## Fix

Single-line resolution keeping both `Printer` and `Download` icons (both referenced downstream in JSX at lines 478 and 495):

```diff
-<<<<<<< Updated upstream
-  Plus, X, Loader2, Wrench, Printer,
-||||||| Stash base
-  Plus, X, Loader2, Wrench,
-=======
-  Plus, X, Loader2, Wrench, Download,
->>>>>>> Stashed changes
+  Plus, X, Loader2, Wrench, Printer, Download,
```

Plus `mira-hub` version bump 1.5.3 → 1.5.4 per `mira-hub/AGENTS.md` versioning rule.

## Pre-merge state (10:26:18Z)

```
https://app.factorylm.com/api/health: 502
https://app.factorylm.com/scan/:       502
https://factorylm.com/:                200  (marketing site unaffected)
```

## Post-deploy state (10:29:44Z, deploy run #25855075232)

```
=== /api/health (follow redirects) ===
{"status":"ok","service":"mira-hub","ts":1778754611145}
final: 200

=== /api/health/ direct ===
{"status":"ok","service":"mira-hub","ts":1778754611343}
status: 200

=== /scan/ status: 500  (different problem — see Followups)

=== factorylm.com: 200
```

## CI signal on PR #1281

17/18 checks green. Critical signals:
- ✅ **Docker Build Check: SUCCESS** — confirms `npm run build` now passes
- ✅ Lint & Format, Static Analysis, Unit Tests, Eval Offline, Security Scans
- ❌ E2E smoke (factorylm.com + app.factorylm.com) — expected failure, smoke ran against the live 502'd prod that this PR fixes (chicken-and-egg)

## Verified

- [x] Conflict block at `mira-hub/src/app/(hub)/assets/page.tsx:10-16` removed
- [x] Both `Printer` and `Download` icons retained (downstream JSX usage at lines 478, 495)
- [x] No other conflict markers anywhere in `mira-hub/` (`grep -rn "^<<<<<<< " mira-hub/` returns nothing)
- [x] `mira-hub` Docker build succeeds in CI
- [x] PR #1281 merged to main as `611e4923`
- [x] `deploy-vps.yml` dispatched with `services="mira-hub"` succeeded
- [x] `https://app.factorylm.com/api/health/` returns `{"status":"ok","service":"mira-hub"}` 200 OK
- [x] Marketing site `factorylm.com` still 200

## Followups

1. **`/scan/` returns 500** — `mira-scan-monday` upstream is now responding (was 502 = down). 500 is a runtime error in the scan backend. Likely separate root cause. `mira-scan-monday` is NOT in `docker-compose.saas.yml` (deploy script errored "no such service" on a prior attempt), so it lives in its own compose file. Needs separate investigation. Body: "Internal Server Error" (Python tracewback hidden behind WSGI). Recommend: SSH the VPS → `docker logs mira-scan-monday --tail 50`.

2. **Eval Offline was failing on main earlier today** but went green on the merged commit — looks self-resolved/flaky. No action.

3. **PR #1214's review process let conflict markers land** — process gap. The CI pipeline should have a `Build Check` that blocks merge if Turbopack build fails. There's now a `Docker Build Check` in CI, so that's covered. Worth confirming it's required for merge on `main` protection rules.

4. **`mira-hub` health-check non-fatal in deploy script** is the second-order cause. Deploy claimed `success` while hub was 502. Worth flipping that fatal — if hub is critical to the product, a deploy that breaks it should fail loudly.

## Files changed in this fix

```
mira-hub/package.json                  | 2 +-
mira-hub/src/app/(hub)/assets/page.tsx | 8 +-------
2 files changed, 2 insertions(+), 8 deletions(-)
```
