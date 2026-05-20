# UNS / MQTT Patterns

> Unified Namespace + MQTT publishing patterns extracted from Fuuz's `fuuz-industrial-ops` skill (`uns-patterns.md`, `alarm-management.md`) + Episode 6 live demo. Compared against MIRA's existing UNS approach (`uns-compliance.md`, `mira-crawler/ingest/uns.py`, `docs/specs/uns-message-resolver-spec.md`).

---

## U-1 — Topic structure: ISA-95 hierarchical, slash-separated

**What:** Fuuz publishes UNS topics as:

```
<broker_root>/{site}/{area}/{line}/{cell}/{equipment}/{datatype}
```

Where:
- `<broker_root>` = `fuuz` in the Fuuz convention (configurable).
- Levels follow ISA-95: Enterprise → Site → Area → Line → Cell → Equipment.
- `{datatype}` is the leaf: `telemetry`, `alarm`, `state`, etc.

**Example:** `fuuz/PLT01/MFG/LN01/CL01/SUB-250/temperature`

**Why ISA-95:** Standardized hierarchy that every ERP/MES vendor maps to. Customers' physical plants already follow it (most of the time).

**MIRA applicability:** Direct. MIRA's `mira-crawler/ingest/uns.py` already builds ISA-95 paths. Lesson — formalize `<broker_root>` configurability so MIRA can publish into a customer's existing UNS root (e.g., `acme/site_a/...`) instead of forcing a `mira/...` namespace.

**Citation:** `fuuz-skills/fuuz-industrial-ops/references/uns-patterns.md`. Episode 6 `[05:00]`.

---

## U-2 — Optional levels handled by a sentinel

**What:** When a hierarchy level doesn't exist (cell-less workcenter, line directly under area), Fuuz uses a placeholder in JSONata:

```jsonata
$cell.code ? $cell.code : "nocell"
```

Result: `fuuz/PLT01/MFG/LN01/nocell/WC01/state`

**Why:** Keeps the topic structure consistent across assets that have different hierarchy depths. Consumers can parse a fixed-arity path without conditionals.

**MIRA applicability:** Borrow the convention. MIRA's `uns.slug()` should accept an optional-level token (probably `__none__` or `nocell` — Fuuz's choice is fine). Today MIRA might collapse missing levels; that breaks downstream parsing.

**Citation:** `fuuz-industrial-ops/references/uns-patterns.md`.

---

## U-3 — UNS message envelope standard

**What:** Every UNS payload Fuuz publishes carries:

| Field | Type | Meaning |
|---|---|---|
| `elementId` | string | ID of the publishing entity (dataPoint ID, workcenter ID, alarm ID) |
| `displayName` | string | Human-readable name / code |
| `typeId` | string | Message type marker (`telemetry`, `alarm`, `workcenterState`) |
| `parentId` | string | Parent entity ID (asset for telemetry, cell for asset, etc.) |
| `hasChildren` | boolean | Whether this entity has child entities |
| `namespaceURI` | string | The full topic the message was published on |
| `value.before` | object | State BEFORE the change (null on create) |
| `value.after` | object | State AFTER the change |
| `timestamp` | ISO 8601 | When the message was created |
| `quality` | string | `Good` / `Bad` / `Uncertain` (mirrors OPC-UA quality codes) |

**Why:** A single envelope means consumers don't write per-source parsers. `value.before` / `value.after` enables differential consumers (alarm-on-change without storing prior state). `quality` lets consumers filter bad reads.

**MIRA applicability:**
- MIRA's `kg_relationships` table has `status` + `evidence` + `confidence` columns — that's a content envelope, not a transport envelope. When MIRA *publishes* events (proposal-created, verified, work-order-tagged), it should use a transport envelope shaped like Fuuz's.
- Specifically: a "MIRA grounded answer" event published to UNS could carry `elementId` = answer ID, `parentId` = component template ID, `value.before` = ungrounded state, `value.after` = grounded state with citations.

**Citation:** `fuuz-industrial-ops/references/uns-patterns.md` ("UNS Message Standard Fields").

---

## U-4 — UNS is real-time only; pair with a persistence + query layer

**What:** From Episode 6 `[12:30]`:
> "If you're not subscribing to a topic when the event fires, that message is completely lost forever."

Fuuz's solution: persist every data change to the model layer (since the internal Fuuz UNS is data-change-driven and tightly coupled to the data model). Then expose a GraphQL layer for history queries.

**Why:** MQTT is intentionally fire-and-forget for most QoS levels. Trying to bend it into a queryable store is a mistake. Persist parallel.

**MIRA applicability:** **Same exact pattern.**
- Live = UNS via MQTT/Sparkplug (publish on KG changes, on grounded-answer events, on proposal-state transitions).
- Persistent = NeonDB `kg_*` tables + audit logs.
- Query API = `mira-mcp` server.

