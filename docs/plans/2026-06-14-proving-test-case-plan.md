# Proving Test-Case Plan — MIRA Diagnostic Validation toward Go-to-Market

**Date:** 2026-06-14
**Status:** Active plan (just unblocked by the Conv_Simple_2.1 flash — live torque/rpm/power/fault telemetry now flows)
**One-liner:** Prove "text your factory, AI tells you what's wrong" with hard evidence — on real hardware AND on a deterministic benchmark — then package that evidence as the demo + beta proof.

---

## 0. What "proven" means (success definition)

MIRA is proven for go-to-market when, with **no human pre-staging the answer**, the chain holds:

> a fault occurs → it is **detected** (anomaly engine) → MIRA **diagnoses** it with a **grounded, cited** answer (root cause + next check, citing the GS10 manual / fixture doc) → the answer is **validated** (rubric / human Good) → the asset reaches **approved** (train-before-deploy) → the same flow runs from a **phone** (the demo).

Two proving grounds, deliberately:

| Ground | What it proves | Why it's not enough alone |
|---|---|---|
| **Live GS10 bench** (`Conv_Simple_2.1` + `plc/conv_simple_anomaly/`) | MIRA works on **real hardware, real Modbus, real drive faults** — credibility | one machine, few fault types, slow to exercise |
| **SimLab** (`simlab/` juice bottling line, 6 scenarios + rubrics) | MIRA's **diagnostic reasoning at scale** — root-cause, doc-grounding, UNS, multi-machine propagation, deterministic CI | simulated; a skeptic asks "but does it work on real iron?" |

The bench answers "is it real?"; SimLab answers "is it reliable?". Go-to-market needs both.

---

## 1. Phase 0 — Golden baseline (DONE, formalize it)

We have the healthy 30 Hz run: `torque 66–77 %`, `rpm 878` (= keypad 880), `power ~0` (unloaded), `freq cmd 30 vs out 30.57 ≈ 1:1`, `DC-bus 319 V`, `current 0.56 A`, 26/26 tags `good`.

**Build:**
- `tests/bench/golden_conv_simple_healthy.json` — captured nominal ranges per tag (the `live_capture.py` summary, frozen). Every anomaly test asserts a deviation **from this baseline**, not a magic number.
- Pin `DEFAULT_CFG` bench thresholds in `rules.py` against this run (the starred CONFIRM values: `motor_fla_a`, `dc_bus_lo/hi_v`, `torque_hi_pct`). `motor_fla_a=5.0` vs measured 0.56 A unloaded — confirm against the **nameplate FLA**, not the unloaded draw.

**Acceptance:** `verify_v2_telemetry.py` passes; baseline JSON committed; `rules.evaluate(baseline_snapshot)` returns **zero anomalies** (healthy = silent).

---

## 2. Phase 1 — Bench anomaly-engine proving (rules A0–A12)

The engine (`plc/conv_simple_anomaly/rules.py`) has 12 pure-function rules. Prove every one fires correctly, with the right severity + evidence, and stays silent on the healthy baseline (no false positives).

**Precondition (build item):** the anomaly engine reads the **`live-plc-bridge`** UNS topics. The V2.1 flash exposed `fault_code` (400119), `freq_setpoint`/`freq_cmd` (400121), etc. — **wire these new registers into `plc/live-plc-bridge/bridge.py`'s HR map** (mirror what the historian's `live_logger.py` HR_SPECS already does) so `vfd/vfd101/fault_code`, `/freq_setpoint` publish. Until then A2/A7/A12 degrade silently (`snap.get → None`). This is the single gate that unblocks the most rules.

### Tier 1 — physical fault injection (safe; real end-to-end proof)
These are inducible on the bench without LOTO or damage. Each is a golden case.

