# Magic Box #001 — Phase 0 Reconnaissance

**PRD:** MIRA Edge / Magic Box #001 (build-ready, supplied 2026-08-13)
**Status:** Phase 0 COMPLETE — runtime inventory + reuse matrix done; asset identity decided
(ADR-0034); one read-only DB verification outstanding before Phase 2
**Rule being honored:** PRD §16 Phase 0 — *"No major feature work"*, and §24 — *"Begin with
reconnaissance, not implementation."*

This document is the Phase-0 deliverable. It is written before any Magic Box code, on purpose.

---

## 0. Headline findings (read these first)

Five things materially change the PRD's plan. Each is measured, not assumed.

| # | Finding | Consequence for the PRD |
|---|---|---|
| 1 | **One physical conveyor carries at least FIVE UNS identities** — `enterprise.garage.demo_cell.cv_101`, `…demo_cell.bottling_demo.cv_101`, `enterprise.garage.cv_101`, `…conveyor_line.equipment.conveyor_001`, and `enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200`. CV-200 is a **real UNS segment**, not branding; the Northwind surface deliberately re-presents the same rig and same source tags (§3.5). | §2/§3.2/§19 asset identity was genuinely ambiguous. ✅ **RESOLVED — ADR-0034**: canonical key `cv_101`, human name **"Discharge Conveyor"**, everything else an alias. Split identity would have fragmented the historian and silently dropped graph edges while every part still looked correct. |
| 2 | **The CV-101 telemetry stream is currently replaying a frozen snapshot and labelling it `live`** (issue #3161 — **figures quoted from that issue's 2026-08-08 measurement, NOT re-verified here**: 845k rows/24 h, 100 % `quality='bad'`, `MIN=MAX` source timestamp of 2026-08-02, 144 h ingest lag, yet `freshness_status='live'`). | This is a **direct, pre-existing blocker** for PRD §6 (provenance), §11 (incident history) and §17 ("provenance is preserved"). Phase 2/3 cannot be honestly demonstrated on top of it. **Fix #3161 first.** |
| 3 | **The PLC is not reachable from this machine.** `192.168.1.100` does not answer ping from CHARLIE. Consistent with the known point-to-point topology (Micro820 ↔ PLC laptop, not on the LAN). | §19's "physical proof" cannot run direct from this box. The **working path is Ignition over Tailscale** (below) — which the PRD already blesses in §3.7. |
| 4 | **The Ignition gateway IS reachable** — `100.72.2.99:8088` OPEN (the Windows laptop `laptop-0ka3c70h`, over Tailscale). LAN `192.168.1.20:8088` and `.99:8088` are closed. | Confirms §3.7's "Ignition plant" path is the viable one for Box #001. Do **not** plan a local protocol adapter for Phase 1–2. |
| 5 | **Nothing is running on the target machine.** Colima is stopped → no Docker daemon → **zero MIRA containers**; no MIRA port is listening. | §5 says "do not assume a clean computer" — the real state is the opposite of what was feared: it is *empty*, not crowded. Phase 1 is a genuine cold start, which is **easier**, but it also means no local service is currently proven. |

Plus one hard constraint: **11 GiB of disk free (95 % full)**. A local historian has almost no
headroom. See §2.3.

---

> **Provenance of numbers in this document.** Everything in §1 (runtime inventory) and §3
> (reuse matrix) was measured or grounded directly against this machine and this tree.
> `#3161` figures were originally quoted from that issue and not re-verified. **They have
> since been re-measured directly — see §8. The verdict is FROZEN/REPLAYED and #3161 was
> if anything understating it.**

## 1. Target runtime inventory (PRD §5 / §14.2)

Measured on the target machine 2026-08-13, read-only. Nothing was installed, started or changed.

### 1.1 Hardware / OS

| Property | Value | Fit vs PRD §20 (future appliance) |
|---|---|---|
| Host | CHARLIE — `CharlieNodes-Mac-mini`, Apple M4 | ARM compute — §20 allows "industrial x86 **or ARM**" ✅ |
| OS | macOS 26.2 (25C56) | ⚠️ The production appliance will be Linux. Anything macOS-specific (launchd, Colima, keychain) is **not portable** — see §2.1. |
| CPU / RAM | 10 cores / **16 GB** | §20 wants 16–32 GB ✅ (at the floor) |
| Disk | 228 GB total, **11 GiB free (95 % used)** | ❌ See §2.3 |
| Uptime | 16 days | — |
| GPU | none required | §20: "A GPU must not be required" ✅ — cloud/hybrid inference modes (§21) are the right default here |

### 1.2 Software runtimes

| Tool | Version | Note |
|---|---|---|
| Python | **3.14.4** on PATH | ⚠️ Repo targets **3.12** (`.claude/rules/python-standards.md`); root `CLAUDE.md` still documents "3.9.6 (system)". Three different versions in play — pin the appliance explicitly. |
| Node | v25.8.0 | |
| Bun | 1.3.10 | mira-web/mira-hub toolchain |
| Docker CLI | 29.2.1 | present |
| Colima | 0.10.1 | **not running** — no daemon |

### 1.3 What is actually running

- **Containers: none.** `docker ps` cannot connect (Colima stopped).
- **Listening MIRA ports: none.** No `1880/3000/3200/3101/8000/8001/8002/8088/9099/5001/11434/8765/5433/1883/502`.
- **launchd agents loaded** (`com.factorylm.*` / `com.mira.*`): `mira-offline-eval` (running, pid 68364),
  `vastai-tunnel` (running, pid 18282), `brain-ingest`, `jarvis-node`, `mira-drop-watcher`,
  `codegraph-reindex`, `eval-fixer`, `lead-hunter`, `graphify-refresh`.
- ⚠️ **`com.factorylm.health-monitor` is broken** — `LastExitStatus = 32512` (= exit 127,
  "command not found"). It has been failing silently. Not caused by this work; flagged, not fixed.

**Implication:** the appliance does not have to fight for resources with a running stack, but it
also cannot claim any of it is proven. Phase 1's exit gate ("reboot and restore predictably") is
starting from zero.

### 1.4 Network topology

| Target | Result | Meaning |
|---|---|---|
| `192.168.1.100` (Micro820 PLC) | **no reply** | PLC not LAN-reachable from CHARLIE (point-to-point to the PLC laptop) |
| `192.168.1.11` (BRAVO) | up | LAN peer |
| `192.168.1.12` (CHARLIE self) | up | — |
| `192.168.1.20:8088`, `192.168.1.99:8088` | closed | Ignition **not** on the LAN at these addresses |
| **`100.72.2.99:8088`** | **OPEN** | ✅ **Ignition gateway reachable over Tailscale** (`laptop-0ka3c70h`, Windows) |

Tailnet: `factorylm-bravo` active; `factorylm-prod` present; `alphanode` offline 25 d;
`factorylm-edge-pi` offline 169 d; `factorylm-hetzner` offline 140 d.

**This is the single most useful runtime fact in the inventory:** the only working route from the
appliance to the physical machine is **Ignition over Tailscale**, which is exactly the §3.7
"Ignition plant" deployment path. Box #001 should take it and defer the local protocol adapter.

### 1.5 Repo / git safety (PRD §15 "preserve git state")

- Shared checkout `~/MIRA` is on branch **`docs/eval-fixer-2026-08-13`** — **another session's work**.
  Not touched.
- **41 worktrees** exist (long-standing clutter, `docs/tech-debt/2026-07-27-worktree-clutter-rca.md`).
  Only my own were created/removed this session.
- Untracked `docs/prd/2026-08-03-cited-technician-turn.md` — foreign WIP, left alone.
- This document is authored in an isolated worktree on `docs/magic-box-001-phase0`.

---

## 2. Risks the PRD does not currently account for

### 2.1 macOS is not the appliance OS

The PRD says the software "must not depend on custom hardware" (§1) and must migrate to an
industrial PC (§17). The bigger portability risk is not hardware, it is **macOS**: launchd,
Colima, and the macOS-keychain Docker/Doppler quirks documented in root `CLAUDE.md` are all
CHARLIE-specific. Phase 1's "service supervision / restart behavior" must be expressed in
something that survives the move (compose `restart:` policies + healthchecks, per PRD §5's
"clearly bounded set of services"), **not** launchd plists.

### 2.2 "Read-only to OT" is already enforced — reuse it, don't rebuild it

`.claude/rules/fieldbus-readonly.md` already encodes the §10 requirement, including the
bench-only carve-outs (`plc/live_monitor.py`, `plc/live-plc-bridge/bridge.py` write and are
bench-only). PRD §10's "add or extend CI protections where necessary" should be checked against
existing guards before writing new ones. Since the PLC is unreachable from this box anyway
(§1.4), the *practical* write risk from the appliance is currently zero.

### 2.3 Disk headroom blocks the local historian

11 GiB free. PRD §11 wants a local incident buffer, and §11 already prescribes the mitigation:
*"Avoid collecting every available tag at maximum frequency. Use tiered sampling or change-based
capture."* That is now a **hard requirement, not a preference**. Either free disk first or design
change-based capture from the start. Note the replay reported in #3161 produced **845k rows in 24 h from 12 tags** (per that issue,
not re-measured here) — that is the anti-pattern, on this exact stream.

