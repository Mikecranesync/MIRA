# Making the VFD Analyzer Tag Setup World-Class
### A UX study of ~26 data-mapping tools + the recommended Connect → Verify → Map → Save redesign

> Editable source for the PDF (`2026-06-15_vfd-analyzer-mapping-ux-study.pdf`, rendered from the
> sibling `.html` via headless Edge `--print-to-pdf`). Prepared for Mike · FactoryLM / MIRA · 2026-06-15.

---

## 1. Executive summary

You rebuilt the Tag Setup page into a big-slots matching game and it looks good — live values flow in, the
backbone is solid. But it still isn't a *guided* experience, and even you, its designer, weren't sure what it
was asking you to do. That's not a you problem. It's a **structure** problem, and every world-class tool solves
it the same way.

**The one big idea:** great onboarding is a **gated, four-step funnel** — **Connect** a data source, **Verify**
it's really live, **Map** the fields, then **Save** for reuse. You can't map before you've seen live data, and
you can't finish until the required fields are done. Our page tries to do everything on one screen with no
gates — which is exactly why it feels like a wall.

**What we found studying 26 tools**
- **The pattern is universal.** CSV importers (Flatfile), industrial IIoT hubs (HighByte), and data pipelines
  (Fivetran, Hightouch) all converge on Connect → Verify → Map → Save.
- **Auto-suggest feels like magic, and it's cheap.** The best mappers fuzzy-match field names, pre-fill the best
  guess, and ask you to confirm. We can do this *locally* on tag names — no AI, no cloud.
- **A "Verify" step builds trust.** Showing "42 tags found, 38 live and good" before mapping is the single
  most-copied trust move across every category.

**Recommendation:** wrap the matching game (which is good!) inside a 4-step wizard, add a Verify step in front,
a required-field progress meter on Map, and a lightweight "suggested — confirm?" auto-fill. Three changes —
**Verify step, suggested badges, progress meter** — map directly to the tools your users already trust, and
~90% of the backend already exists.

---

## 2. Why the current page is confusing (5 anti-patterns)

1. **One-screen kitchen-sink.** Everything at once: pick a role in a dropdown, then hunt a paginated table of
   *every* tag in the gateway. No "do this, then this."
2. **No verify step.** You map without confirming the source is live; most of the table reads **bad** quality.
3. **No progress / no finish line.** Nothing says "3 things needed, 1 done." Required work hidden in a dropdown.
4. **Abstract mapping.** Name-to-name with no sample value beside it. *(Your big-slots rebuild already fixed this.)*
5. **No reuse.** A mapping can't be saved as a template for the next identical drive.

---

## 3. What "great" looks like — the gated 4-step funnel

```
 1. CONNECT  →  2. VERIFY  →  3. MAP  →  4. SAVE
 pick source    prove live     match tags  store + reuse
   │  gate:        │ gate:        │ gate:       │
   folder chosen   ≥1 good tag    required done readiness ok
```

Gates remove cognitive load: one question per screen, proof it worked, move on. The same idea across industries:

| Tool | Connect | Verify | Map | Save |
|---|---|---|---|---|
| Flatfile (CSV) | upload file | preview + header detect | auto-match columns→fields | reusable config |
| Fivetran (pipeline) | pick source | **Save & Test** battery | include/exclude schema | saved connector |
| HighByte (industrial) | connect OPC/MQTT | browse live values | Model↔Instance binding | reusable model |
| Hightouch (reverse-ETL) | model + destination | preview rows | **Suggest mappings** + confirm | saved sync |

---

## 4. Pattern catalog — the 10 worth stealing

| Pattern | What it is | Best examples | How we apply it |
|---|---|---|---|
| Test-connection gate | Explicit test before mapping; can't proceed until pass | Fivetran, Matillion, Census, KEPServerEX | A **Verify** step; gate Next on ≥1 good tag |
| Auto-match + confidence | Fuzzy pre-fill the target; user confirms | Boomi Suggest, Hightouch, Census | Local fuzzy match → pre-fill + "suggested — confirm?" + Accept-all |
| Required-field progress meter | "Mapped 2 of 3"; Save greyed until done | Flatfile, CSVbox, OneSchema, Stitch | "N of 3 required" meter (already computed) + disabled Finish |
| Sample value beside candidate | Live values so you recognize the field | Dromo, CSVbox, MuleSoft | Already in big-slots; extend to Verify |
| Datatype pre-filter | Only show type-fitting candidates | Osmos, CSVbox, our redesign | Shipped: analog → Float/Int only |
| Semantic / fuzzy naming | Match synonyms, not exact strings | Osmos, Flatfile, Hightouch | Token match: freq/hz→frequency, amp/current→current |
| Inline type validation | Green/red per row as you map | Dromo, CSVbox, Power Automate | Reuse live preview + quality color |
| Issue filtering | Show only problem rows | Osmos, Flatfile, Dromo | Verify flags only bad-quality tags |
| Save-as-reusable-template | Save mapping; auto-apply to next source | OneSchema, Flatfile, HighByte | Per-asset today; cross-drive template = Slice 2 |
| Back-navigable stepper | "Step X of Y", Back always allowed | USWDS, W3C, Matillion, Stitch | 4 pills + show/hide; Next gated on validity |

