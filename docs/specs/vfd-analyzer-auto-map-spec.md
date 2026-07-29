# MIRA VFD Analyzer — Auto-Map Spec (Slice 1: config-driven map + click-to-map Setup page)

**Status:** DRAFT · **Date:** 2026-06-14 · **Owner:** Mike · **Phase:** Auto-Map (decouple the analyzer from hardcoded tags)
**Resume context:** `docs/RESUME_2026-06-14_vfd-analyzer-auto-map.md` · **Plan:** `~/.claude/plans/yes-map-the-path-warm-wadler.md` (Phase 3)

> **One line:** make the trend + GS10 fault-decode + A0–A12 anomaly analyzer run on **any** drive's tags,
> configured **at runtime** through a visual **click-to-map** page, with the map stored in **one JSON
> (Document) tag per asset** — no code edit, no redeploy, no DB.

This is **Slice 1 (manual)** of the two-slice auto-map phase. Slice 2 (the cloud AI classifier that
*pre-fills* this map) is outlined in §11 but **not** built here. Ship Slice 1 first; Slice 2 reuses every
contract defined below.

---

## 1. Why this exists / decisions locked

| Decision | Choice | Why |
|---|---|---|
| **Where the map lives** | **Option A — one Ignition `Document` (JSON) tag per asset** | Native 8.3 primitive *for exactly this*; **runtime-editable by the customer with no redeploy** (the whole point); drops into the cache `mira_diagnose` already has; no DB to stand up. |
| **Editor UI** | **Native click-to-map page** (role-first picker + live preview), **not** drag-and-drop | Perspective has **no native drag-and-drop** (would need a JS hack, a custom `.modl`, or a paid module — all reverse our "ship an Exchange resource fast / no `.modl`" call). Click-to-map is fully native, clearer for a novice, and is exactly the surface the Slice-2 AI pre-fills. |
| **Mapping unit** | **Per signal role**, not per tag | The installer thinks "which of my tags is the *output frequency*?", not "what is `AAA_Hz`?". Role-first matches how the analyzer consumes data and makes AI pre-fill drop in cleanly. |
| **Backward compat** | Legacy `LEAF_MAP`/`DEFAULT_FOLDERS` stays as a **fallback** | The live `ConvSimpleLive` panel must keep working byte-identically if no config tag exists. |

