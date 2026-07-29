# PRD — DriveSense Manual-Derived Keypad Navigation & Parameter Intelligence

> **Status:** DRAFT (discovery). Implementation-ready, deliberately not overbuilt.
> **Author:** DriveSense phase planning, 2026-07-05.
> **Depends on:** the objects in `drivesense_service_pack_schema_proposal.md` (canonical — this PRD
> references them, does not redefine them). Current state and gaps: `drivesense_manual_keypad_gap_report.md`.
> **Grounded against:** `mira-drivesense-obj` worktree (main + `DriveDiagnostic` #2486) and
> `docs/drive-commander/pack-construction-and-observability.md`.
> **Governing rules:** `.claude/rules/fieldbus-readonly.md` (read-only OT), `train-before-deploy.md`,
> `direct-connection-uns-certified.md`, `mira-industrial-safety` skill, `uns-compliance.md`.

---

## 1. Problem statement

A technician standing at a networked VFD that has faulted knows the fault *code* but not what to
*do*. Today MIRA already tells them what a fault means and what to check first — the GS10 fault card
(`DiagnosticCard`) is rendered on both the engine and Ignition "Ask MIRA" surfaces via the
`DriveDiagnostic` object (#2484/#2485/#2486). But the fault card stops at "check the Modbus wiring
and the comm-timeout setting." It does **not** tell the technician **which parameter** to look at
(`P09.03`), **what its values mean**, or **how to navigate the drive's keypad to view it** without
flipping through a 400-page manual.

That last mile — *fault → related parameter → keypad steps to view it safely* — is the difference
between "MIRA explained the fault" and "MIRA walked me to the answer on the physical drive." The
information exists in the OEM manual (fault tables, parameter tables, keypad walkthroughs), but the
codebase has **no structured representation of drive parameters or keypad navigation anywhere**
(verified: no `parameters` block in the pack, no `parameter` KG entity type, no keypad schema). Raw
manual RAG can quote a paragraph; it cannot hand a technician an ordered, cited, view-only button
sequence with confidence and a safety framing.

## 2. Target user

**Primary:** a plant maintenance technician at a networked VFD with a phone (MIRA in hand) and the
drive's physical keypad in front of them. Noisy plant, gloves, wants the answer in seconds, not a
manual search. Reads on a phone.

**Secondary:** the **setup/admin** who authors and validates a drive family's service pack in the
Command Center before it is deployed (train-before-deploy).

Out of persona: control engineers doing parameter *tuning* (that's editing — out of scope in beta),
and OEMs/distributors (a later channel).

## 3. First supported drive family

**DURApulse GS10** — already the gold-reference pack (`packs/durapulse_gs10/pack.json`), already has
the fault card path wired, already the bench-verified family. First proof case:

> **CE10 Modbus comm timeout → parameter `P09.03` (Comm Time-out Detection) → keypad steps to view it.**

PowerFlex 525 is the next family (as with fault cards), but **not** in this PRD's scope.

## 4. User stories

1. *As a technician*, when the GS10 shows **CE10**, I want MIRA to name the parameter that governs
   comm-timeout (`P09.03`), tell me what its values mean, and give me the exact keypad buttons to
   **view** it — so I can confirm the setting without searching the manual.
2. *As a technician*, I want every keypad step and parameter fact to say **where it came from**
   (manual section, page when known) and **how sure MIRA is**, so I trust it at an energized drive.
3. *As a technician*, I want MIRA to tell me plainly when it **does not** have a bench-verified path
   ("these steps are from the manual, not hardware-verified") rather than sound falsely certain.
4. *As a technician*, I want the guidance to be **view-only** and clearly say so — never "press ENTER
   to change it" — so I don't accidentally alter a live drive.
5. *As a setup/admin*, I want to author a family's parameter + keypad cards from the manual, mark
   provenance honestly, and **validate** them before they deploy to the HMI (train-before-deploy).

## 5. Technician workflow (the core arc)

```
Networked GS10 faults (CE10)                     [existing live-tag path — no change]
  → live snapshot reaches the engine/Ignition surface (UNS-certified direct connection)
  → build_drive_diagnostic(snapshots) builds a DriveDiagnostic:
        assessment          : "Drive tripped on a Modbus comm timeout (CE10)."   [existing]
        fault_card          : meaning + likely_causes + first_checks + citation  [existing]
        related_parameters  : [ ParameterCard(P09.03, "Comm Time-out Detection", …) ]   [NEW]
        keypad_navigation   : KeypadNavigationCard(goal="View P09.03", steps=[…])        [NEW]
        evidence            : de-duped citations                                          [NEW]
        unknowns            : ["Keypad path is manual_cited, not bench-verified."]        [NEW]
        safety_warning      : energized-drive caution if applicable                       [NEW]
  → each surface renders the SAME object:
        Ask MIRA (engine + Ignition text): appends "### Related parameter" + "### Keypad steps"
        Hub / phone card (later PR): a KeypadNavigationCard component
```

Rendered Ask-MIRA text (illustration, not a spec):

```
## Live Machine Evidence
Drive tripped on a Modbus comm timeout (CE10).

### Fault diagnostic: CE10 — Modbus communication timeout
Likely causes: loose RS-485 wiring; master stopped polling; comm-timeout set too low.
First checks: verify RS-485 A/B + shield; confirm the master is polling; check P09.03.
Source: GS10 User Manual, Ch.9 Communication (manual_cited)

### Related parameter: P09.03 — Comm Time-out Detection
Purpose: how long the drive waits for a Modbus poll before it trips CE10.
Values: 0.0 = disabled · >0.0 = timeout seconds.  Default 0.0.  Range 0.0–100.0 s.
Source: GS10 User Manual, Ch.9 (manual_cited)

### Keypad steps — view P09.03 (VIEW ONLY — do not press ENTER to change it)
1. Press MODE until the display shows a parameter group.
2. Use ▲/▼ to select group P09 (Communication).
3. Press ENTER to open the group, then ▲/▼ to P09.03.
4. The value shown is the current comm-timeout setting.
Confidence: medium (manual_cited, not bench-verified).
```

## 6. Setup / admin workflow (train-before-deploy)

1. Admin opens the drive family in the Command Center, uploads/links the OEM manual (KB ingest —
   existing path). The manual text lands in `knowledge_entries`.
2. Admin authors (or reviews auto-proposed — later phase) `ParameterCard`s + `KeypadNavigationCard`s
   into the family's `pack.json` v2 blocks, each with an honest `source_citation` + `provenance_tier`.
3. Admin **validates**: MIRA answers the family's validation questions (e.g. "how do I check the
   comm-timeout setting on a GS10?") with cited, grounded guidance a human marks good.
4. Only after approval does the family's keypad/parameter guidance deploy to the HMI surface — per
   `train-before-deploy.md` and `asset-agent-validation-spec.md`. Beta = read-only, view-only.

First slice ships the **GS10 data hand-curated** (`manual_cited`), exactly like `drive_fault_intel.py`
did for fault cards — the authoring UI + auto-extraction are later phases, not a precondition.

## 7. Data model & service-pack schema (summary — full spec in the schema proposal)

Canonical objects (see `drivesense_service_pack_schema_proposal.md`):
- **`ParameterCard`** — `parameter_id` (`P09.03`, the keypad/manual number, *not* a Modbus addr),
  `name`, `purpose`, `value_meanings[]`, `default`, `range`, `unit`, `related_faults[]`,
  `source_citation`, `provenance_tier`, `confidence_tier`.
- **`KeypadNavigationCard`** — `goal`, `parameter_id`, `menu_group`, `keypad_steps[]`, mandatory
  non-empty `view_only_warning`, optional `edit_warning`, `source_citation`, `confidence_tier`,
  `provenance_tier`.
- **`DriveDiagnostic` (extended)** — adds `related_parameters[]`, `keypad_navigation`, `evidence[]`,
  `unknowns[]`, `safety_warning`; all default empty/None (behavior-preserving).
- **`Citation` (extended)** — adds `section`, `chunk_id`, `tier`; `section` is the floor, `page` only
  when provable.
- **`DriveSenseServicePack`** — the loaded view; authoring format = `pack.json` schema_version 2 with
  new optional `parameters[]` + `keypad_navigation[]` blocks (v1 packs back-compat with empty blocks).

Storage decision (see schema proposal §7): structured parameter/keypad data lives in **`pack.json`**
(offline, read-only-gate-covered, shipped in image) because it exists in no store today — not a new
DB table, not KB prose, not (yet) the KG. Manual *text* stays in KB; fault↔parameter *relationships*
go to the KG **later** (Layer B), in-pack `related_faults[]` first (Layer A).

## 8. `DriveDiagnostic` extension proposal

`build_drive_diagnostic(snapshots)` gains: after building `fault_card`, look up the active fault's
`related_faults`-matching `ParameterCard`s from the loaded service pack, pick the top one's
`KeypadNavigationCard`, flatten citations into `evidence`, record `unknowns` (e.g. non-bench-verified
keypad path), and set `safety_warning` when guidance touches energized action. **No behavior change
when there is no active GOOD fault** — the new fields stay empty, existing tests pass unchanged.

## 9. `KeypadNavigationCard` proposal

- **View-only by construction.** `view_only_warning` is mandatory and non-empty; `edit_warning` is
  normally `None` (beta ships no edit paths). A card is invalid without the view-only warning.
- `keypad_steps` are plain strings — displayed, never executed. No "do it for me" affordance.
- `confidence_tier` is required (not optional) because wrong steps at an energized drive are a safety
  risk; the surface must always show how sure MIRA is.
- Co-authored with the `mira-industrial-safety` contract: if the goal/steps hit a SAFETY keyword, the
  STOP/escalate behavior wins over rendering the card.

## 10. `ParameterCard` proposal

- Family-keyed (`drive_family` = pack_id); shared once per family, per-model overrides later.
- `parameter_id` is the manual's number; `value_meanings[]` decodes setting values *only when the
  manual documents them* (else empty — do not invent meanings).
- `related_faults[]` is the first-slice fault↔parameter link (Layer A). No KG required.

## 11. Fault-to-parameter relationship model

Two layers (schema proposal §6): **Layer A (now)** = in-pack `ParameterCard.related_faults[]`,
sufficient for "CE10 → P09.03"; **Layer B (deferred)** = a real `kg_entities.entity_type="parameter"`
+ `fault_relates_to_parameter` edge, admin-verifiable, gated on resolving the two-competing-KG-schema
ambiguity. Value ships on Layer A; the KG is not a precondition.

## 12. Citation / evidence model

- Every parameter/keypad fact carries a `Citation` with **section-level minimum**; a `page` appears
  **only** when the source provably came through the pdfplumber/Docling ingest path or was
  hand/bench-verified (no fabricated pages — the `source_page` column is a chunk index on one ingest
  path, see parsing plan §2).
- `chunk_id` links to a real `knowledge_entries` row when one exists.
- `tier` ∈ {`bench_verified`, `manual_cited`}. First GS10 data ships `manual_cited`; a bench pass
  promotes specific cards to `bench_verified`.
- `DriveDiagnostic.evidence` is the auditable trail; threading it into `decision_traces` is a later PR.

## 13. Trust & safety rules

1. **Read-only. View-only.** No parameter/keypad write or edit execution, ever, in beta. Covered by
   the existing `test_drive_packs_readonly.py` AST gate (extended to the new files).
2. **No fabricated pages** (§12). Section-level honesty is required; page is a provable bonus.
3. **Honest unknowns.** `unknowns[]` surfaces "manual_cited, not bench-verified" rather than implying
   certainty.
4. **Safety-keyword supremacy.** `mira-industrial-safety` STOP/escalate wins over any keypad render.
5. **Mandatory view-only warning** on every `KeypadNavigationCard`.
6. **Train before deploy.** Keypad/parameter guidance for a family reaches the HMI only after
   validation + approval (`train-before-deploy.md`, `asset-agent-validation-spec.md`).
7. **UNS certification unchanged.** Direct-connection surfaces still certify the machine; chat
   surfaces still gate. This feature adds content, not a new front door.

## 14. Testing plan

- **Object shape / back-compat:** `ParameterCard`/`KeypadNavigationCard` frozen; `DriveDiagnostic`
  extension keeps existing byte-identical tests green; a v1 `pack.json` loads with empty new blocks.
- **Drift guard:** `KeypadNavigationCard`/`ParameterCard` for GS10 reference only fault codes that
  exist in the pack (mirror of `test_gs10_fault_intel_matches_pack_fault_codes_exactly`); every
  keypad card has a non-empty `view_only_warning`.
- **End-to-end proof (the acceptance test):** a GS10 CE10 snapshot → `build_drive_diagnostic` yields a
  `related_parameters` containing `P09.03` and a `keypad_navigation` card; **both** the engine
  (`render_machine_evidence`) and Ignition (`assess_from_paths`) surfaces render byte-identical
  keypad text (mirror of the existing both-surfaces-identical test).
- **Offline / read-only:** all new paths survive `socket.socket` monkeypatched to raise; the AST gate
  finds no forbidden imports/writes in the new files; new `pack.json` keys are in the allowed set and
  the Hub byte-identical copy is re-synced.
- **Citation honesty:** a test asserts no `ParameterCard`/`KeypadNavigationCard` emits a `page`
  unless its citation is flagged provable; section is always present.

## 15. Phased implementation plan (summary — full breakdown in the dev plan)

- **PR A** — these six discovery docs (this deliverable). Docs only.
- **PR B** — schema/types only: `ParameterCard`, `KeypadNavigationCard`, `Citation`/`DriveDiagnostic`
  extension, `pack.json` schema_version 2 back-compat. No data, no rendering.
- **PR C** — GS10 keypad + parameter **fixture** (hand-curated `manual_cited`), the CE10→P09.03 case
  + a few more params; drift guard; Hub copy re-sync.
- **PR D** — wire `build_drive_diagnostic` to populate the new fields; both surfaces render the text.
- **PR E** — the CE10 → P09.03 keypad-guide end-to-end + both-surfaces-identical + offline tests.
- **PR F** — a simple Hub/phone `KeypadNavigationCard` render (or confirm the Ask-MIRA text render
  from PR D is the shippable surface). Optional.
- **PR G** — optional trace threading (`parameter_id` + keypad citation → `decision_traces`); bigger
  (engine + Hub migration), deferred.

## 16. Out of scope

- ❌ Parameter/keypad **writes or edit execution** — view-only, read-only, always.
- ❌ A full **auto-extraction** pipeline as a precondition — first GS10 data is hand-curated; extraction
  is a later phase (parsing plan).
- ❌ A complete **KG** (Layer B) before delivering value — in-pack `related_faults[]` ships first.
- ❌ **Slack/Telegram** keypad rendering — deferred until the adapter layer is confirmed ready; the
  object is surface-agnostic so it's a small later consumer PR.
- ❌ A **giant GUI** / desktop fleet console / mobile connector — those are separate ADR-0025 tracks.
- ❌ A **DB-backed** parameter/keypad reader as a precondition — offline pack data first.
- ❌ New drive families beyond GS10 — PowerFlex 525 is next, not now.
- ❌ Live fieldbus calls in tests — everything offline.

## 17. Acceptance criteria

1. Given a GS10 CE10 live snapshot, `build_drive_diagnostic` returns a `DriveDiagnostic` whose
   `related_parameters` includes `P09.03` and whose `keypad_navigation` is a `KeypadNavigationCard`
   with non-empty `keypad_steps` and a non-empty `view_only_warning`.
2. The engine and Ignition surfaces render **byte-identical** related-parameter + keypad text for that
   case (single-source-of-truth preserved).
3. Every emitted parameter/keypad fact carries a `Citation` with at least a `section`; no `page`
   appears unless provable; `tier` is a valid provenance value.
4. All existing DriveSense/live-snapshot tests remain green (behavior-preserving extension).
5. The read-only AST gate passes over all new files; the Hub byte-identical pack copy is in sync.
6. No network/socket dependency in any new path (offline test with `socket` blocked passes).
7. `unknowns[]` truthfully reflects the GS10 data's `manual_cited` (not bench-verified) status.

## 18. Cross-references
- `drivesense_service_pack_schema_proposal.md` — canonical object definitions.
- `drivesense_manual_keypad_gap_report.md` — built/partial/missing/risky/deferred.
- `drivesense_manual_parsing_plan.md` — turning manual tables into structured cards (later phase).
- `drivesense_subagent_development_plan.md` — the small-PR sequence.
- `drivesense_technician_keypad_workflow.md` — phone + keypad + live-data walkthrough.
- `docs/drive-commander/pack-construction-and-observability.md`, `docs/adr/0025-*.md`.