---

## 5. The recommended MIRA design

Keep the matching game; wrap it in the 4-step funnel; add Verify in front, a progress meter on Map, and
lightweight auto-suggest.

- **1 Connect** — pick tag provider + drive folder (replaces hard-coded scope; works on any drive). Next when folder chosen.
- **2 Verify** — one "Test data source" click → "Found 42 tags · 38 good · 4 bad" + live sample table + type
  breakdown. Green/amber. Next when ≥1 good tag.
- **3 Map** — the big-slots screen scoped to the folder, with a "Mapped N of 3 required" meter and
  **lightweight auto-suggest**: fuzzy-match tag names, pre-fill best guess, "suggested — confirm?" badge +
  Accept-all. Unsure matches stay empty (never guessed). Local, no cloud. Next→Save at 3/3.
- **4 Save** — confirm the map, readiness gate, train-before-deploy approval ("Trend + Decode + Anomaly work
  now; Ask MIRA unlocks on approval"), Save & Finish.

---

## 6. Implementation spec

**~90% already exists.** The wizard is mostly wrapping + two small steps.

**Stepper without a stepper component** (Perspective 8.3.4 has none, and no flex-repeater — not needed):
header row of 4 numbered pills (flex + label, clickable to go back) + one body with 4 sections toggled by
`visible = currentStep == N` (same show/hide we already use). Each step's **Next** is `enabled` only when the
step validates → can't skip ahead. (USWDS / W3C confirm this plain-component pattern is the accessible standard.)

**Reuse map**

| Step | Reuses (built) | New (small, additive) |
|---|---|---|
| 1 Connect | `browse_tags`, `_scan_all` | `provider_options`, `browse_nodes` |
| 2 Verify | `scan_tags`, `_live`, quality | `verify_summary`, `verify_sample`, `verify_breakdown` |
| 3 Map | entire current view + `scan_for_role`, `preview`, `slot_*`, `set_role`, `gate_text` | `is_ready`, optional `suggest_for_role` |
| 4 Save | `rows_markdown`, `gate_text/color`, `set_role` | `finalize` |

**Risks:** confirm `system.tag.getProviders()` (fail-soft to "default"); reuse proven table pattern (flat rows +
`onRowClick`); run one-shot actions from event scripts, not polling bindings.

**Already fixed this session:** the `assetId is required` save error — the writer only set `assetId` on a
brand-new config; on an existing/edited tag it re-validated without re-asserting it. Hardened the writer to
always assert identity + scaffold, and the view to pass a non-empty asset. Proven against the real validator;
68 parity tests stay green.

---

## 7. Roadmap

| Phase | Ships | Why |
|---|---|---|
| Now (done) | Save-bug fix + this report | Unblock saving; align before building |
| v1 | 4-step wizard wrapping the matching game; manual mapping; progress meter; Verify step | The gated funnel; ~90% reuse |
| v1.1 | Lightweight local auto-suggest (fuzzy pre-fill + badge + Accept-all) | The "magic" moment, no cloud |
| Slice 2 | Cloud AI auto-classifier + Hub proposals + reusable cross-drive templates | The moat |

**Next step:** build v1 in the `testing` sandbox, live-test, promote to `ConvSimpleLive`.

---

## 8. Appendix — the 26-tool teardown

### CSV / data import wizards
- **Flatfile** — File→Map→Validate→Submit; ML auto-match (millions of mappings); confirm/reject; reusable config.
- **OneSchema** — Upload→Map→Configure→Resolve; fuzzy "inexact match"; configure-once auto-apply; saved templates.
- **Dromo** — File→Map→Validate→Import; AI header+synonym (MSRP↔Price); drag-to-match; in-browser validation; Schema Studio.
- **Osmos** — Upload→AutoMap→Verify/Adjust→Submit; LLM semantic match; filter by mapped/required/error; 5 cleanup tools.
- **CSVbox** — File→Map→Validate→Submit; AI header detect; required/optional/ignored; mobile-friendly; counts upfront.
- **ImportCSV** — Upload→Map (confidence %)→Validate→Import; embedding similarity; auto-approve high, review low.
- **TableFlow** — Upload→Header→Preview→Map→Import; AI header+auto-map; multi-source combine; open-source.

### Industrial / IIoT / SCADA
- **Ignition (OPC)** — connection→browse OPC→drag tags; hierarchy preserved; live preview.
- **HighByte** — Connect→Model→Instance→Deploy; blueprint↔real-world binding; no-code; lineage; reusable models.
- **KEPServerEX** — Channel→Device→Tag; device wizard; tag groups; **Quick Client** verify; reusable profiles.
- **Litmus Edge** — auto-discover→one-click onboard→schema; structured output; drag flows.
- **Tulip** — connector type→host→**Test connection**→use; HTTP/MQTT/SQL; test-before-live; reusable connectors.
- **Element Unify** — Connect→Model→Joins→Deploy; fuzzy/contains match w/ similarity threshold; lineage.
- **N3uron** — Node→connectors→protocol→deploy; drag-drop config; modular connectors; transforms.

### iPaaS / workflow integration
- **Zapier** — trigger/action cards; **"Test step"** fetches a real record (or sample data); mapped pills carry source+sample; flags missing required.
- **Make** — node graph; **"Run once"** pins a real output bundle; drag dynamic items; hover pulses source.
- **Workato** — linear recipe; **datapills** dragged from a datatree; type-matching enforced.
- **Boomi** — Map component; **Boomi Suggest** community suggestions in **High/Med/Low** tiers; checkmark=accept; Clear-all.
- **MuleSoft** — define I/O→map→preview; **live Preview** w/ sample data; identical names auto-map; writes DataWeave.
- **Power Automate** — action cards; always-on **Flow checker** + Test Flow (mock results); per-connection green-check.

### ETL / ELT / reverse-ETL & CDP
- **Fivetran** — source→dest→setup guide; **"Save & Test"** named test battery; schema include/exclude; "Save for later".
- **Airbyte** — source+dest→**schema fetch**→select streams→set up; auto sync-mode + primary keys.
- **Hightouch** — model+dest→record-match→field mapping; **"Suggest mappings"** fuzzy pre-fill, confirm before save; (recommended) badges; paired/required fields.
- **Census** — source→dest ("Connect to save and test")→keys→mapping; **"Generate Mappings"** name match; non-destructive.
- **Stitch** — connect→**discovery**→select tables; "Not Configured" until valid; checkbox tables/columns; replication method.
- **Matillion** — **named-page wizard**; **Test** requires all fields populated; field transforms later.
- **Segment** — add source→add destination→confirm (shows "consequences"); Tracking Plan governs validation; plans reused across sources.
- **RudderStack** — source→destination→connect; **Live Events** confirms receipt; destination settings + transformations.

### Two mechanics the design hinges on
- **Stepper (plain components):** "Step X of Y" + emphasized current step + Back/Next, Next disabled until valid
  (USWDS Step-Indicator, W3C multi-page forms). Matillion gates Test on "all fields populated"; Stitch uses a
  status label as the whole progress model. No custom widget.
- **Auto-match + confidence:** Boomi (High/Med/Low tiers, checkbox-accept, Clear-all); Hightouch (fuzzy pre-fill,
  confirm before save); Census (auto-do-the-obvious, leave the ambiguous). Simplest that still feels smart
  (our choice): fuzzy name-match → pre-fill + "suggested" badge to confirm + Accept-all. No fabricated %.

### Sources
Flatfile, OneSchema, Dromo, Osmos, CSVbox, ImportCSV, TableFlow, Inductive Automation (Ignition), HighByte,
PTC KEPServerEX, Litmus, Tulip, AWS/Element Unify, N3uron, Zapier, Make, Workato, Boomi, MuleSoft,
Microsoft Power Automate, Fivetran, Airbyte, Hightouch, Census, Stitch, Matillion, Segment/Twilio, RudderStack;
UX: USWDS Step-Indicator, W3C/WAI multi-page forms, Smart Interface Design Patterns. (Full URLs in the HTML/PDF.)
