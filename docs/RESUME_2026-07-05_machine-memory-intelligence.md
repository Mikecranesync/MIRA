# RESUME 2026-07-05 — Machine Memory → Intelligence (Hub → engine → HMI) + relay perf

## TL;DR
The **live machine state is now a first-class intelligence input to Ask MIRA** across all three
surfaces, plus the live-tag path was made ~43% faster. **All four PRs are now merged + deployed**
(2026-07-05 — #2479 merged as `12815df7`, auto-deployed mira-pipeline). The full Hub → engine → HMI
arc is closed.

| PR | Scope | State | VERSION |
|---|---|---|---|
| **#2474** | relay perf — 1 Neon conn/push (was 3 + pre-pings) | merged + **deployed** | 3.60.3 |
| **#2476** | Hub asset chat gets the live-evidence **context packet** | merged + **deployed** (`5dccbc2e`) | 3.62.0 |
| **#2478** | engine `_maybe_attach_live_snapshot` **Live Machine Evidence** section | merged (`9c9d16e6`) | 3.63.0 |
| **#2479** | Ignition HMI `ignition_chat.py` **Assessment** | **MERGED + deployed** (`12815df7`) | 3.64.0 |

**2026-07-05 close-out:** #2479 merged (all checks green incl. staging-gate/Version Bump/Hub E2E;
Eval Offline passed too). Smoke passed → deploy-vps succeeded. Deployed pipeline verified live via
`app.factorylm.com/v1/models` → 200 (same container mounts the ignition_chat router). The HMAC
`/api/v1/ignition/chat` endpoint is **not on public DNS** (`api.factorylm.com` doesn't resolve —
reachable only from the Ignition gateway); Assessment heading is system-prompt-only. So CI (route +
`test_ignition_chat_direct_connection.py` 9/9) + deploy + live-process is the verification ceiling.
Worktrees `../mira-ign-live` + `../mira-mm-intel` pruned. **Next: deferred #1 (analog assessment on
the Ignition path via `tag_entities.expected_envelope`) — needs a schema/design pass, not a one-shot.**

