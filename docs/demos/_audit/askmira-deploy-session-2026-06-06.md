# AskMira Deploy Session — 2026-06-06

**Branch context:** `docs/askmira-ignition-deploy-handoff-2026-06-06` (travel laptop)
**Goal source:** `docs/wip/2026-06-06-askmira-ignition-deploy/GOAL.md`

## Gate Progress

| Gate | Status | Evidence |
|---|---|---|
| Phase 0 — Webwright install | GREEN (CLI) | `claude plugin marketplace add microsoft/Webwright` + `claude plugin install webwright@webwright` ran from OS shell. `claude plugin list` shows `webwright@webwright v0.1.0 scope:user status:enabled`. `claude plugin details` shows 3 skills (craft, run, webwright). F4-F6 smoke deferred per goal — skills load on next Claude Code session. |
| 1 — Close PR #1620 | GREEN | `gh pr close 1620` — "✓ Closed pull request Mikecranesync/MIRA#1620". 14:14 UTC. |
| 2 — Auth contract + Doppler | GREEN | `ASK_API_KEY` + `X-Mira-Key` confirmed on `main` and `feat/ask-uns-gate-state` branches. Gate is OPTIONAL (only enforced when env set). AskMira `view.json` Gateway script sends `X-Mira-Key:""` intentionally per inline comment "set ASK_API_KEY both ends to enable". No Doppler change required for demo. PR #1746 audit's `MIRA_IGNITION_HMAC_KEY` claim is stale vs current code. |
| 3 — Deploy to Gateway | PENDING | Needs Mike's hands — Designer Launcher login OR PR #24 merge + elevated APPLY.ps1 at bench. MIRA_PLC#24 patched APPLY.ps1 + added resource.json to close the script gap. |
| 4 — Backend smoke `POST /ask` | GREEN | See § Smoke Run below. |
| 5 — 10-question re-test, R1-R6 | PARTIAL (pre-bake) | `askmira-rerun-engine-prebake-2026-06-06.md` — 10 representative diagnostic questions hit `/ask` directly. R1/R2/R3/R4 FIXED vs 2026-06-01 baseline; R5 bimodal (2 s instructional / 50 s grounded); R6 6/6 grounded with sources, 0/4 instructional fallbacks (KB-gap admissions). Official Gate 5 awaits Mike's verbatim 10 Q via Webwright + view. |
| 6 — CHANGELOG entry | PENDING | After Gate 5 official. |

## Smoke Run (Gate 4)

**Endpoint resolved:** `http://100.68.120.99:8011/ask` (NOT the GOAL.md-documented Gateway WebDev path).
- Tailscale `100.68.120.99` = `factorylm-prod` (linux). The ask_api container runs on the prod VPS, not the PLC laptop. Gateway-side `view.json` POSTs Tailscale-direct.

**Health probe** — 14:15 UTC:
```
GET http://100.68.120.99:8011/health  →  {"status":"ok","platform":"ignition"}
```

**Smoke POST** — 14:22 UTC, 39 s elapsed:
```bash
curl -X POST http://100.68.120.99:8011/ask \
  -H "Content-Type: application/json" \
  -d '{
    "question": "current status?",
    "tags": {
      "vfd_fault_code": 14,
      "vfd_comm_ok": 0,
      "e_stop": 1,
      "mlc": 0,
      "vfd_frequency": 0,
      "pe_latched": 0,
      "pe_beam": 1
    },
    "session_id": "00000000-0000-0000-0000-000000000010"
  }'
```

Response:
```json
{"answer":"The current status of the garage conveyor belt is in a fault state with an unmapped fault code 14. The variable frequency drive (VFD) communications are lost, and the emergency stop is armed and okay. The main line contactor is open, and the VFD output is 0.0 hertz, indicating the conveyor belt is not running. The photo-eye is blocked, and the PE-01 beam is blocked. To resolve the issue, check the VFD communications and wiring, and ensure the Modbus connection is stable [Source: AutomationDirect — Fault Code Table]. If the fault persists, try resetting the VFD by writing 2 to register 0x2002 or by pressing the STOP/RESET button on the keypad [Source: AutomationDirect GS10]. Additionally, verify the emergency stop and photo-eye wiring, and ensure the conveyor belt is clear of any obstructions."}
```

