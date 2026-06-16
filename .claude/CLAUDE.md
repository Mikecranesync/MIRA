# MIRA — Product & Architecture Operating Guide

> Companion to root `CLAUDE.md` (which is the **build-state + repo map**). This file is the **product rules** Claude Code must honor while editing this codebase.
>
> **Primary doctrine:** `docs/THEORY_OF_OPERATIONS.md` — read it first.
> **Product-surface contract:** `docs/specs/maintenance-namespace-builder-spec.md` — the UNS gate, AI proposals, readiness levels.
> **Phased execution:** `docs/plans/2026-05-15-maintenance-namespace-builder.md`.

## What MIRA is

**MIRA** (Maintenance Intelligence Resource Agent) is an industrial maintenance intelligence system. The product wedge is a **Slack-first maintenance copilot** that grounds every answer in the customer's real factory context.

It is **not** a generic chatbot. It is **not** a SCADA or CMMS replacement. It is a focused, grounded troubleshooting and ingestion assistant for plant maintenance technicians.

## North Star architecture

| Layer | Role | Lives in |
|---|---|---|
| **Slack / ChatOps** | Front door — where the technician talks | `mira-bots/slack/bot.py` (slack-bolt AsyncApp, Socket Mode) |
| **Maintenance intelligence** | The brain — engine, FSM, grounding, classifier | `mira-bots/shared/engine.py` (Supervisor / GSD engine) |
| **UNS / MQTT / Sparkplug B** | Live nervous system — real plant context | `mira-crawler/ingest/uns.py`, `mira-relay/`, `ignition/` |
| **Component templates + KG** | Memory — reusable asset/component knowledge | NeonDB `kg_entities` + `kg_relationships` (migrations 004/005) |
| **Customer docs + work orders** | Evidence — what we cite | `mira-crawler/ingest/`, `mira-mcp/server.py` (CMMS tools), `mira-cmms/` (Atlas) |

Future interfaces (Teams, Telegram, email) are valid, but **Slack is the first product wedge**. Telegram/email adapters at `mira-bots/{telegram,email}/` exist but follow Slack's contract, not the other way around.

## The non-negotiable UNS location-confirmation gate

**MIRA must not begin troubleshooting until it has resolved the technician's work context inside the Unified Namespace or asset namespace.**

Required flow (enforced in `mira-bots/shared/engine.py`):

1. Receive technician message.
2. Extract candidate `asset`, `area`, `line`, `machine`, `component`, `symptom`, `fault_code`.
3. Search the UNS (`uns_resolver.resolve_uns_path()` per `docs/specs/maintenance-namespace-builder-spec.md` § "The UNS Location-Confirmation Gate").
4. Identify candidate context(s).
5. Gather evidence (UNS hit, work-order history, manual reference, PLC tag, prior session, technician hint).
6. **Send a confirmation message** identifying site / area / line / machine / asset / component / fault, evidence used, confidence level, and a confirmation question.
7. **Wait for confirmation or correction.**
8. Only then enter troubleshooting / live-assist mode.

A code path that begins troubleshooting before step 7 is a **bug**. The `mira-run-hallucination-audit` command exists to find such paths.

**Carve-out — direct machine connections are UNS-certified by construction.** The flow above (and the chat-gate in `.claude/rules/uns-confirmation-gate.md`) applies to chat surfaces (Slack/Telegram/email/generic web). When a turn arrives over a surface that already knows which machine the technician is on — Ignition cloud-chat (`mira-pipeline /api/v1/ignition/chat`), a Perspective "Ask MIRA" panel, an MQTT/Sparkplug B turn from `mira-bridge`/`mira-relay`, a PLC bridge tag-snapshot, a Hub Command Center display, a QR-scan deep-link — the connection itself certifies the UNS path. The engine MUST skip steps 6–7 and treat `state["uns_context"]["source"]=="direct_connection"` as already confirmed. A direct-connection surface that lacks a UNS identifier on its payload must **reject** the turn (`{"error":"uns_required"}`), NOT downgrade to a chat-gate. Full rule + surface list + rejection contract: `.claude/rules/direct-connection-uns-certified.md`.

## Grounded troubleshooting

MIRA must ground every claim in at least one of:

- UNS / asset namespace
- MQTT / live tag data (when available)
- PLC tag map
- Customer manuals
- Wiring diagrams
- Work-order history
- Verified knowledge-graph relationships
- Technician confirmation
- Admin-approved component profile

Existing groundedness hooks Claude must preserve and use:

- `mira-bots/shared/citation_compliance.py` — every reply should be grounded
- `mira-bots/shared/engine.py` — 1–5 groundedness scoring, low-groundedness episode tracking, KB-gap admission prompts
- `mira-bots/shared/benchmark_db.py` — `evidence_utilization`, `evidence_packet`