### 2.4 Phase 2 rests on a stream that is currently lying

Restating finding #2 because it is the critical path: PRD §6 requires every reading to preserve
quality, timestamp and simulated-vs-physical status, and §17 requires "provenance is preserved".
Issue #3161 reports the live stream doing the opposite (its measurement, not re-verified here) — stale values refreshing
`freshness_status='live'`. **Phase 2's exit gate cannot be honestly met until #3161 is fixed.**
It is also a genuine design decision (splitting "collector is reporting" from "value is current"),
not a patch — see the issue.

---

## 3. Repo reuse matrix (PRD §14.1)

Three read-only archaeology lanes ran against `Mikecranesync/MIRA`. **Every claim below was
re-verified by hand against the tree** before being recorded — per the standing rule that
sub-agent output is not trusted on faith. Three agent claims did not survive that check; they are
recorded in §3.4 because acting on them would have caused real damage.

### 3.1 Ownership map — the Phase-0 exit gate

| Capability | Canonical owner | Evidence | Status |
|---|---|---|---|
| Ingest normalization | `mira-relay/ingest_contract.py` | `normalize_tag_path` / `build_tag_entry` / `build_ingest_batch`; sole definition | **REUSE AS-IS** |
| Ingest enforcement + persistence | `mira-relay/tag_ingest.py` | `ingest_batch`, `NeonTagStore.persist_batch`; only writer of `tag_events` + `live_signal_cache` | **REUSE AS-IS** |
| Historian **read** layer | `mira-relay/historian.py` + `historian_postgres.py` | served by `relay_server.py` routes | **REUSE AS-IS** |
| Historian **write** / event capture | `tag_events` (mig 033) + `live_signal_cache` | written only via `tag_ingest.py` | **REUSE AS-IS** |
| Edge/threshold diffing | `mira-relay/tag_diff_logger.py` → `tag_event_diffs` (mig **037 exists**) | Celery task `mira-crawler/tasks/tag_diff_historizer.py` | **EXTEND** — code complete, scheduling unproven |
| Flaky/chatter detection | `mira-relay/flaky_detector.py` | no live caller found | **UNKNOWN-NEEDS-PROOF** |
| In-gateway anomalies A0–A12 | `plc/conv_simple_anomaly/rules_core.py` + `ignition/webdev/FactoryLM/api/diagnose/` | parity-guarded by `tests/regime7_ignition` | **REUSE AS-IS** |
| Statistical difference primitives | `plc/conv_simple_anomaly/difference_detectors.py`, `event_context.py`, `baseline_learner.py` | no live caller found | **UNKNOWN-NEEDS-PROOF** — do not duplicate |
| Offline run/batch diffing | `mira-crawler/run_engine/diff.py` | Celery batch, off the streaming path | **KEEP — separate domain** |
| Asset graph | `kg_entities` / `kg_relationships` (mig 001, 009, 018) | — | **REUSE AS-IS** |
| **Causal/topology vocabulary** | migration `018_relationship_proposals.sql` CHECK | see §3.2 | **REUSE AS-IS** — richer than assumed |
| Multi-hop traversal | `mig 009_kg_multi_hop.sql` + `docs/specs/knowledge-graph-multi-hop-spec.md` | composite traversal indexes | **REUSE AS-IS** |
| **Permissive / interlock reasoning** | `mira-bots/shared/interlock_context.py` | **wired**: `engine.py:91` import, `engine.py:5428 _build_interlock_context` | **REUSE AS-IS** — see §3.3 |
| UNS builders / resolver | `mira-crawler/ingest/uns.py`, `mira-bots/shared/uns_resolver.py` | — | **REUSE AS-IS** |
| Reasoning engine | `mira-bots/shared/engine.py` (Supervisor) | — | **REUSE AS-IS** |
| Evidence contract | `materialized_evidence/context_contract.py` + `mira-bots/shared/technician_context.py` | flag `MIRA_CONTEXT_CONTRACT`, default **off** | **EXTEND** |
| Docs retrieval / citations | `recall_knowledge`, `knowledge_entries`, `citation_compliance.py`, `manual-rag.ts` | — | **REUSE AS-IS** |
| Appliance UI candidate | `mira-bots/ask_api/app.py` + `gate_state.py` | Ignition/kiosk surface | **EXTEND** |
| SimLab | `simlab/` (34 modules) | deterministic; publishes `source_system="simulator"`, `simulated=True` | **REUSE AS-IS** |
| Real-vs-simulated provenance | `mira-relay/tag_ingest.py` | `source_system` discriminator + `simulated` flag + cache-skip so sim cannot overwrite real | **REUSE AS-IS** |
| CV-101 / CV-200 ingestion | — | **contested, see §3.4** | **UNKNOWN-NEEDS-PROOF** |

