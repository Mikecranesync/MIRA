# Cowork Continuation Prompt — Conveyor Demo MVP

> **Paste this whole document into a fresh Claude Code session on CHARLIE (or drop into `/cluster/betterclaw/task_queue/` as a Task.md for midnight cowork).** It is self-contained — fresh agent has zero prior context.

---

## Identity & Scope

You are continuing the MIRA garage-conveyor demo build for the **Florida Automation Expo on 2026-05-21**. Change freeze starts **2026-05-18**. Today is 2026-05-13 (or later — check `date`). You are on the CHARLIE node of the FactoryLM cluster, working in `~/MIRA`.

Mike's vision: he ingests his physical demo conveyor by sending nameplate photos to the Telegram bot. MIRA OCRs nameplates → finds manuals → builds UNS-compliant component templates → fleshes out the asset in the FactoryLM Hub UI. At the booth, he asks "Why is Conveyor 1 stopped?" and gets a graph-walked, evidence-cited answer.

**Authoritative spec:** `docs/specs/mira-component-intelligence-architecture.md`
**Plan (read before doing anything):** `docs/superpowers/plans/2026-05-13-mira-conveyor-demo-mvp.md`
**Cluster laws (non-negotiable):** `~/factorylm/CLUSTER.md` — Evidence-Only Completion (Law 1), 300-line orchestrator limit (Law 3), Task.md protocol (Law 4), Lesson Log every session (Law 5).

## Decisions Already Locked (do NOT re-litigate)

