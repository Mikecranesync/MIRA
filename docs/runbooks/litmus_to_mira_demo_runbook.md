# Litmus → MIRA Demo Runbook

**Status:** Grounded against the repo on 2026-07-02 (four-agent verification pass). Every claim below
traces to a file or a rule. Where the source PDF (`factorylm_mira_litmus_usage_guide.pdf`) overclaimed,
this runbook corrects it — see **§0 Honest status** and the gap register in
`docs/product/litmus_connector_product_gap.md`.

**Audience:** demo operator (Mike or an implementation helper) and any agent asked to stand up or drive
the bench.

**Doctrine this obeys:** read-only toward OT (`.claude/rules/fieldbus-readonly.md`), the one-pipeline
ingest law (`.claude/rules/one-pipeline-ingest.md`), and numbered read-only safety-railed steps for
PLC/lab work. **No PLC writes. No cloud-to-PLC control.** If a step would write to the PLC or change a
device parameter, STOP and ask.

---

## 0. Honest status — what is proven vs blocked (read this first)

The one-line thesis is true: **Litmus collects the Micro820 conveyor; MIRA sits on top and turns the raw
tag wall into equipment-state + likely-cause + next-check.** But be precise about which hop is proven:

| Hop | Status | Evidence |
|---|---|---|
| Micro820 → **Litmus collects** (DeviceHub, 11 registers, 0 Modbus exceptions, live in UI) | ✅ **Proven** | `docs/RESUME_2026-07-01_litmus-devicehub-bench.md:28` |
| **MIRA contextualizes** the exact conveyor data (A0–A12 rules → grounded diagnosis) | ✅ **Proven** via `--source plc` | `plc/litmus/mira_on_litmus.py`; 10 passing tests |
| **Automated read *through* Litmus's API** (`--source litmus`) | ⏳ **Blocked** — `loopedge-access :8094` wants a UUID `apiKey`; UI-minted keys are base32; `:8094` is not host-exposed | `docs/RESUME_2026-07-01_litmus-devicehub-bench.md:47-59` |
| **Production ingest** (Litmus → `mira-relay` one-pipeline) | 🚫 **Not built / on HOLD** (pending #2280/#2281) | `docs/integrations/litmus_supported_connector_plan.md:41-44` |

**What this means for the demo:** demo the **collect + contextualize** story. Show Litmus polling the PLC
live in its own UI, then run MIRA against the *same* conveyor and show the grounded answer. Do **not**
claim MIRA is pulling through Litmus's external API in real time — that hop isn't validated. The
baseline `--source plc` read uses the same brain and produces the same verdict, so the intelligence
story is honest either way.

**Recommended ingest path (corrected):** the PDF recommends "MQTT/Sparkplug first." **There is no MQTT/
Sparkplug subscriber in the codebase yet** — it is design-only (`docs/design/2026-06-23-lane3-mqtt-subscriber-design.md`).
The only *live* ingest surface is **REST** (`POST /api/v1/tags/ingest`, HMAC). For the bench proof you
don't use either — you run the local `mira_on_litmus.py` script.

---

## 1. Bench topology

```
Micro820 PLC (2080-LC20-20QBB, AB, FW 14.11)
  192.168.1.100 : 502 (Modbus TCP)  /  :44818 (EtherNet/IP, CIP read-by-name)
        │  (bench Ethernet, laptop on 192.168.1.50/24)
        ▼
Litmus Edge v4.0.14  — container `le` on the PLC laptop (LAPTOP-0KA3C70H, Tailscale 100.72.2.99)
  UI:            https://100.72.2.99:8443  (or https://localhost:8443 on the laptop)
  DeviceHub:     device `conv-101` (UUID 17C803A8-4B85-42C4-9001-3306CC52B65C) + 11 registers
  auth mint:     http://127.0.0.1:8081/auth/v2/login      (container-internal)
  write API:     http://127.0.0.1:8085/devicehub/*        (container-internal / via nginx :8443)
  read API:      http://127.0.0.1:8094/api/tags/by-device (container-internal, NOT host-exposed) ⏳
        │
        ▼
MIRA rules engine  — plc/litmus/mira_on_litmus.py
  --source plc     → reads PLC directly (Modbus/CIP), no Litmus in the code path  ✅ WORKING
  --source litmus  → reads through Litmus :8094 read API                          ⏳ BLOCKED
        │
        ▼
Grounded diagnosis  (A0–A12 Conv_Simple rules, evidence-cited)
```

**Credentials (bench, dev only — not prod):**
- Litmus local login: `admin` / `Factory2026!` (survives `docker restart`, wiped by `docker rm`; reset
  procedure in memory `reference_litmus_local_admin_password_reset.md`).
- Litmus read API key saved to Doppler `factorylm/dev` → `LITMUS_API_KEY`.
- **Dev Edition license = 2-hour resettable trial.** A reset wipes the device/tags — you must re-activate
  **and** re-provision (§3).

---

## 2. Pre-demo checklist

Run these **before** the audience is watching. Each is read-only.

- [ ] **Container up:** `docker ps` shows `le` running on the PLC laptop.
- [ ] **PLC reachable:** from the laptop, `ping 192.168.1.100` responds (bench Ethernet plugged in).
- [ ] **Litmus UI loads:** open `https://100.72.2.99:8443`, accept the self-signed cert, log in
      `admin` / `Factory2026!`.
- [ ] **License active:** System → Activation shows time remaining. If lapsed → Reset Trial (needs
      reCAPTCHA) **and** re-provision (§3).
- [ ] **Device polling:** DeviceHub → `conv-101` → Browse shows live values, **0 Modbus exceptions**.
- [ ] **MIRA baseline runs:** `python plc/litmus/mira_on_litmus.py --source plc` prints a diagnosis
      (do a dry run in private first).
- [ ] **Offline fallback ready:** `python plc/litmus/demo_context_model.py --source replay --fixture cv101_idle_healthy`
      works with **no PLC and no Litmus** — this is your safety net if the bench or license drops mid-demo.
- [ ] **Tests green:** `pytest plc/litmus/test_demo_context_model.py -q` → `10 passed`.

---

## 3. One-time setup per 2-hour session (Litmus provisioning)

> Only needed after a fresh start or a license/trial reset. If DeviceHub already shows `conv-101` polling
> with 0 exceptions, **skip to §4.**

**3a. Activate the license** — UI → System → Activation → 2-Hour Trial → Reset Trial (+ reCAPTCHA).

**3b. Provision the device + 11 registers** — either path works:

- **Manual (UI clicks):** DeviceHub → add device → Modbus TCP → `192.168.1.100` : `502` : station `1`,
  zero-based addressing per the map. Add the 11 registers by name (table in §5).
  *(The README also documents an EtherNet/IP provisioning at `:44818` slot 0 — either driver reads the
  same conveyor; Modbus TCP is what `provision.py` scripts.)*
- **Scripted:** grab a UI bearer token (F12 → Network → any `/devicehub/*` request → copy
  `Authorization: Bearer …`), then:
  ```bash
  export LITMUS_TOKEN='<bearer-token-from-ui>'
  python plc/litmus/provision.py       # creates conv-101 + all 11 registers; prints server responses
  ```

**3c. Reload the poller** (registers are cached; do this after any add/delete):
```bash
docker exec le /command/s6-svc -r /run/service/loopedge-dh
```

**3d. (Optional) Create a read API key** — UI → Settings → API Keys → create → `export LITMUS_API_KEY=…`.
This is only needed to *attempt* the blocked `--source litmus` hop (§6); the working demo does not need it.

> **Gotcha:** the Micro820 map is **sparse** — only Holding regs 106–109, 114, 117, 118 and coils 0, 3, 5,
> 9 exist. Litmus batches contiguous addresses; a batch spanning a missing address fails wholesale
> (exception 2). The provisioned register set already avoids this. Don't add "convenient" extra addresses.

---

## 4. Run the proof (the demo)

**Primary — MIRA contextualizes the live conveyor (WORKING):**
```bash
python plc/litmus/mira_on_litmus.py --source plc
```
Reads all 11 registers over Modbus/CIP, applies engineering scales (e.g. HR109 raw `3215` ÷10 → `321.5 V`
DC bus), runs the A0–A12 rules, prints **equipment state + likely cause + next check** with cited evidence.

**Fuller demo pipeline (writes artifacts you can show on screen):**
```bash
# live PLC:
python plc/litmus/demo_context_model.py --source plc
# or fully offline (no PLC, no Litmus) — deterministic, safe for a flaky bench:
python plc/litmus/demo_context_model.py --source replay --fixture cv101_idle_healthy
python plc/litmus/demo_context_model.py --source replay --fixture cv101_comm_down
```
Artifacts land in `out/demo/garage_conveyor_context_model/`: `raw_values.json`, `context_model.json`,
`maintenance_answer.md`, `demo_summary.md`.

**During the run, on the Litmus UI:** keep DeviceHub → Browse open so the audience sees Litmus *collecting*
the same tags MIRA is reasoning over. That is the two-layer story made visible.

---

## 5. The 11 demo tags (the small, honest tag set)

The PDF's advice is right: 6–12 tags that explain a maintenance situation, not 500. These are the
verified `conv-101` registers (source: `plc/litmus/mira_on_litmus.py` LITMUS_TAG_MAP,
`plc/conv_simple_anomaly/context_model.cv101.json`):

| Litmus register | PLC source | Type | Scale → unit | Why it matters |
|---|---|---|---|---|
| `motor_running` | Coil 0 | bool | — | Is the machine commanded/running |
| `vfd_comm_ok` | Coil 3 | bool | — | Data quality / comms health |
| `e_stop_active` | Coil 5 | bool | — | Safety interlock state |
| `estop_wiring_fault` | Coil 9 | bool | — | Interlock wiring integrity |
| `vfd_frequency` | HR 106 | uint | ÷100 → Hz | Live drive behavior |
| `vfd_current` | HR 107 | uint | ÷100 → A | Load / drive health |
| `vfd_voltage` | HR 108 | uint | ÷10 → V | Drive output |
| `vfd_dc_bus` | HR 109 | uint | ÷10 → V | Deeper drive health (nominal ≈320 V idle) |
| `vfd_cmd_word` | HR 114 | uint | — | Commanded mode (1=STOP, 18/34=RUN) |
| `vfd_status_word` | HR 117 | uint | — | Diagnostic status |
| `vfd_fault_code` | HR 118 | uint | — | Fault context |

Two signals are deliberately **unmapped** in the context model (photo-eye jam, frequency setpoint) — MIRA
**refuses** to fire rules that need them, and says so. That refusal is a feature: show it.

---

## 6. Demo questions and expected behavior

**Good questions (grounded, bounded):**
- "Why is CV-101 not moving?"
- "Is the drive enabled?"
- "What is blocking this conveyor from running?"
- "What should maintenance check next?"
- "Draft a work-order note for this."

**Expected answers (from the rules, evidence-cited):**
- **Idle-healthy:** MIRA says the conveyor is *not being commanded to run* and calls it **not a fault**
  (DC bus ≈320 V nominal, comms good). It does **not** invent a problem.
- **Comm-down fixture:** MIRA fires **A1 (comm stale) CRITICAL** and **suppresses** the stale VFD rules
  (A9 DC-bus, A2 VFD-fault) because their inputs can't be trusted — a grounded, safe behavior.
- **Injected fault (live):** the matching A-rule fires with the register values as evidence.

**Bad questions (the product should refuse or bound these):**
- "Show me all tags." / "Tell me everything about the plant." → not the value; redirect to a machine.
- "Can you control the conveyor?" / "Can you write to the PLC?" → **read-only-first; MIRA does not write.**

---

## 7. What to say (the positioning line)

> "Litmus is helping us get the machine data. FactoryLM is where we approve what the data *means*. MIRA is
> the assistant that uses that approved context to help maintenance troubleshoot. We're not asking the AI
> to guess from random tags — we're giving it a verified map of the equipment, tags, and evidence."

Business version: *We sit between the factory's existing data platforms (Litmus, Ignition, MQTT,
historians, files) and the maintenance outcome. FactoryLM turns those sources into contextualized
maintenance intelligence; MIRA turns that context into explanations, next-checks, and work-order drafts.*