**No one-pipeline-law violations were found.** `tests/test_architecture.py` Contract 5 is passing
and no module defines a rival normalizer, batch shape, or `tag_events` writer.

### 3.2 The causal vocabulary already exists (do NOT add types)

Migration `018_relationship_proposals.sql` already constrains `relationship_type` to:

```
HAS_COMPONENT INSTANCE_OF LOCATED_IN HAS_PART            -- hierarchy
HAS_DOCUMENT HAS_CHUNK REFERENCES HAS_PROCEDURE          -- documentation
WIRED_TO POWERED_BY MAPS_TO PUBLISHED_AS                 -- wiring & power
USED_IN_LOGIC TRIGGERS CAUSES                            -- logic & control
OCCURS_ON RESOLVED_BY HAS_FAILURE_MODE                   -- faults
HAS_SIGNAL HAS_ALIAS                                     -- signals
DEPENDS_ON UPSTREAM_OF DOWNSTREAM_OF REPLACES            -- topology
CONFIRMED_BY CONTRADICTED_BY                             -- evidence meta
```

PRD §4 (asset dependency reasoning) needs conveyor→motor→VFD, line hierarchy, upstream/downstream
and shared-utility dependency. `POWERED_BY`, `WIRED_TO`, `UPSTREAM_OF`, `DOWNSTREAM_OF`,
`DEPENDS_ON` and `CAUSES` cover all of it. **Phase 4 is a data-population problem, not a schema
problem.** The one genuinely open question is whether *shared utility* (plant air feeding several
machines) is best modelled as `DEPENDS_ON` fan-in — a modelling decision, not a migration.

