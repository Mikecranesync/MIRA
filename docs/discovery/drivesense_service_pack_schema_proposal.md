# DriveSense Service Pack — Schema & Type Proposal

> **Status:** Discovery / proposal. No code in this doc — it defines the canonical objects the
> rest of the DriveSense manual-keypad phase is designed against. The PRD
> (`drivesense_manual_keypad_prd.md`), gap report, parsing plan, and dev plan all reference the
> objects defined **here** verbatim. If a field changes, change it here first.
>
> **Grounding:** every "already exists" claim below was verified against the `mira-drivesense-obj`
> worktree (main + `DriveDiagnostic` #2486, HEAD `5b5f6697`) — see the repo-scout findings folded
> into the gap report. The reference doc `docs/drive-commander/pack-construction-and-observability.md`
> is authoritative for the existing pack architecture.

---

## 0. Design axioms (inherited, non-negotiable)

1. **Reuse, don't re-hold.** Manual *text* lives in `knowledge_entries` (KB); extracted
   component-level intelligence + citations live in `component_templates` /
   `component_template_sources`; graph relationships live in `kg_entities` / `kg_relationships`.
   A pack **points at** those by id; it never copies them. *New structured data that exists in no
   store* (keypad steps, parameter decode) is the only thing a pack may hold directly.
2. **Provenance vocabulary is a closed set:** `bench_verified` | `manual_cited`. Never bare
   `"verified"` (reserved for `kg_*.approval_state`, ADR-0017). Enforced today by
   `drive_packs/loader.py::_VALID_PROVENANCE`. New objects reuse this exact set.
3. **No fabricated page numbers.** `knowledge_entries.source_page` is a *chunk index* on one ingest
   path and a *real PDF page* on another, with **no discriminator column** (see parsing plan §2).
   A citation may carry a page **only** when the source provably came through the pdfplumber/Docling
   path or was hand/bench-verified against a known page. Otherwise cite **section-level** and leave
   `page = null`.
4. **Read-only.** No object below carries or executes a write. Parameter/keypad guidance is
   **view-only text**. New pack files are covered by the existing AST gate
   `mira-bots/tests/test_drive_packs_readonly.py`.
5. **Additive & behavior-preserving.** Extending `DriveDiagnostic` must keep the existing
   byte-identical rendering tests green (new fields default to empty/None).

---

## 1. What already exists (the types we extend)

Verbatim from `mira-bots/shared/`:

```python
# drive_packs/cards.py
class Citation:            # dataclass
    ...                    # (doc, page, excerpt)-shaped today; extended in §5 below

@runtime_checkable
class TemplateReader(Protocol):
    def causes_for(self, pack_id: str, fault_code: int) -> list[str]: ...
    def checks_for(self, pack_id: str, fault_code: int) -> list[str]: ...
    def citations_for(self, pack_id: str, fault_code: int) -> list[Citation]: ...

class DiagnosticCard:      # frozen dataclass
    fault_or_symptom: str
    meaning: str
    likely_causes: list[str]
    first_checks: list[str]
    citations: list[Citation]
    confidence: str | float | None = None
    provenance_tier: str = "manual_cited"

# live_snapshot.py  (#2486)
class DriveDiagnostic:     # frozen dataclass
    assessment: str | None
    fault_card: DiagnosticCard | None
```

Pack schema (`drive_packs/schema.py` + `packs/durapulse_gs10/pack.json`), 8 top-level keys:
`pack_id, schema_version, family, nameplate, live_decode{status_bits,cmd_word,fault_codes,registers},
envelope, knowledge{kb_document_ids[],component_template_id,kg_entity_ids[]}, provenance`.

**Crucially: there is no `parameters` block and no keypad concept anywhere.** `live_decode.registers`
is *live telemetry decode* (freq/current/dc_bus → Modbus addr/scaling), **not** the user-facing
configurable parameters a technician reads on the keypad (`P09.03`). These are different things and
this proposal keeps them in separate blocks.

---

## 2. New object: `ParameterCard`

A cited, structured view of one configurable drive parameter. Family-keyed (shared once per family,
per-model overrides later). Frozen dataclass; pure data.

```python
class ParameterCard:                      # frozen dataclass — proposed
    drive_family: str                     # pack_id, e.g. "durapulse_gs10"
    parameter_id: str                     # manual's user-facing number, e.g. "P09.03" (NOT a Modbus addr)
    name: str                             # "Comm Time-out Detection"
    purpose: str                          # what it controls / why a tech checks it
    value_meanings: list[ValueMeaning]    # decode of setting values, when the manual documents them
    default: str | None                   # factory default as printed, or None if unknown
    range: str | None                     # "0.0–100.0 s" as printed, or None
    unit: str | None                      # "s", "Hz", "%", or None
    related_faults: list[str]             # fault codes/mnemonics this param bears on, e.g. ["CE10"]
    source_citation: Citation             # section-level minimum; page only if provable (axiom 3)
    provenance_tier: str                  # "bench_verified" | "manual_cited"
    confidence_tier: str | None = None    # coarse band "low"|"medium"|"high" or None — never a fake float

class ValueMeaning:                       # frozen dataclass — proposed
    value: str                            # "0", "1", "2" or "0.0"
    meaning: str                          # "Warn and continue running"
```

Notes:
- `parameter_id` is the **keypad/manual** identifier. Do **not** reuse `live_decode.registers[*].addr`
  (Modbus register) here — a future `register_hint: str | None` MAY be added when the manual maps the
  parameter to a Modbus address, but it is optional and separate.
- `related_faults` is a **denormalized, in-pack** link (see §6). It is the first-slice substitute for
  a KG fault↔parameter edge — enough to power "CE10 → check P09.03" without a KG.

---

## 3. New object: `KeypadNavigationCard`

Structured, ordered button-press guidance to *reach and view* a parameter on the physical drive.
This is the genuinely-new structured data DriveSense adds — it exists in **no** current store.

```python
class KeypadNavigationCard:               # frozen dataclass — proposed
    drive_family: str                     # pack_id
    goal: str                             # "View the Modbus comm-timeout setting"
    parameter_id: str | None              # target parameter, e.g. "P09.03"
    menu_group: str | None                # "P09 — Communication Parameters"
    keypad_steps: list[str]               # ordered, e.g. ["Press MODE until 'PAr' shows", ...]
    view_only_warning: str                # REQUIRED — "These steps only VIEW P09.03. Do not press
                                          #   ENTER to change it." (safety framing, always present)
    edit_warning: str | None = None       # present ONLY if the card documents an edit path; carries
                                          #   a stop-and-confirm; beta ships VIEW-only, so normally None
    source_citation: Citation
    confidence_tier: str                  # "low"|"medium"|"high" — keypad steps are safety-adjacent
    provenance_tier: str                  # "bench_verified" once run on hardware; else "manual_cited"
```

Notes:
- `view_only_warning` is **mandatory and non-empty**. A `KeypadNavigationCard` with an empty
  `view_only_warning` is invalid (a loader/test assertion). This is the safety contract, not a hint.
- `keypad_steps` are **strings**, not executable instructions. Nothing renders a "do it for me" button.
- `confidence_tier` is required (not optional) here precisely because wrong steps at an energized
  drive are a safety risk — the surface must always be able to show how sure we are.

---

## 4. `DriveDiagnostic` extension (additive, behavior-preserving)

Extend the existing frozen dataclass with new optional fields, all defaulting to empty/None so the
current byte-identical rendering tests (`test_drive_diagnostic.py`, `test_live_snapshot.py`) stay
green with no change:

```python
class DriveDiagnostic:                    # frozen dataclass — EXTENDED
    assessment: str | None                          # EXISTS
    fault_card: DiagnosticCard | None               # EXISTS
    related_parameters: list[ParameterCard] = []    # NEW — params bearing on the active fault
    keypad_navigation: KeypadNavigationCard | None = None  # NEW — how to reach the top related param
    evidence: list[Citation] = []                   # NEW — flattened, de-duped citation set for the whole diagnosis
    unknowns: list[str] = []                         # NEW — honest "what we could not determine" lines
    safety_warning: str | None = None               # NEW — surfaced hazard note (e.g. energized-drive caution)
```

`build_drive_diagnostic(snapshots)` composes these:
- `related_parameters` = the `ParameterCard`s whose `related_faults` include the active fault
  (empty when there is no active/GOOD fault, preserving current behavior).
- `keypad_navigation` = the `KeypadNavigationCard` for the **highest-priority** related parameter
  (or None). First slice: one card; a `list` can come later if multiple params matter.
- `evidence` = union of the fault card's + parameter cards' + keypad card's citations, de-duped.
- `unknowns` = e.g. `["No bench-verified keypad path for P09.03 — steps are manual_cited."]`.
- `safety_warning` = populated when any rendered guidance touches an energized-equipment action;
  co-authored with the `mira-industrial-safety` skill's contract (STOP/escalate keywords still win).

Rationale for the response-object shape: it matches the "important design idea to evaluate" in the
task brief exactly, keeps every surface rendering **one** object (the whole point of #2486), and is
strictly additive so no existing test changes.

---

## 5. Citation / evidence model

Extend `Citation` (today `doc/page/excerpt`-shaped) to carry honest, source-path-aware provenance:

```python
class Citation:                           # dataclass — EXTENDED
    doc: str                              # human label, e.g. "GS10 User Manual"
    section: str | None = None            # "Ch.9 Communication Parameters" — the honest default
    page: str | None = None               # PDF page ONLY when provable (axiom 3); else None
    excerpt: str | None = None            # short verbatim snippet, when available
    chunk_id: str | None = None           # knowledge_entries.id when linked (source_document_id-style)
    tier: str = "manual_cited"            # "bench_verified" | "manual_cited"
```

Rules:
- **`section` is the floor.** Always cite at least a section. `page` is a bonus, populated only when
  the row came through the pdfplumber/Docling ingest path or was hand/bench-verified.
- **`chunk_id`** links back to a real `knowledge_entries` row when one exists — this is already how
  `component_template_sources.source_document_id` and `kg_*.source_chunk_id` work; reuse it.
- **`tier`** reuses the pack provenance vocabulary — no third "inferred" tier is introduced.
- The DriveDiagnostic-level `evidence: list[Citation]` is the auditable trail; a later PR threads it
  into `decision_traces.manual_evidence` (see dev plan PR G).

---

## 6. Fault ↔ parameter relationship model (two layers, honest about maturity)

| Layer | Representation | When | Requires |
|---|---|---|---|
| **A — In-pack denormalized (first slice)** | `ParameterCard.related_faults[]` (+ optional reciprocal `DiagnosticCard` note) | Now | Nothing new — pure pack data |
| **B — KG edge (deferred)** | `kg_entities.entity_type="parameter"` + `relation_type="fault_relates_to_parameter"`, admin-verifiable | Later | Resolve the two-competing-KG-schema ambiguity first; ADR-0017 proposed→verified flow |

Layer A is sufficient to deliver the technician value ("CE10 → P09.03"). Layer B is the durable,
queryable, admin-governed representation for scale — but the task brief is explicit: *do not require
a perfect KG before delivering value*. So **first slice = Layer A**; KG is a separately-scoped
follow-up gated on the KG-schema decision.

---

## 7. `DriveSenseServicePack` — authoring format vs. loaded object

Two things share the name; keep them distinct:

- **Authoring/storage format = the existing `pack.json`, schema_version bumped 1 → 2**, with two new
  **optional** blocks added exactly parallel to `live_decode.fault_codes`:
  ```
  parameters: [ { parameter_id, name, purpose, value_meanings[], default, range, unit,
                  related_faults[], source_citation, provenance_tier, confidence_tier } ]
  keypad_navigation: [ { goal, parameter_id, menu_group, keypad_steps[], view_only_warning,
                         edit_warning, source_citation, confidence_tier, provenance_tier } ]
  ```
  v1 packs (no blocks) load with empty `parameters`/`keypad_navigation` — **back-compat is a test**.
  The two new blocks are added to the read-only gate's allowed top-level keys and to the Hub
  byte-identical copy.
- **Loaded runtime object = `DriveSenseServicePack`** — what `load_service_pack(family)` returns: the
  resolved family view (`fault_codes` + `ParameterCard`s + `KeypadNavigationCard`s + register decode +
  `knowledge` pointers + `evidence_tier` + `bench_verified_notes`). It is a *view over* the pack (+
  optional DB enrichment later), not a new store.

```python
class DriveSenseServicePack:              # frozen dataclass — proposed (loaded view)
    drive_family: str
    fault_cards: list[DiagnosticCard]
    parameters: list[ParameterCard]
    keypad_navigation: list[KeypadNavigationCard]
    modbus_registers: LiveDecode          # reuse existing
    manual_sources: Knowledge             # reuse existing knowledge{} pointers
    evidence_tier: str                    # coarsest tier across the pack: "bench_verified"|"manual_cited"
    bench_verified_notes: list[str]       # hand-confirmed observations, when present
```

**Why pack.json and not a new DB table:** keypad steps and structured parameter decode exist in **no**
store today (axiom 1). Putting them in `pack.json` keeps them offline, read-only-gate-covered,
shipped-in-image, and parallel to how `fault_codes`/`registers` already live — no new migration, no
tenant-scoping decision, no DB dependency for first value. A DB-backed reader (like the deferred
`fault_codes` reader) can replace the offline source later without changing these object shapes.

---

## 8. What stays out of the schema (scope guard)

- ❌ No `write`/`edit`/`set` field or method on any object. View-only.
- ❌ No Modbus function codes, no fieldbus client, no socket — the read-only gate rejects them.
- ❌ No new parallel knowledge store — manual text stays in `knowledge_entries`.
- ❌ No numeric "confidence score" pretending to be calibrated — only coarse tiers.
- ❌ No `parameter` KG entity type in the first slice (Layer B is deferred).
- ❌ No auto-extraction schema — first GS10 param/keypad data is hand-curated `manual_cited`
  (exactly like `drive_fault_intel.py`); the parsing plan describes extraction as a *later* phase.

## 9. Cross-references
- `drivesense_manual_keypad_prd.md` — the PRD these objects serve.
- `drivesense_manual_keypad_gap_report.md` — built/partial/missing/risky tiers.
- `drivesense_manual_parsing_plan.md` — how manual tables become this structured data (later phase).
- `drivesense_subagent_development_plan.md` — the PR sequence that lands these types.
- `docs/drive-commander/pack-construction-and-observability.md` — authoritative existing architecture.
- `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md` — the product decision.