If a feature change can lower groundedness scores, surface that in the PR.

## Ingestion pipelines

Manual/PDF/photo ingestion flows through `mira-crawler/ingest/` (and `mira-core/mira-ingest/` for the photo/RAG API). Rules:

1. **Preserve source.** Every extracted fact carries a page/section reference where the source supports it.
2. **Don't invent missing data.** Mark unknown fields `unknown`, not best-guess.
3. **Flag ambiguous extractions.** A `confidence` field is mandatory.
4. **Tag every chunk with a UNS path.** Use `mira-crawler/ingest/uns.py` builders — don't reinvent. See `.claude/rules/uns-compliance.md`.
5. **De-dup before insert.** `mira-crawler/ingest/dedup.py` exists; use it.
6. **Normalize into component profiles** when the source supports a complete profile (see component-profile-builder skill).

## Component profiles

Component profiles are the reusable SaaS asset. They follow the schema in `.claude/skills/component-profile-builder/SKILL.md`. Hard rules:

- **Evidence-based.** Every field traces to a manual, tag map, work order, or technician confirmation.
- **Verified vs proposed.** Unverified relationships go in `proposed_relationships`, not `verified_relationships`. Promotion requires admin/technician sign-off.
- **Per-instance vs per-model.** A profile attached to one asset is per-instance; a reusable model template (e.g., `PowerFlex 525`) is per-model. Don't conflate them.

## Knowledge graph proposals

MIRA writes to `kg_entities` and `kg_relationships` (NeonDB; see `docs/migrations/004_kg_entities.sql`, `005_kg_relationships.sql`). Rules:

- **Never silently assert new relationships.** Status is one of `proposed`, `verified`, `rejected`, `needs_review`.
- **Store evidence with every relationship** (source doc + page, or work-order id, or technician confirmation id).
- **Include confidence** (numeric or low/medium/high — match the surrounding column convention).
- **Don't pollute.** If evidence is weak, propose; don't auto-verify.

Promotion from `proposed` → `verified` is an admin action, not an automatic one. Code paths that auto-verify without admin review are bugs.

**Glossary discipline (cross-cutting; see `CONTEXT.md`):**
- `AISuggestion` = a row in `ai_suggestions`; the unit `/proposals` renders and what "N proposals pending" counts. Six `suggestion_type` values.
- `RelationshipProposal` = a row in `relationship_proposals` + 1..N `relationship_evidence` rows; backs `AISuggestion` of type `kg_edge` only. Never read directly by user-facing surfaces.
- `proposed` is a status adjective on `kg_entities` / `kg_relationships`, not a noun. Don't say "a proposed entity" — say "an `AISuggestion` of type `kg_entity`".
- **Forbidden phrase:** "the proposal table". Always name `ai_suggestions` or `relationship_proposals` explicitly.
- **Status transitions** on `ai_suggestions`, `relationship_proposals`, `kg_entities.approval_state`, or `kg_relationships.approval_state` follow the mapping in **ADR-0017**. Once `mira-hub/lib/proposal-transition.ts` and `mira_bots/shared/proposal_transition.py` exist, direct `UPDATE … SET status = …` on these columns is a bug — go through the helper.

## Slack technician UX

Technicians read on a phone in a noisy plant. Optimize for that.

- **Be direct.** Short paragraphs. No corporate language.
- **Lead with suspected context.** Site → asset → component → fault — in that order.
- **Show evidence.** Bulleted, three items max.
- **Ask for confirmation** before troubleshooting (see UNS gate above).
- **Action-oriented steps only after context is confirmed.**
- **Never pretend to know plant context without evidence.** If you don't know, say so and ask.

See `.claude/skills/slack-technician-ux-writer/SKILL.md` for sample message templates.

## Environment boundaries (Dev / Staging / Prod)

**Doctrine:** `docs/environments.md`. Three environments, promoted in order. Root `CLAUDE.md` § **Environments** is the rule card. Product-side implications:

- **Never** test bot changes against the production Telegram bot (`@FactoryLM_Diagnose`). The UNS gate, citation compliance, and groundedness scorers log episodes — a feature-branch reply on the prod bot contaminates the truth set.
- **Never** point a feature-branch engine build at the prod NeonDB. `kg_entities` / `kg_relationships` writes are append-only-with-status; a misfire pollutes the verified set and forces a manual cleanup.
- **Never** seed the KB to prod first. BM25 retrieval quality is verified on staging-shape data (`tests/eval/`) before bulk insert — see issue #1385 (embedding-gate killed BM25 in May 2026; lesson stands: seeds reach prod only after retrieval is proven).
- **Migrations** to `kg_entities` / `kg_relationships` / `cmms_*` / Hub schema go dev → staging → prod via `apply-migrations.yml` (`dry-run` first). The promotion-state column work (ADR-0013) assumes this discipline.
- **Engine / RAG / FSM / classifier changes** must pass the staging gate (today: `smoke-test.yml` + the relevant `tests/eval/` regime) before merging to `main`.

