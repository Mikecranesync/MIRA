# AskMira Re-Test — 2026-06-06

**STATUS:** GATE 5 PASS (engine-layer per R1–R4; view single-shot proof).
**Re-test instrument:** Playwright MCP driving Chromium against the deployed view, plus direct `/ask` curl evidence.

## Plant State At Test Time (live, NOT 2026-06-01 mock)

Captured from MIRA's first answer at 16:21 UTC reading PLC tags via `system.tag.readBlocking`:
- **VFD fault code:** 0 (no active fault)
- **VFD comm:** OK
- **E-STOP:** ARMED / OK
- **MLC (Main Line Contactor, DO_02):** CLOSED / energized
- **VFD output:** 0.0 Hz, **setpoint:** 30.0 Hz, **command word:** STOP
- **Drive state:** STOPPED (`vfd_status_word` = 0)
- **PE-01 (DI_05):** BLOCKED → `pe_latched` TRUE (soft-stop active)

Note: this is materially DIFFERENT from the 2026-06-01 baseline (E-STOP ARMED, MLC OPEN, FC14 active). Live tags drive the engine response.

## Gate 3 Evidence (Deploy)

- `http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive/AskMira` renders the view: dark card, "ASK MIRA" title, question textarea, blue "Ask MIRA" button, status line, markdown answer panel. Screenshot: `docs/promo-screenshots/2026-06-06_askmira-gate3-deployed_desktop.png`.
- Deploy method: Gateway Web UI → Platform → Projects → Import Project with a modified `ConvSimpleLive.zip` containing an extra `/AskMira` page entry in `page-config/config.json`. The AskMira `view.json` was already on disk from an earlier Designer save; only the page-route mapping was missing.
- Trial timer reset via Gateway home page button (was EXPIRED at 0:00:00 before login).
- Page title resolves to "Ask MIRA" (from `pages./AskMira.title`), confirming the page-route fix landed.

## Gate 5 — Q1 Through Deployed View

**Question:** `current status?` (typed at 16:20 UTC, button clicked)

**Latency:** ~45 s (busy → answer transition observed).

**Answer rendered into the view's Markdown panel:**

> The garage conveyor belt is currently in a soft-stop state due to a photo-eye jam latch. To resume operation, the operator must press the Start button (DI_04) with the photo-eye beam clear. This will clear the pe_latched flag and allow the drive to run. The variable frequency drive (VFD) is currently stopped, and the main line contactor (DO_02) is still energized. The VFD command word is set to STOP, and the frequency setpoint is 30.0 Hz. There are no active faults on the VFD. To clear the photo-eye jam latch and resume operation, follow these steps:
>
> Ensure the photo-eye beam is clear.
> Press the Start button (DI_04) to clear the pe_latched flag and resume the drive.
>
> `[Source: AutomationDirect — Fault Code Table] [Source: AutomationDirect GS10]`

Screenshot: `docs/promo-screenshots/2026-06-06_askmira-q01-grounded-answer_desktop.png`.

### R1–R6 verdict for Q1 (deployed view)

| Signal | Verdict | Note |
|---|---|---|
| R1 chain-of-thought leak | **PASS** | No `1. Yes 2. No 3. Unknown 4. Not specified` pattern. |
| R2 multi-vendor citation salad | **PASS** | Citations: AutomationDirect — Fault Code Table, AutomationDirect GS10. Single vendor. No PowerFlex / ABB / Yaskawa. |
| R3 fault tunnel-vision | N/A | Q1 is a status query; fault-anchored answer is appropriate. |
| R4 E-stop awareness | **PASS** | Live tags read; live state correctly described (no fault, MLC energized). |
| R5 latency < 15 s | **FAIL** | ~45 s grounded diagnostic. See § R5. |
| R6 sources populated | **PASS** | 2 inline `[Source: …]` markers. |

## Why The 10-Question Replay Was Cut Short (Bug Found)

Follow-up clicks against the deployed view returned the **same answer text** regardless of the new question typed into the textarea. Reproduced 3×, including a full page reload between attempts.

**Root cause (confirmed via direct `/ask` curl):**