### 3.3 The §12 reasoning contract is largely already built

`mira-bots/shared/interlock_context.py` implements almost exactly the PRD §12 contract:

- `fetch_interlocks()` / `recall_interlocks()` reads **verified** `kg_relationships` for an asset's
  UNS subtree, with `plc_rung` evidence — "empty recall ⇒ no answer".
- `build_interlock_answer()` is a **pure** function over recalled edges + live tag state; causal
  structure comes only from the approved store, values only from live state.
- `evaluate_permissive()` is a deterministic model of the run-permissive chain.
- It returns `None` when nothing is approved — no speculation.

It is **wired into the engine** (`engine.py:91`, `engine.py:5428`). PRD §12's "prefer deterministic
causality over generic LLM speculation" is therefore an **extend**, not a build.

### 3.4 Agent claims that did NOT survive verification

Recorded because acting on any of them would have caused real damage.

| Claim | Reality | Why it mattered |
|---|---|---|
| "Cannot express `driven_by` / `upstream_of` / `shared_utility_feeds` — add 4 new types to `mira-hub/src/lib/kg/types.ts`" | **False.** `UPSTREAM_OF`, `DOWNSTREAM_OF`, `DEPENDS_ON`, `CAUSES`, `POWERED_BY`, `WIRED_TO` all already exist — in a **SQL CHECK constraint** (mig 018), not in a `types.ts` (that path yielded nothing). | Would have added duplicate relationship types **and** edited the wrong file — the exact "rebuild what exists" failure the PRD forbids. |
| "Verify migration 037 exists before Phase 5 — it may be missing" | **False.** `mira-hub/db/migrations/037_tag_event_diffs.sql` is present. | Would have sent someone chasing a non-existent gap. |
| "CV-200 and Northwind are branding aliases only" | **Materially incomplete.** `CV-200` is a *real UNS path segment* — `enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200`. See §3.5. | The dual-identity risk is the single biggest data-modelling hazard in this PRD; "just branding" would have hidden it. |
| "No production CV-101 → NeonDB ingest active today" | **Contradicted** by issue #3161, which reports 845k rows in 24 h from `source_system='ignition'`, `source_connection_id='cv101-bench-gw'`, and 19.2M rows since 2026-07-04. | Ingest *is* active — it is replaying a frozen snapshot. Opposite conclusions, opposite remedies. Marked UNKNOWN-NEEDS-PROOF pending a read-only DB check. |