**Measured win (#2474):** live-tag push cadence **~2.47 s → ~1.41 s** on prod.

## The one thing to do next
**Merge #2479** (open, green, `MERGEABLE`/`CLEAN`). Then let the merge auto-deploy `mira-pipeline`
and confirm the Ignition chat endpoint answers. If main drifted, quick re-rebase (VERSION/CHANGELOG
only — see gotchas). This closes the full Hub → engine → HMI arc.

## What was built (the shared idea)
A deterministic, read-only **assessment** of the live machine state — the "VFD-healthy-but-stopped
→ command/permissive/interlock, not the drive" one-liner — computed once and reused everywhere:
- **Hub (TS):** `mira-hub/src/lib/machine-context-intelligence.ts` (`deriveContextIntelligence`) +
  `machine-context-packet.ts` (`buildMachineContextPacket`, `renderMachineEvidenceSection`), injected
  into `/api/assets/[id]/chat`. Computed once in `buildMachineMemoryResponse` (shared by card + SSE
  + chat packet).
- **Engine (Py):** `mira-bots/shared/live_snapshot.py` `assess_snapshots()` + `render_machine_evidence()`,
  wired into `engine.py::_maybe_attach_live_snapshot` (the gated live-tag preamble path). Embeds the
  `[LIVE CONVEYOR STATUS]` marker verbatim so the kiosk gate-bypass + fast-path (`_LIVE_STATUS_HEADER`)
  still fire.
- **Ignition HMI (Py):** `live_snapshot.assess_from_paths()` (assesses ONLY scaling-immune enum/bool
  signals from the messy `{full_path: {"value": str}}` wire form), wired into `ignition_chat.py`.

Discovery notes: `docs/discovery/machine_memory_intelligence_bridge.md` (Hub),
`docs/discovery/engine_live_evidence.md` (engine), `docs/discovery/ignition_live_evidence.md` (HMI).

## Deferred follow-ups (documented, in priority order)
1. **Analog assessment on the Ignition path** — currently only enum/bool signals are assessed (the
   wire value scaling is ambiguous — raw register vs engineering). Needs `tag_entities.expected_envelope`
   (assess against per-tag min/max/normal/fault_states) OR a raw-vs-engineering flag on the wire.
2. **A structured, citable live-evidence type in the Supervisor** — today live tags reach the LLM as
   *text preamble* and `tag_evidence` is *trace-only*; make it a real evidence item so
   citation-compliance + groundedness score it (bigger engine-contract change — do NOT rush it).
3. **`tag_entities`-driven decode unification** — two decode tables today (`live_snapshot` short-key
   vs the Ignition `tag_entities` enrichment).
4. **Per-component UNS granularity** — `approved_tags` seeds point every tag at one flat asset node.
5. **Persist Ask-MIRA diagnostic snapshots** (Phase 4 deferred from #2476).

## Verification reality (be honest about it)
- The chat **"Live Machine Evidence" heading is system-prompt-only — never streamed to the client**,
  so it can't be observed externally. It's proven by CI-green route/engine tests + the machine-memory
  endpoint's new fields.
- Live authenticated CV-101 render needs a real tenant session (**bench tenant
  `e88bd0e8-8a84-4e30-9803-c0dc6efb07fe`**) or the **`DEMO_API_TOKEN`** demo path (demo tenant
  `00000000-0000-0000-0000-0000000000d1`, demo asset ids `20000000-0001-0000-0000-00000000000X`).
  Prod Hub is `https://app.factorylm.com` at root (no `/hub`); both endpoints 401 without a session.

## Housekeeping / gotchas (saved pain)
- **Prune two leftover worktrees:** `../mira-mm-intel` (#2476) and `../mira-ign-live` (#2479).
- **main churns FAST** — every rebase hits VERSION/CHANGELOG conflicts. Resolve VERSION to the max;
  for CHANGELOG take `git show origin/main:docs/CHANGELOG.md` and **prepend** your entry (keeps all
  of main's entries). Then `--admin` merge (strict up-to-date + phantom checks).
- **Required checks:** `staging-gate`, `Version Bump Check`, `Hub E2E (command-center + onboarding)`.
  `Eval Offline` is **pre-existing red on main** — not a blocker. `sitemap-drift` + `cmms-deploy-env`
  fail **locally on Windows only** (env artifacts) — they pass in CI.
- **Pre-push routine (learned the hard way):** run `ruff format --check` (NOT just `ruff check`) AND
  the **FULL** affected test suite — including `**/__tests__/` route tests. I shipped a red CI twice
  by scoping too narrowly.
- **Discovery sub-agents keep reading the stale local branch** `feat/hub-live-signal-polish` instead
  of `main` and falsely report code "doesn't exist." Always verify against `main` (or a worktree off it).
- **Deploy targets:** `mira-hub` + `mira-pipeline` are in the deploy-vps defaults (auto-deploy on
  merge → smoke → deploy-vps). `mira-relay` is NOT — it needs an explicit
  `deploy-vps.yml services="mira-relay"` dispatch.

## Related memory
`project_machine_memory_intelligence_bridge`, `reference_live_tag_latency_budget`,
`project_machine_memory_live_proof`.

---

## Resume prompt (paste this to pick up)

> Resume from `docs/RESUME_2026-07-05_machine-memory-intelligence.md`. The machine-memory →
> intelligence workstream (make live machine state a first-class Ask-MIRA input) is DONE across three
> surfaces + a relay speedup: #2474 (relay perf, merged+deployed, cadence 2.47s→1.41s), #2476 (Hub
> asset-chat live-evidence packet, merged+deployed `5dccbc2e`), #2478 (engine
> `_maybe_attach_live_snapshot` Live Machine Evidence section, merged `9c9d16e6`). **PRIMARY TASK:
> merge #2479** (Ignition HMI `ignition_chat.py` deterministic Assessment — OPEN, green,
> MERGEABLE/CLEAN, VERSION 3.64.0), then let the merge auto-deploy `mira-pipeline` and confirm the
> Ignition chat endpoint answers. If main drifted, quick re-rebase (VERSION→max, CHANGELOG=take
> origin/main + prepend my entry) then `--admin` merge (required checks: staging-gate, Version Bump,
> Hub E2E; Eval Offline is pre-existing red — ignore). The shared piece is a deterministic assessment
> ("VFD healthy but stopped → command/permissive/interlock, not the drive"): Hub
> `machine-context-intelligence.ts`, engine/HMI `mira-bots/shared/live_snapshot.py`
> (`assess_snapshots`/`render_machine_evidence`/`assess_from_paths`). Then pick the next deferred item
> (priority: analog assessment on the Ignition path via `tag_entities.expected_envelope`; then a
> structured citable live-evidence type in the Supervisor — do NOT rush the engine-contract change).
> Housekeeping: prune worktrees `../mira-mm-intel` + `../mira-ign-live`. Pre-push: `ruff format --check`
> + the FULL affected suite incl. `__tests__/`. Verify against `main`, not the stale
> `feat/hub-live-signal-polish` checkout. Full context, gotchas, and asset/tenant ids in the resume doc.