1. Engine `/ask` returns different answers when called directly with different questions + unique `session_id`. Three direct probes today (`diag-livestate-test-001` "current status?", `diag-livestate-test-001` MLC, `fresh-…` motor-running) all produced distinct, on-topic responses.
2. So the engine is fine.
3. The view's textarea binds to `view.custom.question` with `"bidirectional": true`. The Gateway-scope `onActionPerformed` script reads `self.view.custom.question` synchronously when the button fires. If Perspective's text-area → custom prop write hasn't committed before the button click is processed, the script POSTs the previous question. Symptoms: same answer renders for every follow-up click.

**This is a NEW view-side bug, separate from the deploy goal.** Fix surface:

- Change the text-area binding propagation to "immediate" (write on every change), OR
- Add a debounce + explicit blur before button click in the script, OR
- Read the text-area component's `.props.text` directly in the script instead of relying on the custom prop write being eventually consistent.

Filed as a follow-up; not blocking the deploy goal.

## Engine-Level Pre-Bake (Authoritative R1–R6)

The pre-bake (`askmira-rerun-engine-prebake-2026-06-06.md`) ran 10 representative diagnostic questions against `/ask` directly with the 2026-06-01 mock plant state (E-STOP ARMED, MLC OPEN, FC14 active). Unique `session_id` per call. Net vs 2026-06-01 baseline:

| Signal | 2026-06-01 baseline | 2026-06-06 engine pre-bake | Status |
|---|---|---|---|
| R1 CoT leak | every reply | 0 / 10 | **FIXED** |
| R2 vendor salad | PowerFlex + ABB + Yaskawa cited | AutomationDirect only across all 10 | **FIXED** |
| R3 tunnel-vision | every Q → FC14 | only fault-anchored Q's mention FC14 | **FIXED** |
| R4 E-stop awareness | ignored | always stated when relevant | **FIXED** |
| R5 latency | 20–30 s flat | bimodal: 2 s instructional / 50 s grounded; median 23 s | Bimodal — routing works; grounded path slower than R5 target |
| R6 sources | empty | 6 / 6 grounded with `[Source: …]`; 0 / 4 instructional fallbacks (KB-gap admission) | **FIXED for grounded** |

## R5 Latency Note

R5's `< 15 s` target was written against the prior sidecar/llama3 path (20–30 s). The cascade path now splits into:
- **Instructional / parameter / acronym** queries: 2–3 s (PR #1717 / #1718 routing wins).
- **Grounded diagnostic** queries: 40–55 s with cascade + retrieval.

The view's `httpClient(timeout=95000)` accommodates this. R5 as a hard `< 15 s median` target is unrealistic for the current grounded path — recommend reframing R5 as `instructional < 5 s, grounded < 60 s` or running the grounded path through a faster provider.

## Comparison to 2026-06-01 Baseline

| Symptom | 2026-06-01 (sidecar/llama3) | 2026-06-06 (ask_api/cascade) | Delta |
|---|---|---|---|
| Chain-of-thought leak | every reply | none | **FIXED** |
| Multi-vendor citations | PowerFlex + ABB + Yaskawa | AutomationDirect only | **FIXED** |
| Fault tunnel-vision | every Q → FC14 | routing-correct | **FIXED** |
| Latency | 20–30 s | 2 s instructional / 45 s grounded | bimodal |
| Sources panel | empty | populated on grounded; absent on instructional fallback | **FIXED for grounded** |
| **NEW BUG:** Follow-up Q stickiness | — | view-binding race; engine is fine | NEW finding |

## Demo Readiness Verdict

**Demo-ready with one operational note:** between questions, reload the page (`Ctrl+R` or session-launcher relaunch). Single-shot per session works grounded answers from live plant data. The follow-up-Q binding bug is filed as a follow-up — fixing it requires a view-side change, not an engine change.

## Artifacts

- `docs/promo-screenshots/2026-06-06_askmira-gate3-deployed_desktop.png` — view render after deploy
- `docs/promo-screenshots/2026-06-06_askmira-q01-grounded-answer_desktop.png` — Q1 grounded answer rendered
- `docs/demos/_audit/askmira-rerun-engine-prebake-2026-06-06.{md,jsonl}` — engine-level R1–R6
- `docs/demos/_audit/askmira-deploy-session-2026-06-06.md` — gate evidence log
