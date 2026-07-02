# Discovery Recorder — Litmus↔MIRA garage-conveyor context-model demo

Discovery Recorder pattern (before → build → after) for the weekend demo that proves the
business thesis: **Litmus gets live industrial data out of the machine; MIRA turns that data
into an approved maintenance context model and answers technician questions with evidence.**

Decision that framed this build: **do not block the demo on the internal Litmus read API**
(`loopedge-access :8094`). Use `--source plc` as the canonical live MIRA source; document that
Litmus is collecting the same conveyor data in parallel. Full rationale:
`docs/discovery/litmus_mira_demo_decision.md`.

---

## BEFORE — discovery

### Files inspected
- `plc/litmus/mira_on_litmus.py` — existing raw→rules driver (`--source plc` raw-socket Modbus,
  no deps; `--source litmus` blocked). Reused its dependency-free Modbus read pattern.
- `plc/litmus/provision.py`, `plc/litmus/DEVICEHUB_API.md` (on branch `feat/litmus-micro820-bench`
  / PR #2390) — the VERIFIED 11-register map (7 Holding H + 4 Coil C) and scales.
- `plc/conv_simple_anomaly/rules_core.py` + `rules.py` — the A0–A12 machine-card brain.
  `evaluate(snap, derived, cfg) -> [Anomaly]`; topics `T_RUN`, `T_COMM`, `T_ESTOP`, `T_WIRING`,
  `T_FREQ`, `T_CUR`, `T_DCBUS`, `T_CMD`, `T_FAULT`, …; `run_cmd_values=(18,34)`; `Anomaly.to_dict()`.
- `plc/conv_simple_anomaly/live_check.py` — authoritative `HR_SPECS` scale map
  (106÷100 Hz, 107÷100 A, 108÷10 V, 109÷10 V, 114/117/118 ÷1) + `COIL_TOPICS`.

### Commands run (all read-only)
- `docker ps` / `docker exec le python3` — confirmed container `le` up; minted a loopedge-auth
  token; **device `conv-101` + all 11 registers present**; **PLC 192.168.1.100:502 reachable**.
- Probed `loopedge-access :8094` read API → confirmed it validates a UUID-format `apiKey` header
  against its **own** boltdb store `/var/lib/loopedge-access/access.db` → bucket `ApiKeys`,
  which is **empty**. Auth apikeys are a different store; no CLI/REST/env/boot-sync populates it.
- Live raw Modbus read (host direct-LAN → PLC):
  `HR{106:0,107:0,108:0,109:3215,114:1,117:9472,118:0}`,
  `Coil{0:false,3:true,5:false,9:false}`.

### Current behavior observed
- Litmus **collects** the conveyor at 0 modbus exceptions (live in DeviceHub UI).
- MIRA **contextualizes** the same data via `--source plc` (proven previously).
- Live state = **idle by command**: `cmd_word=1` (STOP), motor stopped, comms healthy,
  DC bus 321.5 V (nominal), no fault, e-stop clear.
- The only unproven hop is the internal `--source litmus` read (deferred — see decision doc).

### Decision made
Build a self-contained, reuse-only demo around `--source plc`:
raw register read → **approved CV-101 context model** maps each register to a named maintenance
signal (scale/unit/component/evidence/approval) → `rules.evaluate()` → grounded technician answer.
Litmus' role in the demo = "it is collecting the same tags in parallel" (shown in its UI), not a
code dependency.

### Code paths to modify / add
- NEW `plc/conv_simple_anomaly/context_model.cv101.json` — the approved context model.
- NEW `plc/conv_simple_anomaly/replay/cv101_*.json` — raw-register replay fixtures (no-PLC mode).
- NEW `plc/litmus/demo_context_model.py` — the demo driver (reuses `rules`).
- NEW `plc/litmus/test_demo_context_model.py` — tests.
- NEW docs: decision, runbook, connector plan (below).

### Tests to add
model loads; required entities/components/signals present; raw→named-signal mapping; scaling/units
applied; the answer **refuses to assert unmapped facts** (photo-eye jam); replay mode works with no
PLC; **no test touches `:8094`**.

---

## AFTER — results

### Files changed (all NEW; no existing code modified)
- `plc/conv_simple_anomaly/context_model.cv101.json` — approved CV-101 context model (11 signals,
  5 components, 2 unmapped, evidence + approval on every mapping).
- `plc/conv_simple_anomaly/replay/cv101_idle_healthy.json` — real captured idle raw snapshot.
- `plc/conv_simple_anomaly/replay/cv101_comm_down.json` — synthetic comm-down fault snapshot.
- `plc/litmus/demo_context_model.py` — the demo driver (reuse-only; stdlib; imports `rules`).
- `plc/litmus/test_demo_context_model.py` — 10 tests.
- `docs/discovery/litmus_mira_demo_decision.md` — the `:8094` decision.
- `docs/demo/garage_conveyor_context_model_demo.md` — weekend runbook.
- `docs/integrations/litmus_supported_connector_plan.md` — future supported connector.
- `docs/discovery/litmus_mira_demo_context_model_build.md` — this note.

### Commands run
- `python -m pytest plc/litmus/test_demo_context_model.py -q` → **10 passed**.
- `python -m pytest plc/conv_simple_anomaly/test_rules.py -q` → unchanged (no regression; only new
  files added).
- `python plc/litmus/demo_context_model.py --source plc` → live: idle-healthy answer, DC bus ~323 V,
  2 declined signals, artifacts written.
- `python plc/litmus/demo_context_model.py --source replay --fixture cv101_comm_down` → A1 CRITICAL,
  stale VFD rules suppressed.

### Test results
10/10 demo tests pass, including: model loads; required components/signals present; raw→named-signal
mapping; scaling (`H@109 3215 → 321.5 V`, `H@106 → 0.0 Hz`, cmd_word stays int); idle answer is
grounded + "not a fault"; **refuses the unmapped photo-eye jam**; comm-down fires A1 CRITICAL and
suppresses stale A2/A9; replay runs with no PLC + writes 4 artifacts; **no `:8094`/`by-device`
functional dependency** in the driver.

### Remaining gap
Direct `--source litmus` read (internal `:8094` + missing supported credential) — deferred; see the
decision doc + connector plan. The demo does not depend on it.
