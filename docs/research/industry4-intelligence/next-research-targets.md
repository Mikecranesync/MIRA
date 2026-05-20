# Next Research Targets

> Prioritized list of what to research next. Refreshed after each sprint. Last refreshed 2026-05-20 after Fuuz deep-dive.

---

## Next sprint (this week / next week)

### 1. Tier-2 Fuuz videos — finish the Fuuz picture

- [ ] **F0oaVkVj2EQ** — *How Manufacturers Scale From Fragmented Data to AI-Native Intelligence*. Likely customer-outcome focus.
- [ ] **uxk3NkUEHsA** — *From Shop Floor to Top Floor: The Fuuz Strategic Advantage*. Strategic / customer framing.
- [ ] **i0lj8quQsDM** — *Webinar: Industry 4.0 for Manufacturers*. Long-form, likely competitive positioning.

For each: transcript via the documented `youtube_transcript_api` flow → 1-page analysis → cross-reference into `companies/fuuz.md` and `videos/video-index.md`.

**Why now:** finishes the Fuuz picture before moving on. Avoids returning later having forgotten context.

**Expected output:** updated `companies/fuuz.md` + 3 transcript files + a Tier-2 patterns appendix.

---

### 2. HighByte deep-dive — the closest UNS-modeling competitor

Pattern parallel to the Fuuz sprint. HighByte was Tier-1-first-pass-only; we have public material to mine:

- [ ] HighByte Intelligence Hub product docs (modeling layer, transforms, output adapters)
- [ ] IDC MarketScape coverage of HighByte's MCP services (April 2026)
- [ ] Any HighByte conference talks from ProveIt! 2026
- [ ] John Harrington's LinkedIn writing (CPO; thought-leader on UNS modeling)

**Expected output:** refreshed `companies/highbyte.md` + `architecture-patterns/highbyte-patterns.md` + an entry in `repos/` if a public repo surfaces + delta to `mira-architecture-decisions.md` for any partnership lean.

---

### 3. ThredCloud — the closest architectural twin

Tier-1 marked them as "closest architectural twin" but we haven't done depth on:

- [ ] Their KG schema (publicly described?)
- [ ] How NL search works (vector? structured? hybrid?)
- [ ] Their Ignition Perspective integration mechanics
- [ ] Public talks / demos

**Why now:** their architecture mirrors MIRA's most closely. If they're ahead on some axis (e.g., NL search quality), MIRA needs to know.

**Expected output:** refreshed `companies/thredcloud.md` + a side-by-side comparison file `mira-lessons/mira-vs-thredcloud-comparison.md`.

---

## Next month (sprint 2)

### 4. MaintainX CoPilot — the highest threat in the CMMS lane

- [ ] Trial MaintainX (free tier or paid).
- [ ] Document CoPilot behavior on edge cases (no context, ambiguous query, ungrounded request).
- [ ] Compare against MIRA's UNS confirmation gate.
- [ ] Photo-to-recommendation: how does it ground?

**Why:** they own the technician's mobile attention. If their CoPilot doesn't have a UNS gate, MIRA's wedge is real. If it does, sharpen the positioning.

**Expected output:** refreshed `companies/maintainx.md` + a head-to-head video/screenshot comparison + decision in `mira-lessons/mira-architecture-decisions.md`.

---

### 5. Sparkplug B spec deep-dive — confirm MIRA's lead

- [ ] Read Eclipse Sparkplug B v3.0 spec directly.
- [ ] Compare against MIRA's `mira-relay` design.
- [ ] Document birth/death certs, NDATA/DDATA distinctions, type metadata.
- [ ] Cross-reference HiveMQ (Sparkplug B steward) and any HighByte / Litmus Sparkplug content.

**Why:** Fuuz didn't surface Sparkplug B explicitly. MIRA can lead on this if we want.

**Expected output:** new file `architecture-patterns/sparkplug-b-patterns.md` + updated `mira-relay` design notes (if applicable).

---

### 6. Ignition + LLM integration patterns

- [ ] Inductive Automation's official LLM positioning (any?)
- [ ] Third-party LLM plug-ins / extensions for Ignition
- [ ] ThredCloud-on-Ignition (overlap with target #3)
- [ ] Sample Perspective-screen + LLM-overlay public demos

**Why:** Ignition has the SCADA install base. If a grounded copilot ships inside Perspective, MIRA's moat must be UNS-portable, not Ignition-bound.

**Expected output:** refreshed `companies/inductive-automation.md` + an architecture decision in `mira-architecture-decisions.md` about Ignition-portability of MIRA's UNS contract.

---

## Tier-2 companies to start (carry-over from initial sprint)

| Company | Why | When |
|---|---|---|
| Opto 22 | REST-native PLC + first-class API surface | Q3 |
| FlowFuse | Node-RED commercial DevOps; many maintenance teams run Node-RED | Q3 |
| Software Toolbox | OPC / connectivity layer; surfaced as a fellow ProveIt! exhibitor | Q3 |
| AVEVA (PI System) | Process historian incumbent | Q3 |
| Tatsoft (FactoryStudio) | SCADA alternative; cheaper than Ignition | Q4 |
| TDengine | Time-series DB for industrial telemetry | Q4 |
| Critical Manufacturing | Semiconductor MES — pattern source for high-rigor implementations | Q4 |

---

## Process improvements for next sprint

(Lessons from the Fuuz sprint — see `fuuz-first-action-final-report.md` § "What worked / what I'd do differently.")

- [ ] **Unpack one `.fuuz` package** to see actual `package-data.json` structure (tar archive — easy).
- [ ] **Read more flow-context-reference details** to inform MIRA component-template export format.
- [ ] **Search LinkedIn explicitly** — Craig's thought-leadership cadence there is heavy and the public web search missed signal.
- [ ] **Try to get a customer perspective** — every analyst-only or vendor-only source is half a picture.

## Cross-reference

- [INDEX.md](INDEX.md) — full library map
- [open-questions.md](open-questions.md) — unresolved questions across the library
- [RESEARCH_ROUTINE.md](RESEARCH_ROUTINE.md) — the recurring process to follow
- [summaries/fuuz-first-action-final-report.md](summaries/fuuz-first-action-final-report.md) — what just shipped
