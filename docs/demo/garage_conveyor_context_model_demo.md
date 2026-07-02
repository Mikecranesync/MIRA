# Weekend demo runbook — Garage conveyor CV-101: Litmus collects, MIRA contextualizes

**Thesis:** *Litmus gets live industrial data out of the machine. MIRA turns that data into an
approved maintenance context model and uses it to answer technician questions — with evidence, and
without guessing.*

**Duration:** ~5 minutes. **Prereqs:** bench Ethernet plugged in (laptop on `192.168.1.50/24`,
PLC at `192.168.1.100:502`); Litmus container `le` up; DeviceHub `conv-101` + 11 registers
provisioned (re-run `python plc/litmus/provision.py` after a 2-hour Dev reset). The MIRA half also
runs fully **offline** via replay — see step 6.

---

## The four things the audience should see

1. Litmus is **connected to the conveyor and collecting** live data.
2. MIRA **reads/contextualizes the same** live data.
3. MIRA maps raw tags/registers into an **approved** CV-101 maintenance **context model**.
4. MIRA **answers a maintenance question** from that model + live values — and **declines** what it
   can't ground.

---

## Steps

### 1. Show the physical conveyor
Point at the garage conveyor + the Micro820 / GS10 drive. "This is CV-101, our discharge conveyor."

### 2. Show Litmus/DeviceHub polling with no exceptions
Open `https://localhost:8443` → DeviceHub → device **conv-101** → **Browse**. Show the 11 tags
updating with **no modbus exceptions**. *"Litmus is getting the data out of the machine — this is
the hard, valuable plumbing, and it's working."*

### 3. Show the raw tag wall — and why it isn't enough
Run the live demo:
```bash
python plc/litmus/demo_context_model.py --source plc
```
Point at the **RAW TAG WALL** block (`vfd_dc_bus (3230)`, `vfd_cmd_word (1)`, `motor_running
(False)`…). *"Here's exactly what a platform hands you. A number like `3230` on register 109 is not
a maintenance answer. A technician can't act on this."*

### 4. Show the MIRA context model for CV-101
Open `plc/conv_simple_anomaly/context_model.cv101.json` (or the copy written to
`out/demo/garage_conveyor_context_model/context_model.json`). Show that every register maps to a
**named signal** with a **component**, a **scale/unit**, **evidence**, and a **human approval**.
*"This is the context MIRA adds. `H@109 ÷10 = 321.5 V DC bus on VFD-101`, approved by a human,
traced to the GS10 manual. That's the difference between data and intelligence."*

### 5. Show approved mappings + ask the maintenance question
In the console output (and `out/demo/.../maintenance_answer.md`), show:
- the **Evidence used** table (signal → value → source → confidence → **approval**), and
- the **answer** to *"Why is CV-101 stopped?"*:
  > *CV-101 is stopped because it is not being commanded to run — the GS10 command word reads STOP…
  > This is a normal idle stop, not a fault: the PLC↔GS10 link is healthy, no GS10 fault is active,
  > the e-stop is clear.*
- the **"What MIRA will NOT claim"** block — MIRA explicitly declines a photo-eye jam because that
  signal isn't in the approved map. *"It answers what it can prove, and refuses to guess. That's
  what makes it trustworthy on a plant floor."*

### 6. (Optional / no-hardware) Show a fault, deterministically
If the PLC isn't attached, or to show a failure cleanly on camera:
```bash
python plc/litmus/demo_context_model.py --source replay --fixture cv101_comm_down
```
MIRA flags **A1 GS10 RS-485 link down (CRITICAL)** and says it will **not** diagnose the (now stale)
VFD values until comms are restored — the trust gate in action.

### 7. Land the business conclusion
*"Litmus gets the data out of the machine. MIRA turns that data into an approved maintenance context
model and answers the technician's question — grounded, cited, and honest about what it doesn't
know. That's the product."*

---

## The one command to run the demo

```bash
# live (bench connected)
python plc/litmus/demo_context_model.py --source plc

# offline / deterministic (video or CI)
python plc/litmus/demo_context_model.py --source replay --fixture cv101_idle_healthy
```

Artifacts (screen-share / video ready) are written to
`out/demo/garage_conveyor_context_model/`: `raw_values.json`, `context_model.json`,
`maintenance_answer.md`, `demo_summary.md`.

---

## Honest gap (say it out loud if asked)

The **direct** Litmus-API read (`--source litmus`) is a deferred follow-up — the internal
`loopedge-access :8094` path needs a supported credential/route and is container-internal
(`docs/discovery/litmus_mira_demo_decision.md`). It does **not** weaken the proof: MIRA reads the
**same live conveyor data** over `--source plc`, and Litmus is demonstrably collecting it in
parallel (step 2). The supported connector plan is `docs/integrations/litmus_supported_connector_plan.md`.
