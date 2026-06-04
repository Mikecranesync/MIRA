# FlowFuse / Node-RED / live-data — next steps

**Purpose:** a prioritized, repo-grounded action plan coming out of the 2026-06-04 alignment audit (`docs/audits/2026-06-04-flowfuse-ignition-alignment.md`).
**Guiding principle:** the reasoning brain is ahead of the live nervous system. Close that gap with **one boring, reliable, read-only data path** — not a big build.

**Standing constraints (do not violate):** no PLC/VFD writes; no cloud→plant inbound; don't remove safety guards; don't replace Ignition; don't make FlowFuse a hard dependency; don't claim Sparkplug B is implemented; don't present sim data as live; preserve the UNS confirmation gate + citations.

---

## Priority order

### P0 — Documentation consolidation  ✅ (this batch)
- The five missing deliverables + this audit now exist under `docs/research/`, `docs/architecture/`, `docs/plans/`, `docs/audits/`.
- **Action:** link them from `docs/THEORY_OF_OPERATIONS.md` and the ADR cross-references so they're discoverable. (1 small docs PR.)

### P1 — One boring live data path (read-only)
The single highest-value engineering move. Build a **read-only live-tag snapshot adapter** (see "Next coding task" below). Plain MQTT / existing relay only — **no Sparkplug yet**.
- **Done when:** a confirmed UNS asset's latest real snapshot is attached to the conversation *after* the gate, labelled + timestamped, and logged for traceability; tests cover normalize + stale-handling.

### P2 — Normalize tag sources behind one shape
- Today live tags arrive two ways (bench MQTT via `plc/live-plc-bridge/bridge.py`; customer HTTPS via `ignition/gateway-scripts/tag-stream.py` → `mira-relay`). Make both normalize into the **same** `{uns_path, datapoint, value, quality, ts, source}` snapshot so the engine is source-agnostic.
- Fix the documented tag-name casing mismatch (readiness runbook) in the adapter's normalize step, not by editing the PLC.

### P3 — Keep Ignition integration customer-friendly
- Continue on the ADR-0021 path: allowlist-first reads, outbound-HTTPS, HMAC. Land the Exchange listing work (`docs/specs/ignition-exchange-spec.md`, #1625) on its own track.
- No new fieldbus sockets in any customer-shipped package.

### P4 — Plain MQTT before Sparkplug B
- Only implement Sparkplug B (`mira-connect`, #1627) when a real customer UNS requires birth/death + typed metrics. Until then, plain MQTT with explicit `quality`/`ts` is enough.

### P5 — FlowFuse: hold
- Do **not** adopt FlowFuse yet (ADR-0016). Re-evaluate only on its documented triggers: a multi-tenant deal needing per-customer Node-RED isolation, Node-RED 4.x EOL/CVE, or a flow-drift production incident.

### P6 — Retire the stub honestly
- Once the snapshot adapter exists, decide the fate of `mira-bots/shared/workers/plc_worker.py` (the "not connected yet" stub): either route it to the new adapter (read-only) or delete it. Don't leave a misleading stub once a real path exists.

---

## Phase 4 — Next coding task (task list only this pass)

**Task:** *Create a read-only live-tag snapshot adapter that accepts conveyor/VFD/PLC state from the easiest current source, normalizes it into a UNS-keyed structure, attaches it to the MIRA conversation context after the UNS confirmation gate, and logs the snapshot for traceability.*

**Why this is NOT implemented in this pass:** attaching a snapshot *after the gate* requires touching `mira-bots/shared/engine.py` (4774 lines; flagged in `.claude/rules/codegraph-usage.md` as requiring a `codegraph_impact` pass before edits — high blast radius). That is not a "very small" change, and the constraints say docs/adapters over rewrites. So this is a task list, not a patch.

**Build it read-only, in small pieces, with tests:**

1. **`snapshot.py` (pure, no I/O)** — define `LiveTagSnapshot {uns_path, datapoint, value, quality, ts, source}` and `normalize(raw_tags, uns_path) -> list[LiveTagSnapshot]`. Reuse the decode logic that already exists in `mira-bots/ask_api/app.py::_build_status_block` (extract it; don't duplicate). Honor the `vfd_comm_ok=false ⇒ stale` rule. **Unit-testable with zero infra.**
2. **Source readers (read-only, behind one interface):**
   - MQTT reader (bench): subscribe to the UNS topics `plc/live-plc-bridge/bridge.py` already publishes.
   - Relay reader (customer): read the latest row from the `equipment_status` table `mira-relay` already upserts.
   - Both return raw tags for `normalize()`. **No writes anywhere.**
3. **Snapshot store (trace):** append each attached snapshot to a small read-only table (reuse the `equipment_status` pattern), keyed by `uns_path` + `ts` + `session_id`, for "what changed before the fault?" and auditability.
4. **Engine attach point (the one careful edit):** *after* the UNS confirmation gate succeeds, look up the latest snapshot for the confirmed `uns_path` and attach it to context — mirroring how `ask_api` prepends `[LIVE CONVEYOR STATUS]`, but gate-scoped and logged. Do a `codegraph_impact` on the gate/`process()` path first; keep the diff surgical; add a golden case.
5. **Tests:** `normalize()` unit tests (good/stale/unknown tags); a snapshot-attach integration test; a golden case proving the gate still fires before any live data is used.
6. **Safety review:** confirm no write FCs, no inbound, no Sparkplug claim, sim labelled as sim, citations intact. Run `mira-run-hallucination-audit` after the engine edit.

---

## Summary answers

- **FlowFuse now?** No — deferred (ADR-0016).
- **Direction?** Both share **plain MQTT/UNS**; the customer-shipping spine is the **outbound-HTTPS relay** (Ignition → MIRA). Node-RED feeds the bus at the edge; Ignition stays the source of truth. MIRA never feeds the plant.
- **Safest first experiment:** the read-only snapshot adapter above, on the bench (`plc/live-plc-bridge` → MQTT) first, then the relay path.
- **Sparkplug B now?** No — spec-only; defer to #1627.
- **Next coding task:** the snapshot adapter (Phase 4), built read-only with tests, with only one surgical engine edit guarded by `codegraph_impact`.
