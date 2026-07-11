# Drive Commander Packs — Construction, Storage, and Observability

> **Scope.** This is a reference/architecture doc for the "Drive Commander" **drive pack** system:
> how a pack is constructed, **where its data actually lives (KB vs KG vs the relational
> template layer)**, and how a pack-driven diagnosis is traced and observed. It is written to
> orient enrichment work (follow-up #1: filling the GS10 pack). It records the current *shipped*
> state, the known gaps, and the design decisions taken for enrichment.
>
> **Authoritative sources:** ADR-0025 (`docs/adr/0025-drive-intelligence-packs-and-drive-commander.md`),
> the pack schema README (`mira-bots/shared/drive_packs/packs/README.md`), and the code cited
> inline. Where this doc and an older doc disagree, the code wins — file:line citations are given.

---

## TL;DR

- A **pack is a small JSON manifest** (`mira-bots/shared/drive_packs/packs/<family>/pack.json`).
  It holds only what exists nowhere else: **live-decode tables, the operating envelope, and the
  nameplate/family match descriptor.**
- The manual text and the extracted diagnostic intelligence do **not** live in the pack. They live
  in the database. The pack **points at** those rows by id through its `knowledge` block.
- **"KB or KG or both?" → Both, plus a relational template layer.** A fully-enriched pack references
  three stores: the **KB** (`knowledge_entries` — chunked manual text), the **component-template
  layer** (`component_templates` + `component_template_sources` — extracted intelligence + per-fault
  citations), and the **KG** (`kg_entities` / `kg_relationships`). The pack itself is a fourth thing,
  a file, that *references* all three. It is not stored in the DB.
- **Today the `knowledge` block is empty** (`kb_document_ids: []`, `component_template_id: null`,
  `kg_entity_ids: []`). That is the foundation-only state ADR-0025 §1b describes — enrichment fills it.
- **Observability:** a diagnosis is traced by `decision_trace.py` → the append-only `decision_traces`
  table, plus optional local JSONL and the KG-subgraph `kg_query_traces` table. **There is no
  pack-specific trace record yet** — which pack loaded, which fault resolved, and which per-fault
  citation was used are **not** currently threaded into any trace. That gap is called out below.

---

## 1. How a pack is constructed

### 1.1 What a pack is (and is not)

A drive pack is a language-neutral JSON manifest that turns a VFD family's register maps,
status/fault tables, and operating envelope into **data an engine loads** — instead of hardcoding
one drive family into engine code (`mira-bots/shared/drive_packs/packs/README.md:11-26`).

The governing rule is **"reuse, don't re-hold"** (`README.md:176-186`):

> A pack is **not** a copy of the manufacturer's manual and **not** a parallel knowledge store.
> Layers 1–2 (full manual text + extracted fault/parameter intelligence) already live in
> `knowledge_entries` / `component_templates` / `component_template_sources` / `kg_entities` — the
> pack **points at** those rows by id. It only adds what doesn't exist anywhere else.
> **A pack that duplicates KB/KG content instead of pointing at it is a defect.**

### 1.2 The `pack.json` schema (8 required top-level keys)

Canonical example: `mira-bots/shared/drive_packs/packs/durapulse_gs10/pack.json`.

| Key | What it carries | Lives only in the pack? |
|---|---|---|
| `pack_id` | Slug; must equal the directory name (`durapulse_gs10`). | — |
| `schema_version` | `1` for this generation. | — |
| `family` | `manufacturer`, `series`, `aliases[]` — the family-first match descriptor. | ✅ yes |
| `nameplate` | `match_keywords[]` — matched after `family.aliases`. | ✅ yes |
| `live_decode` | `status_bits`, `cmd_word`, `fault_codes` (string keys → int on load), and `registers` (addr/unit/scaling/datapoint). | ✅ yes |
| `envelope` | Expected operating band per analog signal (`dc_bus`, `current`, `frequency`). Closes the `tag_entities.expected_envelope` gap. | ✅ yes |
| `knowledge` | **ID pointers** into existing stores: `kb_document_ids[]`, `component_template_id`, `kg_entity_ids[]`. | ❌ no — pointers into KB/KG/template layer |
| `provenance` | Per-field provenance tier + the sources it rests on. | mixed |

**Provenance vocabulary is strict** (`README.md:136-159`): each `provenance.items` entry is exactly
`bench_verified` (measured on hardware) or `manual_cited` (from a manual, not bench-verified).
**Never write bare `"verified"`** — that word is reserved for `kg_*.approval_state` (ADR-0017) and
means an admin-signed-off KG edge, a different thing.

> ⚠️ **Bench-verified correction:** the GS10 `cmd_word` REV+RUN value is **34** (`0x22 = 0x20 REV | 0x02 RUN`),
> not 20. The pack.json is correct (34); the `README.md:93` illustrative snippet still shows the stale 20.
> Authority: `plc/conv_simple_anomaly/rules_core.py` (bench-verified 2026-06-12). Do not let 20 regress.

### 1.3 The loader and models (`mira-bots/shared/drive_packs/`)

Pure Python, no network/DB/fieldbus I/O — the only file access is reading `pack.json` off disk.

- **`schema.py`** — frozen dataclasses only (`Family`, `Nameplate`, `RegisterEntry`, `LiveDecode`,
  `EnvelopeBand`, `Envelope`, `Knowledge`, `Provenance`, `DrivePack`). No I/O.
- **`loader.py`** — `load_pack(pack_id)`, `list_packs()`, `resolve_pack(text)`.
  - `_packs_dir()` resolves `Path(__file__).resolve().parent / "packs"` — **co-located package data,
    `__file__`-based.** This is deliberate: the mira-pipeline Docker image only `COPY`s
    `mira-bots/shared/`, so a repo-root-relative loader would crash-loop the container at import.
    (Caught by CI's Docker Build Check — see ADR-0025 Consequences.)
  - `resolve_pack` is a **two-pass, family-first** match across *all* packs: pass 1 checks every
    pack's `family.aliases`; pass 2 (only if pass 1 is empty) checks every pack's
    `nameplate.match_keywords`. Family-alias precedence is independent of load order.
- **`nameplate.py`** — `resolve_pack_from_vision(vision_output)` maps a structured nameplate-OCR dict
  to text and calls `resolve_pack`. Excludes symptom/condition fields (those describe the fault, not
  the family). Returns `None`, never raises, on bad input.

### 1.4 Where the pack is consumed

- **`live_snapshot.py`** loads the GS10 pack **at import** (`_GS10_PACK = load_pack("durapulse_gs10")`)
  and sources its `_STATUS_BITS`/`_CMD_WORD`/`_FAULT_CODES`/`_REGISTERS` from it (no hardcoded
  literals). It self-validates the required register keys at import, failing loudly on a bad pack
  edit. The envelope-driven analog assessment stays **silent** unless the datapoint is envelope-covered,
  the snapshot is present/numeric/`GOOD` quality, the pack defines a *full* band (both `min` and
  `max`), and the value is out of band. (`current` has no rated band today → always silent.)
- **`cards.py`** derives **diagnostic cards** — see §3.

---

## 2. Where a pack's knowledge lives — KB, KG, or both

**Answer: both — plus a relational template layer that sits between them.** The pack is a JSON file
that *references* rows in these stores; the stores hold the actual content.

```
              pack.json (a FILE, not a DB row)
              └─ knowledge:
                   ├─ kb_document_ids[]      ──▶  KB:  knowledge_entries          (chunked manual text)
                   ├─ component_template_id  ──▶  TPL: component_templates        (extracted intelligence)
                   │                              └─  component_template_sources  (per-fault page+excerpt citations,
                   │                                    FK source_document_id ──▶ knowledge_entries)
                   └─ kg_entity_ids[]         ──▶  KG:  kg_entities / kg_relationships
```

### 2.1 KB — `knowledge_entries` (chunked, citable manual text)

- Schema: `docs/migrations/001_knowledge_entries.sql`. Columns include `id UUID PK`, `tenant_id`,
  `manufacturer`, `model_number`, `content`, `embedding vector(768)`, `source_url`, `source_page`
  (**chunk index, not PDF page**), `metadata JSONB`, `is_private`, `chunk_type`. The table predates
  formal migrations (~25k+ rows in prod).
- Retrieval: `mira-bots/shared/neon_recall.py` (`recall_knowledge`, `_like_search`, `_product_search`).
  Fulltext/tsvector path works even when `embedding` is NULL.
- **GS10 content already exists**: `tools/seeds/gs10-vfd-knowledge.sql` seeds 5 chunks (Modbus RTU
  params with real register addresses like `0x2100`, the register map, common failure modes,
  MSG_MODBUS ErrorID decode, RS-485 wiring) — **under tenant `mike-garage-demo`
  (`78917b56-f85f-43bb-9a08-1bb98a6cd6c3`)**, i.e. tenant-scoped, `embedding` NULL pending backfill.

### 2.2 Template layer — `component_templates` (+ `component_template_sources`)

This is the **ADR-sanctioned enrichment source** the `TemplateReader` seam is designed around.

- Schema: `mira-hub/db/migrations/016_component_templates.sql`. Diagnostic fields the pack cares about
  are JSONB arrays: `common_failure_modes`, `troubleshooting_steps`, `diagnostic_indicators`,
  `expected_signals`, `pm_checks`, `safety_notes`, plus `verification_status`
  (`proposed`/`verified`/`rejected`) and `version`.
- `component_template_sources` (same migration) carries the **citation trail**: `source_type`
  (`manual`/`datasheet`/`print`/…), `source_document_id` **FK → `knowledge_entries.id`**,
  `page_numbers`, `excerpt`, `extraction_confidence` (0–1), `extracted_by` (`llm`/`human`/…).
- Builder: `tools/build_component_template.py` runs the full pipeline (fetch KB chunks → LLM cascade
  extraction → INSERT into both tables). **Status: appears to have only been dry-run** for GS10 /
  PowerFlex 525 (its docstring says "2/15 → 6/15 fields populated" on a PowerFlex dry run). **A
  committed `component_templates` row for GS10 must be verified against NeonDB (or produced via
  `--commit`) before `component_template_id` can be populated.** This is a DB/LLM data step, not a
  code change.

### 2.3 KG — `kg_entities` / `kg_relationships`

- **Two schemas exist in the repo — this is a genuine ambiguity to resolve before KG work:**
  - `docs/migrations/004_kg_entities.sql` / `005_kg_relationships.sql` — headers say
    **"PLANNED — do not run until GraphRAG phase starts."**
  - `mira-hub/db/migrations/001_knowledge_graph.sql` — RLS-enabled, referenced elsewhere as live
    (`entity_type`/`entity_id`/`name`/`properties`, `kg_relationships.confidence`, `kg_triples_log`).
  - ADR-0025's `kg_*.approval_state` column language does **not** literally appear in either migration
    found; confirm the real column name against the deployed Hub schema before assuming it.
- **No GS10 `kg_entities` seeding script exists.** Of the three pointers, `kg_entity_ids` is the
  least-built — effectively greenfield for GS10.

### 2.4 A fourth, already-populated source ADR-0025 does not mention: `fault_codes`

`docs/migrations/002_fault_codes.sql` defines a structured `fault_codes` table
(`code, description, cause, action, severity, equipment_model, manufacturer, source_chunk_id,
source_url, page_num`). `mira-core/scripts/seed_fault_codes.py` seeds GS10 fault content in two shapes:
**`GS10_NUMERIC`** — the numeric register-0x2100 codes → *name only* (`4: GFF — ground fault`,
`12: Lvd`, `21: oL`, `49: EF`, `54–58: CE1..CE10`), matching the pack's `live_decode.fault_codes` 1:1
but carrying **generic boilerplate** cause/action; and **`GS_SUPPLEMENT`** — the *keypad-mnemonic*
rows (`GF`/`UV`/`OL`/`EF`/`CF1`, letter codes not numeric) which DO carry real per-condition
cause/action. So the code-specific prose must be assembled by mapping numeric → mnemonic, and the CE
comm codes (54–58) have no cause/action row in this file at all. (This corrects an earlier draft that
said `GS10_NUMERIC` carries real per-code prose — it does not.)

This is the fastest available source of `causes_for` / `checks_for` / citations, but it is **not** one
of the three stores the `knowledge` block names. **Follow-up #2 wired an offline, `manual_cited`
GS10 fault table (`drive_fault_intel.py`) derived from these sources into the card path** (§3); a
DB-backed reader over the live `fault_codes` table remains the deferred next step.

### 2.5 The split, stated plainly

| Thing | Where it lives | In the pack file? |
|---|---|---|
| Live-decode tables, envelope, nameplate match | the pack JSON | ✅ the whole point |
| Chunked manual text | `knowledge_entries` (KB) | ❌ referenced by `kb_document_ids` |
| Extracted failure modes / troubleshooting / per-fault citations | `component_templates` + `component_template_sources` | ❌ referenced by `component_template_id` |
| Graph entities/relationships | `kg_entities` / `kg_relationships` (KG) | ❌ referenced by `kg_entity_ids` |
| Structured fault cause/action prose | `fault_codes` (unreferenced by schema today) | ❌ see §5 decision |

**The pack file is never stored in the database.** It is package data shipped in the image. Its Hub
twin (`mira-hub/src/lib/drive-packs/gs10-pack.json`) is a **byte-identical copy** (build-context
boundary; drift-guarded — see §4).

---

## 3. Diagnostic cards and the `TemplateReader` seam

A **diagnostic card** (`mira-bots/shared/drive_packs/cards.py`) is a derived, cited view over one
fault code — the unit the UI shows and the LLM cites. `build_cards(pack, *, template_reader=None)`
derives one card per real fault code (excludes code `0`), fresh every call, writing nothing.

**The seam** (`cards.py:38-51`, verbatim):

```python
@runtime_checkable
class TemplateReader(Protocol):
    def causes_for(self, pack_id: str, fault_code: int) -> list[str]: ...
    def checks_for(self, pack_id: str, fault_code: int) -> list[str]: ...
    def citations_for(self, pack_id: str, fault_code: int) -> list[Citation]: ...
```

- **Default path (`template_reader=None`):** `likely_causes=[]`, `first_checks=[]`, `confidence=None`;
  `citations` fall back to the pack-level `provenance.sources`.
- **Enriched path:** when a reader is injected, its three methods are called per fault code and each
  non-empty result overrides the card field (`cards.py:106-116`).
- **SHIPPED (follow-up #2) — a real reader is now wired for GS10 at runtime.**
  `mira-bots/shared/live_snapshot.py` builds a `FaultCodesTemplateReader` once at import (fed by the
  **offline** adapter `mira-bots/shared/drive_fault_intel.py`, `build_gs10_template_reader()`), calls
  `build_cards(_GS10_PACK, template_reader=reader)`, and — in `render_machine_evidence`'s active-fault
  branch — renders the matching card's `likely_causes` / `first_checks` / citation into the engine's
  **`## Live Machine Evidence`** section (`render_fault_diagnostic`). So a live GS10 fault now surfaces
  cited, per-fault troubleshooting in Supervisor replies. Read-only/offline: the adapter holds a
  curated `manual_cited` GS10 fault table — **no DB dependency** (the DB-backed reader over the real
  `fault_codes` table is still deferred; this offline adapter is the interim source).
- The Protocol has no `confidence_for()` yet (`DiagnosticCard.confidence` stays `None`) — a deferred
  follow-up to add when the DB-backed reader lands.

---

## 4. Tests and guards (the shipping gate)

- **`mira-bots/tests/test_drive_packs_readonly.py`** — the Drive Commander shipping gate. AST-scans
  `drive_packs/**/*.py` for forbidden write-call names, fieldbus/socket imports
  (`pymodbus`/`pycomm3`/`snap7`/`opcua`/`socket`/…), `write_`/`set_param`/`deploy_`/`send_command`
  def prefixes, and Modbus write function-code literals (5/6/15/16) adjacent to an `fc=`-shaped
  keyword. Also asserts every `pack.json` is pure JSON with only the documented top-level keys, and
  self-tests the checker against bad/good fixtures. **Scope note:** it proves the *pack/loader/card*
  surface is pure data reshaping — it does **not** prove a future desktop connector is read-only.
- **`mira-bots/tests/test_drive_pack_hub_copy_sync.py`** — asserts
  `mira-hub/src/lib/drive-packs/gs10-pack.json` is **byte-for-byte identical** to the canonical
  `packs/durapulse_gs10/pack.json`. Any pack.json edit must re-sync the Hub copy or this fails.
- **Hub loader** (`mira-hub/src/lib/drive-packs/loader.ts`) imports the copy as a build-time bundled
  object and ports only a **minimal subset** of the schema — it does **not** currently type or read
  `knowledge`/`provenance`. Enrichment that must surface `knowledge.*` on the Hub side would need to
  extend `DrivePack`/`loadPack()` in `loader.ts` *and* keep the byte-identical guard satisfied.

---

## 5. Tracing & observability

### 5.1 What actually traces a diagnosis today

- ⚠️ **`mira-bots/shared/agent_trace.py` does not exist on `main`.** It is described in
  `docs/observability/mira-agent-eval-audit.md` and referenced from `CLAUDE.md`, but the file only
  exists on the orphaned `parking/untangle-code-2026-06-16` branch. **Treat any doc citing
  `agent_trace.py` as dead documentation.**
- **The real per-turn trace is `mira-bots/shared/decision_trace.py`.** `build_trace_row()` (pure) +
  `write_trace()` (async, fail-open, 2s timeout) INSERT into `decision_traces`
  (`mira-hub/db/migrations/032_decision_traces.sql`): `trace_id, tenant_id, session_id, platform,
  uns_path (LTREE), user_question, tag_evidence/manual_evidence/kg_evidence (JSONB), recommendation,
  citations_present, technician_confirmed, outcome, model_used, latency_ms, ts`. **Append-only**
  (`GRANT SELECT, INSERT` only; `REVOKE UPDATE, DELETE`), with a partial index
  `decision_traces_uncited_idx … WHERE citations_present = false` for a groundedness sweep.
- Wired from `engine.py` (`_schedule_decision_trace`) **after** the reply is built as a fire-and-forget
  `asyncio.create_task` — never blocks the reply. It also emits a **local JSONL trace** via
  `mira-bots/shared/observe/from_engine.py::emit_local_trace` (off unless `MIRA_LOCAL_TRACE=1`).
- **`kg_query_traces`** (`mira-hub/db/migrations/033_kg_query_traces.sql`) persists the KG reasoning
  subgraph behind an answer (`entity_ids UUID[]`, `edges JSONB`) for the `/graph` page — best-effort.
- **`citation_compliance.py`** — observational: logs `CITATION_COMPLIANCE_MISS`/`OK` and a
  vendor-mismatch `CITATION_RELEVANCE_MISS`; `enforce_citation_via_rewrite()` salvages an
  uncited-but-grounded reply with an insertion-only LLM rewrite.
- **Groundedness scoring** — `engine.py`'s `_CRITIQUE_PROMPT` is a 3-dimension self-critique judge
  (groundedness / helpfulness / instruction_following, 1–5), gated by `_CRITIQUE_*` env vars, with
  low-groundedness episode tracking.

### 5.2 Observability of a *pack-driven* diagnosis — the gap

**There is no pack-specific trace record today.** Nothing in `decision_traces`, `kg_query_traces`,
or `observe/` logs which pack loaded, which fault code resolved, or which per-fault citation a card
used. `decision_traces.manual_evidence` is shaped generically from RAG `_last_sources`
(`decision_trace._manual_evidence_from_sources`), **not** from `DiagnosticCard.citations`.

**Consequence for enrichment:** as of follow-up #2 the card *is* rendered into the engine's Live
Machine Evidence text (§3), but its citation is still **not** threaded into the structured
`decision_traces` row. The **card layer and the trace layer remain unwired.** A follow-up task should:

1. Record `pack_id` + resolved `fault_code` on the trace row (a new field or into `metadata`).
2. Map `DiagnosticCard.citations` → `decision_traces.manual_evidence` so a cited pack diagnosis is
   auditable via the existing uncited-sweep index.

**Deferred in follow-up #2 (deliberately, to keep the PR small):** threading the card into
`decision_traces` requires touching `engine.py`'s `_schedule_decision_trace` *and* either a new
nullable column (a Hub migration) or overloading the existing `metadata`/`tag_evidence` JSONB — that
is engine + schema surface, well beyond a small wiring PR. Recorded here rather than expanded into
scope. Until it lands, a pack diagnosis is observable only at the generic RAG-source granularity, not
per-card.

---

## 6. Enrichment seams for follow-up #1 (field-by-field)

| Pack field | Source | Mechanism / status |
|---|---|---|
| `live_decode.registers[*].addr` (all `null`) | Real Modbus addresses in `tools/seeds/gs10-vfd-knowledge.sql` (`0x2101/0x2102` freq, `0x2103` current, `0x2104` dc_bus) | Data edit, but **needs a careful cross-check** of addr↔`datapoint`↔`_decode_one` (`live_snapshot.py`) before writing — a wrong address is a correctness defect. Provenance must be `manual_cited`. **Deferred out of the first slice** for that reason. |
| `knowledge.kb_document_ids` | `knowledge_entries.id` for the GS10 seed chunks | Rows exist but are **tenant-scoped** (`78917b56-…`); packs have no tenant concept. **Decision owed** (§7). Ids may be non-deterministic (`gen_random_uuid`) → requires a NeonDB lookup, not an offline edit. |
| `knowledge.component_template_id` | a `component_templates` row for GS10 | `build_component_template.py --commit` must run (LLM + DB) or an existing row be verified. DB/LLM step, not offline code. |
| `knowledge.kg_entity_ids` | `kg_entities` rows | Greenfield; blocked on the KG-schema ambiguity (§2.3). |
| card `causes_for`/`checks_for`/`citations_for` | `fault_codes`-shaped intel (per-code, keys match the pack 1:1); `component_templates`/KG layered in later as component-level context | **SHIPPED** — `FaultCodesTemplateReader` (#2482) + wired into `render_machine_evidence` via the offline `drive_fault_intel.py` adapter (#2482 follow-up #2). DB-backed reader over the live `fault_codes` table still deferred. |

---

## 7. Design decisions taken for enrichment (recorded, not silently assumed)

The exploration surfaced genuine forks. To let work start without stalling, these decisions are
recorded here; revisit with the user if any proves wrong.

1. **The first real `TemplateReader` is backed by the `fault_codes` table** (`GS10_NUMERIC`), *not*
   `component_templates` directly. Rationale — a schema fact, not a preference: the Protocol is
   **keyed by numeric `fault_code`**, and `fault_codes` is the only store whose keys match the pack's
   `live_decode.fault_codes` **1:1**, already populated with real `cause` / `action` / `page_num` /
   `source_url` per code. `component_templates.common_failure_modes` is a **flat, component-level**
   list — it is *not* fault-code-keyed, so it cannot answer `causes_for(fault_code)` on its own.
   The `component_templates` / `component_template_sources` layer and `kg_entities` are therefore
   **layered in afterward as component-level context** (richer citations, PM checks, safety notes),
   not as the first per-fault reader. This keeps the enriched card faithful to the ADR's reuse layers
   without inventing a fault-code index the template table doesn't have. (ADR-0025's seam docstring
   names `component_templates` — record this as a refinement: the *code-keyed* answer comes from
   `fault_codes`; the *component-level* enrichment comes from `component_templates`/KG.)
2. **The reader takes an injected data source** (a fetch callable / rows), so it is pure and
   **offline unit-testable** with fixtures. The live NeonDB query is a thin, separately-tested
   adapter — no live DB in the card/reader unit tests, honoring `test_drive_packs_readonly.py`'s
   no-DB-in-`drive_packs` constraint (the adapter lives outside `drive_packs/` if it touches the DB).
3. **Populating the `knowledge` id pointers is a data step, deferred** behind the code seam.
   `component_template_id` needs a committed row; `kb_document_ids` needs a tenant-scoping decision;
   `kg_entity_ids` needs the schema resolved. None are offline code changes, so they are **not** in
   the first slice.
4. **Register `addr` population is deferred** — real, valuable, but correctness-sensitive; do it as a
   dedicated, cross-checked task, not bundled into the seam work.

**First enrichment slice = implement the injectable `TemplateReader` against the template schema,
fully unit-tested.** It is ADR-faithful, offline, reviewable, and it is the seam every other
enrichment task depends on.

### 7.1 Follow-up #2 — shipped state and remaining gaps

**Shipped:** the reader is now a **runtime caller** (the first ever) — `live_snapshot.py` injects an
offline `FaultCodesTemplateReader` into `build_cards` and renders the active GS10 fault's card
(likely causes / first checks / cited source). Data is a curated `manual_cited` GS10 fault table
(`drive_fault_intel.py`), so enrichment is product-visible with **no DB dependency**. Provenance is
honest per code (numeric faults → P06.17; CE comm codes → the Modbus-comm section — never a page the
text isn't grounded in). **Both surfaces are now enriched:** the engine path
(`render_machine_evidence`) *and* the Ignition direct "Ask MIRA" path (`assess_from_paths`), through a
single shared helper `_render_active_fault_diagnostic(snapshots)` — the GOOD-quality gate + card render
lives in **one** place, no duplicated diagnostic logic across surfaces.

**Structured response object (shipped):** both surfaces now build a single surface-agnostic
`DriveDiagnostic` (`assessment` + optional `fault_card: DiagnosticCard`) via
`build_drive_diagnostic(snapshots)` in `live_snapshot.py`, then render it — one typed payload the
engine and Ignition paths share (and future Hub/Slack/Telegram + the trace layer can consume). This is
a behavior-preserving refactor: the emitted text is byte-identical. It does **not** add new surfaces.

**Remaining gaps (deferred, documented):**
1. **DB-backed reader** over the live `fault_codes` table — replaces the interim offline
   `drive_fault_intel.py` adapter. Needs a thin NeonDB adapter (outside `drive_packs/`).
2. **Trace threading** — thread `DriveDiagnostic` (fault_code + card citations) into `decision_traces`
   (see §5.2); engine + schema work. Now that the structured object exists, this is the natural next step.
3. **Additional consuming surfaces** — Slack / Telegram / a Hub panel that render the shared
   `DriveDiagnostic`. The object is ready; the surfaces are not built.
4. **`knowledge.*` id-pointers**, **register `addr`**, **`confidence_for()`** — as in §6/§7 above.

*(The Ignition-path gap and the cross-surface response-object gap listed in follow-up #2 are now
closed — this §7.1 entry reflects that.)*

---

## 8. Cross-references

- `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md` — the product decision (§1b maturity).
- `mira-bots/shared/drive_packs/packs/README.md` — the pack schema, field by field.
- `mira-bots/shared/drive_packs/{schema,loader,nameplate,cards}.py` — the pack model + card seam.
- `mira-bots/shared/live_snapshot.py` — the pack's live-decode + envelope consumer; **the first
  runtime caller of `build_cards`** (`render_fault_diagnostic`, follow-up #2).
- `mira-bots/shared/drive_fault_intel.py` — the interim offline GS10 fault-intel adapter (follow-up #2).
- `mira-bots/tests/test_drive_packs_readonly.py`, `test_drive_pack_hub_copy_sync.py` — the guards.
- `mira-bots/shared/decision_trace.py` + Hub migrations `032`/`033` — the real trace layer.
- `docs/migrations/001_knowledge_entries.sql`, `002_fault_codes.sql`;
  `mira-hub/db/migrations/016_component_templates.sql`, `001_knowledge_graph.sql` — the stores.
- `tools/seeds/gs10-vfd-knowledge.sql`, `mira-core/scripts/seed_fault_codes.py`,
  `tools/build_component_template.py` — GS10 data sources.