This is already MIRA's architecture; the lesson is to **document the duality**. Customers (and our own future selves) will ask "can I query last week's MIRA events?" — answer should be "via the Hub API; the MQTT UNS is for live integration only."

**Citation:** Episode 6 `[12:30]`. fuuz-patterns Pattern P-2.

---

## U-5 — Read AND write to the customer's UNS

**What:** Fuuz subscribes to the customer's UNS topics and ALSO publishes its own events back to the same UNS. Demonstrates openness; participates in the customer's nervous system rather than building a parallel one.

**Why:** No customer has only one vendor publishing to their UNS. Two-way play is necessary.

**MIRA applicability:**
- **`mira-relay` should both subscribe and publish.** Today `mira-relay` is mostly read-side (Ignition factory → cloud tag streaming). Lesson: publish MIRA's grounded events back to the customer's UNS — e.g., `acme/PLT01/MFG/LN01/CL01/SUB-250/mira_proposal` carrying "MIRA proposed: this fault is X, evidence: manual page 47, work-order #12345."
- This positions MIRA as **augmenting** the customer's UNS, not parallel to it.

**Citation:** Episode 6 `[03:00]`, `[05:00]`. fuuz-patterns Pattern P-12.

---

## U-6 — Workcenter dual-parent fallback

**What:** A `Workcenter` can link directly to a `Cell` **or** to a `Line` (skipping the cell level). When building a UNS topic for a workcenter, resolve the parent line via either path:

```jsonata
$line := $wc.line ? $wc.line : $cell.line;
```

**Why:** Real plants don't always have a cell level. Forcing one creates synthetic intermediate nodes.

**MIRA applicability:** Direct. MIRA's UNS resolver should handle the same case — a `component_template` linked to a `cell` *or* a `line` (or even a `site` for plant-wide components like a chiller). Action: audit `uns_resolver.py` for this fallback.

**Citation:** `fuuz-industrial-ops/references/uns-patterns.md` ("Workcenter Hierarchy").

---

## U-7 — Alarm UNS messages carry limits + deadband + before/after

**What:** When an alarm transitions state and gets published to UNS, the payload includes the data-point's `setPoint`, `lowerLimit`, `upperLimit`, `deadband`, AND `value.before` / `value.after`. Consumers don't need a separate lookup.

**Why:** Self-contained messages survive eventual consistency. A downstream consumer that wants to know "is this alarm a critical limit breach or a warning?" doesn't have to round-trip to fetch the data-point definition.

**MIRA applicability:** Same shape applies to MIRA's grounded events. When MIRA publishes a "proposal needs review" event, include in the payload everything the consumer (Hub UI, Linear-card maker, on-call Slack notifier) might need: proposal ID, component ID, evidence summary, confidence band, current verified-vs-proposed state. **No required lookups** to render the next surface.

**Citation:** `fuuz-industrial-ops/references/uns-patterns.md` (alarm pattern, "DataPoint with Hierarchy" GraphQL + JSONata transform).

---

## U-8 — Topic builder is JSONata `$join()`, not string concat

**What:** Fuuz constructs UNS topic strings via:

```jsonata
$join([
  "fuuz",
  $site.code,
  $area.code,
  $line.code,
  $cell.code ? $cell.code : "nocell",
  $asset.code,
  $dp.code
], "/")
```

Not via concatenation, not via templated strings.

**Why:**
- Explicit array makes optional levels easy.
- No `// {area}` placeholder bugs.
- Each level visible.

**MIRA applicability:** MIRA's `uns.py` uses Python list joins (`"/".join([...])`) — same shape, different language. Lesson: **never hand-format** UNS paths in user code. Always route through the builder. (This rule already exists as `uns-compliance.md` rule 1; reinforce it.)

**Citation:** `fuuz-industrial-ops/references/uns-patterns.md` ("Building Topic Paths with JSONata").

---

## U-9 — Alarm lifecycle: ACTIVE → ACTIVE_ACK → CLEARED

**What:** Fuuz's alarm state machine has three states:
- `ACTIVE` — alarm triggered, not yet acknowledged.
- `ACTIVE_ACK` — alarm acknowledged by operator, condition still present.
- `CLEARED` — alarm condition no longer present.

Plus **deadband** logic to prevent chatter:
- If `|currentValue - previousTriggerValue| ≤ deadband` → skip alarm creation.
- If `|currentValue - previousTriggerValue| > deadband` → create new alarm.

And **limit-type priority**: HighLimit/LowLimit > HighWarning/LowWarning > SetPoint±Tolerance Deviation.

**Why:** Without `ACTIVE_ACK`, operators get re-paged on the same alarm. Without deadband, oscillating sensors flood the dashboard. Without limit priority, a critical breach gets buried under warning chatter.

