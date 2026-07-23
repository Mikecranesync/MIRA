# MIRA Connect — Build-in-Public / Video Proof Plan

*Phase 3 deliverable. Turns the weekend development/probing process into credibility-building public
content. Docs-only; no code. Grounded in the interoperability gap report
(`docs/discovery/mira_connect_interoperability_gap_report.md`), the connector matrix, and the PRD
outline. **Honesty rule: show what is built, what is partial, and what is missing — and why the
architecture matters.***

---

## A. Content thesis

> **"We are taking real factory signals from PLCs, SCADA, MQTT/Sparkplug, Ignition, Litmus-style
> platforms, and future OPC UA sources, then turning them into maintenance context and outcome
> recommendations."**

The through-line of every video: MIRA/FactoryLM is **not a chatbot**. It is an **industrial
connectivity, context, and maintenance-outcome system** being built against **real PLC / lab / demo
evidence** — four universal surfaces, one context boundary, one accountable outcome.

---

## B. Audience

- Maintenance technicians
- Maintenance managers
- Plant engineers
- Controls engineers curious about AI
- Small manufacturers
- System integrators
- Industrial software people
- Potential beta customers

---

## C. Tone

Plain-English, technician-friendly, honest, build-in-public. **Do not pretend every connector is
done.** Clearly show what is built, what is partial, what is missing, and **why the architecture
matters** (four surfaces + recipes, not twelve one-off integrations).

---

## D. First 10 video ideas

| # | Title | Core proof it maps to |
|---|---|---|
| 1 | Why raw PLC tags are not maintenance intelligence | Context Packet — a register value isn't cause/next-check |
| 2 | The four ways factories expose machine data: REST, MQTT/Sparkplug, OPC UA, historian/file | Four-surface strategy (3 built, OPC UA missing) |
| 3 | How Ignition gets machine tags into MIRA | Built REST/Ignition path (`tag-stream.py` → HMAC → relay) |
| 4 | Why OPC UA is the strategic missing connector | One connector unlocks Kepware/HighByte/Siemens Edge/OPC Router |
| 5 | What a Context Packet is and why it matters | The versioned boundary artifact (provenance→grounding→meaning) |
| 6 | What makes MIRA different from a tag chatbot | Outcome object + human-approve + cite |
| 7 | Turning an anomaly into a maintenance outcome | Detection → cited cause/next-check/parts/WO draft |
| 8 | Litmus/Kepware/HighByte/Siemens Edge/OPC Router: recipes, not custom cores | Vendor-recipe layer over generic surfaces |
| 9 | Building a home-lab factory data stack for AI maintenance | The bench (Micro820/GS10/Litmus/SimLab) evidence |
| 10 | What has to be true before a factory can trust AI maintenance recommendations | Read-only-first, evidence, approval, no PLC writes |

---

## E. Weekend capture checklist

During Phase 3/4 probing, capture notes / screenshots / screen recordings for:

- [ ] Connector matrix (`docs/discovery/mira_connect_connector_matrix.md`)
- [ ] Current / proposed architecture diagrams (gap report §4–5)
- [ ] Existing REST / Ignition / Sparkplug ingest paths (relay + `tag-stream.py` + `mqtt_ingest/`)
- [ ] **The corrected anomaly persistence gap** (gateway-local Jython writers vs. cloud path discarding —
      gap report §2.1)
- [ ] Context Packet boundary (gap report §6)
- [ ] Outcome object boundary (gap report §7)
- [ ] P0 roadmap (P0-1…P0-5)
- [ ] Live bench or SimLab telemetry path if available (Micro820 → Litmus → relay; `simlab` MqttPublisher)
- [ ] Any **"built vs demo-only"** verification findings from Phase 4

---

## F. Video-to-product mapping

Each video maps back to a **product proof** — never a generic tutorial:

| Video theme | Product proof |
|---|---|
| Connector matrix | proves the **interoperability strategy** (four surfaces + recipes) |
| Context Packet | proves the **accountable data boundary** |
| Outcome object | proves the **business value** (maintenance outcomes, not prose) |
| Anomaly persistence | proves moving from **detection → durable maintenance intelligence** |
| OPC UA | proves the **market-expansion path** |
| Ignition / Sparkplug / REST | prove the **first beta doesn't wait for every connector** |

---

## G. Do-not-do list

- ❌ Do **not** claim MIRA supports OPC UA until it is implemented (P0-2 is missing).
- ❌ Do **not** claim "anomaly persistence is absent everywhere" — the accurate statement is:
  *gateway-local Jython writers exist and write to a gateway-local DB; the cloud A0–A12 path computes
  anomalies and discards them; there is no queryable cloud-side anomaly store the Supervisor/outcome
  layer reads* (gap report §2.1).
- ❌ Do **not** present demo-only / test-only code as production (e.g., Litmus is demo; PI is a mock;
  Modbus driver is bench-only).
- ❌ Do **not** overpromise autonomous maintenance — MIRA is read-only troubleshooting intelligence;
  no PLC writes in beta.
- ❌ Do **not** make the videos generic PLC tutorials — every video maps to a product proof (§F).
- ❌ Do **not** let video planning delay the Phase 3 docs or the Phase 4 verification pass.

---

## H. Honest status legend (use on-screen)

- 🟢 **Built (prod):** REST/JSON ingest · Ignition push · MQTT/Sparkplug (opt-in compose profile) · CSV import ·
  contextualize→approve→cite · security posture.
- 🟡 **Partial / demo / mock:** Litmus (demo) · PI (mock) · Modbus driver (bench) · historian/file
  (real PI/SQL/xlsx missing) · outcome layer (~60%).
- 🔴 **Missing:** OPC UA (and Kepware/HighByte/Siemens Edge/OPC Router behind it) · formal Outcome
  object · cloud anomaly persistence · cloud recipes.

*Always show the legend when a video touches a capability — that is the build-in-public credibility.*