### 3.5 ⚠️ One physical conveyor, at least five UNS identities

The single most consequential finding. The same Micro820 + GS10 rig is addressed as:

```
enterprise.garage.demo_cell.cv_101
enterprise.garage.demo_cell.bottling_demo.cv_101
enterprise.garage.cv_101
enterprise.garage.area.demo_cell.line.conveyor_line.equipment.conveyor_001
enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200
```

The Northwind/Riverside identity is **deliberate**: `plc/ignition-project/NorthwindBottling/README.md`
states it *"**ADDS** a Northwind surface; it does **NOT repoint** the garage `ConvSimpleLive` demo.
Same physical rig, same source tag paths."* So CV-200 is a second *presentation* identity over
identical source tags — not a rename, and not merely branding.

`CV-200` appears in 42 tracked files, `CV-101` in 271, `Northwind` in 47. There is no `cv_200`
snake-case form.

**Why this endangers the PRD:** §6 requires every reading to preserve asset identity and
provenance; §11 requires incident reconstruction; §17 requires "the graph relates machine/device
context". If history lands under one identity and the graph/documents under another, the historian
fragments and root-cause traversal silently misses edges — while every individual component still
looks correct.

### ✅ RESOLVED 2026-08-14 — see **ADR-0034**

Decided by Mike:

| | |
|---|---|
| **Canonical machine key** | `cv_101` |
| **Human name** | **"Discharge Conveyor"** (`kg_entities.name`) |
| **Everything else** | alias in `kg_entities.properties` — `CV-200`, `discharge_conveyor_cv200`, `conveyor_001`; `CV-100` to be retired |

**No schema migration.** `kg_entities` already separates `entity_id` (machine key) / `name`
(human) / `properties` (aliases), so this is additive.

`cv_101` was chosen because the live stream is already keyed to it (`cv101-bench-gw`), so
**nothing has to be re-keyed** — making the Northwind id canonical would have meant migrating the
live stream *and* existing history, on a stream #3161 already reports as unstable.
"Discharge Conveyor" was chosen over the incumbent "garage conveyor" (~120 uses) because it names
what the machine *does* rather than where it lives — the appliance ships into a customer's control
panel, where "the garage conveyor" means nothing. Location already lives in the UNS path.

The Northwind/Riverside path remains a valid **presentation** surface. Consequence to enforce:
any path accepting an asset reference must resolve aliases to `cv_101` before writing — **storing
a non-canonical id is a bug.**

**Not started:** the companion repo `Mikecranesync/factorylm`.

---

## 4. Phase 0 exit gate — status

The gate (PRD §16) is: *state exactly which existing system owns each capability, with no
ambiguous duplicate ownership.*