**MIRA applicability:**
- MIRA's CMMS work-order lifecycle has similar states (Open → In Progress → Closed). The lesson is **deadband logic on auto-creation**.
- When MIRA proposes a KG relationship and that proposal repeatedly fires from the same evidence path, dedup logic should prevent re-proposal spam. (May already be partly there — audit `kg_writer.py`.)
- Same for `bot-grounding-tests` GS11 evidence: if the same low-groundedness signal fires N times in a row from the same query, don't create N separate episodes.

**Citation:** `fuuz-industrial-ops/references/alarm-management.md`.

---

## U-10 — OPC-UA quality codes in the message

**What:** Every UNS message carries a `quality` field mirroring OPC-UA's quality codes (`GOOD`, `BAD`, `UNCERTAIN`, plus more specific codes like `OPC-UA good 192`).

**Why:** Lets consumers filter on quality. Bad reads (sensor offline, communication error) shouldn't drive alarms.

**MIRA applicability:** When MIRA cites manual chunks, the equivalent is a **confidence band** on the chunk (`high` / `medium` / `low`) tied to how confident the OCR + chunker + KG-mapper were about that page. Carry it on the citation. Lets the bot say "based on a low-confidence manual extraction…" when warranted.

**Citation:** Episode 6 `[37:00]`. `fuuz-industrial-ops/references/uns-patterns.md`.

---

## U-11 — Sparkplug B not explicitly named (gap)

**What:** The video and the `fuuz-industrial-ops` skill talk about MQTT but don't explicitly mention **Sparkplug B**. Fuuz's gateway has an MQTT broker + client; Sparkplug-B compatibility is UNCONFIRMED.

**Why this matters:** Sparkplug B is the dominant *structured* MQTT spec for industrial. Pure MQTT topics + raw JSON payloads are valid; Sparkplug adds birth/death certificates, type metadata, and stateful representation.

**MIRA applicability:** MIRA's plan (per CLAUDE.md) is Sparkplug-B-aware via `mira-relay`. We're **ahead** of Fuuz on this specific axis (or at least more explicit about it). Don't lose the lead — when MIRA documents UNS publishing, mention Sparkplug B explicitly, contrast with plain MQTT.

**Citation:** Absence of mention in `fuuz-industrial-ops` UNS patterns. UNCONFIRMED whether Fuuz internally supports Sparkplug.

---

## U-12 — The "multiple UNSes in play" reality

**What:** In Craig's ProveIt! demo, three UNSes coexist:
1. **Public ProveIt! UNS** — the conference's virtual factory, accessible to all vendors.
2. **Internal Fuuz UNS** — Fuuz's own data-change-driven event bus.
3. **Screen-level "mini UNS"** — Pattern S-5, per-page React state.

**Why:** Multiple namespaces serve different scopes. The customer's plant UNS is the customer's. Fuuz's internal UNS is Fuuz's. Confusing them is bad.

**MIRA applicability:** Same applies. MIRA could have:
- **Customer plant UNS** (the customer's existing topology).
- **MIRA-internal event bus** (KG changes, proposal lifecycle, citation activity).
- **Hub-screen-level mini UNS** (future, per Pattern S-5).

Don't conflate. Document the boundaries.

**Citation:** Episode 6 `[20:30]`.

---

## Comparison: Fuuz UNS vs MIRA UNS handling

| Concern | Fuuz today | MIRA today | Action item |
|---|---|---|---|
| ISA-95 topic structure | ✅ `fuuz/{site}/{area}/...` | ✅ `mira_crawler.ingest.uns` | Audit for parity |
| Optional level sentinel | ✅ `"nocell"` | UNCONFIRMED if MIRA has one | **Adopt explicit sentinel** |
| Standard envelope | ✅ 10-field envelope | ⚠️ ad-hoc per source | **Define envelope schema** |
| Read + write to customer UNS | ✅ both | Read-only via `mira-relay` | **Add publish path** |
| Sparkplug B support | UNCONFIRMED | Planned | **Document explicitly** |
| Alarm deadband | ✅ in skill | N/A (no alarms) | Reuse when MIRA grows alarm-like events |
| Multi-UNS conscious | ✅ implicit | ⚠️ underdocumented | **Document the layers MIRA touches** |

---

## Cross-reference

- For backend architecture → [`fuuz-patterns.md`](fuuz-patterns.md)
- For data-model rules → [`data-modeling-patterns.md`](data-modeling-patterns.md)
- For UI / workflow → [`screens-workflows-patterns.md`](screens-workflows-patterns.md)
- For agent / skill patterns → [`industrial-ai-agent-patterns.md`](industrial-ai-agent-patterns.md)
- For MIRA action plan → [`../mira-lessons/mira-fuuz-skill-adaptation-plan.md`](../mira-lessons/mira-fuuz-skill-adaptation-plan.md)
- MIRA's existing UNS doctrine → `.claude/rules/uns-compliance.md`, `docs/specs/uns-message-resolver-spec.md`