**Regression-signal pre-check (single sample, NOT the full 10-question re-test):**

| Signal | Observation |
|---|---|
| R1 chain-of-thought leak | NO `1. Yes 2. No 3. Unknown 4. Not specified` pattern. PASS for this sample. |
| R2 multi-vendor salad | Citations: "AutomationDirect — Fault Code Table", "AutomationDirect GS10". Single vendor. PASS. |
| R3 fault tunnel-vision | Question was a status query → fault-centred answer is appropriate, not tunnel-vision. Defer judgement until non-fault questions tested. |
| R4 E-stop visibility | "emergency stop is armed and okay" — reflected. PASS. |
| R5 latency <15 s | **39 s** — exceeds threshold. Gemini-cascade + grounded RAG at this sample point. Mike's view.json `httpClient(timeout=95000)` accommodates this. Real R5 metric is over the 10-question replay median, not a single hit. |
| R6 sources populated | 2 inline `[Source: ...]` citations. PASS. |

## Deploy-route Decision (Action 4)

| Option | Viable? | Notes |
|---|---|---|
| (a) RDP `mstsc /v:100.72.2.99` | NO | Windows password unrecoverable. |
| (b) Designer Launcher → Gateway admin login | **YES (Mike's hands)** | Gateway `http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive` returns 200 from travel laptop — gateway reachable. Mike opens Designer Launcher, connects, imports AskMira view. |
| (c) APPLY.ps1 via Gateway Script Console | PARTIAL | Script Console runs Jython in Gateway scope but file writes to `C:\Program Files\...` need admin. May not work without elevation. |
| (d) Physical PLC-laptop access | DEFERRED | Mike not on-site. |
| **(e) NEW — Patched APPLY.ps1, run elevated locally on PLC laptop** | **YES (Mike's hands)** | Requires Mike to RDP into local PLC laptop console at the bench OR to reset Windows password. Cleanest path if Mike returns to bench. |

**Picked route:** (b) Designer Launcher. Open AskMira `view.json` from local clone of MIRA_PLC `feat/ask-mira-ignition-hmi` branch, paste/import into the gateway-side `ConvSimpleLive` project, save.

## Agent-side Artifacts Produced

1. PR Mikecranesync/MIRA#1620 closed.
2. This audit file.
3. PR Mikecranesync/MIRA_PLC#24 — `fix(deploy): APPLY.ps1 ships AskMira view + creates new view folders`. Adds AskMira view + sibling `resource.json` to `$pairs`, replaces skip-if-missing with create-parent-and-copy. Mike's optional elevated path; the Designer Launcher recipe still works independently.
4. `docs/wip/2026-06-06-askmira-ignition-deploy/DEPLOY-RECIPE.md` — Designer Launcher recipe with `view.json` embedded inline (no git checkout required).
5. `docs/wip/2026-06-06-askmira-ignition-deploy/webwright-rerun.spec.ts` — Playwright spec scaffold for the 10-question re-test. Mike fills `QUESTIONS[]` from his 2026-06-01 transcript. Runs unchanged under Webwright once Phase 0 install completes.
6. `docs/demos/_audit/askmira-rerun-2026-06-06.md` — re-test report template with R1–R6 table.
7. (Pending) Webwright availability note appended to `GOAL.md` once Phase 0 succeeds.

## Mike's Next Hands-on Actions (in order)

1. **Webwright install** — type in Claude Code chat:
   ```
   /plugin marketplace add microsoft/Webwright
   /plugin install webwright@webwright
   ```
   Restart Claude Code. Verify `claude plugin list | grep webwright`.

2. **Deploy AskMira view via Designer Launcher:**
   - Launch `C:\Program Files\Inductive Automation\Designer Launcher\designerlauncher.exe`
   - Connect to `http://100.72.2.99:8088` (Gateway admin login).
   - In Project Browser → `ConvSimpleLive` → Perspective → Views → right-click → New Folder `AskMira`.
   - File contents to paste come from `MIRA_PLC/ignition/ConvSimpleLive/views/AskMira/view.json` on `feat/ask-mira-ignition-hmi` branch.
   - Save project. Verify `http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive/AskMira` renders.

3. **Run 10-question re-test** with Webwright once installed. Save report as `docs/demos/_audit/askmira-rerun-2026-06-06.md`.

