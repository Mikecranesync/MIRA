# PR #3018 Adversarial Review — Response

Review: `2026-08-01-pr3018-adversarial-review-for-claude.md`
Branch after fixes: `codex/plc-live-snapshot` @ `6b41f0c99` · VERSION `3.237.1`
GitHub: **MERGEABLE / CLEAN**, 27/27 checks green.

**All five findings were verified real before being fixed.** None was contested.

## Finding-by-finding

### 1. Merge conflicts — CONFIRMED, FIXED
Reproduced: 2 commits behind, `VERSION` + `docs/CHANGELOG.md` conflicted. Rebased onto
`origin/main` (`722617888`, v3.237.0). The mechanical per-commit changelog resolution mangled the
file (duplicate headers + committed conflict markers), so the changelog was **rebuilt**: main's
file verbatim + one consolidated `### v3.237.1` entry covering all three layers of the PR
(adapter → deployment contract → review fixes). `git merge --no-commit --no-ff origin/main` now
reports `Already up to date`.

### 2. Activation-to-stream config mismatch — CONFIRMED, FIXED
`api/connect/doPost.py` persists `RELAY_URL`; `tag-stream.py` read only `INGEST_URL` and fell back
to the hardcoded `DEFAULT_INGEST_URL` — a freshly activated gateway ignored the relay it was just
assigned. Same two-names-for-one-thing defect the PR already fixed for tenant/HMAC, on the URL.

Fix: the stream reads `INGEST_URL` (documented manual override — **wins**) → `RELAY_URL`
(activation-written) → default. Activation deliberately does **not** write `INGEST_URL`, so it can
never clobber an operator's override. Regression tests
(`TestActivationStreamConfigContract`) assert the pair **and the precedence** on comment-stripped
code — with a mutation test proving the guard isn't reading prose.

### 3. Activation success without persistence — CONFIRMED, FIXED
`_write_config()` no-opped with a warning when no `factorylm.properties` existed; `doPost()`
returned `"activated"` anyway. Clean gateway: code consumed, nothing persisted, no visible error.

Fix: `_write_config()` now (a) updates an existing file in place, (b) **creates** the file under
the first Ignition data dir present on the install when none exists, (c) returns `True` only when
the value reached disk. `doPost()` returns an explicit **500** carrying the tenant id and a
configure-manually pointer when persistence failed. Three new tests in
`TestConnectActivationPersistence`: clean-gateway create, no-writable-location 500, and in-place
update writing exactly `MIRA_TENANT_ID` + `TENANT_ID` + `RELAY_URL` (and never `INGEST_URL`).

### 4. `-Force` overwrite nests instead of replacing — CONFIRMED (reproduced live), FIXED
Repro: `Copy-Item src -Destination existing-dst -Recurse -Force` produced `dst\src\new.txt` and
left `dst\stale.txt` in place. Fix: after the backup succeeds, the destination is removed
(`Remove-Item -LiteralPath $ProjectDst -Recurse -Force`, with the resolved path printed first),
then the copy recreates it clean. Test pins **backup → remove → copy** ordering on
comment-stripped script text.

### 5. Jython source-encoding risk — CONFIRMED, ELIMINATED via PEP 263
Verified: all 13 deployed artifacts contain non-ASCII UTF-8 (comments *and* string literals), and
the only module proven running on the bench gateway (`ConvSimpleLive/mira_diagnose/code.py`) is
pure ASCII — so there was **no live evidence** undeclared UTF-8 parses under Jython 2.7.

Fix (the review's middle option): every emitted artifact carries `# -*- coding: utf-8 -*-` in a
PEP 263-valid position — **line 1** for script-library modules, **first line inside the def**
(= file line 2) for handler bodies, the only placement compatible with the def-first rule (a
line-1 comment would resurrect the silent HTTP-200-empty-body failure). Harmless if Ignition
compiles already-decoded strings; load-bearing if it ever compiles bytes. ASCII-only
transliteration was rejected because non-ASCII appears in string literals (changing them changes
runtime output). `TestEncodingSafety` asserts every deployed `.py` decodes as UTF-8 and declares
its encoding within the first two lines, and that handler line 1 is still the `def`.

## Verification (the review's block, executed)

- `git merge --no-commit --no-ff origin/main` → `Already up to date` (then aborted)
- `tests/ignition` + `tests/regime7_ignition` (full) → **242 passed** (11 new this round)
- `tests/test_architecture.py` → passed (included in the 159-test minimal block run)
- `ruff check` → clean on every touched file (8 pre-existing findings in two untouched files
  (`test_diagnose_endpoint.py`, `test_gateway_scripts.py`) left alone — not this PR's)
- `git diff --check` → clean
- `deploy_ignition.ps1` → `Parser::ParseFile` 0 errors, pure ASCII
- GitHub: `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`, 27/27 checks green

## Constraints honoured

- Not merged — that remains Mike's call.
- No live-gateway deployment performed this round.
- PLC logic, CCW projects, fieldbus write paths, production secrets: untouched.
- One focused hardening update; the adapter's fail-closed/read-only behaviour unchanged.

## Honest residuals

- Offline tests still cannot prove the nine converted handlers end-to-end on a gateway (CPython
  always defines `__file__`). The post-merge step remains:
  `deploy_ignition.ps1 -ProjectName MiraDeployTest` as Administrator → hit
  `/system/webdev/MiraDeployTest/FactoryLM/api/status` + one POST endpoint → delete the scratch
  project. Needs Mike's explicit approval per the review's constraint.
- The PEP 263 cookie is correct under both possible platform behaviours but which behaviour
  Ignition 8.3 actually has (string vs bytes compile) remains unobserved; the scratch-project
  deploy settles it as a side effect, since every deployed artifact is non-ASCII.
