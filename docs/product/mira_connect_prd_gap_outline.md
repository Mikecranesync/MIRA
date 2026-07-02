# FactoryLM / MIRA Connect — PRD-Ready Gap Outline

*Phase 3 product deliverable. A short, hand-to-product/engineering outline derived from the
interoperability gap report (`docs/discovery/mira_connect_interoperability_gap_report.md`) and the
connector matrix (`docs/discovery/mira_connect_connector_matrix.md`). Docs-only; no code. Claims are
evidence-cited in the companion report; this outline is the decision surface.*

---

## 1. Product names and definitions

**Name options:** FactoryLM Connect · MIRA Connect · FactoryLM Interconnect · MIRA Context Bridge.
*(Recommendation: **MIRA Connect** for the connectivity product; "FactoryLM Connect" if positioned
under the platform brand.)*

**One-sentence definition:** *MIRA Connect is the maintenance-intelligence interoperability layer that
plugs into whatever industrial data platform a factory already has — through four universal surfaces —
imports and contextualizes assets, tags, documents, live values, and evidence, and turns them into
accountable maintenance outcomes.*

**What it is not:** another Litmus, SCADA, historian, or Industrial DataOps platform. It is the
context + outcome layer **on top of** those systems.

---

## 2. Problem statement

Factories already have data platforms (Ignition, Litmus, Kepware, PI, brokers, spreadsheets), but
**raw tags are not maintenance intelligence**. A number on a register does not tell a technician the
cause, the next check, the part, or the labor. Every AI-maintenance vendor either (a) assumes the
context already exists, or (b) tries to become yet another data platform. MIRA Connect instead **meets
the factory where its data already lives**, contextualizes it with human-approved evidence, and
produces **cited, accountable maintenance outcomes** — without ripping out anything.

---

## 3. Personas

| Persona | Cares about | MIRA Connect value |
|---|---|---|
| **Maintenance technician** | "What's wrong and what do I do next?" | cited cause + next check + parts, on the surface they already use |
| **Maintenance manager** | MTTR, accountability, no risky writes | read-only, evidence-backed outcomes + WO drafts |
| **Plant / controls engineer** | data integrity, security, no PLC writes | one canonical pipeline, read-only-first, outbound-only |
| **Controls engineer curious about AI** | "is this real or a chatbot?" | Context Packet + Outcome object, not prose over tags |
| **Small manufacturer** | low-friction onboarding | CSV/Excel/MQTT import; bring-your-own-stack |
| **System integrator** | repeatable deployments | vendor recipes over four surfaces, not bespoke builds |
| **Beta customer** | fast time-to-value, safety | first beta runs on already-built connectivity |

---

## 4. MVP / beta / enterprise scope

**MVP / first serious beta (no new connector required):**
- Ingest via **REST/JSON + Ignition push + MQTT/Sparkplug** (already built).
- **P0-3 Context Packet** (explicit boundary), **P0-4 Outcome model**, **P0-5 cloud anomaly persistence**.
- Human-approve + cite (already built); read-only; single-tenant-per-deployment acceptable.
- Proof: bench (Micro820→Litmus→relay) or SimLab → cited Outcome + WO draft.

**Beta (design-partner) adds:**
- **P0-1** unified connector registry + **P0-2 generic OPC UA connector** (unlocks Kepware/HighByte/
  Siemens Edge/OPC Router as recipes).
- **P1-6** real PI connector, **P1-7** Excel/SQL import, **P1-8** Litmus supported egress recipe.
- Multi-tenant hardening (RLS already in place); full `audit_log`.

**Enterprise adds:**
- **P2-9** cloud/edge recipes (SiteWise/Azure/EMQX/HiveMQ/Node-RED); distributed nonce; SSO;
  connector marketplace; per-tenant HMAC key registry; SLA + escalation on the approval queue.

---

## 5. P0–P3 roadmap

| Pri | Item | Layer | Complexity |
|---|---|---|---|
| **P0-1** | Consolidate connector registry (merge `mira-connect` + `mira-connectors`) | Connectivity | M |
| **P0-2** | **Generic OPC UA connector** (unlocks Kepware/HighByte/Siemens Edge/OPC Router) | Connectivity | L |
| **P0-3** | First-class **Context Packet** contract | Boundary | M |
| **P0-4** | **Maintenance Outcome model** (cause/failure-mode/next-check/recommendation/parts/labor/WO/evidence/confidence) | Outcome | L |
| **P0-5** | **Cloud anomaly persistence** (queryable store the Supervisor reads) | Outcome | M |
| P1-6 | Real PI connector | Connectivity | M |
| P1-7 | Excel / SQL import | Connectivity | S–M |
| P1-8 | Litmus supported egress recipe | Connectivity | S |
| P2-9 | Cloud/edge recipes (SiteWise/Azure/EMQX/HiveMQ/Node-RED) | Connectivity | S each |
| P3-10 | Deferred/unknown recipes (paid-demand only) | Connectivity | Unknown |

