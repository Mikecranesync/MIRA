# Discovery — Live Machine Evidence on the Python engine / HMI surface

**Date:** 2026-07-05
**Goal:** Extend the deterministic **Live Machine Evidence** win from the Hub asset chat
(PR #2476, `machine_memory_intelligence_bridge`) to the **Python engine / Ignition HMI
deployment surface** — so the direct-connection "Ask MIRA" (`mira-pipeline/ignition_chat.py`)
and any adapter that feeds `live_tags` to the Supervisor also gets a decoded live-value block
**plus a deterministic assessment and the live/context/inference/next-checks separation
instruction**, not just a flat label list.

**Method:** read the engine + live-snapshot + Ignition-chat paths on `main` (this worktree,
not the stale local branch that confused earlier agents).

---

## 1. What exists today (two separate live-tag paths, both text-only)

### A. Engine path — `mira-bots/shared/engine.py::_maybe_attach_live_snapshot` (line ~1526)
- Triggered when an adapter calls `engine.process(..., live_tags=<raw dict>)`.
- Gated (the safety guarantee): attaches ONLY after the UNS confirmation gate — pre-turn FSM
  state ∈ `ACTIVE_DIAGNOSTIC_STATES` **and** `state["asset_identified"]`. Withheld + logged
  otherwise. Best-effort (any failure → original message).
- Flow: `normalize_live_tags(live_tags, uns_base, source, ts)` → `render_status_block(snapshots)`
  → prepends `[LIVE CONVEYOR STATUS]\n<labels>` to the message.
- `mira-bots/shared/live_snapshot.py` is the pure, I/O-free decode: `normalize()` →
  `list[LiveTagSnapshot]` (`{uns_path, datapoint, value, unit, quality good/stale/unknown,
  label, source, ts}`), VFD trust-gated on `vfd_comm_ok`; `render_status_block()` → the flat
  `[LIVE CONVEYOR STATUS]` label list with `[STALE]` markers.

### B. Ignition path — `mira-pipeline/ignition_chat.py` (line ~495)
- Builds its OWN preamble: `_enrich_tag_snapshot_with_semantics` (join verified `tag_entities`
  for units/data_type) → `_format_tag_preamble(snapshot, asset_id)` → `[LIVE TAGS — …]` list →
  `message = f"{preamble}\n\n{question}"`.
- Then calls `engine.process(..., uns_source="direct_connection", tag_evidence=<structured list>)`
  **without `live_tags=`** — so it does NOT trigger `_maybe_attach_live_snapshot`; it pre-bakes
  its own text. `tag_evidence` is **trace-only** (decision_trace), never reaches the LLM as
  structured evidence.
- Shape mismatch to note: the Ignition snapshot is `{full_path: {value, quality, units,
  data_type}}` (keys are Ignition browse paths like `[default]MIRA_IOCheck/VFD/vfd_fault_code`),
  whereas `live_snapshot.normalize` decodes on **short** keys (`vfd_fault_code`). Bridging needs
  a leaf extraction (`path.split("/")[-1]`).

### The engine's structured-evidence contract (do NOT touch in this PR)
The only structured evidence the engine understands is the **RAG chunk dict**
(`_evidence_from_parsed` / `_citation_evidence`, consumed by `citation_compliance` + groundedness
scoring + decision_trace). Making live tags a *citable structured* evidence type would touch that
contract — high blast radius (groundedness, citation enforcement). **Out of scope here.**

---

## 2. The gap

Both Python surfaces render live tags as a **flat text label list**. Neither has:
- a deterministic **assessment** (the Hub's "VFD healthy but stopped → command/permissive/
  interlock, not the drive" one-liner), nor
- the **live / asset+doc context / inference / next-checks separation instruction** the Hub
  packet gives the LLM.

So the HMI-deployed Ask MIRA reasons from raw decoded values only, with no honest
machine-state assessment framing — the exact thing the Hub bridge added.

---

## 3. Minimal, safe slice (this PR)

**Do NOT touch the engine evidence/citation contract.** Only upgrade the **text preamble** the
two paths already produce — the same mechanism, richer content. Pure, deterministic, gated as
today.

1. **`mira-bots/shared/live_snapshot.py` (pure):**
   - `assess_snapshots(snapshots) -> str | None` — the deterministic assessment over
     `LiveTagSnapshot`, mirroring the Hub's `deriveContextIntelligence` summary: active
     fault/stale lead; else VFD-health (comm_ok + fault_code + dc_bus + cmd/status) → the
     "healthy but stopped / running / comms-down / unconfirmed" cases. Never invents a value;
     honest absence when a signal is missing.
   - `render_machine_evidence(snapshots) -> str` — the structured section: `## Live Machine
     Evidence (observed now)` header + the 4-way separation instruction + decoded live values +
     the assessment line + `[STALE]` markers. Mirrors the Hub `renderMachineEvidenceSection`.
     `render_status_block` stays (back-compat) but the engine attach path moves to the new one.
2. **`engine.py::_maybe_attach_live_snapshot`** — swap `render_status_block` → `render_machine_evidence`.
   One-line change inside the existing gated method; no contract change.

**Ignition-chat wiring is the immediate follow-up, deliberately NOT in this PR.**
`ignition_chat.py`'s snapshot is **pre-scaled** (`{"Motor_Current_A": {"value": 11.2, …}}` — the
value is already `11.2 A`, not the raw register) and keyed by **arbitrary tag names**
(`Motor_Current_A`, not the `vfd_current` key `live_snapshot._decode_one` matches). Feeding it
into `live_snapshot.normalize` would miss every key and, where it matched, double-scale. Giving
the Ignition surface a correct assessment needs a `tag_entities`-driven (or role-mapped)
assessment over its own value semantics — a separate, careful change. This PR ships the shared
`assess_snapshots` / `render_machine_evidence` foundation + the engine path; the Ignition
follow-up reuses `assess_snapshots` once its snapshot is mapped to the same decoded facts.

Flag-gating: not needed — the change only enriches an already-gated, best-effort text preamble;
it cannot make MIRA *act*, only frame evidence better. It preserves the direct-connection UNS
contract and the pre-turn gate.

## 4. Tests
- Pure `assess_snapshots`: VFD-healthy-but-stopped, active-fault-leads, comms-down/stale,
  running, honest-absence.
- `render_machine_evidence`: header + separation instruction + decoded values + assessment.
- Engine `_maybe_attach_live_snapshot`: still gated (withheld pre-gate); when open, emits the
  new section.
- `ignition_chat` preamble: includes the assessment; existing `[LIVE TAGS]` block preserved.
- No new fieldbus/write path (read-only doctrine intact).

## 5. Deferred (documented — NOT this PR)
- A genuine **structured, citable live-evidence type** in the Supervisor (so citation compliance
  + groundedness score it uniformly, replacing text-only preambles and the trace-only
  `tag_evidence`). This is the larger engine-contract change.
- `tag_entities`-driven decode unification (the two paths still use two decode tables —
  `live_snapshot.py` short-key table vs the Ignition `tag_entities` enrichment).
- Unify the two preamble builders into one shared renderer (this PR keeps them separate,
  sharing only `assess_snapshots`).
