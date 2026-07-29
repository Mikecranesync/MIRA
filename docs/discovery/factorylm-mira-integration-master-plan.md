# FactoryLM/MIRA Integration Master Plan

**Date:** 2026-07-03 · **Audited at:** `main` @ `9a3c6f80` (includes the same-day machine-memory merges #2403/#2404/#2406/#2407/#2408) · **Method:** 5 parallel read-only audit agents (loop map, seams, duplicates, surfaces, scoreboard) + synthesis. Companion docs, same directory: `repo-integration-map.md`, `integration-seams-register.md`, `duplicate-systems-audit.md`, `product-surface-integration-plan.md`, `product-scoreboard.md`. Every claim is cited there; this plan carries the verdicts.

**Target product sentence:** *FactoryLM/MIRA connects factory equipment, maps and approves its tags and evidence, remembers what machines actually did, detects meaningful changes, and gives maintenance teams cited next actions.*

---

## 1. Executive summary

The repo now contains every stage of the product loop. After the 2026-07-03 machine-memory merges, **the cut moved downstream, not away**: raw tags land (033), typed anomalies persist (038/040 via `run_engine`), and a Hub card displays them — but **zero answer surfaces read the machine memory** (`engine.py`, `ignition_chat.py`, `neon_recall.py`, `manual-rag.ts`, every chat route: empty greps), the card's work-order button is a stub whose target page ignores its prefill, and **both product gates ship OFF** (`MIRA_RUN_DIFF_ENABLED`, `MIRA_ENFORCE_APPROVED_RETRIEVAL`). The integration job is not "build more" — it is ten tickets of wiring, three of which are one-file changes. The active physical proof (bench timer → first CV-101 `tag_events` row → populated card) remains the gate for everything else; this plan sequences around it, and the audit surfaced one thing the proof itself needs (`MIRA_MACHINE_MEMORY_UNS_PATHS` missing from the compose beat service).

## 2. What the repo already has (LIVE or code-complete)

- **Ingest**: one-pipeline contract enforced in CI; REST/HMAC relay production; Sparkplug subscriber built; Ignition tag-stream collector deployed on the bench gateway; relay now tailnet-reachable (#2408).
- **Map/approve**: PLC import → real `ai_suggestions` (the wizard's TagImportStep writes real proposals — its *data source* is the mock, correcting the old sweep); proposals decide → `kg_relationships`/`tag_entities`; asset-agent train→validate→approve FSM server-enforced; `approved_tags` fail-closed allowlist (285 rows incl. today's 58 CV-101 rows).
- **Evidence**: upload → `knowledge_entries` → HAS_DOCUMENT proposals → human decide — the **healthy seam to copy** (seam 7).
- **Machine memory**: worker + beat service in compose (`mira-historian-*`), migrations 038/040 applied to prod today, parity-guarded A0–A12, CV-101 fixtures + drift guards, `MachineMemoryCard` on the asset page.
- **Explain**: Supervisor with UNS gate + groundedness scoring + citation compliance (Python); `WhyMiraThinksThis` evidence panel with `decision_traces` (Hub asset chat).
- **Close loop**: one work-order system of record (`work_orders` mig 007 + Atlas sync; mira-mcp bypass converges via reverse-sync).
- **Measure**: db-inspect scoreboard step (#2403); full scoreboard spec in `product-scoreboard.md`.

## 3. What is duplicated (verdicts from `duplicate-systems-audit.md`)

| Duplicate | Verdict |
|---|---|
| 8 Ask MIRA surfaces (4 share the Supervisor; Hub asset/node/quickstart/expo are TS reimplementations) | MERGE node chat into a shared Hub chat lib using `WhyMiraThisThis`; keep asset chat canonical; quickstart stays (public funnel); expo route = demo fixture |
| 2 retrieval engines (`neon_recall.py` hybrid-RRF vs `manual-rag.ts` BM25) | KEEP both short-term (different runtimes); converge ranking + approval gating long-term; **mira-sidecar = DELETE LATER (dead)** |
| 4 relationship-type vocabularies; no CHECK on `kg_relationships` | KEEP mig-043 CHECK as canonical; display fold (#2403) is the read seam; write-canonicalizers stay; `types.ts` lowercase list = deprecate in place |
| 4 vendored A0–A12 copies (1 unguarded: NorthwindBottling) | KEEP vendoring pattern; ADD the missing parity test (one file) |
| 3 safety-keyword lists — **Hub misses the physical-hazard category** | UNIFY on `guardrails.py` + parity test — safety-relevant, do first |
| `conveyor_events` vs `faults` (same SQLite, never joined) | DEPRECATE `conveyor_events` (write-only dead-end); `/api/faults/active` repoints at `run_diff` (T6) |
| 3 UNS `slug()` impls | KEEP crawler's; fix `plc/discover.py:408` (self-declared debt); align parser's empty-case |
| 2 baseline impls | KEEP `run_engine/baseline.py` (live); harvest range/lag features from orphaned `baseline_learner.py`, then retire it |
| `mira-connect` vs `mira-connectors` | DEPRECATE `mira-connect` (dormant stub); RENAME one to end the collision (docs-level first) |
| Demo tenants (garage CV-101, Northwind CV-200, SimLab, demo-hub, Stardust) | LEAVE AS FIXTURES — deliberate, not accidental; fix the `tools/seeds/README.md:121-131` doc contradiction; **CV-101 proof pins tenant `e88bd0e8` + `enterprise.home_garage.conveyor_lab.conveyor_1`** |

## 4. What is disconnected (from `integration-seams-register.md`)

- **7→8 (the new cut):** machine memory → any explanation surface. `context/route.ts` has no machine_memory block; `build_event_context` used only by tests.
- **9→10:** card → work order (disabled button; `/workorders/new` reads no prefill; **no schema links a WO to a run_diff** — not even measurable).
- **3→2:** `tag_entities` (PLC-import approvals) never feed `approved_tags` (ingest allowlist) — an approved tag isn't ingestible without SQL.
- **Gates:** both flags default-off everywhere.
- **Escapes:** `tools/demo_plc_poller.py` and `mira-hub/src/lib/signal-recorder.ts` write `live_signal_cache` outside Contract 5's scan scope.
- **Dark code:** `flaky_detector` (no runtime caller), orphaned `baseline_learner.py`, electrical prints (zero citation-path references).
- **Not on main at all:** fault dictionary / difference-engine demo / wiring_diagram / external-AI MCP (still untracked on `feat/litmus-bench-proof`).

## 5. The one canonical product loop (as-is + target)

```
Ignition gateway timer ──HMAC──▶ relay /api/v1/tags/ingest ──fail-closed──▶ tag_events + live_signal_cache   [LIVE, awaiting first physical row]
tag_events ──run_engine (flag)──▶ machine_run/run_step/run_baseline/run_diff/machine_state_window            [CODE-COMPLETE, flag off]
PLC export ──/plc-import──▶ ai_suggestions ──human──▶ tag_entities ──▶ (T5 bridge) ──▶ approved_tags          [CUT at the bridge]
uploads ──▶ knowledge_entries ──▶ HAS_DOCUMENT proposals ──human──▶ kg_relationships                          [HEALTHY — the model]
machine memory ──(T2)──▶ asset context + chat evidence ──▶ cited answer with next_check                       [CUT]
run_diff ──(T4)──▶ work_orders.source_run_diff_id ──▶ Atlas                                                   [CUT + unmeasurable]
everything ──▶ MachineMemoryCard + command-center freshness + /knowledge review                                [LIVE, thin]
```

## 6. What to merge or unify

Safety lists (now), Ask MIRA Hub implementations (shared lib), fault surfaces onto `run_diff`, baseline impls, relationship vocabularies (display fold shipped; write-side already canonical), slug impls, Contract-5 scan scope (add TS + tools globs).

## 7. What to park

Fault dictionary + difference-engine demo (land from the WIP branch later, after the proof); electrical-print reader; external-AI MCP; Litmus connector (await license/customer pull); OPC UA; Sparkplug live proof (until a second source exists); `mira-connectors` vendor adapters (mocks are fine until a CMMS integration is sold).

## 8. What to stop building

New demo tenants/aliases; new chat surfaces (8 exist); new anomaly rules (12 exist, 2 reflash-gated); new vendored copies without parity tests; new slug/normalizer implementations; any `machine_events`-style table (038/040 is the law); features on the WIP branch while it holds unlanded work.

## 9–11. The next 10 integration tickets (order, proof milestone, scoreboard metric)

| # | Ticket | Proof milestone | Scoreboard metric moved |
|---|---|---|---|
| T1 | **Finish the CV-101 physical proof** (in flight): bench elevated step → gateway restart; **add `MIRA_MACHINE_MEMORY_UNS_PATHS=enterprise.home_garage.conveyor_lab.conveyor_1` to compose/Doppler** (audit found the beat service omits it — idle windows won't derive without it); staging flag validation; prod flag on; card screenshot | First physical row in `tag_events` + populated card in `docs/promo-screenshots/` | `tag_events`/day > 0 real; 038-layer rows > 0 |
| T2 | Machine memory → Ask MIRA: `machine_memory` block in `/api/assets/[id]/context` + `next_check` rendered in `WhyMiraThinksThis` | "Why is CV-101 stopped?" answer cites the live A1 window + next check | grounded answers referencing live state (measurable after T8b) |
| T3 | **Safety-list unification** (Hub routes ← full `guardrails.py` list + parity test) | "melted insulation" hard-stops on Hub chat like Slack/Telegram | n/a (safety correctness) |
| T4 | Card → WO: enable button; `/workorders/new` reads prefill; migration `work_orders.source_run_diff_id` (scoreboard's smallest addition) | Click from a real A1 diff → WO row with `source_run_diff_id` set | WOs-from-anomalies (0 → measurable → >0) |
| T5 | `tag_entities` → `approved_tags` bridge on proposal accept (offer ingest-approval; same decide route) | Import L5X → approve → tag ingestible with zero SQL | approved_tags growth via product, not seeds |
| T6 | Fault-surface unification: `/api/faults/active` reads `run_diff`; deprecate `conveyor_events` | Telegram `/faults` shows the same bench anomaly as the Hub card | one event source (audit item closed) |
| T7 | Guard hardening: NorthwindBottling parity test + Contract-5 globs cover `tools/` + TS writers | CI fails on rule drift or a bypass writer | guard coverage (2 escapes → 0) |
| T8 | Hub chat dedup + groundedness persistence: node chat → shared lib w/ evidence panel; `decision_traces.approved_context_enforced` + `approved_source_count` columns | Node chat shows the same evidence panel; grounded-rate queryable | % answers grounded in approved context (unmeasurable → measured) |
| T9 | Gates default-on (staged): `MIRA_ENFORCE_APPROVED_RETRIEVAL` after a staging eval pass; then `MIRA_RUN_DIFF_ENABLED` after T1 verification window | Unverified-context question refuses on prod; worker runs unflagged | approved-context answer %; 038 rows/day sustained |
| T10 | Baseline/flaky consolidation: harvest `baseline_learner` features into `run_engine/baseline.py`; schedule `flaky_detector` in the same beat | Baselines accrue for CV-101 tags; a flaky tag yields a KG proposal | run_baseline coverage % of approved tags |

## 12. Risks / unknowns

- The bench laptop naps (gateway log gaps; ClockDrift warnings) — the demo's weakest physical link; consider power settings during T1.
- NeonRunStore SQL never CI-executed against live Postgres — T1's staging step is the verification; eyeball before prod flag.
- `relay_server.py` binds `0.0.0.0` in-container (#2408 changed only the host port mapping) — fine behind the mapping, but note if the compose ever changes network mode.
- Dual-tenant CV-101 identity (garage vs Northwind) — proof config pins garage; never point both at the same live stream simultaneously or diffs double.
- The WIP branch (`feat/litmus-bench-proof`) still holds unlanded product (fault dictionary etc.) — landing it later must not regress today's merges.
- Concurrent sessions merge to main with VERSION bumps — serialize merges or expect trivial re-resolves.

## 13. Recommendation

**Do next:** T1 (already in flight — one elevated bench step outstanding), then T2+T3 (both small, both make the proof *demonstrable*: the card shows memory AND the chat explains it safely), then T4–T5 to close the loop story. **Do not touch:** the WIP branch's unlanded modules, Litmus/OPC-UA/Sparkplug expansion, new demos, or any schema beyond `source_run_diff_id` + the two `decision_traces` columns. The product sentence becomes literally true the day T1+T2+T4 are done: connected equipment, approved tags and evidence, remembered behavior, detected changes, cited next actions — one loop, one product.
