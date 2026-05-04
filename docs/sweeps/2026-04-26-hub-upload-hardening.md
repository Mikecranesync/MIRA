# 2026-04-26 — mira-hub upload pipeline hardening sweep

**Owner:** Mike + Claude
**Trigger:** PR #664 finally unblocked actual ingest (the `after()` → fire-and-forget Promise fix). With uploads working end-to-end, a senior backend agent review surfaced 12 production-readiness gaps in `mira-hub`'s upload pipeline.
**Outcome:** 8 of 12 issues shipped in a single day. 4 deferred pending design calls.

---

## What shipped

Each PR followed: isolated git worktree → CI green → squash-merge → VPS rebuild on `factorylm.com` (`docker compose build --no-cache`) → Playwright proof spec → screenshot posted to PR comment.

| # | PR | Severity | Description |
|---|----|----------|-------------|
| 693 | [#707](https://github.com/Mikecranesync/MIRA/pull/707) | security | `tenant_id` filter on `updateUploadStatus` — close the lone hole where UPDATE-by-id-only could have overwritten another tenant's row |
| 695 | [#709](https://github.com/Mikecranesync/MIRA/pull/709) | observability | Structured JSON logs at every status transition + `X-Request-Id` propagated `hub → mira-ingest`. mira-ingest middleware logs incoming request_id and echoes on response |
| 697 | [#726](https://github.com/Mikecranesync/MIRA/pull/726) + [#727](https://github.com/Mikecranesync/MIRA/pull/727) | security | Path-traversal sanitization on `asset_tag`. Hub strict-rejects, mira-ingest coerces (so bot adapters keep working). Hotfix #727 added the new module to mira-ingest's explicit COPY list. |
| 698 | [#729](https://github.com/Mikecranesync/MIRA/pull/729) | security | Magic-byte file sniffing. Reject anything whose first 16 bytes don't match the declared MIME's general category (PDF↔PDF, image↔any image kind). |
| 699 | [#730](https://github.com/Mikecranesync/MIRA/pull/730) | reliability | `AbortSignal.timeout` on every outbound fetch. Drive 60s, signed URL 60s, mira-ingest 120s, OpenWebUI delete 10s. Clean error message lands in `status_detail`. |
| 696 | [#731](https://github.com/Mikecranesync/MIRA/pull/731) | security | SSRF guard on `streamFromSignedUrl`. Allowlist (`.dropbox.com`, `.dropboxusercontent.com`, `.googleusercontent.com`), IP-literal block, private-range block, manual redirect re-validation. |
| 700 | [#733](https://github.com/Mikecranesync/MIRA/pull/733) | UX/cost | Cloud-source upload idempotency. UNIQUE INDEX `(tenant_id, provider, external_file_id)`. Pre-flight lookup + race fallback on SQLSTATE 23505. Returns existing row with `alreadyImported` / `alreadyInProgress` flag. |
| 704 | [#734](https://github.com/Mikecranesync/MIRA/pull/734) | UX | `POST /api/uploads/:id/retry` for failed cloud uploads. Local uploads return 400 (buffer is gone). Pipeline extracted to shared `lib/upload-pipeline.ts` so create + retry share one implementation. |

---

## Architecture changes worth remembering

### New shared modules in `mira-hub/src/lib/`

| File | Purpose |
|------|---------|
| `asset-tag.ts` | `validateAssetTag()` — strict whitelist for hub-side input |
| `sniff-mime.ts` | `sniffMime()` + `isMimeCompatible()` — first-byte content type detection |
| `abort-helpers.ts` | `composeTimeout()` + `isAbortError()` — fetch timeout boilerplate |
| `ssrf-guard.ts` | `assertSafeUrl()` + private IP detection |
| `upload-log.ts` | `makeUploadLogger()` — structured JSON logs keyed by requestId |
| `upload-pipeline.ts` | `runIngestPipeline()` + `pipelineInputFromRow()` — extracted from `route.ts` so create + retry share it |

### mira-ingest changes

- New `mira-core/mira-ingest/asset_tag.py` — `sanitize_asset_tag()` with coerce-not-reject (bot adapters depend on it)
- New `@app.middleware("http")` in `main.py` — logs incoming `X-Request-Id` at INFO, echoes on response
- **Both new files must be in the explicit COPY list of `mira-core/mira-ingest/Dockerfile`** — see `memory/feedback_mira_ingest_dockerfile_copy_allowlist.md`. Hotfix #727 was the lesson learned.

---

## What was deferred + why

| # | Item | Effort | Open question |
|---|------|--------|---------------|
| 694 | stuck-upload reaper | M | Cron mechanism: external cron-job.org hitting an internal endpoint, vs. systemd timer on VPS, vs. dedicated Node worker container. Vercel cron N/A. |
| 701 | retry on transient OW failures | M | Policy: how many retries, what 4xx/5xx are transient (502/503/504 obvious; 422 ambiguous), and whether the manual retry endpoint #704 already covers it well enough that automatic retry is overkill |
| 702 | per-tenant rate limit | M | Storage: in-memory (single-replica only) vs. Postgres counter (Neon roundtrips) vs. introduce Redis dependency |
| 703 | versioned migrations | M | Scope (just `hub_uploads` or repo-wide) and breaking the inline `IF NOT EXISTS` pattern that the rest of the repo uses. Refactor risk on #700's recently-added unique index. |

All four are M-effort and need a brainstorm pass before code starts. None of them are urgent for customer 1 — security + UX must-haves are already shipped.

---

## Verification protocol used (worth keeping)

For every PR in the sweep:

1. **Branch**: `git worktree add` for clean isolation per PR
2. **CI**: 12-check workflow watched until green (one Semgrep job hung once on #733, cancelled + reran cleanly)
3. **Merge**: squash + delete-branch via `gh pr merge`
4. **Pull**: `git pull --ff-only` locally + on VPS
5. **Rebuild**: `doppler run -- docker compose -f docker-compose.saas.yml build --no-cache <service>`
6. **Recreate**: `up -d --force-recreate <service>`
7. **Health gate**: `until docker ps | grep <service> | grep -q healthy; do sleep 2; done`
8. **Playwright proof**: per-PR spec under `mira-hub/tests/e2e/proof-pr-<NNN>.spec.ts`. Three checks per PR — health 200, auth gate (307 → /hub/login), screenshot of /hub/upload
9. **Screenshot**: copied to `tools/web-review-runs/2026-04-26-pr-<NNN>/` and linked in a PR comment with full verification report

This pattern caught one regression mid-sweep (mira-ingest crash from missing `asset_tag.py` in Dockerfile COPY) within 2 minutes of deploy. Without the post-deploy verification, that would have been a silent breakage in prod.

---

## Rollback target

All eight PRs land on `main` between `40718e4` and `51536a3`. To roll back any single one, `git revert <commit>`; to roll back the whole sweep, revert from `51536a3` back to `40718e4`. Per the new global versioning discipline rule, the next mira-hub release should bump `mira-hub/package.json` from 1.4.0 → 1.5.0 and tag `mira-hub/v1.5.0`. (Currently package.json + latest tag are in sync at v1.4.0 from the parallel-session work earlier in the day.)