| Rule | Fault | How to inject (safe) | Assert |
|---|---|---|---|
| **A0** OFFLINE | no fresh data | unplug Ethernet/Modbus (you already did this!) or stop the bridge | A0 CRITICAL after `offline_s=30` |
| **A1** COMM_STALE | RS-485 down | unplug the PLC↔GS10 RS-485 lead | A1 CRITICAL, `comm_ok=False`, downstream values trust-gated |
| **A2** VFD_FAULT | GS10 trips | induce **CE10 (Modbus timeout)** by pulling RS-485 >5 s (the drive's own `P09.03` timeout), or **oL** by loading the belt | A2 fires, decodes code→name via `GS10_FAULT_CODES`, severity per `_GS10_CRITICAL` |
| **A4** DIRECTION | FWD+REV both | flip both direction inputs | A4 MED; PLC commands STOP (`cmd_word=1`) |
| **A7** FREQ_NOT_TRACKING | can't hold speed | add mechanical drag / load so output Hz lags setpoint > `freq_track_tol_hz=3` | A7 MED after `freq_track_grace_s` |
| **A12** PHOTOEYE_JAM | beam blocked | block the photo-eye (DI_05) once `pe_latched` publishes | A12 HIGH |

### Tier 2 — synthetic snapshot replay (the dangerous faults — never physically induced)
`rules.evaluate(snap, derived, cfg)` is a pure function. Feed crafted snapshots for the faults we must NOT physically create. Fully offline, runs in CI.

| Rule | Fault | Synthetic snapshot |
|---|---|---|
| **A3** ESTOP_WIRING | dual-channel mismatch | `DI_02 == DI_03` (both True) or `wiring=True` |
| **A5** ILLEGAL_RUN | running while unsafe | `running=True` + (`estop=True` \| `contactor=False`) |
| **A6** NOT_RESPONDING | RUN cmd, no motion | `cmd_word∈{18,34}`, `running=False`, `cmd_run_for_s≥grace` |
| **A8** OVERCURRENT | over FLA | `current_a > motor_fla_a` |
| **A9** DC_BUS | over/under-volt | `dc_bus_v` outside `[250,410]` |
| **A10** FREQ_STUCK_ZERO | output stuck 0 | RUN cmd, `freq≈0`, `cmd_run_for_s≥5` |

**Build:**
- `tests/bench/test_anomaly_rules.py` — one parametrized test per rule: a triggering snapshot (asserts fires, correct `rule_id`/`severity`/evidence) + a near-miss snapshot (asserts silent). The near-miss is the anti-false-positive guard (e.g., steady non-zero Hz must NOT trip A10).
- `tests/bench/replay/*.jsonl` — for Tier-1 faults, **record the real `live_capture` stream during injection** so each physical fault becomes a replayable regression fixture (so we don't re-induce hardware faults every CI run; we induce once, capture, replay forever).

**Acceptance:** all 12 rules fire on their trigger + stay silent on baseline and near-miss; ≥6 backed by a real recorded bench injection (not just synthetic).

---

## 3. Phase 2 — Anomaly → MIRA grounded diagnosis (the product promise)

Detection isn't the product; **diagnosis** is. For each anomaly, route it to the real Supervisor (`mira-bots/shared/engine.py`) and assert MIRA returns a **grounded, cited** answer — root cause + next check — citing the GS10 manual page for the fault, not generic knowledge.

- Input: the `Anomaly` (rule_id, evidence, components) + the live snapshot, over a **direct-connection** surface (the bridge → `source="direct_connection"`, UNS-certified — no chat gate; per `.claude/rules/direct-connection-uns-certified.md`).
- Assert: answer names the **correct asset/UNS path**, cites the GS10 fault entry (e.g., CE10 → Modbus timeout → "check RS-485 wiring/termination, P09.03 timeout"), gives a concrete next check, and scores **groundedness ≥ 4/5** (`citation_compliance.py` + engine scorer). No invented fault meanings.
- **Anti-hallucination:** run `/mira-run-hallucination-audit` over the bench diagnosis path; assert no troubleshooting begins without the certified UNS context, no fabricated tag meanings.

**Build:**
- `tests/bench/test_anomaly_to_diagnosis.py` (real Supervisor, Doppler-gated, not default CI — like `tests/simlab/runner.py`).
- Add each bench fault as a **golden case** in `tests/golden_factorylm.csv` (per the testing-expectations rule: new troubleshooting feature → golden case).
- Grounding source: `plc/GS10_Integration_Guide.md` + the GS10 manual ingested to the KB so MIRA can cite a page.

**Acceptance:** every Tier-1 fault yields a cited, ≥4/5-grounded diagnosis naming the right cause + next check; hallucination audit clean.

---

## 4. Phase 3 — SimLab eval (reliability at scale)

Run the six scenarios (A–F) against the **real Supervisor** via `tests/simlab/runner.py`, plus the deterministic rubric grader (`simlab.diagnostic.grade`) for no-LLM CI.

| Scenario | Proves |
|---|---|
| A Filler underfill (low bowl pressure) | single-asset root cause + doc citation (`filler01/troubleshooting.md`) |
| B Capper torque deviation | quality-reject correlation → mechanical cause |
| C Labeler registration drift | trend-based (tension/registration) reasoning |
| D Case-packer jam → line slowdown | **multi-machine propagation to single root cause** (accumulation backup) |
| E Palletizer unavailable → cases back up | E-stop root cause vs downstream symptoms |
| F Low plant air → multi-machine symptoms | **utility root cause** behind many faults (hardest) |

Assert per scenario (the README's "What MIRA Must Prove"): correct **root-cause asset+fault**, correct **doc citation by name**, correct **canonical UNS path** (not free-form), and the **train-before-deploy** lifecycle reaches `approved` only after a Good-marked cited answer.

**Build:** SimLab tests already exist (`tests/simlab/`, 10 modules). Add a **scorecard runner** that runs all 6 against the live cascade, emits a pass/fail + groundedness table, and gates on D/E/F (the propagation scenarios — the ones that prove "root cause, not symptom-spam").

**Acceptance:** ≥5/6 scenarios pass the rubric AND produce cited grounded answers via the real Supervisor; D & E & F (propagation) must be in the passing set.

---

## 5. Phase 4 — Train-before-deploy + beta gate tie-in

The proving plan **is** the train-before-deploy evidence for the GS10 asset:
- Asset `kg_entities` row → `verified`; GS10 manual chunks grounded to its UNS subtree (closes the upload→retrieval gap — the beta gate, PR #1592).
- Bench validation questions ("why did the belt stop?", "what's CE10?", "is the drive faulted?") answered with cited ≥4/5 answers a human marks **Good**.
- Record `asset_agent_status='approved'` (`approved_by`) → only then is the GS10 "deployable" to an HMI/Ask-MIRA surface (`.claude/rules/train-before-deploy.md`).
- **Beta-gate dovetail:** the GS10 manual is the "stranger uploads a manual → cited answer" proof. The bench fault Q&A is exactly `tests/beta/beta_ready_upload_retrieval_citation.py` made concrete on real iron.

---

## 6. Phase 5 — Go-to-market demo assembly

Package the evidence as the demo ("text your factory"):
1. Phone → Telegram/Slack → MIRA, asking about the live bench → **direct-connection** certified answer (no gate), cited.
2. Induce a **safe** live fault (pull RS-485 → CE10), text "what's wrong with the conveyor?" → MIRA: "GS10 CE10 Modbus timeout on `enterprise…conv…`, RS-485 link down — check termination/wiring, P09.03" with citation. **Live, on real hardware, in front of the room.**
3. SimLab scorecard as the "and it does this across a whole bottling line" slide (6 scenarios, rubric pass-rate).
4. Screenshot rule: capture each step to `docs/promo-screenshots/` (desktop + mobile) for the video pipeline.

---

## 7. Sequencing (what to build, in order)

1. **Phase 0** baseline JSON + threshold confirm *(small; do first — everything asserts against it)*.
2. **Bridge wiring** — add the V2.1 registers to `live-plc-bridge` *(the gate that unblocks A2/A7/A12)*.
3. **Phase 1 Tier-2** `test_anomaly_rules.py` *(pure-function, offline, buildable today — no bench needed)*.
4. **Phase 1 Tier-1** record real injections during a bench session → replay fixtures.
5. **Phase 2** anomaly→diagnosis golden cases + GS10 manual ingest.
6. **Phase 3** SimLab scorecard runner.
7. **Phase 4/5** approval record + demo capture.

**Fastest first proof (do today, no hardware):** Phase 0 baseline + Phase 1 Tier-2 `test_anomaly_rules.py`. It turns the 12 rules from "trust me" into a green, regression-locked suite — the foundation everything else builds on.

---

## 8. Risks / open items
- **rpm signed-on-reverse** (~65249 = −287): fix the trend viewer to read `vfd_motor_rpm` as signed int16 before it pollutes A7/anomaly logic in REV.
- **`motor_fla_a` threshold**: 5.0 A is a guess; confirm vs nameplate or A8 mis-fires / never fires.
- **Bridge ≠ historian**: two separate readers of the PLC; keep their HR maps in sync (the anomaly engine reads the bridge; the logger reads its own).
- **Real-Supervisor tests are Doppler-gated** (cascade credentials), off default CI — same pattern as `tests/simlab/runner.py`.
- **Unloaded bench** → power ~0 and low current; load-dependent rules (A8 overcurrent, A7 under load) need a real load to exercise physically — else Tier-2 synthetic only.

## 9. Cross-references
- `plc/conv_simple_anomaly/rules.py` — the 12 rules (A0–A12) + GS10 fault table
- `plc/conv_simple_anomaly/{live_capture,verify_v2_telemetry}.py` — capture + acceptance tools (this session)
- `.claude/skills/plc-ccw-deploy/SKILL.md` — the deploy workflow that got us here
- `docs/simlab/README.md` — SimLab benchmark (6 scenarios, rubrics, runner)
- `tests/simlab/runner.py` — real-Supervisor SimLab harness
- `.claude/rules/direct-connection-uns-certified.md` — bench → engine surface contract
- `docs/plans/2026-06-07-path-to-beta.md` — the beta gate this feeds