---

## 8. Failure modes & troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Litmus UI won't log in | Local admin creds drifted | Reset per `reference_litmus_local_admin_password_reset.md` (stop `loopedge-auth`, reset-password prints a temp, restart; use PowerShell not Git Bash) |
| DeviceHub shows Modbus **exception 2** | Register batch spans a missing sparse address | Use only the provisioned 11 registers; scan with single FC3/FC1 reads first |
| Values frozen after add/delete | Poller cache | `docker exec le /command/s6-svc -r /run/service/loopedge-dh` |
| Device/tags vanished | 2-hour trial reset wiped state | Re-activate (§3a) + re-provision (`python plc/litmus/provision.py`) + reload poller |
| `--source plc` can't connect | Bench Ethernet unplugged / laptop off 192.168.1.x | Check `ping 192.168.1.100`; confirm laptop IP `192.168.1.50/24` |
| `--source litmus` fails auth | **Known blocker** — `:8094` UUID-apiKey mismatch, not host-exposed | Don't rely on it for the demo; use `--source plc`. See §0 and the OPEN ITEM in the RESUME doc |
| Whole bench is down mid-demo | Hardware/license | Fall back to `demo_context_model.py --source replay` (no PLC, no Litmus) |

---

## 9. Hard rules (do not violate)