| Capability | Owner | Status |
|---|---|---|
| Live telemetry | `mira-relay/tag_ingest.py` (+ `ingest_contract.py`) | ✅ unambiguous |
| Normalization | `mira-relay/ingest_contract.py` | ✅ unambiguous |
| Historian | write `tag_events`/`live_signal_cache`; read `mira-relay/historian*.py` | ✅ unambiguous |
| Asset identity | `kg_entities`/`kg_relationships` + `uns.py`/`uns_resolver.py` | ✅ unambiguous |
| Documentation | `knowledge_entries` + `recall_knowledge` + `manual-rag.ts` | ✅ unambiguous |
| Reasoning | `mira-bots/shared/engine.py` (+ `interlock_context.py`) | ✅ unambiguous |
| Citations | `mira-bots/shared/citation_compliance.py` | ✅ unambiguous |
| SimLab | `simlab/` (34 modules) | ✅ unambiguous |
| **Asset identity** ("Discharge Conveyor") | **`cv_101` canonical — ADR-0034** | ✅ **decided 2026-08-14** |
| CV-101 ingestion — *live vs replayed* | `tag_ingest.py` owns it; **measured FROZEN/REPLAYED** (§8) | ✅ **settled 2026-08-14** |
| UI | `mira-bots/ask_api/` (Ignition/kiosk) | ⚠️ no edge surface yet |
| **Target-PC runtime inventory** | this document §1 | ✅ complete |
| **Git/worktree safety report** | this document §1.5 | ✅ complete |

**Gate verdict: SUBSTANTIALLY MET — one verification outstanding.** All capabilities now have a
single unambiguous owner and no duplicate implementations (the one-pipeline law is holding). The
identity ambiguity that blocked the gate is **resolved by ADR-0034**: canonical key `cv_101`, human
name **"Discharge Conveyor"**, everything else an alias.

What remains is not ambiguity of *ownership* but of *fact*: `tag_ingest.py` unambiguously owns
CV-101 ingestion, but whether that stream is currently live or replaying a frozen snapshot is
contradicted between #3161 and archaeology (§3.4) and was not measured here. One read-only
`db-inspect.yml` run settles it. **Phase 1 (appliance runtime) may proceed; Phase 2's dual-source
provenance gate may not, until that is settled and #3161 is fixed.**

This is a *good* outcome for the PRD's thesis — §35's "the primary mission is convergence, reuse,
wiring, gap closure" is confirmed: far more exists than the PRD assumes, including the §12
reasoning contract and the full causal vocabulary. The remaining work is genuinely wiring, not
building.

---

## 5. What the PRD assumes must be built, but already exists

The PRD's own directive is *"When a feature already exists, stop building and integrate it."*
Applying that to the phase plan materially shrinks it:

| PRD phase | Assumed work | Reality |
|---|---|---|
| §16 Phase 3 — incident history | build/converge a historian | Write path + read API both exist; `tag_diff_logger` → `tag_event_diffs` (mig **037 present**) is code-complete. Work = **schedule + prove**, not build. |
| §16 Phase 4 — asset dependency reasoning | express upstream/downstream, motor/VFD, shared utility | Vocabulary already has `UPSTREAM_OF`/`DOWNSTREAM_OF`/`DEPENDS_ON`/`CAUSES`/`POWERED_BY`/`WIRED_TO`, plus multi-hop indexes (mig 009) and a spec. Work = **populate data**, not migrate schema. |
| §12 reasoning contract | build deterministic causal reasoning | `interlock_context.py` already does recall-verified-edges + pure evaluation over live state, wired at `engine.py:5428`. Work = **extend to more asset types**. |
| §6/§8 real-vs-simulated provenance | build a provenance model | `source_system` + `simulated` + cache-skip already prevent sim overwriting real. Work = **prove it under mixed load**. |
| §13 technician UX | possibly a new frontend | `mira-bots/ask_api/` exists. Work = **thin edge surface**, and the PRD says not to build a frontend unless required. |

Genuinely new/unproven: the **appliance runtime** (§16 Phase 1), the **edge surface**, enabling the
**evidence contract** flag, and the **benchmark** (§16 Phase 6).

## 6. Recommended sequencing (proposed, NOT executed)

1. ~~**Decide the canonical asset identity**~~ ✅ **DONE 2026-08-14 — ADR-0034.** Canonical key
   `cv_101`; human name **"Discharge Conveyor"**; `CV-200` / `discharge_conveyor_cv200` /
   `conveyor_001` become aliases; `CV-100` to be retired. No migration — `kg_entities` already has
   `entity_id` / `name` / `properties`. **Next mechanical step:** write the alias rows and add
   alias resolution to every asset-reference intake, so a non-canonical id can never be stored.
