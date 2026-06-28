# /mira-e2e-laptop-to-cloud

Run the human-like **laptop → cloud** end-to-end (offline contextualizer → Hub knowledge graph)
and iterate toward green: run → on failure, diagnose from the trace/logs → apply a surgical fix →
rerun. **Hard cap: 5 iterations**, then stop and report. Goal = a `kg_entities` row reaches
`verified` on the Hub.

## When to run
- After any change to the offline→Hub flow: the contextualizer CCW parse/export, the Hub
  `/api/contextualization/import` + `parseBundle`, the contextualization pages, Promote, or the
  `/knowledge/suggestions` approve path.
- As a regression check before shipping anything in that chain.

## The goal (success criterion — explicit)
Phase A (offline app, real clicks): create profile → CCW-import `Micro820_v4.1.9_Program.st` +
`MbSrvConf_v4.xml` → accept all signals → export bundle.
Phase B (Hub, real clicks, authed via `storageState`): Import bundle → **new** project with ~100
signals → Promote (assert it reached the knowledge graph) → at `/knowledge/suggestions`, approve the
`SelectorFWD` signal if it's still pending, then **assert it shows under Verified**.
PASS = `B3` green: a real promoted signal is `verified` in the KG.

## Design reality (why it's built this way — don't "fix" these)
- **Shared approved account, not fresh-per-run.** Registration is rate-limited **5/hour per IP**, so a
  new account each run (and each of the 5 retries) is not viable. `playwright@factorylm.com` is already
  onboarded + trial-valid.
- **kg_entities dedup by tag within a tenant** → re-running the same `.st` stages nothing new after the
  first run. So assertions are **idempotent**: A + B1 are genuinely per-run fresh (new bundle, new
  project, ~100 parsed signals); B2 proves Promote *succeeds*; B3 proves the signal is *verified*
  (approving it the first time, asserting verified thereafter).
- **Known blind spot (documented honestly):** on the shared account a Promote that silently staged
  *nothing* but reported "already present" would still pass B2. The per-run-fresh coverage (A, B1) and
  the verified-state check (B3) catch every other regression in the chain. Closing this fully needs an
  isolated tenant (blocked by the register rate limit).

## Pre-flight (once per machine)
- Offline venv runnable: `C:/Users/hharp/Documents/MIRA-pr2068/mira-contextualizer/.venv/Scripts/python.exe`
  (carries `mira_plc_parser` + pdf deps). Override path via `MIRA_CTX_ROOT` / `MIRA_CTX_PYTHON`.
- Playwright Chromium installed (`npx playwright install chromium` if missing — already present here).
- Test account: `E2E_HUB_EMAIL` / `E2E_HUB_PASSWORD` (default `playwright@factorylm.com` /
  `TestPass123`). globalSetup registers it on prod if absent and mints `tests/e2e/.state/hub.json`
  (gitignored — contains a real session cookie; never commit).

## The run command
```bash
cd mira-hub && npx playwright test --config playwright.e2e-laptop-to-cloud.config.ts --reporter=line
```
globalSetup spawns the offline app (reads its OS-assigned port → `tests/e2e/.state/offline.json`) and
mints the Hub session; globalTeardown kills the offline app.

## The loop (max 5 iterations)
1. **Run** the command above.
2. **Pass →** report green + artifact paths. **Done.**
3. **Fail →** open the artifacts for the failing `test.step`:
   - `mira-hub/test-results/laptop-to-cloud/.../trace.zip` — `npx playwright show-trace <path>` (primary).
   - `.../video.webm`, `.../test-failed-1.png`, and `test-results/laptop-to-cloud/console-network.json`.
   Diagnose the root cause of *that* step, then apply a **surgical fix** (selector, timing/wait,
   launcher, or product code — never a broad refactor). Re-typecheck (`bunx tsc --noEmit`).
4. **Rerun.** Increment the counter. Append the iteration's diagnosis + fix to a run log.
5. **After 5 still-red:** STOP. Do **not** loop further. Report the last failing step, every fix
   tried, and the most-likely remaining cause.

## Known-fragile steps (check these first on failure)
| Step | Common cause | Fix shape |
|---|---|---|
| `A2` CCW import | `webkitdirectory` input needs a **directory** path, not file paths | stage files in a temp dir, `setInputFiles(dir)` |
| `A3` accept-all | `decide()` does an async full re-render → detach race | click first, `expect.poll` count strictly decreases, repeat |
| `B1` import | hub base mismatch (`/hub` basePath vs root) or modal selector | confirm `HUB_APP_BASE`; the file input is `input[type=file][accept=".zip"]` |
| `B3` approve | wrong route — it's `/knowledge/suggestions` (`/proposals` redirects); queue sorts by risk first so low-risk signals are deep | testids `suggestion-verify` / `suggestion-card`; page via `proposals-load-more` to find `SelectorFWD`; Pending then Verified tab |

## Constraints
- Runs on a feature branch. Product-code fixes it makes are **committed for review, never
  auto-merged**.
- Never commit `tests/e2e/.state/` (real session cookie) — it's gitignored; keep it that way.
- Hits **prod** (`app.factorylm.com`) under the test account's own tenant — self-contained; never
  touches other tenants. Each green run leaves one project + verified entity in that tenant (benign).

## Files
- Spec: `mira-hub/tests/e2e/laptop-to-cloud.spec.ts`
- Setup/teardown: `mira-hub/tests/e2e/laptop-to-cloud.global{Setup,Teardown}.ts`
- Config: `mira-hub/playwright.e2e-laptop-to-cloud.config.ts`
- Offline launcher: `tools/e2e/launch_contextualizer.py`
- Auth helpers reused: `mira-hub/tests/e2e/fixtures/auth.ts`

## To run as a self-paced loop
`/loop /mira-e2e-laptop-to-cloud` — re-enters this command each cycle until green or 5 iterations.
