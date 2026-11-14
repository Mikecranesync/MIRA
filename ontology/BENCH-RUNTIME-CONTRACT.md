# Bench runtime context contract — rule → runtime path → test

**For the full-workbench pilot integrator. Scope: drive (VFD1) + supply relay (Q1, hand-labelled "MLC") first.**

This is not a second ontology and not a second registry. The canonical record stays
`ontology/mappings/runtime-contract.v1.json` (+ the generated `SHAPE-INVENTORY.md`). This page
is the reading guide to it for one question: *which rules does the running application actually
honour on the paths the bench pilot uses, and what proves it?*

## Heads this page describes

| Thing | Head | State |
|---|---|---|
| `main` | `20fda901e3ea2c2ca2b4af8556eedc27c202c12f` | — |
| PR #5530 (ontology coverage gate + runtime mapping) — **the review candidate, untouched** | `c7a21990b391af70e62e4656a7cccc5b6cb4f01c` | draft, 0 behind main, checks green on that head, no GitHub review |
| This follow-on (local branch `test/ontology-bench-runtime-contract`, stacked on #5530, **not pushed**) | the commit that adds this file (see `git log c7a21990b..`) | tests + mapping only; no production code |
| PR #5504 (bench components) — cited, not mine | `e649880b1b51dcc010b539181a74a88f98ef7bea` | draft; last review found 2 HIGH on selection paths, owner repairing locally |

## Two paths. Do not merge them in your head.

| | **Path P — the pilot's path** | **Path G — the graph path (second consumer)** |
|---|---|---|
| Entry | `/api/equipment-notebooks/[id]/chat` + bench components (#5504) | `/api/assets/[id]/chat` and `/api/internal/kg` (called by `mira-bots/shared/engine.py` and `mira-mcp/kg_client.py`) |
| Where a machine fact lives | notebook sources, `notebook_components` + append-only revisions (#5504, migration 115 **proposed, not applied**) , recorded tag history | `kg_entities`, `relationship_proposals`, `kg_relationships` |
| Reads the knowledge graph? | **Relationships: no.** The route imports nothing from `@/lib/knowledge-graph` and reads no `kg_relationships`. It does read `kg_entities` for a machine's identity and plant path, so the install row written by `mintAssetBridgeNode` is on its evidence path. | Yes |
| Can it express "Q1 feeds VFD1"? | **No.** #5504 models components, not relationships between them. | Yes — and that is where it breaks (below) |

Consequence: every graph protection below is evidence about Path G only. None of it protects
an answer the pilot's notebook chat gives. If the pilot later routes through Path G, the
critical gaps in the last section block it.

## Evidence classes

- **CI** — runs on every PR today.
- **CI-via-meta** — picked up by `tests/test_ontology_attribution.py`, which CI names; needs this branch pushed first.
- **LOCAL-PG** — I ran it against a disposable PostgreSQL built from the real Hub migrations. No CI job runs it.
- **LOCAL** — pure, ran locally, no CI job runs that folder.
- **CITED-BY-TITLE** — another owner's test at the head shown. I read the test titles and the proposed schema, not the test bodies, and did not run them. #5504's head has two open HIGH review findings on selection paths and its migration is applied nowhere, so nothing marked this way is *demonstrated at an accepted head*.

Test files: **HUB-G** = `mira-hub/tests/integration/ontology/bench-context-contract.integration.test.ts` (33 tests) ·
**HUB-P** = `mira-hub/tests/integration/ontology/bench-pilot-live-evidence.integration.test.ts` (13 pass + 1 expected failure) ·
**PY** = `tests/test_ontology_bench_contract.py` (18 pass + 7 strict xfail) ·
**EXIST-P** = `mira-hub/src/app/api/equipment-notebooks/[id]/chat/__tests__/machine-evidence.test.ts` (re-run here: green).

## The minimum bench contract

| # | Clause | Path | Real boundary | Holds? | Test (class) |
|---|---|---|---|---|---|
| 1 | Installed instance is distinct from catalog model | G | `mintAssetBridgeNode` → `kg_entities` | **Partly.** Two installs of one model get two rows with distinct paths. The model itself is only a text field: there is no model node and no `INSTANCE_OF` edge. | HUB-G §1 (LOCAL-PG) |
| 1 | same | P | `notebook_components` + revisions | Claimed by the owner's tests: two components may carry one catalog number; identity is per component + revision. **Not demonstrated by me.** | #5504 `store.integration.test.ts`, `selection-retrieval.test.ts` (CITED-BY-TITLE) |
| 2 | Stable parentage | G | `kg_entities.uns_path` + unique `(tenant_id, entity_type, name)` | Holds for the install rows. | HUB-G §0–1 (LOCAL-PG) |
| 2 | same | P | component → notebook foreign key | Claimed (foreign key in the proposed migration). **Not demonstrated by me.** | #5504 migration 115 + `store.integration.test.ts` (CITED-BY-TITLE) |
| 2 | Typed, directed relationships | G | `mapToCanonicalEdge` → `upsertInferredProposal` → decide route → `kg_relationships` | **Written correctly, not readable.** See gap #5519. | HUB-G §3–4 (LOCAL-PG) |
| 2 | same | P | — | **Not expressible** on the pilot path. | none |
| 3 | Tenant isolation | G | RLS on `kg_entities` / `kg_relationships`; `tenant_id` predicate in every reader; internal key on `/api/internal/kg` | Holds: other tenant's admin gets 404 on decide, readers return nothing, RLS counts 0, wrong key 401. Note: the `relationship_proposals` policy also admits rows with a NULL tenant. | HUB-G §3, §6 (LOCAL-PG) |
| 3 | same | P | tenant-bound SELECT-only re-fetch; 404 for another tenant's notebook | Holds. | EXIST-P; `asset-binding.test.ts`, `delete.test.ts` (CI) ; #5504 `components-route.test.ts` (CITED-BY-TITLE) |
| 4 | Source / revision provenance | G | `relationship_evidence`, `relationship_proposal_id` on the edge | **Partly.** Proposer, approver, time and cited source are reachable by join. Nothing structured records a source revision, a validity window, or what replaced a fact. The answer context names no edge, proposal or source (#5527). | HUB-G §4, §7 (LOCAL-PG) |
| 4 | same | P | citations on notebook answers; component revisions | Claimed: component revisions are append-only and numbered. **Not demonstrated by me.** | #5504 (CITED-BY-TITLE) |
| 5 | Explicit approval | G | `/api/proposals/[id]/decide`, capability `proposals.decide` | Holds: a proposed edge is not served; technician 403; reject keeps history and writes no edge; verify writes one linked edge; re-decide 409. | HUB-G §2–3 (LOCAL-PG) |
| 5 | same | P | component `identity_status` + `confirmed_at` CHECK; unconfirmed component blocked from manual answers | Claimed by the owner's tests. **Not demonstrated by me.** | #5504 `store.integration.test.ts`, `selection-retrieval.test.ts` (CITED-BY-TITLE) |
| 6 | Corrected / superseded fact leaves current answers, stays in history | G | `applyHubProposalTransition('supersede')` | **No.** See gap #5523. History is kept; the old edge is still served. | HUB-G §5 (LOCAL-PG) |
| 6 | same | P | identity correction = new revision; selection re-pointed; turns under the old revision do not carry | Component correction: claimed by the owner's tests, **not demonstrated by me.** Notebook *sources*: the existing `provenance-canonical-evidence.integration.test.ts` ran 7 of 8 green on my disposable database — a superseded reading is hidden from the source list and its history stays resolvable. The eighth, "a superseded document cannot re-enter chat scope", **failed at its own positive control** there (cause not determined; no CI job runs that file). So exclusion from the *answer scope* is **not demonstrated.** | #5504 (CITED-BY-TITLE); `src/lib/__tests__/provenance-canonical-evidence.integration.test.ts` (LOCAL-PG, 7/8) |
| 7 | Timestamp and quality on every reading | P | `renderMachineEvidenceSection` (replay rows) | Holds for the render step: observed time, received time and quality on each row; quality never invented. | HUB-P (LOCAL); EXIST-P (CI) |
| 7 | same | drive live-snapshot | `live_snapshot.normalize` | **Partly.** Every reading has a quality; the stamp is the receive time (bots, Ask API) or empty (Ignition chat), and age never changes quality. Stale-by-age: **no.** | PY (CI-via-meta) |
| 8 | Command is distinct from feedback | P | `deriveCurrentState` + `deriveContextIntelligence` | Holds **in these two functions**: state comes from recorded state windows; a RUN command alone never yields "running". The real builder chain with a fake database client is covered by the existing `src/lib/machine-context-packet.test.ts` (CI), but only with a STOP command. Not exercised: the historian that derives those windows. **One gap:** a state window left open with stale signals is still summarised "Machine running" (the state line beside it does say stale). | HUB-P (LOCAL, mutation-checked; gap pinned with an expected failure) |
| 8 | same | drive live-snapshot | `ignition_chat.py` → `assess_from_paths` | **No.** A RUN command alone reads "Machine running"; RUN against STOPPED status reads "running". | PY strict xfail, through the Ignition entry point (CI-via-meta) |
| 9 | Missing observation shown as unknown | P | summary + empty-window refusal (422) | Holds: no fault reading → not called healthy; empty window refused before any answer. | HUB-P (LOCAL); EXIST-P (CI) |
| 9 | same | drive live-snapshot | `ignition_chat.py` → `assess_from_paths` | **No.** An unread fault register reads "No active VFD fault." | PY strict xfail, through the Ignition entry point (CI-via-meta) |

"Drive live-snapshot" is `mira-bots/shared/live_snapshot.py`. Its one deployed caller for the
summary is the Ignition chat (`mira-pipeline/ignition_chat.py` → `assess_from_paths`). The Ask
API uses it only to list values (no summary). The bot engine is wired to it but nothing in
this repository passes it live tags. The notebook chat does not use it. So rows 7–9 of that
path apply to the pilot **only if the pilot exercises an Ignition "Ask MIRA" panel** for the drive.

On Path P the MACHINE section exists only on a sensor-replay turn; an ordinary document
question carries no machine evidence at all, so rows 7–9 are then simply not in play.

## How much of the pilot path is actually demonstrated

Less than the test counts suggest. Stated plainly:

- **Demonstrated by me on Path P:** only the machine-evidence derivation and rendering, which is
  in play on sensor-replay turns only.
- **Not demonstrated on Path P:** component identity, approval and correction (all #5504, an
  unaccepted head), and exclusion of a superseded source from the answer scope.
- **An ordinary document question on the pilot** is therefore protected, as far as this work
  shows, by existing tenant and citation tests — not by anything new here.

## The complete path, as executed (Path G)

propose Q1 → VFD1 (`feeds`, from the one-line sheet) → **not served while proposed** → technician
refused, other tenant refused → admin approves → one verified edge, linked to its proposal →
**the readers cannot see it** (#5519) → with the stored name altered to the reader's spelling
(positive control) the impact reader returns it and the answer context includes it → supersede →
proposal becomes `deprecated`, history kept → **the edge is still verified and still served**
(#5523) → a revised proposal for the same pair is **dropped** (#5524).

Negatives covered: two installed instances of one model; a rejected proposal; a second tenant
with the same device tags and the same path; missing feedback; stale data.

## Known gaps — each has a failing-by-design test

| Gap | What happens today | Owner | Blocks |
|---|---|---|---|
| **#5519** | Approval stores the canonical name (`feeds` → `UPSTREAM_OF`, `has_component` → `HAS_COMPONENT`); readers filter the lowercase one. An approved relationship reaches no reader. Per reader: impact, components, similar and the engine's internal route all miss it. | open, **unclaimed** | Path G — critical |
| **#5523** | Superseding a fact changes the proposal only. The edge stays `verified`; relationship rows cannot even hold a `deprecated` state; no route fires supersede. Old and new can both be current. | open, **unclaimed** | Path G — critical |
| **#5524** | A corrected proposal for the same pair is silently dropped by de-duplication. | open, unclaimed | Path G |
| **#5527** | The answer context carries no edge id, proposal id or source, and names machines by internal id. | open, unclaimed | Path G |
| **#5520** | Fault identity is not model-specific in the application. Not exercised here. | open, unclaimed | fault answers |
| live-data ×3 | Command read as feedback; missing fault reading read as healthy; age never affects quality (seven strict xfails, two of them through the Ignition entry point). Tracked under #5528 — **no dedicated issue filed; filing needs the owner's word.** | none | Ignition "Ask MIRA" for the drive |
| open-window stale | On Path P, a state window never closed + stale signals → assessment still says "Machine running". Same tracking note. | none | Path P, replay turns — **low**: the state line beside it says stale |
| model node | No catalog-model node or `INSTANCE_OF` edge is written by the application. | none | Path G |

I repaired none of these. No owner has claimed them, so there was no one to hand a slice to
or take one from; the tests are the executable contracts a future owner repairs against. When
a repair lands, the matching known-gap test goes red and says to convert it.

## Second-consumer semantics

`/api/internal/kg` and the asset chat are the second consumers of the same verified-edge
rule. They agree with each other (both go through `traversal.ts`), so they share #5519 and
#5523 exactly. A repair must be made in the reader/transition layer once, not per consumer —
the tests check each reader separately so a partial repair is visible.

## Extending across the bench inventory

Inventory: `mira-hub/scripts/data/cv101-provisional-inventory.json` on #5504 — **provisional,
not frozen** (19 rows + 2 excluded per the integrator's read). The contracts above are
parameterised by tag and relationship name, not by device type, so the same assertions *should* apply
to each further row — **but only `feeds`, `has_component` and `similar_to` were executed end to
end.** For the rest, a sweep through the real name mapper (HUB-G §4b) shows the same outcome
for every name a reader filters on, and that `controls` and `protects` (PLC → drive, breaker →
supply) cannot be proposed at all. So: **not extended across the inventory; the inventory is
not frozen.** What does not extend:

- On Path P, relationships between components (PS1 → PLC1, CB1 → PS1, VFD1 → M1 …) cannot be
  stated at all today.
- On Path G, every further relationship inherits #5519 and #5523 unchanged — adding rows adds
  no protection until those are repaired.
- Live-data rows 7–9 were proven for the drive's tags only. Sensors, the selector and the
  pilot light have no decoded tag set in either live path that I exercised.

## #5530's four changed shapes — semantic review

Probed through the real validator with sixteen edge-case graphs (not just the shipped fixtures).

| Shape | Verdict | Finding |
|---|---|---|
| `ContainmentCycleShape` | behaves as documented | Catches mixed and child-side cycles; a parent edge stated together with its inverse is correctly not a cycle. |
| `InstanceOfDirectionShape` | behaves as documented | Catches an install pointing at an install or a manufacturer. Documented limits confirmed: an untyped target and an unrelated kind both conform. |
| `FaultAppliedToWrongFamilyShape` | **two findings** | (a) A code scoped to *two* families fires on a legitimate member of either — nothing limits `scoped_to` to one value, so either the limit or the rule is missing. (b) A model cannot state its family (`member_of_family` is for installs only), so a drive declaring family A while being an instance of a family-B model, carrying that model's code, passes this rule. |
| `WritableSignalShape` | **one finding — the comment over-claims** | "Fails closed" holds for a *missing* flag and a boolean `false`. A flag written as text (`"false"`, `"no"`) conforms: nothing checks the datatype. |

None of these changes application behaviour; all four shapes are offline-only checks on
fixtures. They are review findings for #5530's author and reviewer, not pilot blockers.

## External standards

No crosswalk to ISA-95, ISA-88, a UNS convention or Sparkplug is finished. Passing fixtures
show the fixtures are internally consistent with these shapes; they are **not** evidence of
compliance with any external standard, and nothing here should be quoted that way.

## Review status

- Independent review required for this work: **not obtained.** A governed Codex round needs
  the owner's authorization; none was requested or spent.
- One read-only second-model read of this branch was run as evidence only. Label: **PARTIAL**
  (same model family as the author). It ran no tests. It found no vacuous test; it did find
  seven places where a test or this page claimed more than it exercised. All seven were
  accepted and corrected (the open-window gap above, the Ignition entry point, the
  `kg_entities` wording, a one-sided tenant check, three under-qualified test names).
- Stale comment: the CI step "Ontology validation (ADR-0032)" in `.github/workflows/ci.yml`
  still says absent fixture directories "SKIP by design". Since #5530 a missing fixture pair
  fails. The file is a guarded control path; the fix is a maintainer's, with an exception.
