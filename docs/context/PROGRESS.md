# MIRA — Progress Log
**Last Updated:** 2026-05-05

This is the file that **updates every session**. Top of the file is current state; below the divider is an append-only log written by the stop hook (`.claude/hooks/stop.sh`). Keep the top section short — if it grows past one screen, prune it into a section below the divider.

---

## Current state (top section — edit in place)

### Phase
**90-day MVP** (locked window: **2026-04-19 → 2026-07-19**).
Source of truth: `docs/plans/2026-04-19-mira-90-day-mvp.md`. Read its "Currently in-flight" section + run the 3-command coordination check before claiming new work.

### Where we are right now (2026-05-10)
- **Main branch tip:** `11c358b1 fix(atlas): remove duplicate KG triples + expand PM schedule seed (CRA-248, CRA-249)` — merged PR #1169.
- **Recent shipped:** PostHog server-side PLG funnel + video pipeline extensions (PR #1167). Atlas seed data fixes — duplicate KG triples (CRA-248) + sparse PM calendar (CRA-249) (PR #1169). QR permanent binding (PR #1166). Agentic RAG components 2+3 (PR #1165).
- **Demo reshoot unblocked:** CRA-248 (3 duplicate VFD-07 work orders) and CRA-249 (PM calendar with 3 entries) are fixed. Re-run seed script then reshoot Atlas screens.
- **Eval pass rate:** 77 % (stale — `rich.errors.MarkupError` crashing pytest sessionfinish is pre-existing, not a real regression; track in known-issues.md).
- **Anthropic removal:** complete (PR #610 + #649); cascade Groq → Cerebras → Gemini. Do not reintroduce.
- **mira-sidecar:** still legacy; OEM migration to Open WebUI KB is the cutover gate (issue #195).

### What's done — broad strokes
- Engine: Supervisor + workers + guardrails + InferenceRouter cascade (PII default-on).
- Adapters: Telegram (polling singleton), Slack (Socket Mode), pipeline (`/v1/chat/completions`).
- Knowledge: ~25,219 chunks (NeonDB pgvector); hybrid retrieval Unit 6 behind kill switch.
- Atlas CMMS: 4 containers wired; mira-mcp brokers REST + 7 CMMS MCP tools across 4 providers.
- Hub: mira-hub `v1.1.0` shipped 2026-04-24 (OAuth + full platform shell).
- Web: PLG funnel live; magic-link JWT fixed; PostHog optional.
- Knowledge graph schema: `kg_entities / kg_relationships / kg_triples_log` with RLS (#791) — runtime extraction not yet wired.

### What's next (top of backlog)
- **Demo reshoot (IMMEDIATE):** Re-run `bun run scripts/seed-synthetic-users.ts` → reshoot Atlas CMMS screens (work orders, PM calendar, asset list). CRA-248 + CRA-249 are merged. Also CRA-250: MIRA chat interface not shown in demo yet.
- **Auto-PM pipeline #1:** Extract PM schedules from manuals → structured JSON → auto-create PM work orders → push to downstream CMMS. Without this, the flywheel doesn't close.
- **Triple extractor at runtime:** Wire conversation → KG triples to feed GraphRAG.
- **Eval ratchet:** Pass rate 77 % → ≥ 90 %; refresh with current cascade. Fix `rich.errors.MarkupError` sessionfinish crash blocking clean eval output.
- **mira-sidecar sunset:** Migrate ChromaDB OEM corpus to Open WebUI KB; cut `mira-web` to `mira-pipeline` (PR #197).
- **mira-pipeline test coverage:** 0 → ≥ 5 unit tests (currently grade F).
- **Funnel digest weekly automation:** wire Cowork Sunday 02:00 to Discord `#weekly-review`.

### Active decisions and constraints
- LLM cascade is **non-negotiable** Groq → Cerebras → Gemini. No single-provider calls; no Anthropic.
- Doppler `factorylm/prd` is the only legitimate secret store.
- Anyone touching `mira.db` from outside `mira-bridge` must use WAL retry pattern (`Supervisor._ensure_table()`).
- Magic-inbox PDF flow: relevance gate behind `RELEVANCE_GATE_ENABLED`; fail-open on Groq errors.
- mira-hub uses a **custom internal Next.js fork** — read `node_modules/next/dist/docs/` before assuming.

### Blockers
- Eval pass rate stale; until refreshed we can't trust regression signal.
- Triple extractor at runtime is a known gap — KG schema exists with no writer wired.
- mira-pipeline has zero unit tests (graded F per `docs/QUALITY_SCORE.md`).

### Pointers for the next agent
- `docs/specs/SPEC_INDEX.md` — every module's contract.
- `docs/context/RULES.md` — non-negotiable constraints.
- `docs/context/ARCHITECTURE.md` — layer map + container topology.
- `wiki/hot.md` — wiki entrypoint (read at session start).
- `docs/plans/2026-04-19-mira-90-day-mvp.md` — 90-day plan, currently in-flight section.

---

## Session log (append-only — written by `.claude/hooks/stop.sh`)

> Format per entry:
>
> ```
> ### YYYY-MM-DD HH:MM session — <branch>
> **Changed:** files / one-line summary
> **In progress:** what is still WIP
> **Blocked:** any blockers + cause
> **Next:** the next action
> ```

<!-- BEGIN AUTOLOG -->

### 2026-05-06 05:28 UTC — `docs/comprehensive-specs`
**Last commit:** b9bfc8a docs(specs): add per-module specs, context system, session stop hook
**Changed (vs. fork point):**
- .claude/hooks/stop.sh
- .claude/settings.json
- docs/context/ARCHITECTURE.md
- docs/context/FILE_STRUCTURE.md
- docs/context/PROGRESS.md
- docs/context/PROJECT_BRIEF.md
- docs/context/RULES.md
- docs/context/TECH_STACK.md
- docs/specs/SPEC_INDEX.md
- docs/specs/agentic-os-spec.md
- docs/specs/auth-tenancy-spec.md
- docs/specs/deployment-spec.md
- docs/specs/dialogue-state-tracker-spec.md
- docs/specs/hub-mobile-spec.md
- docs/specs/ignition-exchange-spec.md
- docs/specs/knowledge-graph-spec.md
- docs/specs/mira-bots-spec.md
- docs/specs/mira-bridge-spec.md
- docs/specs/mira-cmms-spec.md
- docs/specs/mira-core-spec.md
**Working tree:** clean
**Next:** _set by next session_

### 2026-05-10 20:44 UTC — `fix/atlas-seed-data-cra248-cra249`
**Last commit:** f5f3e72c fix(atlas): remove duplicate KG triples + expand PM schedule seed (CRA-248, CRA-249)
**Changed (vs. fork point):**
- mira-hub/scripts/seed-synthetic-users.ts
**Working tree:**
- ?? marketing/comic-pipeline/reference/vfd_shot_01.png
- ?? marketing/comic-pipeline/reference/vfd_shot_01.v1.png
- ?? marketing/comic-pipeline/reference/vfd_shot_01.v2.png
- ?? marketing/comic-pipeline/reference/vfd_shot_01.v3.png
- ?? marketing/comic-pipeline/reference/vfd_shot_01.v4.png
- ?? marketing/comic-pipeline/reference/vfd_shot_02.png
- ?? marketing/comic-pipeline/reference/vfd_shot_02.v1.png
- ?? marketing/comic-pipeline/reference/vfd_shot_02.v2.png
- ?? marketing/comic-pipeline/reference/vfd_shot_02.v3.png
- ?? marketing/comic-pipeline/reference/vfd_shot_02.v4.png
- ?? marketing/comic-pipeline/reference/vfd_shot_03.png
- ?? marketing/comic-pipeline/reference/vfd_shot_03.v1.png
- ?? marketing/comic-pipeline/reference/vfd_shot_03.v2.png
- ?? marketing/comic-pipeline/reference/vfd_shot_03.v3.png
- ?? marketing/comic-pipeline/reference/vfd_shot_03.v4.png
- ?? marketing/comic-pipeline/reference/vfd_shot_04.png
- ?? marketing/comic-pipeline/reference/vfd_shot_04.v1.png
- ?? marketing/comic-pipeline/reference/vfd_shot_04.v2.png
- ?? marketing/comic-pipeline/reference/vfd_shot_04.v3.png
- ?? marketing/comic-pipeline/reference/vfd_shot_04.v4.png
**Next:** _set by next session_
<!-- END AUTOLOG -->