- **Tenant:** new "Demo Plant" tenant (slug `demo_plant`). UUID needs to be generated + stored in Doppler `factorylm/prd` as `DEMO_PLANT_TENANT_ID` if not present.
- **Asset name:** Conveyor 1.
- **Review UI:** screenshot in pitch — bot Q&A is the live moment.
- **No Anthropic, no LangChain, Groq → Cerebras → Gemini cascade only** (per CLAUDE.md Hard Constraint #2).
- **UNS-compliant ltree everywhere** (per `.claude/rules/uns-compliance.md`).

## Audits Already Done (don't re-run; trust the file:line references)

Four parallel `feature-dev:code-explorer` agents traced the workflow on 2026-05-13. Findings:

### Photo → nameplate → asset
- `mira-bots/telegram/bot.py:582–619` — photo handler, 4s burst window, multi-photo path works
- `mira-bots/shared/workers/vision_worker.py:133–411` — classifies NAMEPLATE / ELECTRICAL_PRINT / EQUIPMENT_PHOTO
- `mira-bots/shared/workers/nameplate_worker.py:81–197` — extracts `{manufacturer, model, serial, voltage, fla, hp, frequency, rpm}` via cascade
- `mira-bots/shared/engine.py:2146–2306` — `_handle_nameplate()` runs the full flow
- **CRITICAL BUG:** `engine.py:2191` POSTs to `/api/cmms/nameplate` but **the REST endpoint does not exist** in `mira-mcp/server.py`. Only the MCP tool `create_asset_from_nameplate` at line 388 is wired. **Every nameplate photo silently fails to create the asset in Atlas CMMS today.** Fix is to add `_rest_cmms_nameplate(request)` handler.

### OEM manual discovery
- `mira-crawler/tasks/discover.py:86` — `discover_manufacturer` Celery task, Apify-powered. Hardcoded for Rockwell, Siemens, ABB, Schneider, Mitsubishi, Yaskawa, Danfoss, Lenze.
- `mira-crawler/tasks/ingest.py:58` — `ingest_url` task: Docling PDF → 2000-char chunks → Ollama `nomic-embed-text` → NeonDB `knowledge_entries`
- **Gap:** AutomationDirect (GS10 VFD) is in `scripts/discover_manuals.py` but NOT in the main task hardcode. For the GS10 demo, either add it or pre-stage the PDF.
- **Gap:** UNS path not stamped at ingest (violates `uns-compliance.md` rule 2).

### Component template builder
- `tools/build_component_template.py` (in PR #1253) — CLI tool, but `extract_template()` and `insert_template()` are importable as Python functions.
- **No MCP tool exposes the template builder.** Engine has no tool-calling loop; it only dispatches to workers (vision/nameplate/RAG/print/PLC).
- Correct integration plane is a **Celery task chain**: `discover → ingest → build_template_for(manufacturer, model)` — not an MCP tool.

### Hub UI (this is in `mira-hub`, NOT `mira-web`)
- `mira-web` is the PLG funnel + QR handler. **The Hub UI is `mira-hub/` (Next.js 16).**
- `mira-hub/src/app/api/uns/browse/route.ts:36–168` — UNS ltree browser endpoint (kind: literal/dynamic/both) **exists; no UI consumer yet.**
- `mira-hub/src/app/(hub)/assets/[id]/page.tsx:19–101` — asset detail page **renders mock data; needs real wiring.**

## Open PRs Blocking Day 1

| PR | Title | CI state | Blocker |
|---|---|---|---|
| #1245 | UNS ISA-95 path backfill | 17/18 pass; E2E smoke red **but same red on main** | Mike must confirm-and-merge per CI policy |
| #1253 | Component intelligence schema + tools | 17/18 pass; same E2E smoke red | Same — Mike confirm |

**Do NOT auto-merge these PRs.** Repo CI & Merge Policy in `~/.claude/CLAUDE.md` requires user confirmation when pre-existing red on main is the only failure.

## Decisions Mike Still Owes (4)

These were posed in the last conversation; he hasn't answered. Make the reasonable call only if it doesn't paint into a corner:

1. **Live-or-canned at booth:** all-in on live ingestion vs. live-primary + canned fallback toggle. *Recommended default: build both; canned is the fallback `tools/seed_demo_conveyor.py`.*
2. **Multi-photo UX:** bot prompts for asset overview first vs. Mike sends a "starter" message and bot collects in burst mode. *Recommended default: starter message + burst — fewer states.*
3. **AutomationDirect GS10 manual fetch:** add to `discover.py` hardcode vs. pre-stage PDF in `knowledge_entries`. *Recommended default: pre-stage the GS10 PDF; one less moving piece for the demo.*
4. **Where live demo runs:** prod NeonDB Demo Plant tenant vs. staging branch. *Recommended default: staging branch you can wipe between rehearsals; promote to prod only after dress rehearsal succeeds.*

If Mike pings during the session, surface these. Otherwise default-and-flag.

---

## Authorized Work for This Session (autonomous, no human approval needed)

Execute in this order. Each item lists what proves it's done.

### 1. Sanity checks (read-only) — 15 min
- [ ] `cd ~/MIRA && git pull --rebase origin main` (must succeed cleanly)
- [ ] `gh pr checks 1245 && gh pr checks 1253` — confirm CI state matches handoff
- [ ] Run Day 0 Step 4 CHECK-constraint audit (read-only SQL):
      ```bash
      doppler run -p factorylm -c prd -- python -c "
      import os, psycopg2
      conn = psycopg2.connect(os.environ['NEONDB_URL'])
      cur = conn.cursor()
      cur.execute(\"\"\"
        SELECT relationship_type, COUNT(*) FROM kg_relationships GROUP BY relationship_type
        EXCEPT
        SELECT unnest(ARRAY['HAS_COMPONENT','INSTANCE_OF','HAS_DOCUMENT','HAS_CHUNK','HAS_PART','HAS_PROCEDURE',
          'WIRED_TO','LOCATED_IN','POWERED_BY','MAPS_TO','PUBLISHED_AS','USED_IN_LOGIC',
          'TRIGGERS','CAUSES','OCCURS_ON','RESOLVED_BY','REFERENCES','REPLACES',
          'HAS_FAILURE_MODE','HAS_SIGNAL','HAS_ALIAS','DEPENDS_ON','UPSTREAM_OF',
          'DOWNSTREAM_OF','CONFIRMED_BY','CONTRADICTED_BY']), NULL;
      \"\"\")
      rows = cur.fetchall()
      print('Rows violating migration 018 CHECK:', rows or 'NONE — safe to merge')
      "
      ```
      **Proof:** paste output into the handoff doc. If non-empty: STOP and surface — migration 018 will fail.
- [ ] Eval baseline: `cd ~/MIRA && pytest tests/eval/ -v --tb=short 2>&1 | tail -50 > /tmp/eval-baseline-$(date +%Y%m%d).txt`
      **Proof:** pass rate copied to `wiki/hot.md` under today's date.

### 2. Fix the broken `/api/cmms/nameplate` REST endpoint — ½ day

- [ ] Create worktree: `git worktree add ../mira-fix-nameplate-rest fix/cmms-nameplate-rest-endpoint`
- [ ] Read `mira-mcp/server.py` near the existing `create_asset_from_nameplate` MCP tool (line 388) — understand its signature.
- [ ] Find the existing REST handler pattern in `mira-mcp/server.py` (search for `async def _rest_` or `aiohttp.web.RouteTableDef`).
- [ ] Add a new REST handler `_rest_cmms_nameplate(request)` that wraps the same logic. Body shape per `engine.py:2173–2195` — `{tenant_id, manufacturer, model, serial, voltage, hp, fla, ...}`.
- [ ] Wire it to the route table (`/api/cmms/nameplate`).
- [ ] Write a pytest test in `tests/test_mcp_rest_nameplate.py` that POSTs synthetic nameplate data and asserts an `cmms_equipment` row + `kg_entity` row are created with a proper UNS path.
- [ ] Run the test. **Proof:** paste pytest output.
- [ ] Run the full eval suite — pass rate must match baseline. **Proof:** paste tail output.
- [ ] Commit: `fix(mcp): add REST endpoint for /api/cmms/nameplate (was 404 from engine)`
- [ ] Push + open PR as **draft** with body referencing the audit finding from this plan.

### 3. Draft `mira-bots/shared/graph_traversal.py` (feature-flag default OFF) — ½ day

- [ ] Worktree: `git worktree add ../mira-graph-traversal feat/engine-graph-walk-augmentation`
- [ ] TDD-first: write `tests/test_graph_traversal.py` with the failing tests in plan Day 4 Step 1.
- [ ] Implement `augment_context(entities, tenant_id, max_hops=2) -> str` per plan Day 4 Step 3.
- [ ] Wire into `engine.py` as **additive only**, gated by `MIRA_ENGINE_GRAPH_WALK` env var. **Default OFF in this PR**; we'll flip it on after eval+dress-rehearsal validation.
- [ ] Run eval — must not regress. **Proof:** baseline vs. with-flag-off (identical pass rate expected).
- [ ] Commit on the feat branch. Push + open PR as **draft**.

### 4. Write `tools/seed_demo_conveyor.py` (canned fallback) — ½ day

- [ ] Follow plan §10 Day 1 Steps 1–3 exactly.
- [ ] Idempotent (rerun-safe). Dry-run by default; `--commit` writes.
- [ ] Validate dry-run output matches plan Day 1 Step 3 expected counts.
- [ ] Demo data YAMLs in `demo-data/garage-conveyor/`.
- [ ] Commit on its own branch `feat/demo-plant-seeder`. Push + open PR as **draft**.

### 5. Unified plan rewrite (if time permits) — 1 hr

- [ ] Read the original plan + last 4 audit findings (in this prompt).
- [ ] Rewrite `docs/superpowers/plans/2026-05-13-mira-conveyor-demo-mvp.md` to integrate the live-ingestion pieces (broken endpoint fix, parent-asset multi-photo flow, on-demand manual fetch, auto template build, Hub asset detail page) on top of the existing Day 0–7 structure.
- [ ] Commit on a `docs/` branch. PR as draft.

---

## HARD STOPS (do not cross without Mike's explicit go)

1. **Do NOT merge any PR.** Pre-existing red on main; CI & Merge Policy demands user confirm.
2. **Do NOT apply migrations to prod NeonDB.** NeonDB branches only; the prod apply is Mike's call.
3. **Do NOT flip `MIRA_ENGINE_GRAPH_WALK` to true in any deployment.** Default OFF until dress rehearsal.
4. **Do NOT push directly to main.** Per repo branching policy.
5. **Do NOT commit `.env` or anything in `marketing/prospects/hardening-alerts.jsonl` or other unrelated `??` files** that may be sensitive/in-flight.
6. **Do NOT add tracked files outside this work** (`git add -A` is forbidden; add by explicit path only).
7. **No `--no-verify`, no `--amend`, no `--force` on shared branches.**
8. **If anything crashes the bot or breaks an existing eval case: stop, write LESSON to `/cluster/betterclaw/logs/`, hand off.**

---

## End-of-Session Deliverables (write before stopping)

1. **`HANDOFF_$(date +%Y-%m-%d).md` at repo root** with:
   - What got done with proof (file paths, line counts, pytest output, PR URLs)
   - What failed and why (root cause, not "I'll fix it")
   - Eval pass rate: baseline vs. now
   - Open PRs awaiting Mike's nod (list + 1-line context each)
   - Decisions still pending (Mike's 4 from the last conversation)
   - Recommended next-cowork actions

2. **`LESSON-$(date +%Y-%m-%d).md` to `/cluster/betterclaw/logs/`** with:
   - Human mistakes observed (likely: none this session — Mike isn't pairing)
   - AI mistakes observed (rules you re-discovered the hard way, bad detours, dead-ends)
   - Fine-tuning candidates (patterns that should be a `.claude/rules/` entry)

3. **Update `wiki/hot.md`** under today's date with one paragraph of what changed.

4. **Post to Discord `#alpha-status`** via the cluster pattern (only if you're invoked through Alpha cowork; on a manual run, skip).

---

## Evidence-Only Completion Reminder

> "Done = deterministic proof only. File exists. Test returned real numbers. Code actually ran. 'I think it's done' = NOT DONE." — Cluster Law 1

Every checkbox above requires proof in the handoff doc. If you can't paste output, you didn't finish it.

---

## If You Get Stuck

- Hit an architecture decision not covered here → write down both options in the handoff, default-and-flag, move on.
- Hit a tool/service that's misbehaving → don't fight it for more than 30 min. Log it as a blocker and skip to the next authorized item.
- Hit a "should I" question that isn't in the decisions list → default to the safer option, write a `## Open Question for Mike` block in the handoff.
- Eval drops → halt all engine work, root-cause, do not push.
