# GOAL — Ship Ignition "Ask MIRA" Panel To Demo-Ready

**Created:** 2026-06-06
**Authoring session:** Conversation with Mike on travel laptop, after two failed test runs (2026-06-01) and one wrong-stack PR attempt.
**Status:** Not started. Hand this file to a fresh `/goal` session.

---

## Mission

Make the Ignition "Ask MIRA" panel on the PMC-station Garage Conveyor work end-to-end against the **official** mira-bots/ask_api backend, with the demo-readiness regressions from 2026-06-01 closed and a clean re-test report attached.

The prior cutover attempt (PR Mikecranesync/MIRA#1620, branch `feat/ignition-chat-mira-pipeline-cutover`) targeted the WRONG stack — mira-pipeline `/v1/chat/completions` via `ignition/webdev/FactoryLM/api/chat/doPost.py` in the MIRA repo. Close that PR; do not build on it.

The OFFICIAL stack is:

- **Backend HTTP:** `mira-bots/ask_api/app.py` → `POST /ask` (port 8011). Uses `Supervisor.process()` directly. Auth via `X-Mira-Key` header reading `ASK_API_KEY` env (header/var name may have changed on the active branch — verify per § Reading List).
- **Ignition project:** `MIRA_PLC` repo, branch `feat/ask-mira-ignition-hmi`, project `ignition/ConvSimpleLive/`, view `ConvSimpleLive/views/AskMira/`.
- **Deploy script:** `MIRA_PLC/ignition/ConvSimpleLive/APPLY_ASKMIRA.ps1` (elevated PowerShell, 95s Gateway timeout).
- **Rollback artifact:** `MIRA_PLC/ignition/ConvSimpleLive/rollbacks/Conveyor_v6_ask-mira_20260531.json`.

---

## Required Reading (in this order, before any edit)

### Repo-internal docs

| # | Path / URL | Why |
|---|---|---|
| 1 | `CLAUDE.md` (repo root, MIRA) | Build state, hard constraints, environment doctrine. |
| 2 | `.claude/CLAUDE.md` (MIRA) | Product rules, UNS gate non-negotiable. |
| 3 | `.claude/rules/uns-confirmation-gate.md` | The gate behavior the AskMira view's Yes/No confirm panel renders. |
| 4 | `.claude/rules/karpathy-principles.md` | Behavioral discipline. |
| 5 | `docs/THEORY_OF_OPERATIONS.md` | Primary doctrine. |
| 6 | `docs/environments.md` | Dev / staging / prod separation. |
| 7 | `docs/demos/_audit/ignition-audit.md` (if present on `main`; otherwise on PR #1746's branch) | The demo-readiness audit naming the exact blockers. |
| 8 | `mira-bots/ask_api/app.py` (on `main` AND on the AskMira backend branch) | Current vs in-flight auth/header/response shape. |
| 9 | `mira-bots/ask_api/Dockerfile` | How ask_api is built/served. |
| 10 | `mira-bots/whatsapp/bot.py` | The pattern ask_api mirrors. |
| 11 | `mira-bots/shared/engine.py` (search for `pending_uns_confirm`, `AWAITING_UNS_CONFIRMATION`) | The UNS gate FSM states the new `/ask` response surfaces. |

### MIRA_PLC repo

| # | Path | Why |
|---|---|---|
| 12 | `MIRA_PLC/ignition/ConvSimpleLive/APPLY_ASKMIRA.ps1` (on `feat/ask-mira-ignition-hmi`) | The exact deploy steps for the Gateway. |
| 13 | `MIRA_PLC/ignition/ConvSimpleLive/views/AskMira/view.json` (same branch) | The Perspective view — confirm panel binding to `uns_gate_state`. |
| 14 | `MIRA_PLC/ignition/ConvSimpleLive/views/AskMira/resource.json` (same branch) | Resource manifest. |
| 15 | `MIRA_PLC/ignition/ConvSimpleLive/rollbacks/Conveyor_v6_ask-mira_20260531.json` | Pre-AskMira project state to restore on bail-out. |
| 16 | `MIRA_PLC/ignition/ConvSimpleLive/askmira_browser_verified.png` (same branch) | What "working" looks like in the browser. |

### Pull requests to read

| # | URL | Why |
|---|---|---|
| 17 | https://github.com/Mikecranesync/MIRA/pull/1711 | Adds `uns_gate_state`, `candidate_asset`, `confirmed_asset` to `/ask` response — the contract the AskMira view binds to. **Read body + diff before deploy.** |
| 18 | https://github.com/Mikecranesync/MIRA/pull/1746 | Demo-readiness audit + Ignition AskMira blocker list. |
| 19 | https://github.com/Mikecranesync/MIRA/pull/1700 | Gated read-only live-tag snapshot + ask_api de-dup (merged). |
| 20 | https://github.com/Mikecranesync/MIRA/pull/1689 | "Exercise the real Ignition chat proxy path" — regression coverage (merged). |
| 21 | https://github.com/Mikecranesync/MIRA/pull/1733 | Removed Rockwell/PowerFlex from clarification template — fixes wrong-vendor citation symptom (merged). |
| 22 | https://github.com/Mikecranesync/MIRA/pull/1717 | General/instructional handlers reset FSM to IDLE — fixes tunnel-vision symptom (merged). |
| 23 | https://github.com/Mikecranesync/MIRA/pull/1718 | Parameter-lookup queries route to instructional → IDLE (open). |
| 24 | https://github.com/Mikecranesync/MIRA/pull/1731 | Guard DST dispatch against IDLE reset in active diagnostic states (merged). |
| 25 | https://github.com/Mikecranesync/MIRA/pull/1750 | Demo-tenant Hub seed (garage conveyor cell) — registers `conveyor_demo` asset (open). |
| 26 | https://github.com/Mikecranesync/MIRA/pull/1620 | **The wrong-stack cutover attempt to be closed.** Do NOT build on it. |

### External user-facing test artifacts

| # | What | Where |
|---|---|---|
| 27 | Run-1 test report (2026-06-01) | In conversation transcript that produced this GOAL.md. Pull verbatim from the user's `/garage-conveyor` test report — captured failure modes per question. |
| 28 | Run-2 test report (2026-06-01) | Same source. Identical symptoms to Run-1 = pre-deploy state. |

---

## Findings From The 2026-06-01 → 2026-06-06 Refresh

1. The legacy `mira-sidecar` (ChromaDB + local Ollama `llama3` 8B) was the backend Ignition still talked to as of the 2026-06-01 tests. Its prompt forced a rigid 7-section format and the small model leaked multiple-choice chain-of-thought into the user-facing answer ("1. Yes 2. No 3. Unknown 4. Not specified"). 20-30s/turn on CPU. This is why Mike's reports looked broken.
2. The MIRA repo `ignition/webdev/FactoryLM/api/chat/doPost.py` on `main` still POSTs to `http://localhost:5000/rag` (legacy sidecar). The cutover was being written in two separate efforts simultaneously:
   - PR #1620 (this session) — wrong stack: `/v1/chat/completions` to `mira-pipeline`. Close.
   - Branch `feat/ask-mira-ignition-hmi` on MIRA_PLC + `mira-bots/ask_api/` on the MIRA repo — right stack: `/ask` direct to `Supervisor.process()`.
3. Several engine-side fixes that address Mike's specific symptoms have already merged to `main` since the test reports (#1717, #1733, #1731, #1700). Re-test against the official path is likely to look very different even before the open PRs (#1711, #1718, #1750) land.
4. The Ignition Gateway runs on the PLC laptop (Tailscale `100.72.2.99`). Mike is in Orlando on the travel laptop. The PLC laptop's Windows password is currently unrecoverable from his end; Tailscale SSH server is not enabled; OpenSSH key auth is not authorized for the travel-laptop key. The only remote path that works without OS login is **Ignition Designer Launcher** at `C:\Program Files\Inductive Automation\Designer Launcher\designerlauncher.exe` connecting to `http://100.72.2.99:8088` using Gateway admin credentials (separate from Windows).
5. RDP (`mstsc /v:100.72.2.99`) launches a window but requires the forgotten Windows password.
6. PR #1746's audit names `MIRA_IGNITION_HMAC_KEY` as the missing Doppler secret. Current `mira-bots/ask_api/app.py:32` on `main` reads `ASK_API_KEY` via `X-Mira-Key`. The active backend branch may have renamed/HMAC-wrapped it — verify from item #8 in the reading list before setting the Doppler value.

7. **Resolved 2026-06-06 (session: `docs/askmira-ignition-deploy-handoff-2026-06-06`):**
   - **Open Q1:** PR #1711 lands AFTER deploy. View.json on `feat/ask-mira-ignition-hmi` does not bind to `uns_gate_state`/`candidate_asset`/`confirmed_asset` — safe to deploy independently.
   - **Open Q3:** Current code (both `main` and PR #1711) uses `ASK_API_KEY` + `X-Mira-Key`. Gate is OPTIONAL. View.json intentionally sends empty key per inline comment. No Doppler change needed. PR #1746's `MIRA_IGNITION_HMAC_KEY` claim is stale.
   - **Endpoint correction:** view.json POSTs Tailscale-direct to `http://100.68.120.99:8011/ask` (`factorylm-prod` VPS), NOT through Gateway WebDev `/system/webdev/ConvSimpleLive/ask`. Gate 4 smoke uses this URL.
   - **APPLY.ps1 correction:** the canonical deploy script is `APPLY.ps1` (not `APPLY_ASKMIRA.ps1`) and on its current `feat/ask-mira-ignition-hmi` HEAD it did NOT deploy AskMira. Closed by MIRA_PLC#24 (adds AskMira pair + resource.json; replaces skip-if-missing with create-parent-and-copy).
   - **Webwright:** Phase 0 install completed via OS CLI (`claude plugin marketplace add` / `claude plugin install`) — works without needing slash commands in chat. Plugin enabled under user scope; skills load on next session start.

---

## Known Blockers (Operational, Not Code)

| # | Blocker | Owner | Resolution |
|---|---|---|---|
| B1 | Doppler `factorylm/prd` missing AskMira auth secret | Mike (Doppler perms) | After reading items #8 and #17 above, set the correct env var name to a fresh random secret. Confirm propagation to running `ask_api` container via `docker exec mira-ask env | grep -i ask`. |
| B2 | AskMira WebDev / Perspective view not deployed to PLC-laptop Gateway | PLC-laptop ops | Run `MIRA_PLC/ignition/ConvSimpleLive/APPLY_ASKMIRA.ps1` on the Gateway host. Falls back to Ignition Designer Launcher if remote shell unavailable. |
| B3 | Travel laptop has no shell access to PLC laptop (Windows password forgotten, Tailscale SSH not enabled, OpenSSH key not authorized) | Mike | Three independent options: (a) Ignition Designer Launcher + Gateway admin login covers most of the deploy without OS shell; (b) recover Windows password (Microsoft account / local recovery); (c) wait until Mike is physically at the PLC laptop to enable `tailscale up --ssh` once. |
| B4 | `conveyor_demo` asset may not be registered in the Hub `kg_entities` → engine's UNS gate will prompt "is this Allen-Bradley PowerFlex 525?" or similar on every fresh question | PR #1750 should fix once merged | Confirm PR #1750 merge before re-testing. If unmerged, the demo path requires a one-time in-chat confirm to advance past the UNS gate. |

---

## Regression Signals To Validate (Re-Test Pass Criteria)

After deploy succeeds, replay the **10 questions from the Mike 2026-06-01 test reports** against the live PMC Garage Conveyor (E-STOP: ARMED, MLC: OPEN, COMM X active fault, motor stopped) and check:

| # | Symptom from prior runs | Pass criterion |
|---|---|---|
| R1 | Chain-of-thought leak in every reply (`1. Yes 2. No 3. Unknown 4. Not specified`) | The literal pattern does NOT appear in any of the 10 replies. |
| R2 | Multi-vendor citation salad (PowerFlex 525 + ABB ACS355 + Yaskawa GA500 all cited for the same drive) | Citations match a single vendor (whichever the demo seed registers for `conveyor_demo`) or the engine says "no docs for this asset." |
| R3 | Fault tunnel-vision — every question redirected to FC14 / VFD comms lost | PM, lubrication, FLA, normal-Hz, mechanical-belt questions answered on their own merits (parameter / instructional path), not anchored to active fault. |
| R4 | E-STOP: ARMED visible on HMI but ignored by MIRA | E-stop status reflected in MIRA reply when asked, OR MIRA explicitly states it does not have the E-stop tag. |
| R5 | Latency 20-30 s per reply | Median latency under 15 s. |
| R6 | Sources panel empty / wrong | Sources panel populated with at least one cited document per substantive reply. |

Capture the re-test as `docs/demos/_audit/askmira-rerun-YYYY-MM-DD.md` with one section per question + a final summary table mirroring the above.

---

## DONE-WHEN (Hard Gates, In Order)

1. **PR #1620 closed** with a comment redirecting to `feat/ask-mira-ignition-hmi` (MIRA_PLC) + PR #1711 (MIRA).
2. **Auth secret correct.** The exact env var name read by the active `ask_api` branch is verified, the secret is set in Doppler `factorylm/prd`, and `docker exec` on the running ask_api container shows it present + non-empty.
3. **AskMira deployed.** `APPLY_ASKMIRA.ps1` (or its Designer-driven equivalent) has run on the PLC-laptop Gateway, the project rescan log shows no errors, and `http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive/...` reaches the AskMira view in a browser.
4. **Backend smoke green.** From travel laptop:
   ```
   curl -X POST http://100.72.2.99:8088/system/webdev/ConvSimpleLive/ask \
        -H "Content-Type: application/json" \
        -H "X-Mira-Key: $SECRET" \
        -d '{"question":"current status?","tags":{...sample tag block...},"session_id":"00000000-0000-0000-0000-000000000001"}'
   ```
   returns HTTP 200 + JSON containing keys `answer` AND (if PR #1711 merged) `uns_gate_state`, `candidate_asset`, `confirmed_asset`.
5. **Re-test passes.** All six regression signals (R1-R6) above flip green across the 10-question replay. Report saved to `docs/demos/_audit/askmira-rerun-YYYY-MM-DD.md`.
6. **PR #1620 stays closed** (no resurrection) and a one-line entry in `docs/CHANGELOG.md` (or its successor) records the official cutover landing.

---

## Guardrails

- **Don't paste prod Doppler values into a dev shell.** Use `Set-Clipboard`, `doppler run`, or write directly to a file owned by the Gateway process.
- **Don't touch `mira-pipeline /v1/chat/completions`** for this work. Wrong stack.
- **Don't modify the MIRA repo `ignition/webdev/FactoryLM/api/chat/doPost.py`** from PR #1620. Superseded.
- **Don't redirect the Gateway-side `/ask` proxy at the staging or prod VPS endpoints** without explicit ops sign-off. The live-tag block is what makes the call useful, and only Gateway-local POSTs see real tags.
- **Don't merge PR #1711 mid-deploy without re-checking** the AskMira view's binding shape — the view consumes the new response keys.
- **Prod-guard.sh** is wired as a PreToolUse hook (`.claude/settings.json` in MIRA). Override only with explicit `MIRA_ALLOW_PROD=1` per-shell, and only after confirming the action is actually targeting prod and not staging.
- **Never auto-merge a PR.** Mike approves manually.
- **Don't claim a DONE-WHEN gate green without command output captured in the session log.** "No error" is NOT verification — read the response body, the container env, the browser screenshot, or the test row.

---

## First Four Actions (In Order)

1. **Close PR #1620.**
   ```
   gh pr close 1620 --comment "Superseded by feat/ask-mira-ignition-hmi (MIRA_PLC) + PR #1711 (mira-bots/ask_api/). See docs/wip/2026-06-06-askmira-ignition-deploy/GOAL.md for the official path."
   ```

2. **Read the deploy script + auth contract on the active branches.**
   ```
   cd C:/Users/hharp/Documents/MIRA_PLC
   git fetch origin
   git checkout feat/ask-mira-ignition-hmi
   cat ignition/ConvSimpleLive/APPLY_ASKMIRA.ps1
   cat ignition/ConvSimpleLive/views/AskMira/view.json | head -200
   ```
   ```
   cd C:/Users/hharp/Documents/MIRA
   git fetch origin
   # find the most recent ask_api branch/PR
   gh pr list --search "ask_api in:title,body" --state all --limit 10
   ```
   Grep for the exact env var + header name in the chosen branch.

3. **Audit Doppler factorylm/prd.**
   ```
   doppler secrets --project factorylm --config prd --only-names | findstr /i "mira ignition ask hmac"
   ```
   Decide: set missing secret, rename a typo'd one, or leave alone if already correct. **Do not echo secret values to stdout.**

4. **Pick a deploy route.** RDP first (`mstsc /v:100.72.2.99` — needs Windows password). If blocked, Designer Launcher (`& "C:\Program Files\Inductive Automation\Designer Launcher\designerlauncher.exe"`) → connect to `http://100.72.2.99:8088` → Gateway admin login. If the `APPLY_ASKMIRA.ps1` deploy steps can be reproduced inside a Gateway-scope Script Console (file writes + project rescan), do that. Otherwise escalate to physical PLC-laptop access.

After action 4 finishes, report back. The remaining four DONE-WHEN gates depend on which deploy route is viable.

---

## Rollback Plan

| Layer | How to back out |
|---|---|
| Doppler secret | `doppler secrets set <NAME>=""` in `factorylm/prd`, then `docker compose restart mira-ask` (or equivalent on whatever node hosts ask_api). |
| Gateway project | Restore `MIRA_PLC/ignition/ConvSimpleLive/rollbacks/Conveyor_v6_ask-mira_20260531.json` via Designer → Import. |
| AskMira view | Delete `ConvSimpleLive/views/AskMira/` in Designer; save project. |
| `/ask` backend | Stop the ask_api container; the legacy sidecar path (still present in `ignition/webdev/FactoryLM/api/chat/doPost.py` on `main`) remains the fallback iframe surface. |

---

## Open Questions To Confirm Early

- Q1: Does PR #1711 land before or after this deploy? If after, the AskMira view may already be coded to expect the new response keys — verify by reading `views/AskMira/view.json` (item #13).
- Q2: Does PR #1750 (demo-tenant seed) need to land before re-test, or will an unregistered `conveyor_demo` asset confirm-flow be acceptable for the demo?
- Q3: Which Doppler env var name is current — `ASK_API_KEY` (on `main`) or `MIRA_IGNITION_HMAC_KEY` (per audit PR #1746)? Pick one and reconcile in the same PR if they disagree.

---

## Out Of Scope For This Goal

- The wider 90-day MVP + marketplace plan (`docs/plans/2026-04-19-mira-90-day-mvp.md`, `~/.claude/plans/dev-api-key-for-optimized-badger.md`).
- Migrating other Ignition projects (`step1_io_check`, etc.) to ask_api.
- Sunsetting mira-sidecar (ADR-0008) — that's a separate, larger cleanup once OEM-doc migration completes.
- Anything in the MIRA `ignition/webdev/` tree from PR #1620.
