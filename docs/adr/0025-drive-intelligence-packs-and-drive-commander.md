# ADR-0025: The Single Sellable Product — VFD Drive-Intelligence Packs via "Drive Commander"

## Status

Accepted — 2026-07-05

**Related:** ADR-0021 (Ignition-Module-First Edge — the *cloud/customer-install* trust boundary this ADR does **not** overturn), ADR-0024 (dedicated FactoryLM origin per Ignition gateway), ADR-0017 (proposal state machine — provenance vocabulary), the canonical wedge in [`NORTH_STAR.md`](../../NORTH_STAR.md), and the rules [`.claude/rules/fieldbus-readonly.md`](../../.claude/rules/fieldbus-readonly.md) (amended by this ADR) + [`.claude/rules/train-before-deploy.md`](../../.claude/rules/train-before-deploy.md).

**Origin:** grilling session 2026-07-05 (`/grill-with-docs about this project's destiny`), anchored on `mira_single_product_claude_code_prompt.md` + `the-last-12-hours-a-simple-story.md`. Full session record: [`docs/discovery/mira_single_product_research.md`](../discovery/mira_single_product_research.md).

**Supersedes:** nothing structurally. This ADR **narrows** the canonical wedge into one shippable product and **adds** one new customer surface (a read-only desktop app). NORTH_STAR is unchanged — this is a packaging decision, not a pivot.

---

## Context

