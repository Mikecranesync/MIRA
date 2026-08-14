# Magic Box #001 — Phase 0 Reconnaissance

**PRD:** MIRA Edge / Magic Box #001 (build-ready, supplied 2026-08-13)
**Status:** Phase 0 IN PROGRESS — runtime inventory complete, repo archaeology in flight
**Rule being honored:** PRD §16 Phase 0 — *"No major feature work"*, and §24 — *"Begin with
reconnaissance, not implementation."*

This document is the Phase-0 deliverable. It is written before any Magic Box code, on purpose.

---

## 0. Headline findings (read these first)

Five things materially change the PRD's plan. Each is measured, not assumed.

| # | Finding | Consequence for the PRD |
|---|---|---|
| 1 | **One physical conveyor carries at least FIVE UNS identities** — `enterprise.garage.demo_cell.cv_101`, `…demo_cell.bottling_demo.cv_101`, `enterprise.garage.cv_101`, `…conveyor_line.equipment.conveyor_001`, and `enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200`. CV-200 is a **real UNS segment**, not branding; the Northwind surface deliberately re-presents the same rig and same source tags (§3.5). | §2/§3.2/§19 asset identity is genuinely ambiguous. **Decide a canonical identity + alias map before Phase 2** — split identity fragments the historian and silently drops graph edges while every part still looks correct. |
| 2 | **The CV-101 telemetry stream is currently replaying a frozen snapshot and labelling it `live`** (issue #3161, verified 2026-08-08: 845k rows/24 h, 100 % `quality='bad'`, `MIN=MAX` source timestamp of 2026-08-02, 144 h ingest lag, yet `freshness_status='live'`). | This is a **direct, pre-existing blocker** for PRD §6 (provenance), §11 (incident history) and §17 ("provenance is preserved"). Phase 2/3 cannot be honestly demonstrated on top of it. **Fix #3161 first.** |
| 3 | **The PLC is not reachable from this machine.** `192.168.1.100` does not answer ping from CHARLIE. Consistent with the known point-to-point topology (Micro820 ↔ PLC laptop, not on the LAN). | §19's "physical proof" cannot run direct from this box. The **working path is Ignition over Tailscale** (below) — which the PRD already blesses in §3.7. |
| 4 | **The Ignition gateway IS reachable** — `100.72.2.99:8088` OPEN (the Windows laptop `laptop-0ka3c70h`, over Tailscale). LAN `192.168.1.20:8088` and `.99:8088` are closed. | Confirms §3.7's "Ignition plant" path is the viable one for Box #001. Do **not** plan a local protocol adapter for Phase 1–2. |
| 5 | **Nothing is running on the target machine.** Colima is stopped → no Docker daemon → **zero MIRA containers**; no MIRA port is listening. | §5 says "do not assume a clean computer" — the real state is the opposite of what was feared: it is *empty*, not crowded. Phase 1 is a genuine cold start, which is **easier**, but it also means no local service is currently proven. |

Plus one hard constraint: **11 GiB of disk free (95 % full)**. A local historian has almost no
headroom. See §2.3.

---

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
change-based capture from the start. Note issue #3161's replay produced **845k rows in 24 h from
12 tags** — that is the anti-pattern, on this exact stream.

### 2.4 Phase 2 rests on a stream that is currently lying

Restating finding #2 because it is the critical path: PRD §6 requires every reading to preserve
quality, timestamp and simulated-vs-physical status, and §17 requires "provenance is preserved".
Issue #3161 documents the live stream doing the opposite — stale values refreshing
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
| "No production CV-101 → NeonDB ingest active today" | **Contradicted** by issue #3161, which measured 845k rows in 24 h from `source_system='ignition'`, `source_connection_id='cv101-bench-gw'`, and 19.2M rows since 2026-07-04. | Ingest *is* active — it is replaying a frozen snapshot. Opposite conclusions, opposite remedies. Marked UNKNOWN-NEEDS-PROOF pending a read-only DB check. |

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
looks correct. **A canonical identity + explicit alias mapping must be decided before Phase 2.**

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
| **CV-101 / CV-200 ingestion** | **contested — ≥5 UNS identities (§3.5); live-ingest state contradicted (§3.4)** | ❌ **AMBIGUOUS** |
| UI | `mira-bots/ask_api/` (Ignition/kiosk) | ⚠️ no edge surface yet |
| **Target-PC runtime inventory** | this document §1 | ✅ complete |
| **Git/worktree safety report** | this document §1.5 | ✅ complete |

**Gate verdict: NOT MET — one blocker.** Nine of ten capabilities have a single unambiguous owner
and no duplicate implementations (the one-pipeline law is holding). The gate fails on exactly one
row: **CV-101/CV-200 asset identity and its live-ingest state.** The PRD's gate wording is "no
ambiguous duplicate ownership", and §3.5 is precisely that.

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

1. **Decide the canonical asset identity** for the physical rig and write the alias map (§3.5).
   Cheapest item here and everything downstream keys on it. This is a **product decision**, not a
   code change — CV-101 (garage/engineering truth) and CV-200 (Northwind/customer-facing demo)
   both have legitimate reasons to exist; what is missing is a declared canonical + mapping.
2. **Fix #3161** before Phase 2. The dual-source provenance exit gate cannot be honestly met on a
   stream that reports 2026-08-02 values as `freshness_status='live'`. Note this also needs a
   design decision (split collector-liveness from value-freshness), not just a patch.
3. **Confirm the live-ingest reality** with a read-only DB check to settle §3.4's contradiction.
4. **Adopt Ignition-over-Tailscale** (§3.7 "Ignition plant") for Box #001; defer the local
   protocol adapter — the PLC is not reachable from this box anyway (§1.4).
5. **Decide the disk story** before the historian (§2.3): 11 GiB free, and #3161 shows this exact
   stream producing 845k rows/day from 12 tags.
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
