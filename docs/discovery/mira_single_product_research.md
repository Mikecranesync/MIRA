# Discovery — The Single Sellable MIRA Product ("Drive Commander")

**Date:** 2026-07-05
**Method:** `/grill-with-docs` grilling session (not the multi-agent research prompt — the decisions were reached by interview against the codebase). 8 questions, each grounded in code where the code could answer.
**Question answered:** *What already exists that can be turned into ONE polished, sellable MIRA product — narrow, not a platform?*
**Decision of record:** [ADR-0025](../adr/0025-drive-intelligence-packs-and-drive-commander.md).
**Anchors:** `mira_single_product_claude_code_prompt.md`, `the-last-12-hours-a-simple-story.md`, `NORTH_STAR.md`.

---

## Product conclusion (one line)

**MIRA "Drive Commander" — a read-only VFD diagnostic tool whose sellable atom is a per-model "drive pack"** (the manufacturer's own register map + fault table + envelope, as data). It reads a tech's drives and says *what's wrong and what to check*, cited. *DriveExplorer showed the numbers; MIRA tells you what they mean.* Context-led; "Ask your machine" is the proof-demo.

## The grilled design tree (decisions)

| # | Question | Decision |
|---|---|---|
| 1 | Packaging vs. strategy pivot? | **Packaging.** NORTH_STAR intact; pitch leads with context/evidence; "Ask your machine" = proof-demo. |
| 2 | How narrow? | **VFD / drive-only**, pack-per-drive (not "conveyor line", not "any machine"). |
| 3 | What is a pack? | **5-part data bundle** (register map, fault table, status/cmd decode, envelope, per-item provenance); engine loads packs drive-agnostically. |
| 4 | Day-one unit? | **Pack + fault-code diagnosis, zero integration.** Live-connect = premium tier. |
| 5 | Trust when we lack the hardware? | **Tiered, per-item provenance** — `bench_verified` vs `manual_cited`, surfaced honestly. |
| 6 | First buyer? | **Plant maintenance teams w/ a drive fleet, DURApulse/GS10-first.** PowerFlex 525 next. OEM/distributor later. |
| 7 | How does the desktop connect? | **Direct read-only EtherNet/IP/Modbus-TCP** (DriveExplorer model). Amends `fieldbus-readonly` with a local-desktop carve-out. |
| 8 | How does mobile get data? | **Desktop owns live fleet; mobile v1 = standalone point-of-service fault-code/Ask-MIRA.** Live-on-mobile = later desktop relay. |

Plus: **name** → "Drive Commander" (working; trademark diligence pending). **Two surfaces, own UIs** — classic-elegant desktop fleet console + purpose-built elegant mobile; both under `factorylm-ui-style` + `industrial-hmi-scada-design`.

### Regrill (2026-07-05) — the pack is the manual turned into KB/KG-backed intelligence

A pack is **not** a JSON register table and **not** "chat with a PDF" — it's an OEM manual **transformed** into a searchable, cited, structured diagnostic layer MIRA uses without the tech opening the manual. Three layers, two already built:

| Layer | Home | Status |
|---|---|---|
| **Document** (manuals + citations) | `knowledge_entries` + `component_template_sources` (`source_type`/`source_document_id`/`page_numbers`/`excerpt`/`extraction_confidence`) | **exists** (mig 016) |
| **Extracted intelligence** (fault→cause→checks, param/status/ratings/warnings/symptom→path) | `component_templates` (`common_failure_modes`/`troubleshooting_steps`/`diagnostic_indicators`/`pinout`/`safety_notes`) + `kg_entities` (`fault_code`/`specification`/`procedure`) | **exists** (mig 016/004) |
| **Diagnostic reasoning** (faulted/healthy · commanded/not · drive-vs-command-vs-motor-vs-load · next check) | engine (`live_snapshot.assess_*` + Supervisor), generic | **exists** |

Regrill decisions: **(R1)** a pack is a **manifest reusing** KB/KG/`component_templates` — it ADDS only the live-decode data (register/status/cmd/envelope), the family+nameplate descriptor, and derived diagnostic cards; it does **not** re-hold KB/KG. **(R2)** the pack is **keyed to the drive family** (GS10, GA500, PowerFlex 525) — shared family intelligence once + per-model overrides; a nameplate photo resolves **family-first, model-refined** (photo → family pack → clarifiers → model). **(R3)** a **diagnostic card** is a *derived, cited view* over the extracted intelligence (`{fault_or_symptom, meaning, likely_causes[], first_checks[], citations[], confidence, provenance_tier}`), promotable to a curated per-card override — not a new store.

Product sentence: *"MIRA service packs turn OEM drive manuals into field-ready diagnostic intelligence, so a technician can identify a drive with a phone photo and get cited, model-specific troubleshooting without searching the manual."*

## Major findings (with evidence)

1. **A VFD is diagnosable in isolation.** `mira-bots/shared/live_snapshot.py::assess_snapshots` composes the flagship "healthy-but-stopped → command/permissive/interlock" answer from **six drive-internal registers only** (`vfd_comm_ok`, `vfd_fault_code`, `vfd_dc_bus`, `vfd_frequency`, `vfd_cmd_word`, `vfd_status_word`). It reads the drive's own command/status words — it never needed the PLC. ⇒ "just the VFD" reaches the flagship answer and correctly points upstream.
2. **The decode is already table-driven but code-bound.** `_STATUS_BITS`/`_CMD_WORD`/`_FAULT_CODES` dicts in `live_snapshot.py`, mirrored in `mira-hub/src/lib/gs10-display.ts`. "Add a drive" ≈ "swap the tables" → externalizing to packs is a tractable refactor.
3. **`expected_envelope` exists but is empty.** `tag_entities.expected_envelope JSONB` (migration 025); only `tools/verify_phase0_deploy.py` references it as a column name — nothing writes/reads it. The pack (from the datasheet) is where it finally gets populated.
4. **The zero-integration path is real and shipped.** `uns_resolver.py` extracts + normalizes fault codes from free text; the beta gate (`tests/beta/beta_ready_upload_retrieval_citation.py`) is **MET (2026-06-17), CI-enforced** — stranger uploads a manual, asks, gets a cited answer.
5. **Reusable chassis exists as bench/offline tools.** `plc/discover.py` (read-only fleet scan, Ethernet scan is side-effect-free), `plc/live_monitor.py` (per-drive Modbus read), `mira-plc-parser`/`mira-contextualizer` (desktop GUI + PyInstaller + design tokens), `fieldbus-discovery` skill.
6. **AB reference tool identified.** No AB product named "Drive Commander"; the model is **DriveExplorer / DriveExecutive** (DriveTools SP, + DriveObserver) — desktop apps that connect to a fleet over EtherNet/IP, read parameters/faults/trends. MIRA's differentiator = diagnostic intelligence overlay, not a parameter viewer. (Sources in the session.)

## Commands run (representative)
- `gh pr view/checks/merge 2479` — primary task (merged `12815df7`, deployed).
- `git grep` for `expected_envelope`, `assess_snapshots`, GS10 decode, tag-approval UI surfaces, fault-code path.
- `WebSearch` — Allen-Bradley DriveExplorer/DriveExecutive.
- `curl app.factorylm.com/v1/models` → 200 (deployed pipeline live; `api.factorylm.com` not on public DNS — gateway-only).

## Recommended next actions
1. **First build:** extract GS10 → `packs/gs10.*` behind a drive-agnostic pack loader (5-part schema + per-item provenance). Closes the `expected_envelope` gap.
2. Add a **provable-read-only test** (no write FC emittable) as a Drive Commander shipping gate.
3. Amend `.claude/rules/fieldbus-readonly.md` with the ADR-0025 carve-out.
4. Author **pack #2 (PowerFlex 525)** from the KB manual as the first `manual_cited` pack — proves the extraction method generalizes.
5. Design the two UIs (desktop fleet console, mobile point-of-service) under the design system.

## Maturity verdict
Closer to **private beta** than sellable-beta: the *fault-code/manual mode* is shipped (beta gate MET); the *pack architecture, desktop app, and provenance model* are designed but unbuilt. GS10 live decode is bench-proven; generalization is the work.

## Open questions / assumptions
- "Drive Commander" trademark clearance (assumption: usable; unverified).
- Pack as in-repo data vs. separately-licensed SKU (assumed in-repo for v1).
- Desktop stack: reuse `mira-plc-parser` Python/GUI chassis vs. new (unresolved).
- Assumed customer has drives on a reachable Ethernet segment for the desktop's direct read (serial-only sites fall back to fault-code mode + the `--serial-bus-idle` guard).

## Stale / conflicting evidence noted
- The research prompt's "maintenance copilot" framing conflicts with NORTH_STAR's "lead with context, not copilot" — resolved as *packaging*, pitch stays context-led.
- The runbook `docs/runbooks/provision-ignition-hmac.md` references `api.factorylm.com`, which does not resolve publicly (the HMAC ignition endpoint is gateway-reachable only) — flagged, not fixed here.
