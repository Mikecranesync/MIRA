# Ranked Convergence Backlog — Gate 0 output

**Date:** 2026-08-15 · Every unit is independently reversible and walks the gates (Discovery → … → R1 → separate deletion). Risk classes drive §Gate 7 reviewer effort (High default; **xhigh** for the auto-escalation list; Max by exception).
**Order = recommended execution order**, chosen so each unit hardens the machinery the next one needs.

---

## CU-P1 — PILOT: one asset-tag grammar for Hub + Mobile ⭐ ✅ DONE

- **Status: DONE 2026-08-15** — PR #3249 → merge `a353a334a` → **v3.273.2** (deployed). R0 `3ba7f4e54`; rollback checkpoint `rollback/2026-08-15-v3.273.2`. D-5 resolved. Full gate walk (incl. a round-1 adversarial BLOCK on a real defect, fixed and re-passed) in `units/CU-P1.md`. **Next unit: CU-02.**
- **Open obligation (§19):** observation window — watch Hub `/api/assets/by-tag` 404 rate on mobile-originated requests over the next mobile release cycle (should only drop). Not yet checked.

- **What:** `mira-hub/src/lib/asset-tag.ts:11` forbids dots (traversal defense); `mira-mobile/src/lib/tags.ts:7` allows them while claiming "Hub semantics". Extract ONE tag-grammar contract (Hub's is canonical — the restrictive one, and it is the server), conform mobile, and behavior-lock both sides with shared golden cases (valid tags, dot/traversal attacks, QR deep-link forms).
- **Why pilot:** real drift finding on the product spine (QR → asset); tiny surface (2 files + tests); no auth/tenancy/DB/Supervisor (§15 requirement); a clean Branch-by-Abstraction miniature; shadow validation is trivially deterministic (run both regexes over the golden corpus, diff acceptance).
- **Gates:** behavior-lock tests → R0 → implement → deterministic verify → adversarial review (High) → shadow (regex corpus diff) → human GO → R1. Deletion step: none (nothing removed).
- **Risk:** low. **Effort:** small.

## CU-02 — Drift repairs (docs reconcile to reality)

- D-2 container map: regenerate root CLAUDE.md map from compose files (or replace with a pointer); kill phantom `mira-docling`, fix mira-mcp ports, add mira-web.
- D-1 hub-mobile-spec: supersession header → ADR-0034 + mobile PRD.
- D-4 sidecar line: "sunset pending" → "removed from prod 2026-05-20; directory deletion tracked (Gate 11)".
- Registry statuses land with this PR (already in `REGISTRY.yaml`).
- **Risk:** minimal (docs-only). **Rule §11:** prefer machine-validated facts — the map regeneration should become a script, not a hand edit.

## CU-06 — Executable architecture (build the fences before moving anything big)

- Extend `tests/test_architecture.py` contracts with: tag-grammar contract (from CU-P1), registry-vs-compose drift check (catches D-2 class forever), "no new writers to knowledge_entries without is_private parameter" ast-grep rule.
- Evaluate **dependency-cruiser** for `mira-hub`/`mira-web`/`mira-mobile` TS boundary rules (mobile may import from its own src + generated API types only, etc.).
- Adopt the §6 tag taxonomy in REGISTRY.yaml (`type:*`, `domain:*`).
- **Risk:** low (CI-only). **Gate 7:** High.

## CU-11 — Wire the §Gate 7 independent adversarial-review lane (blocks CU-03)

- **What:** §Gate 7 names **GPT-5.6 Sol / Codex, fresh context** as the independent adversarial reviewer. That lane is external to the implementing session's tooling and has never been wired — CU-P1 substituted an independent fresh-context reviewer agent and recorded the deviation. Deliver an invocable step (a `/codex-review` command or equivalent) plus the evidence shape a unit record cites.
- **Why it is its own unit:** three documents previously asserted this was "tracked in the backlog" while no backlog entry and no issue existed. It is tracked here now.
- **Ordering:** placed here because CU-02 and CU-06 are docs-only / CI-only and may proceed with a substitute reviewer (recording the deviation each time), but **CU-03 is auto-xhigh (tenancy-adjacent) and must not walk Gate 7 until this lane exists.**
- **Risk:** low to build; **high leverage** — it is the check that catches false-greens on every later unit.

## CU-03 — knowledge_entries write-path hardening (I-1..I-3)

- `store.py::insert_chunk` gains a required `is_private` parameter (no silent default); `ingest_url` validates against `sources.yaml` before shared-corpus writes; audit `learning_ingester.py` visibility.
- Behavior-lock first: tenant-scoping tests asserting today's exact write shapes (OEM public, uploads private) before touching the code.
- **Risk:** medium-high (tenancy-adjacent) → **Gate 7 xhigh**, human GO. Not a pilot candidate for exactly that reason.

## CU-04 — factorylm legacy strangulation, phase 1 (statuses + proof, no deletion)

- Registry marks `services/diagnosis`, `services/telegram_bot`, `services/llm-router`, `apps/plc-reader`, `services/plc-modbus`, `sim`, `simulation`, `cosmos`, `cookoff` as LEGACY/DELETE_CANDIDATE.
- Gate 11 evidence collection: prove zero *runtime* consumers on the actual nodes (ALPHA/CHARLIE launchd, crontabs, CLUSTER.md scheduled tasks — CLUSTER.md still claims a CHARLIE telegram poller from `services/troubleshoot/`). In-repo grep is NOT sufficient per §Gate 11.
- Deletion itself is a **separate later unit** per doctrine ("replacement success does not authorize deletion").
- **Risk:** low now; deletion unit later is medium.

## CU-08 — Simulation estate decision

- SimLab stays canonical (CI-gated). Decide: `mira-fault-sim`/`mira-fault-detective` → keep as bench harness (register EXPERIMENTAL) or retire; factorylm sim quartet (`sim`, `simulation`, `cosmos`, `cookoff`) is one coupled deletion unit (15+ cross-imports).
- **Risk:** low. Human taste decision on the bench harness.

## CU-07 — FactoryLM Personal SWE-Bench v0

- Build the harness per `SWE_BENCH_SEED.md` (~30 seeded cases, 10 categories; extend toward 50-100). Start with hermetic categories (FSM, citation, safety, CI).
- **Value:** answers "which model+harness is safest on THIS codebase" before the heavy CU-05 migrations hand agents bigger knives.
- **Risk:** low (read-only vs history).

## CU-09 — ADR-0033 status resolution (human decision)

- Code adopted the TechnicianContext seam (default-off) while the ADR says Proposed/awaiting-Mike (D-3). Mike either ratifies or the ADR documents the experimental wiring explicitly. Registry carries the drift until resolved.
- **Risk:** none to execute; governance hygiene.

## CU-10 — Atlas CMMS bridge contract

- `atlas-hub-sync.py` bidirectionally syncs `cmms_equipment.atlas_id` with a separate Postgres. Extract the sync contract (fields, direction, conflict rules) into a tested spec so the bridge can't drift silently.
- **Risk:** medium (touches CMMS truth) → Gate 7 xhigh when implemented.

## CU-05 — FLAGSHIP: canonical asset identity convergence (staged program)

- Target model in `OWNERSHIP.md`: instance = `cmms_equipment.id`; address = stored `uns_path`; model class = `kg_entities`; all bridges explicit + validated; identity-minting backfills retired.
- Stages (each its own unit, each reversible): (a) ADR + identity contract; (b) shadow instrumentation — log every place the schemes disagree on real traffic (blind spot §13.11); (c) validated-bridge helpers replacing ad-hoc joins; (d) backfill derivation flip; (e) nullable-uns_path gate closure.
- **Risk:** high — auto-**xhigh** review, shadow validation mandatory (§Gate 8 structured invariants: asset ID, UNS path, WO identity), human GO per stage. **Do not start until CU-P1, CU-06, CU-03 are green and the SWE-bench has baselined the agents.**

---

## Sequencing logic

`CU-P1` proves the full gate machinery on a real, small drift. `CU-02` makes the docs stop lying. `CU-06` turns discovered rules into CI fences. `CU-03` closes the standing security-adjacent write gaps behind those fences. `CU-04/08` de-risk the estate without deleting anything. `CU-07` measures the agents. Only then does `CU-05` — the one that makes the §3 product-spine invariant true — begin, with the strongest tooling and evidence culture already in place.