1. **Read-only toward the PLC.** No FC5/FC6/FC15/FC16 writes, no parameter changes, no run/stop commands
   from any demo path. (`plc/live_monitor.py` and `plc/live-plc-bridge/bridge.py` *can* write — they are
   **BENCH-ONLY** dev tools and are **not** part of this demo.)
2. **The bench proof is NOT the production ingest path.** `mira_on_litmus.py` reads Litmus/PLC and
   diagnoses; it never writes `tag_events` / `live_signal_cache` and never touches `mira-relay`. Sending
   Litmus data into the canonical pipeline is a separate, gated effort (HOLD, #2280/#2281) that must obey
   `.claude/rules/one-pipeline-ingest.md`.
3. **Credentials come from env/Doppler**, never committed, never printed on screen during a demo.
4. **Don't commit bench work** unless explicitly asked; if you do, use a worktree and stage only
   `plc/litmus/` files explicitly (the main tree has foreign WIP — never `git add -A`).

---

## 10. Cross-references

- `plc/litmus/README.md` — the bench proof's own setup notes (BENCH-ONLY banner).
- `docs/RESUME_2026-07-01_litmus-devicehub-bench.md` — full session state + the OPEN ITEM (read-key mismatch).
- `docs/integrations/litmus_supported_connector_plan.md` — the future *supported* connector plan (deferred).
- `docs/product/litmus_connector_product_gap.md` — the corrected claim register + P0/P1/P2 roadmap.
- `.claude/rules/fieldbus-readonly.md` / `.claude/rules/one-pipeline-ingest.md` — the doctrine this obeys.
- `plc/conv_simple_anomaly/context_model.cv101.json` — the approved CV-101 context packet (11 signals).