MIRA/FactoryLM had proven a real capability (the "last 12 hours": relay latency cut ~43%, live machine state turned into a context packet, Ask MIRA grounded on live evidence across Hub → engine → HMI, PRs #2474/#2476/#2478/#2479). The open question was **not** "what can it do" but **"what is the ONE polished product Mike can demo, beta, and sell?"** — without sprawling into a full platform.

Two documents were in apparent tension:

1. **The single-product research prompt** proposed a "Live Machine Context" **copilot** — "Ask your machine what is wrong."
2. **`NORTH_STAR.md` (canonical, 2026-06-22)** mandates: *"Lead with the context platform, never with the copilot. 'AI maintenance copilot' is a crowded [lane]."* The product is the context; the agent is the proof.

Grilling resolved the tension: the two **agree on substance** (the agent proving context is real *is* the NORTH_STAR thesis) and clash only on a marketing verb. So this is a **packaging exercise** (NORTH_STAR intact), and the product's name/pitch lead with **context/evidence**, with "Ask your machine" as the proof-demo.

Two facts from the codebase then shaped the product:

- The flagship assessment ("VFD healthy but stopped → command/permissive/interlock, not the drive") is computed from **six drive-internal registers only** (`vfd_comm_ok`, `vfd_fault_code`, `vfd_dc_bus`, `vfd_frequency`, `vfd_cmd_word`, `vfd_status_word` — `mira-bots/shared/live_snapshot.py::assess_snapshots`). It never needed the PLC's tags. ⇒ **a VFD can be diagnosed in isolation** and correctly *point upstream* when it's healthy.
- The GS10 decode is **already table-driven** (`_STATUS_BITS`/`_CMD_WORD`/`_FAULT_CODES` dicts in `live_snapshot.py`, mirrored in `mira-hub/src/lib/gs10-display.ts`) but lives **in engine code**, hardcoded to one drive. `tag_entities.expected_envelope` (migration 025) exists but is **unpopulated** — the seam between "demos on the bench" and "runs on a customer's drive."
- **The manual-intelligence layers already exist** (found during the regrill, 2026-07-05): `component_templates` (migration 016) already carries `common_failure_modes`/`troubleshooting_steps`/`diagnostic_indicators`/`pinout`/`safety_notes`/`verification_status`; `component_template_sources` already carries `source_type`/`source_document_id`→KB/`page_numbers`/`excerpt`/`extraction_confidence` (the document layer + citations + confidence); and the **structured-vision path already extracts drive+fault from a photo** (`test_structured_vision.py` → `{"component":"GS20 VFD","symptom":"F004 fault"}`). ⇒ a pack must **reuse** these, not re-hold them.

## Decision

**The single sellable product is a read-only VFD diagnostic tool, "Drive Commander," whose sellable atom is a per-model "drive pack."** It reads a technician's drives and — using the manufacturer's own register maps and fault tables, packaged as data — tells them *what's wrong and what to check*, with cited evidence. Positioning is **context-led** ("you're buying the drive intelligence"); "Ask your machine what's wrong" is the proof-demo, never the headline.

### 1. The atom — a **drive pack** = an OEM manual **transformed into KB/KG-backed diagnostic intelligence**

A drive pack is **not** a little JSON register table and **not** "chat with a PDF." It is a **productized manifest** that turns a manufacturer's manuals into a searchable, cited, structured diagnostic layer MIRA uses *without the technician opening the manual*. It is **keyed to a drive family** (e.g. DURApulse GS10, Yaskawa GA500, PowerFlex 525), with per-model overrides.

**A pack REUSES infrastructure that already exists** (decision: this ADR + regrill 2026-07-05). It is a manifest binding, for one family, three layers — two of which are already built:

| Layer | What it is | Home (mostly existing) |
|---|---|---|
| **1. Document** | full manuals (user/install/parameter/datasheet/quick-start/fault-ref) + citations | `knowledge_entries` (KB) + **`component_template_sources`** (`source_type`, `source_document_id`→KB, `page_numbers`, `excerpt`, `extraction_confidence`) — migration 016 |
| **2. Extracted intelligence** | fault→meaning→causes→first-checks; param/register→meaning→unit→scaling; status bit→meaning; ratings; warnings; symptom→inspection path | **`component_templates`** (`common_failure_modes`, `troubleshooting_steps`, `diagnostic_indicators`, `expected_signals`, `pinout`, `safety_notes`, `verification_status`) + `kg_entities` (`fault_code`/`specification`/`procedure`) — migrations 016/004 |
| **3. Diagnostic reasoning** | faulted/healthy · commanded/not · ready/inhibited · drive-vs-command-vs-motor-vs-load · next physical check | the generic engine (`live_snapshot.assess_*` + Supervisor) — **shared across all drives** |

**What the pack ADDS on top of the existing three layers** (the genuinely new data):
- **Live-decode data** — Modbus/EtherNet-IP register addr → value, status/command-word bit decode, and **expected envelope** (nominal DC bus, rated current, freq range → populates `tag_entities.expected_envelope`). This is the only wholly-new store; it feeds Drive Commander desktop's live fleet and closes the envelope gap (from the datasheet — no learned baseline for v1).
- **Family + nameplate-recognition descriptor** — how a photo of the drive tag resolves to *this* pack (see §1a).
- **Diagnostic cards** — a *derived, cited view* over layer 2 (one card per fault code / symptom: `{fault_or_symptom, meaning, likely_causes[], first_checks[], citations[], confidence, provenance_tier}`), generated at build/query time, **promotable to a hand-curated override per-card** when a human wants to tune one. Not a new hand-authored store.

**Per-item provenance** (`bench_verified` vs `manual_cited`, §4) rides on the existing `component_template_sources.extraction_confidence` + `verification_status`, tracked per item.

**Adding a drive = converting its manuals into a family pack (ingest → extract → cite → decode-map), not editing engine code.** This is the SKU and expansion model. The product sentence: *"MIRA service packs turn OEM drive manuals into field-ready diagnostic intelligence, so a technician can identify a drive with a phone photo and get cited, model-specific troubleshooting without searching the manual."*

### 1a. Nameplate-photo resolution (family-first, model-refined)

The signature mobile moment, and **already partly built** (`test_structured_vision.py` extracts `{"component":"GS20 VFD","symptom":"F004 fault"}` from an image):

1. **Photo of the drive tag** → identify **brand + family** ("DURApulse GS10", "PowerFlex 525", "Yaskawa GA500").
2. **Load the best-matching pack** — the **family pack** always; apply the exact-model overrides when the catalog number is legible.
3. **Answer from the family pack immediately**, and **ask targeted clarifiers** to sharpen to the model ("what's the full catalog number?", "what fault/keypad message?", "RUN / STOP / FAULT / ALARM?", "is the motor actually moving?").
4. **Return a cited, model-specific answer** from layers 1–2 + the engine (layer 3): *"Likely overcurrent on acceleration — check mechanical binding, motor leads, accel time. Evidence: GA500 manual fault table, parameter group X, p.Y."*

### 2. Two surfaces, two jobs, two purpose-built UIs

- **Desktop — the fleet console** (classic-but-elegant): connects **read-only** to the whole VFD fleet (the DriveExplorer/DriveExecutive model), live monitoring + pack intelligence overlaid on the raw parameters. On-network; the maintenance-office/bench oversight tool.
- **Mobile — point-of-service** (its *own* elegant UI, not a shrunk desktop): standalone, **zero integration** — type/scan a drive + fault code → cited cause + next check + Ask MIRA. Works anywhere on cellular. This is the **already-shipped** fault-code/manual path (beta gate MET, 2026-06-17).

Both UIs are built under `factorylm-ui-style` tokens + `industrial-hmi-scada-design` (muted-normal, color-for-state). **Live-on-mobile** is a *later* desktop→phone relay feature — v1 does not stand up a live cloud-fleet pipeline just to light up mobile.

### 3. The new surface — a customer-run, provably-read-only desktop app

**Drive Commander desktop opens read-only EtherNet/IP / Modbus-TCP connections directly to the customer's drives** (the DriveExplorer model), independent of whether the customer runs Ignition. This preserves the **zero-integration promise**: a maintenance laptop finds and reads the fleet with no SCADA dependency.

This **amends `.claude/rules/fieldbus-readonly.md`** with a narrow carve-out (see below). It does **not** overturn ADR-0021: that rule governs the **MIRA *cloud* / customer-*install* surface** ("the plant LAN must not be reachable from a MIRA-*cloud* component; MIRA reads tags via Ignition"). Drive Commander is a **different trust model** — a local diagnostic app the customer runs on their own laptop, exactly the model that makes DriveExplorer trusted. The two coexist:

| Surface | Connects how | Governed by |
|---|---|---|
| MIRA Cloud / Ignition install | **Never** opens a plant socket; reads via Ignition tag space; outbound 443 only | ADR-0021 (unchanged) |
| **Drive Commander desktop** (new) | **Read-only** EtherNet/IP / Modbus-TCP direct to drives, on the customer's own machine | this ADR + amended fieldbus-readonly |

### 4. Trust & safety (non-negotiable)

- **Read-only, provably.** Read function codes only (FC1–FC4); **never** a write FC (FC5/6/15/16), no parameter/IP/baud writes, no control words — the same discipline `plc/discover.py` already enforces. Serial RS-485 keeps the `--serial-bus-idle` two-master guard; EtherNet/IP has no bus-contention hazard.
- **Tiered provenance, surfaced honestly.** A manual-cited answer says so ("per ABB ACS580 manual §6.3, fault 2310 = overcurrent — not hardware-verified by us"). **Confidently wrong is worse than no answer** — stay quiet when unsure (the Ignition-path lesson: assess only scaling-immune signals; show but don't reinterpret ambiguous ones).
- GS10/DURApulse is the **bench-verified gold reference** that proves the extraction method.

### 5. Go-to-market

First buyer = **plant maintenance teams with a drive fleet, DURApulse/GS10-first** (where we have both the gold pack and the hardware). **PowerFlex 525 next** (already in the KB). OEM-bundle and AutomationDirect co-sell are **later channels**, not the first dollar. Day-one unit sold = **pack + fault-code diagnosis, no integration**; live fleet (desktop) is the premium tier.

### Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| **Pivot the wedge to a "maintenance copilot"** | Crowded lane (MaintainX/UptimeAI); contradicts NORTH_STAR's validated competitive map. Substance already agrees — only the verb differed. |
| **"Live Machine Context" for *any* machine** | Unbounded knowledge problem; requires generalizing decode + learned baselines before the first sale. A drive is a *bounded, documented* unit — ownable. |
| **Generalize the live-assessment layer before selling** | Inverts the wedge; the research prompt itself says "prefer connecting/polishing existing pieces over inventing new architecture." Packs defer this cleanly. |
| **Live-connected-only product** | Every sale needs per-customer Ignition/MQTT integration — the exact friction Drive Commander's direct read + mobile fault-code mode remove. |
| **Ship only bench-verified packs (own every drive)** | Capital-heavy, slow; kills the repeatable pack-authoring expansion model. Manual-cited-with-provenance is the honest, scalable middle. |
| **Mobile = shrunk desktop** | Different job (one drive, point-of-service, off-network) demands a different UI. Rejected per product directive. |
| **Direct-connect via MIRA cloud/container** | Would overturn ADR-0021's trust boundary. The carve-out is scoped to a *customer-run local desktop*, not cloud. |

## Consequences

**Positive**
- One narrow, demoable-today, honest product with a repeatable revenue/expansion unit (packs).
- Closes the `expected_envelope` gap as a *side effect* of the pack refactor.
- Reuses existing assets (`plc/discover.py`, `plc/live_monitor.py`, `mira-plc-parser`/`mira-contextualizer` desktop chassis, `fieldbus-discovery` skill, the shipped fault-code path).
- Keeps NORTH_STAR and ADR-0021 intact; adds one clearly-bounded surface.

**Costs / obligations**
- **Amends `.claude/rules/fieldbus-readonly.md`** (carve-out below) — a change to project doctrine, recorded here.
- Introduces a **pack schema + loader** and moves GS10 tables out of code (first build).
- New desktop + mobile UIs to build and maintain (under the shared design system).
- **Provable read-only** is now a shipping-gate for a customer-facing app, not just a bench script — needs a test that asserts no write FC can be emitted.

**Amendment to `.claude/rules/fieldbus-readonly.md`**
> A **customer-run desktop diagnostic app** (Drive Commander) MAY open **read-only** EtherNet/IP / Modbus-TCP connections directly to drives, under the same provable read-only discipline as `plc/discover.py` (read FCs only; no write FC ever; serial RS-485 requires `--serial-bus-idle`). This carve-out is **scoped to the local desktop surface only**. The prohibition on a MIRA **cloud component / MIRA-named container** opening a plant socket (ADR-0021) is **unchanged**.

## Open items (deferred, non-blocking)
- **"Drive Commander" trademark diligence** before committing the name (no AB product by that name surfaced; third-party use possible).
- **Pack packaging**: in-repo data now → licensable per-drive SKU later (lean: start in-repo).
- **Desktop tech stack**: reuse the `mira-plc-parser` Python/GUI + PyInstaller chassis vs. new — a first-build decision.

## First build (proposed, not yet enacted) — the GS10 gold reference pack

Assemble the **DURApulse GS10 family pack** as the gold reference, mostly by *productizing what exists* + filling gaps:
1. **Manifest + drive-agnostic pack loader** — the engine loads a pack (family + optional model overrides) instead of hardcoding GS10; existing GS10 tests are the byte-identical guardrail.
2. **Live-decode data (new)** — extract the `_STATUS_BITS`/`_CMD_WORD`/`_FAULT_CODES` dicts out of `live_snapshot.py`/`gs10-display.ts` into the pack; add the expected envelope → populates `tag_entities.expected_envelope` (unblocks analog assessment).
3. **Layers 1–2 (reuse)** — bind the GS10 manuals in `knowledge_entries` + the GS10 `component_templates` row (+ `component_template_sources` citations, `seed_fault_codes.py`) to the pack; fill any missing fault/param extractions.
4. **Nameplate-recognition descriptor** — reuse the structured-vision path so a GS10 tag photo resolves to this pack.
5. **Diagnostic cards** — derive cited fault/symptom cards from layer 2.
6. **Provable-read-only test** — assert no write FC (FC5/6/15/16) can be emitted (the Drive Commander shipping gate).

**Success criteria:** existing `test_live_snapshot`/`test_engine_live_snapshot`/`gs10-display.test.ts` stay green with GS10 loaded *as a pack*; envelope populated; a GS10 photo resolves to the pack; the read-only assertion passes. Then PowerFlex 525 becomes the first *`manual_cited`* family pack, proving the manual→pack conversion generalizes.