Sources behind the storage/UI calls: [Tag Data Types 8.3](https://www.docs.inductiveautomation.com/docs/8.3/platform/tags/tag-data-types), [JSON config in Perspective (forum)](https://forum.inductiveautomation.com/t/best-way-to-get-json-config-in-perspective/45714), [Perspective drag-drop limits](https://industrialmonitordirect.com/blogs/knowledgebase/ignition-perspective-drag-and-drop-workarounds-and-sdk-implementation).

---

## 2. The canonical signal-role catalog (single source of truth)

The roles are the `T_*` topic constants in `plc/conv_simple_anomaly/rules_core.py` (§ lines 99–112). The map
points a customer's **real tag path** at one of these roles + a **scale divisor**. The catalog is the
contract between the mapper UI, the JSON schema, and the diagnose/trend consumers. **Build it once** as a
pure, dual-Py module (`signal_roles.py`) so UI, storage, and rules can't drift.

| Role key (`snap` topic) | Display name | Kind | Unit | GS10 default divisor | Req? | Consumed by (rules) |
|---|---|---|---|---|---|---|
| `vfd/vfd101/freq` | Output frequency | analog | Hz | 100.0 | **yes** | A7, A10, running-state |
| `vfd/vfd101/freq_setpoint` | Frequency setpoint (cmd Hz) | analog | Hz | 100.0 | rec. | A7 |
| `vfd/vfd101/current_a` | Output current | analog | A | 100.0 | **yes** | A8 (vs motor FLA) |
| `vfd/vfd101/dc_bus_v` | DC-bus voltage | analog | V | 10.0 | rec. | A9 |
| `vfd/vfd101/fault_code` | Fault code (0x2100 low byte) | code | — | 1.0 (passthrough) | **yes** | A2 (GS10 decode) |
| `vfd/vfd101/warn_code` | Warn code (0x2100 high byte) | code | — | 1.0 | opt. | A2 evidence |
| `vfd/vfd101/comm_ok` | Drive comm OK | bool | — | — (passthrough) | rec. | A1, trust-gate |
| `vfd/vfd101/cmd_word` | Command word | code | — | 1.0 | rec. | A6, A10, running-state |
| `motor/m101/running` | Motor running | bool | — | — | opt. | A5, A6 |
| `safety/estop` | E-stop active | bool | — | — | opt. | A5 |
| `safety/wiring` | E-stop wiring fault | bool | — | — | opt. | A3, A5 |
| `safety/contactor_q1` | Contactor closed | bool | — | — | opt. | A5 |
| `safety/pe_latched` | Photo-eye latch | bool | — | — | opt. | A12 |
| `plc/di/di00_fwd` … `di05_photoeye` | Discrete inputs | bool | — | — | opt. | A3, A4, A12 |

- **`Kind`** drives the picker datatype filter (analog → numeric tags; bool → boolean; code → integer).
- **`Req?`** = the analyzer's *minimum useful set*. "yes" roles unmapped ⇒ the page shows an amber gate
  and Ask MIRA stays disabled (train-before-deploy). "opt." roles just disable the rules that need them
  (rules already `snap.get → None` degrade silently).
- **Divisor by family:** GS10 column above is the seed. `generic` family defaults all analog divisors to
  `1.0` (assume pre-scaled engineering tags) — the installer overrides per row.

---

## 3. Storage — the per-asset config tag (Option A)

**One `String` memory tag per asset:** `[default]MIRA/Config/<assetId>/map`, holding the map as a JSON
string.

> **Build refinement (2026-06-14):** Option A's concrete type is a **String** memory tag, not a
> `Document` tag. `system.tag.readBlocking` returns the String value as a plain Jython string →
> `asset_config.load_config(str)` parses it directly, avoiding `Document`→Jython value marshalling.
> The decision ("a JSON tag, runtime-editable, no DB") is unchanged.

```jsonc
{
  "schemaVersion": 1,
  "assetId": "conveyor",                 // slug; matches mira_diagnose folder/asset id
  "driveFamily": "GS10",                 // GS10 | generic  (selects default divisors)
  "unsPath": "enterprise.garage.demo_cell.cv_101",  // direct-connection UNS identity (rule: uns-compliance)
  "updatedAt": "2026-06-14T18:20:00Z",
  "updatedBy": "mike",
  "approved": false,                     // train-before-deploy gate for Ask MIRA (free wedge works pre-approval)
  "approvedBy": null,
  "roles": {
    "vfd/vfd101/freq":        { "tag": "[default]Plant/Line1/Drive3/AAA_Hz", "divisor": 100.0,
                                "source": "manual", "confidence": "verified", "evidence": "technician_confirm" },
    "vfd/vfd101/current_a":   { "tag": "[default]Plant/Line1/Drive3/AAA_I",  "divisor": 100.0,
                                "source": "manual", "confidence": "verified", "evidence": "technician_confirm" },
    "vfd/vfd101/fault_code":  { "tag": "[default]Plant/Line1/Drive3/AAA_Flt","divisor": 1.0,
                                "source": "manual", "confidence": "verified", "evidence": "technician_confirm" }
    // unmapped roles are simply absent — never guessed (plc-tag-mapper rule #1)
  }
}
```

**Per-role fields** (honor `plc-tag-mapper` evidence/confidence discipline):
- `source`: `manual` (this slice) | `ai` (Slice 2 proposal) | `seed` (migrated from LEAF_MAP).
- `confidence`: `verified` (a human picked it — `manual`/approved) | `proposed` (AI, unapproved) | `low`.
- `evidence`: `technician_confirm` for manual picks; AI picks carry the classifier's evidence string.
- **Manual picks are `verified` by construction** — the human selecting the tag *is* the sign-off
  (plc-tag-mapper rule #2). AI picks stay `proposed` until approved (Slice 2).

**The map IS the read allowlist.** The diagnose script reads **only** the tag paths named in `roles[*].tag`
— never browses-then-reads. This preserves the existing fail-closed, read-only doctrine
(`ignition-webdev` rule #2, `fieldbus-readonly`). The config tag path itself is added to
`ignition/project/approved_tags.json` for the WebDev endpoint; the project-script seam is bounded by the
map.

**Seed for `conveyor`:** ship `ignition/tags/mira_config_conveyor.json` (a tag-definition file) whose
`roles` reproduce today's effective `LEAF_MAP` for the live `[default]MIRA_IOCheck/VFD` tags. This proves
the round-trip and makes the live panel config-driven without behavior change.

---

## 4. Consumer changes — diagnose seam reads the config

New pure module **`ignition/webdev/FactoryLM/api/diagnose/asset_config.py`** (dual Py2.7/3.12, no I/O,
unit-tested) with:

```python
load_config(json_text) -> dict            # parse + validate against schemaVersion; raise on bad shape
read_plan(config) -> (paths, plan)        # paths=[tag...]; plan=[(topic, divisor)...] parallel
build_snap_from_plan(plan, qvalues) -> snap   # good-quality only; coerce by divisor; keyed by topic
required_unmapped(config) -> [role_key...]    # for the UI gate + header
```

`build_snap_from_plan` reuses `tag_topic_map.coerce(value, divisor)` verbatim (same scaling semantics:
`None` divisor = bool/raw passthrough, `1.0` = int passthrough, else `float/divisor`).

**Modify `plc/ignition-project/ConvSimpleLive/ignition/script-python/mira_diagnose/code.py`** `_read_snap`:

```
1. cfg = read config Document tag for assetId (system.tag.readBlocking)
2. if cfg present & valid:
       paths, plan = asset_config.read_plan(cfg)
       qvs = readBlocking(paths)            # ONLY the mapped paths
       snap = build_snap_from_plan(plan, qvs)
   else:                                    # FALLBACK — zero change to existing live behavior
       legacy path: DEFAULT_FOLDERS x LEAF_MAP   (today's code, untouched)
3. evaluate(snap, derived) -> cards         # unchanged downstream
```

Vendor `asset_config.py` into the gateway script lib as a sibling module (like `mira_tag_map`,
`mira_diagnose_core`); extend `tests/regime7_ignition/test_diagnose_parity.py` to assert copy identity +
that **seed-config snap == legacy LEAF_MAP snap** for the conveyor tag set (the no-regression proof).

---

## 5. Consumer changes — TrendChart reads the config

Today the sandbox `TrendChart/view.json` has a static `tag-history` binding (4 hardcoded
`[default]MIRA_IOCheck/VFD/*` paths) + a script transform with hardcoded `scales`.

**Generalize:** replace the static tag-history binding with a **script binding** on the chart `data` prop
that is config-driven:

```
1. cfg = read [default]MIRA/Config/{view.params.assetId}/map
2. trend roles = [freq, freq_setpoint, current_a, dc_bus_v] ∩ mapped roles
3. paths  = [roles[r].tag for r]      ; aliases = engineering names (OutputHz, SetpointHz, Current_A, DCBus_V)
4. ds = system.tag.queryTagHistory(paths=paths, ... rangeMinutes, Average, Wide)
5. scale each column by roles[r].divisor   (reuse the existing transform math)
6. return the wide dataset                 (3-plot auto-scaling layout unchanged: Hz / A / V)
```

This cuts the hardcoded paths AND keeps the proven multi-plot scaling. **History caveat (industrial
best-practice surface):** `queryTagHistory` returns data only for tags with history enabled. The Setup
page (§6) flags any mapped tag whose `historyEnabled` is false so the installer fixes it before expecting a
trend — degrade cleanly (live-empty), never error.

---

## 6. The click-to-map Setup page (Perspective view `TagMapper`)

**Built in the `testing` sandbox project first** (sandbox-first rule), live-tested, then promoted.

### 6.1 Layout (ISA-101 / High-Performance HMI applied to a *config* surface)

```
┌─ MIRA VFD Analyzer — Tag Setup ──────────────────────────────────────────────┐
│ Asset: [conveyor ▾]   Drive family: [GS10 ▾]   UNS: enterprise.garage…cv_101   │
│ Status: ● 3 of 3 required roles mapped — ready          [Test all] [Save]      │  ← gate banner
├───────────────────────────────────────────────────────────────────────────────┤
│ ROLE                  REQ   YOUR TAG                      SCALE   LIVE          │
│ Output frequency      ●req  [Drive3/AAA_Hz        ▾]      ÷100    47.3 Hz  ●good │
│ Output current        ●req  [Drive3/AAA_I         ▾]      ÷100     2.10 A   ●good │
│ Fault code            ●req  [Drive3/AAA_Flt       ▾]      ÷1          0     ●good │
│ Freq setpoint         ○rec  [— pick a tag —       ▾]      ÷100      —      ○unset │
│ DC-bus voltage        ○rec  [Drive3/AAA_Vdc       ▾]      ÷10    324 V   ⚠ no hist│
│ Drive comm OK         ○rec  [— pick a tag —       ▾]       —        —      ○unset │
│ … optional roles (collapsed: "Show 9 optional safety/IO roles")                │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Design rules (the principles, applied)

- **Role-first, not tag-wall.** Rows are *what MIRA needs*, in priority order (required → recommended →
  optional collapsed). Each role has a one-line plain-language explainer on hover/expand and lists the
  rules it powers ("feeds the over-current jam check"). This is the "convert raw tags into
  meaning, never a raw-tag wall" rule.
- **Muted base; strong color only for problems.** Normal/mapped = neutral gray + a quiet ✓. **Amber** =
  required-unmapped or "history disabled". **Red** = a picked tag reads **bad quality**. Green is used
  sparingly for the "ready" gate banner. No blink.
- **Live preview = the 3-second test.** Every picked tag shows `raw → scaled value + unit + quality dot`,
  polling ~1 s. The installer *sees* `47.3 Hz` and knows instantly it's the right tag — the single most
  important correctness affordance on the page.
- **Datatype-filtered picker.** The tag dropdown is built from `system.tag.browse` (lazy, one folder level
  at a time for big trees) filtered by the role's `Kind` (analog→numeric, bool→boolean, code→int). Reduces
  mis-picks; never auto-selects by name (plc-tag-mapper rule #1 — naming is a *hint for Slice 2*, never
  truth here).
- **Scale with smart defaults + sanity check.** Divisor pre-filled from `driveFamily`; if the scaled live
  value is wildly out of a role's plausible band (e.g. "Output frequency = 4730 Hz"), show an amber
  "check scale?" nudge. Hint, not a block.
- **Gate banner = mode/state/readiness at a glance.** "N of M required mapped"; green "ready" only when all
  required roles are mapped with good quality. Mirrors the panel's 3-second state header.

### 6.3 Behavior

- **Load:** read the asset's config tag (if any) → populate rows; else empty with defaults.
- **Save:** `system.tag.writeBlocking` the assembled JSON to `[default]MIRA/Config/<assetId>/map` with
  `source:"manual"`, `confidence:"verified"`, `evidence:"technician_confirm"`, `updatedAt/By`. **Writes
  only the config tag — never a customer process/drive tag** (read-only doctrine; the analyzer only ever
  *reads* mapped tags).
- **Test all:** read every mapped tag, roll up good/bad/quality + history-enabled into the banner.
- **Approval (train-before-deploy):** Save persists with `approved:false`. A separate admin **Approve**
  action sets `approved:true`/`approvedBy`. Free tier (trend + decode + anomaly) works pre-approval; **Ask
  MIRA is gated on `approved:true`** for that asset. (Wiring Ask-MIRA gating end-to-end is finalized with
  Slice 2 / the Hub `/proposals` surface; this slice persists the fields + honors them in the panel.)

---

## 7. Files to create / modify

**Create**
- `ignition/webdev/FactoryLM/api/diagnose/signal_roles.py` — the role catalog (dual-Py, pure).
- `ignition/webdev/FactoryLM/api/diagnose/asset_config.py` — load/validate/read_plan/build_snap (dual-Py, pure).
- `ignition/tags/mira_config_conveyor.json` — the `Document` tag definition + `conveyor` seed map.
- `plc/ignition-project/testing/.../views/TagMapper/{view.json,resource.json}` — the click-to-map page (sandbox).
- Vendored gateway sibling copies of `signal_roles.py` + `asset_config.py` (parity-guarded).
- Tests in `tests/regime7_ignition/`: config parse/validate, read_plan, build_snap_from_plan,
  **seed==legacy snap**, copy-identity (extend `test_diagnose_parity.py`).

**Modify**
- `plc/ignition-project/ConvSimpleLive/.../mira_diagnose/code.py` — config-first `_read_snap`, legacy fallback.
- `plc/ignition-project/testing/.../views/TrendChart/view.json` — config-driven script binding.
- `ignition/project/approved_tags.json` — add `[default]MIRA/Config/*` (config tag readable by WebDev).
- `mira-ignition-exchange/EXCHANGE_LISTING.md` — note the runtime tag-mapping setup.

---

## 8. Security / safety boundaries (non-negotiable)

- **Read-only.** The analyzer reads only the mapped tags. The Setup page writes **only** the config
  Document tag. **No write ever reaches a customer process tag, PLC, or drive** (`fieldbus-readonly`,
  train-before-deploy "read-only in beta"). No `pymodbus`/`pycomm3`/OPC client anywhere — all I/O is
  Ignition `system.tag.*` in-gateway.
- **Bounded reads.** The map is the read allowlist; no `system.tag.browse`-then-read-all in the diagnose
  path. Browse is UI-only (the picker), gateway-scope, lazy.
- **No secrets in files** (`ignition-webdev` rule #3). Jython 2.7 only in gateway/WebDev code.
- **UNS identity carried.** `unsPath` on the config = the direct-connection UNS certification
  (`direct-connection-uns-certified`); a config without a resolvable `unsPath` is incomplete and Ask MIRA
  is rejected, not downgraded to a chat-gate.

---

## 9. Validation / acceptance (evidence beats assertion)

- [ ] `python -m pytest tests/regime7_ignition/ -q` green (was 44) + new cases incl. **seed==legacy snap**.
- [ ] `cd plc/conv_simple_anomaly && python -m pytest test_rules.py -q` still 27 (rules untouched).
- [ ] `python -m json.tool` clean on every changed `.json` (tag defs, both view files, approved_tags).
- [ ] `allowlist.resolve_allowlist_path()` still resolves.
- [ ] **No-regression proof:** with the conveyor seed config present, the live panel header/feed match the
      pre-change output for the same tag values (parity test + a live screenshot).
- [ ] **Slice-1 "moat" proof (manual):** point at a **second, differently-named** tag folder, map 3
      required roles by hand on the `TagMapper` page → trend renders + an induced fault produces the right
      anomaly card — **with no code edit**. Screenshot → `docs/promo-screenshots/`.
- [ ] Sandbox-first: deploy `TagMapper` + generalized `TrendChart` to `testing`, Mike live-tests, then
      `PROMOTE.ps1`. (Deploys are elevated — hand Mike the exact command; never auto-fire UAC.)

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `system.tag.browse` slow on large customer tag trees | lazy one-level browse in the picker; never full-tree scan |
| Config tag missing/corrupt at runtime | `load_config` validates `schemaVersion` + shape; on failure, **fall back to legacy** and log — never crash the panel |
| Schema/catalog drift between UI, storage, rules | single `signal_roles.py` source of truth + parity test |
| Mapped tag has no history → empty trend | Setup flags `historyEnabled:false`; trend degrades to live-empty, not error |
| Wrong scale picked | live preview + out-of-band "check scale?" nudge (the human catches it visually) |
| Breaking the live ConvSimpleLive panel | legacy fallback + seed-config parity test + save-point tag `convsimplelive-known-good-2026-06-14` |

---

## 11. Slice 2 (outline only — not built here): the cloud AI classifier (the moat)

Reuses every contract above. On install: browse the tag set + sample values/datatypes → **AI-classifies
each tag into a signal role** (reusing `mira-bots/shared/uns_resolver.py`, `mira-crawler/ingest/uns.py`,
the namespace-builder spec, simlab archetype baselines) → **pre-fills the same `roles{}` map** with
`source:"ai"`, `confidence:"proposed"` → surfaces in the click-to-map page / Hub `/proposals` → human
approves (`approved:true`) → identical downstream. **High-confidence-only; unknowns stay unmapped, never
guessed.** The manual page built in Slice 1 becomes the review/correction surface.

---

## 12. Cross-references

- `docs/RESUME_2026-06-14_vfd-analyzer-auto-map.md` · `~/.claude/plans/yes-map-the-path-warm-wadler.md`
- `plc/conv_simple_anomaly/rules_core.py` (role constants + rules) · `tests/regime7_ignition/test_diagnose_parity.py`
- `ignition/webdev/FactoryLM/api/diagnose/tag_topic_map.py` (the hand map this generalizes)
- `plc/ignition-project/ConvSimpleLive/.../mira_diagnose/code.py` · `.../testing/.../TrendChart/view.json`
- Rules: `.claude/rules/{fieldbus-readonly,train-before-deploy,direct-connection-uns-certified,uns-compliance}.md`
- Skills: `plc-tag-mapper`, `ignition-webdev`; HMI doctrine: global CLAUDE.md INDUSTRIAL UI RULE (ISA-101)
- Sandbox workflow: `plc/ignition-project/testing/SANDBOX_WORKFLOW.md`