2. **Fix #3161** before Phase 2. The dual-source provenance exit gate cannot be honestly met on a
   stream that reports 2026-08-02 values as `freshness_status='live'`. Note this also needs a
   design decision (split collector-liveness from value-freshness), not just a patch.
3. **Confirm the live-ingest reality** with a read-only DB check to settle §3.4's contradiction.
4. **Adopt Ignition-over-Tailscale** (§3.7 "Ignition plant") for Box #001; defer the local
   protocol adapter — the PLC is not reachable from this box anyway (§1.4).
5. **Decide the disk story** before the historian (§2.3): 11 GiB free (measured here), and #3161
   reports this exact stream producing 845k rows/day from 12 tags (its figure, not re-verified).
6. Only then Phase 1 (appliance runtime), expressed portably — compose healthchecks and restart
   policies, not launchd (§2.1).

## 7. Process note

Three read-only archaeology agents were dispatched in parallel and all three returned useful
maps — but **four of their headline claims were wrong or materially incomplete** (§3.4), including
one that would have added duplicate relationship types to a file that does not exist. Every claim
in this document was re-grounded against the tree before being recorded. Sub-agent output is a
lead, not evidence.

One agent also wrote a report into the shared checkout at
`.planning/ARCHAEOLOGY-EDGE-APPLIANCE-REUSE.md` despite a read-only instruction. `.planning/` is
gitignored so nothing was clobbered, but it confirms that write-capable dispatches need worktree
isolation even when the prompt says "research only".


---

## 8. CV-101 telemetry verdict — **FROZEN / REPLAYED** (measured 2026-08-14)

The last open Phase-0 fact, settled from production data via a read-only `db-inspect` probe
added for this purpose (run `31773087124`, `target=prod`, 2026-08-14 05:29 UTC).

### Evidence

| metric — last 24 h of ingests, `source_connection_id='cv101-bench-gw'` | value |
|---|---|
| rows | 774,480 |
| **distinct observed timestamps** | **1** |
| **live_ratio** (distinct observed / rows) | **0.0000** |
| **observed_span** | **00:00:00** |
| ingest_span | 23:59:58 |
| newest observed | 2026-08-02 07:14:33Z |
| **newest observation age** | **11 days 22:15** |
| newest ingest age | 0.7 s |

Rows arrive continuously (2,952 in the last 5 minutes) all stamped with **one** observed
timestamp from twelve days ago — received-time advancing, observed-time frozen.

Corroborating: `distinct_values = 1` on **all 12 tags** over 24 h; `vfd_comm_ok=false`,
`vfd_frequency=0`, `vfd_current=0`; 774,468 rows `quality='bad'`, `simulated=false`.

**Method note.** Row count is not evidence — a replay loop produces 845k rows/24 h just as
readily as a live stream. The discriminator is `distinct(event_timestamp) / rows`, because the
033 schema already separates observed-at from received-at.

### Root cause

**The bench PLC↔Ignition link has been down since 2026-08-02.** Ignition has been reporting
`quality='bad'` and `vfd_comm_ok=false` the entire time; the gateway kept forwarding
last-known values with their original frozen timestamps. This is a **physical** fault at the
rig, not a code fault.

Compounding it, a genuine code defect: `freshness_status` was the hardcoded constant
`"simulated" if simulated else "live"` and was **never computed**, so untrustworthy readings
were cached as `live`. Rows 41 and 45 days stale also read `live`. Fixed in PR #3232 (derive
from quality; gated on quality only, because ageing client timestamps caused the 2026-07-04
report-by-exception regression).

### Consequences

- **Phase 0 is otherwise COMPLETE.** Ownership is unambiguous across every capability;
  identity is decided (ADR-0034); this last fact is now measured rather than assumed.
- **Phase 1 remains gated.** It starts on a genuine LIVE verdict, which requires restoring the
  bench link — a physical action, then a re-run of the same probe expecting
  `live_ratio ≈ 1.0`.
- **Phase 2 remains gated** independently, per its own provenance requirements.
- A **sixth** UNS identity surfaced (`enterprise.home_garage.conveyor_lab.conveyor_1`, 23.7M
  rows) — ADR-0034's alias rule is already violated in production. Filed as **#3233**.