**Framing:** OPC UA is the **one strategic connectivity gap**; the **Outcome model + anomaly
persistence** are the **core value gap**. Do not let connectivity crowd out value.

---

## 6. Success metrics

- **Time-to-first-Outcome:** from "connect my stack" to first cited maintenance Outcome (< 1 day for a
  built surface).
- **Grounding rate:** % of Outcomes with ≥1 evidence citation (target 100%; enforced by
  `citation_compliance` + hallucination audit).
- **Surface coverage:** # platforms reachable via the four surfaces without new core (target: all
  non-OPC-UA rows immediately; +4 on OPC UA ship).
- **Approval health:** median proposal review latency; % Outcomes acting only on `verified` context.
- **Beta activation:** # design partners whose real data produces an accepted Outcome + WO draft.
- **Safety:** 0 PLC writes; 0 cross-tenant leaks (RLS-enforced).

---

## 7. Demo script (5 minutes, honest)

1. *"Raw tags aren't intelligence."* Show the register wall (REST/Ignition/Sparkplug ingest → `live_signal_cache`).
2. *"MIRA adds context."* Show the **Context Packet** for one asset — source tag → UNS → grounding → (soon) maintenance meaning.
3. *"Detection becomes an outcome."* Trigger a bench/replay fault → **Outcome object**: cause + next check + parts + WO draft, each line **cited**.
4. *"It remembers."* (after P0-5) Show the anomaly history feeding the outcome loop.
5. *"Bring your own stack."* Point a CSV / MQTT broker at it; data normalizes into the same Packet.
6. *"What's next."* Name OPC UA as the one strategic connector that turns Kepware/HighByte/Siemens Edge/OPC Router into recipes — **honestly marked not-yet-built.**

---

## 8. Acceptance tests

- **Connectivity:** a tag POSTed via REST / pushed via Ignition / published via Sparkplug lands in
  `tag_events` + `live_signal_cache`, allowlist-filtered, tenant-scoped (existing tests +
  Contract-5 stays green).
- **Context Packet:** schema-conformance test in Contract 5; round-trip (surface → packet → store → read).
- **Outcome:** golden cases assert `Outcome` fields + citations; `mira-run-hallucination-audit` shows
  no ungrounded outcome.
- **Anomaly persistence:** DB round-trip — anomaly fires → cloud row persisted → Supervisor reads it;
  `test_diagnose_parity.py` unaffected.
- **OPC UA (post-P0-2):** read-only integration against a public OPC UA reference server; no write
  function codes; Contract-5 conformance.
- **Security:** no PLC write path (`test_no_customer_write_paths.py`); RLS blocks cross-tenant reads.

---

## 9. Risks and dependencies

| Risk / dependency | Impact | Mitigation |
|---|---|---|
| OPC UA client library / license (Apache/MIT only, PRD §4) | blocks P0-2 | verify license before adoption; **Unknown** today |
| Sparkplug ships as an opt-in `sparkplug` compose profile | MQTT surface not started by a default deploy | enable the profile / confirm it is live before claiming prod |
| Two connector packages drift | erosion of one-pipeline law | do P0-1 before adding connectors |
| Outcome model without persistence | no memory / no learned baselines | sequence P0-5 with P0-4 |
| `tag_diff_logger` scheduler deferred | may be a P0-5 prerequisite | verify before P0-5 (**Unknown**) |
| Overpromising connectors in market | credibility loss | honest "built vs partial vs missing" everywhere (see video plan Do-Not-Do list) |
| Distributed nonce / full audit_log deferred | scaled-beta gap | single-node beta OK; add Redis/NeonDB for scale |

---

## 10. Non-goals (V1)

- No PLC writes / autonomous control. Read-only troubleshooting intelligence only.
- Not a data platform / historian / SCADA replacement.
- No new connector core per vendor — recipes over four surfaces.
- No inbound exposure of the factory network.

*Companion: build-in-public / video proof plan — `docs/product/mira_connect_video_proof_plan.md`.*