`tools/hooks/prod-guard.sh` enforces the obvious blast-radius cases (`PreToolUse(Bash)`). It is a floor, not a ceiling. The full rule set lives in `docs/environments.md`.

## Code exploration: CodeGraph first

CodeGraph is the SQLite semantic index of every symbol, edge, file, and call path in the workspace. It is wired into every Claude Code session via the `codegraph` MCP server in `.mcp.json`. Use it BEFORE grep / Read for any symbol-shaped question. **It is the only code-navigation graph for this repo — Graphify is excluded from code navigation (`.claude/rules/graphify-excluded.md`).**

- **Preflight BEFORE any non-doc coding task:** `tools/codegraph-preflight.sh ["task"]` — verifies install / MCP / index presence / freshness / canary and prints a markdown report for the PR (verdict **READY / STALE / BROKEN**). **If STALE or BROKEN, `sync` / `index --force` and re-run before trusting call edges.** Trust is earned, not assumed: the call-graph (`callers`/`callees`/`trace`/`impact`) is only reliable after freshness + health pass — symbol *lookup* is reliable on any non-broken index. Periodic fail-loud check: `tools/codegraph-benchmark.sh`.
- **Known blind spots (verify with grep):** class instantiation `ClassName()` isn't a caller edge; `impact <Class>` returns containment not dependents; import-alias calls and same-name symbols don't resolve. Full list: `.claude/rules/codegraph-usage.md`.
- **First call for any task in indexed code:** `codegraph_context "<task>"` — composes search + node + callers + callees in one call. Cheapest possible orientation.
- **Before editing `engine.py` or any shared module:** `codegraph_impact <symbol>` to see the blast radius. Modules in scope: `mira-bots/shared/engine.py`, `mira-bots/shared/inference/router.py`, `mira-bots/shared/uns_resolver.py`, `mira-bots/shared/citation_compliance.py`, `mira-bots/shared/guardrails.py`, `mira-crawler/ingest/uns.py`, `mira-mcp/server.py`, plus anything imported by >5 files. **Never ignore an unexpected symbol in the blast-radius output** — narrow the change first.
- **"How does X reach Y" / call-path questions:** `codegraph_trace` — handles dynamic-dispatch hops (callbacks, async workers, FSM transitions) that grep can't follow.
- **Multi-symbol surveys:** `codegraph_explore` — one capped call for several related symbols. Don't loop `codegraph_node` or `Read`.
- **Do NOT re-read files CodeGraph already returned source for.** `codegraph_node` / `codegraph_explore` include the symbol body.
- **Only fall back to `Grep` / `Read`** for plain-text matches (prompt strings, log lines, comments), file-level inspection of files CodeGraph didn't index, or details the CodeGraph response didn't cover.
- **Index freshness:** `.githooks/post-merge` and `.githooks/post-checkout` run `codegraph sync` → corruption canary → write a `.codegraph/.last-sync` marker (sync alone can't repair dropped call edges; the canary `index --force`s if they collapsed). A daily `index --force` launchd job (`tools/codegraph-force-reindex.sh`) bounds drift. After cherry-picks or hand-edits, run `npx -y @colbymchenry/codegraph sync` (or the preflight) manually.

Full rules: `.claude/rules/codegraph-usage.md`. Reference: `wiki/references/codegraph.md`.

## Rules for code changes

- **Conventional Commits**: `feat/fix/security/docs/refactor/test/chore/BREAKING`. Scope hint: module name (`feat(slack):`, `fix(uns):`, `fix(engine):`).
- **No LangChain, TensorFlow, n8n** — see PRD §4 in root CLAUDE.md.
- **Doppler for secrets** — `factorylm/dev` (local) / `factorylm/stg` (staging) / `factorylm/prd` (production). Never `.env` files in git. Never copy `prd` values into a dev shell.
- **Python: ruff + httpx + `Optional[X]` (3.12 target)** — see `.claude/rules/python-standards.md`.
- **Security boundaries** — see `.claude/rules/security-boundaries.md` (PII sanitization, safety keywords, Doppler).
- **UNS compliance** — see `.claude/rules/uns-compliance.md` (every asset row has `uns_path` or `equipment_entity_id` FK).
- **Direct-connection UNS certification** — see `.claude/rules/direct-connection-uns-certified.md` (Ignition/MQTT/PLC/Hub/QR surfaces carry a UNS identifier on every turn or are rejected; engine skips the chat-gate on `source="direct_connection"`).
- **CodeGraph-first exploration** — see `.claude/rules/codegraph-usage.md` (run `tools/codegraph-preflight.sh` before non-doc code work; `codegraph_context` / `codegraph_impact` before grep + Read; trust the call-graph only after freshness passes).
- **Graphify excluded from code navigation** — see `.claude/rules/graphify-excluded.md` (CodeGraph is the single code-nav graph; the orchestrator-pulse product KG is a separate, allowed artifact).
- **Karpathy principles** — think before coding, simplicity first, surgical changes, goal-driven execution. See `.claude/rules/karpathy-principles.md`.
- **Don't break the UNS confirmation gate.** Run `mira-run-hallucination-audit` after engine/bot edits.

## Testing expectations

- **5-regime test framework** in `tests/` (regime1_telethon through regime6_sidecar, plus regime7_ignition). Pre-commit watcher: `tools/eval_watch.py` against `tests/eval/watch_set.txt`.
- **Golden cases**: `tests/golden_factorylm.csv`, `tests/golden_hybrid.csv` — diagnostic engine truth set.
- **New troubleshooting features**: add a golden case. Tweaking the gate? Add one or more.
- **No "trust me" reviews** — Karpathy principle 4 (`evidence beats assertion`) + Cluster Law 1 (`evidence-only completion`).
- **For UI changes** — Screenshot Rule (`docs/promo-screenshots/`).

## Do not do

- ❌ **Build a generic chatbot.** MIRA answers grounded maintenance questions, nothing else.
- ❌ **Begin troubleshooting before the UNS gate confirms.** (Chat surfaces only — direct connections are certified by construction; see `.claude/rules/direct-connection-uns-certified.md`.)
- ❌ **Ask a direct-connection turn "are you sure you're looking at X?"** If the connection didn't carry a UNS identifier, REJECT it — don't downgrade to a chat-gate.
- ❌ **Add a new direct-connection surface (Ignition, MQTT, PLC, Hub display, QR) without declaring its UNS-identity source.** Every direct surface must populate `state["uns_context"]["source"]="direct_connection"` and supply a resolvable identifier on every turn.
- ❌ **Invent plant data, PLC tag meaning, work-order history, fault codes, or manual references.** Always cite.
- ❌ **Auto-promote `proposed` → `verified`** in the knowledge graph.
- ❌ **Replace SCADA, replace CMMS, or expose arbitrary PLC writes.** That's out of scope. See `.claude/skills/mira-saas-scope-guard/SKILL.md`.
- ❌ **Add a LangChain/n8n abstraction over the LLM call** (PRD §4).
- ❌ **Reintroduce Anthropic as a provider** — removed PR #610, never reintroduce. Cascade is Groq → Cerebras → Gemini.
- ❌ **Skip the screenshot rule** for visible mira-web UI changes.
- ❌ **Cross environment boundaries** — no prod `psql`, no direct VPS `docker compose`, no feature-branch traffic to `@FactoryLM_Diagnose`, no hand-edited prod schema. See `docs/environments.md`.

## Cross-references

- Root `CLAUDE.md` — build state, ports, env vars, repo map
- `docs/environments.md` — dev / staging / prod doctrine (env separation + promotion workflow)
- `docs/THEORY_OF_OPERATIONS.md` — primary product doctrine
- `docs/specs/maintenance-namespace-builder-spec.md` — UNS gate, AI proposals, readiness levels (subsumes the older `uns-message-resolver-spec.md` reference)
- `docs/plans/2026-05-15-maintenance-namespace-builder.md` — phased execution
- `.claude/rules/uns-compliance.md` — UNS data-shape enforcement
- `.claude/rules/uns-confirmation-gate.md` — chat-surface UNS gate (Slack/Telegram/email/web)
- `.claude/rules/direct-connection-uns-certified.md` — direct-connection UNS certification (Ignition/MQTT/PLC/Hub/QR)
- `.claude/rules/security-boundaries.md` — secrets, PII, safety keywords
- `.claude/rules/python-standards.md` — ruff, httpx, NeonDB, async
- `.claude/rules/karpathy-principles.md` — coding behavior
- `.claude/rules/codegraph-usage.md` — when to use CodeGraph vs grep/Read + trust model + preflight + blind spots
- `.claude/rules/graphify-excluded.md` — Graphify excluded from code navigation (CodeGraph is the single code-nav graph)
- `docs/specs/uns-kg-unification-spec.md` — UNS authority (data architecture)
- `docs/specs/mira-component-intelligence-architecture.md` — implementation-level architecture (component templates, KG mechanics)
- `docs/specs/dialogue-state-tracker-spec.md` — FSM the UNS gate plugs into
- `docs/specs/uns-message-resolver-spec.md` — how bot messages resolve to UNS paths (Stage-1 spec, shipped)
- `.claude/skills/<name>/SKILL.md` — task-specific operating guides
- `.claude/commands/<name>.md` — repeatable workflows
- `.claude/mcp/<name>-spec.md` — MCP server contracts
