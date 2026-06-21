---
name: mira-platform
description: |
  Read-only doctrine and architecture reference for MIRA. Co-activates with any other MIRA domain or workflow skill to provide cross-cutting constraints — North Star, environment boundaries, provider cascade, hard constraints (PRD §4), and screenshot/commit conventions. Use when reviewing a feature proposal, refactor, or PR for alignment with the product wedge. Do NOT trigger as the *primary* skill for UNS resolution (mira-uns-architecture), component profile work (mira-component-profile), maintenance workflow design (mira-maintenance-workflow), or safety-keyword handling (mira-industrial-safety) — those have dedicated specialized skills; this one provides the ceiling, not the answer.
version: 0.1.0
status: draft
last-updated: 2026-05-19
owner-paths:
  - CLAUDE.md
  - .claude/CLAUDE.md
  - docs/THEORY_OF_OPERATIONS.md
  - docs/ARCHITECTURE.md
  - docs/environments.md
  - NORTH_STAR.md
  - .claude/rules/uns-compliance.md
  - .claude/rules/security-boundaries.md
  - .claude/rules/python-standards.md
  - .claude/rules/karpathy-principles.md
related-skills:
  - mira-uns-architecture
  - mira-industrial-safety
  - mira-component-profile
  - mira-maintenance-workflow
  - mira-saas-scope-guard
---

# mira-platform

> **Status:** Draft (Phase 6 of the Fuuz-adaptation initiative). Replaces the role of `mira-architecture-guardian/` once Phase A of the implementation roadmap completes. Until then, both can coexist; this skill is the more comprehensive target shape.

## 1. When to invoke

Invoke as a **co-skill** whenever any of the following hold:

- A feature request, PR, or refactor could expand MIRA's surface area beyond the maintenance-intelligence wedge.
- A PR touches `mira-bots/`, `mira-pipeline/`, `mira-mcp/`, `mira-crawler/`, `mira-cmms/`, `mira-web/`, `mira-bridge/`, `mira-relay/`, or `mira-hub/`.
- Any task involves provider selection, secrets, environment boundaries, the screenshot rule, or the commit convention.
- A reply needs to be checked against MIRA's North Star ("Slack = front door, UNS/MQTT = nervous system, KG + component templates = memory, customer docs + work orders = evidence").

### Do NOT trigger as the primary skill for

- UNS path construction or resolution → use `mira-uns-architecture`.
- Component-profile design → use `mira-component-profile`.
- Technician dialogue or troubleshooting flow → use `mira-maintenance-workflow`.
- Safety keyword handling → use `mira-industrial-safety`.
- SaaS scope classification of an inbound request → use `mira-saas-scope-guard`.

This is the **ceiling** skill, not the answer skill.

## 2. What this skill grounds in

Authoritative MIRA files. Every constraint below traces to one of these:

| File | What it covers |
|---|---|
| `CLAUDE.md` | Build state, env vars, container map, hard constraints |
| `.claude/CLAUDE.md` | Product rules, North Star, UNS gate, grounded troubleshooting |
| `docs/THEORY_OF_OPERATIONS.md` | Primary doctrine — what MIRA is and is not |
| `docs/ARCHITECTURE.md` | Layer map + dependency rules |
| `docs/environments.md` | Dev / Staging / Prod doctrine |
| `NORTH_STAR.md` | Commercial flywheel |
| `.claude/rules/uns-compliance.md` | UNS data-shape enforcement |
| `.claude/rules/security-boundaries.md` | Secrets, PII, safety keywords, Docker |
| `.claude/rules/python-standards.md` | ruff, httpx, NeonDB, async |
| `.claude/rules/karpathy-principles.md` | Behavior laws |

If a constraint here doesn't trace to one of these files, that's a bug in this skill — file an issue.

## 3. Architecture invariants

```
        ┌─────────────────────────────────────────┐
        │ Slack technician (front door)            │
        │ (Telegram / Teams optional, same engine) │
        └────────────────┬─────────────────────────┘
                         │
        ┌────────────────▼─────────────────────────┐
        │ Engine — mira-bots/shared/engine.py      │
        │  • Intent classifier                     │
        │  • UNS resolver (uns_resolver.py)        │
        │  • Confirmation gate                     │
        │  • Grounding + citation compliance       │
        │  • Inference cascade (Groq→Cerebras→Gem) │
        └────────────────┬─────────────────────────┘
                         │
   ┌─────────────────────┼──────────────────────────┐
   ▼                     ▼                          ▼
UNS / MQTT          KG + component        Customer docs +
(live nervous       templates             work-order history
 system)            (memory)              (evidence)
```

Lines that cross these layers do so through the engine. New front doors must connect to the engine; new context sources must register through the UNS layer; new evidence sources must be cited through the citation-compliance pipeline.

## 4. Constraints

### 4.1 Product wedge

- **PLT-001** `[FATAL]` MIRA is not a generic chatbot. Replies that are not grounded in plant context, manuals, work orders, or component templates must be rerouted to "I don't have evidence for that yet."
- **PLT-002** `[FATAL]` Slack is the front door. Adding a new front door (web chat, voice, email, etc.) must preserve the Slack contract: same engine, same gate, same grounding. See `.claude/CLAUDE.md` "North Star architecture".
- **PLT-003** `[FATAL]` Never replace SCADA or CMMS. MIRA augments them; it never becomes them. Cross-check with `mira-saas-scope-guard` before approving any feature that looks SCADA-adjacent.
- **PLT-004** `[FATAL]` Never expose arbitrary PLC writes through MIRA. PLC reads via `mira-relay`/`mira-connect` (when shipped) are read-only by default; write paths require a separate, audited interface and explicit human approval.

### 4.2 Inference + provider cascade

- **PLT-010** `[FATAL]` Never reintroduce Anthropic as an LLM provider. Removed PR #610 (verified by memory). Provider cascade is **Groq → Cerebras → Gemini**.
- **PLT-011** `[WARNING]` Always go through `InferenceRouter.complete()` (`mira-bots/shared/inference/router.py`). Default behavior includes PII sanitization (IP/MAC/SN). Setting `sanitize=False` requires a justified comment in the PR.
- **PLT-012** `[STYLE]` Single-provider direct calls are a code smell. If you find one in the codebase, file an issue or fix it in the same PR.

### 4.3 Environment boundaries

See `references/environment-doctrine.md` for the full table.

- **PLT-020** `[FATAL]` Never run `psql` or raw SQL against prod NeonDB from a code session. Use staging, dev, or `db-inspect.yml`. Enforced by `tools/hooks/prod-guard.sh`.
- **PLT-021** `[FATAL]` Never restart, rebuild, or `docker compose` a VPS container directly. Use `deploy-vps.yml`.
- **PLT-022** `[FATAL]` Never point a feature-branch build at `@FactoryLM_Diagnose` (production Telegram bot). Use a dev/staging adapter.
- **PLT-023** `[BLOCKING]` Engine / RAG / retrieval / classifier changes must pass the staging gate (`smoke-test.yml` + `tests/eval/`) before deploy.
- **PLT-024** `[BLOCKING]` Migrations follow dev → staging → prod via `apply-migrations.yml` (`dry-run` then `apply`). Never hand-edit prod schema.
- **PLT-025** `[BLOCKING]` KB seeds: staging first, verify BM25 retrieval, then prod. (Lesson: PR #1385 — embedding-gate killed BM25 in May 2026.)

### 4.4 Secrets

- **PLT-030** `[FATAL]` All secrets via Doppler (`factorylm/dev`, `factorylm/stg`, `factorylm/prd`). Never `.env` files in git.
- **PLT-031** `[FATAL]` Never copy prod secrets into a dev shell. Set them in `factorylm/dev`.
- **PLT-032** `[BLOCKING]` Before commit: `git remote -v` (right repo?) + `git diff --cached` (no secrets?).

### 4.5 UNS compliance (summary; full rules in `mira-uns-architecture`)

- **PLT-040** `[FATAL]` Every asset row has `uns_path` or `equipment_entity_id` FK. No free-form manufacturer/model string pairs.
- **PLT-041** `[FATAL]` UNS paths built ONLY by functions in `mira-crawler/ingest/uns.py` (`manufacturer_path`, `model_path`, `fault_code_path`, etc.). No hand-formatted `f"enterprise.knowledge_base.{mfr}.{model}"`.

### 4.6 Grounding contract

- **PLT-050** `[FATAL]` MIRA must not begin troubleshooting before the UNS gate confirms. See `mira-uns-architecture` and `.claude/CLAUDE.md` "non-negotiable UNS location-confirmation gate".
- **PLT-051** `[WARNING]` Every claim cites at least one of: UNS / asset namespace, MQTT / live tag data, PLC tag map, customer manuals, wiring diagrams, work-order history, verified KG relationships, technician confirmation, admin-approved component profile.
- **PLT-052** `[WARNING]` Feature changes that can lower groundedness scores must call that out in the PR. See `mira-bots/shared/citation_compliance.py` and `mira-bots/shared/benchmark_db.py`.

### 4.7 Knowledge graph

- **PLT-060** `[FATAL]` Never auto-promote `proposed → verified` in `kg_relationships`. Promotion is an admin action.
- **PLT-061** `[FATAL]` Every `kg_relationships` row carries evidence (source doc + page, or work-order id, or technician confirmation id) and a confidence value.

### 4.8 Frameworks + abstractions

- **PLT-070** `[FATAL]` No LangChain, no TensorFlow, no n8n, no framework that abstracts the LLM call. PRD §4. **Scope: LLM-orchestration/agent frameworks only. Langfuse (observability/tracing) is NOT in scope — it is allowed and in active use. Never flag Langfuse under PLT-070.**
- **PLT-071** `[STYLE]` Engine layer, bot adapters, and ingest pipelines read top-to-bottom — not chained through indirections.

### 4.9 Python standards

- **PLT-080** `[STYLE]` Python 3.12; modern type hints (`list[str]`, `str | None`); `uv` for package management; `ruff` for lint/format. See `references/hard-constraints.md` and `.claude/rules/python-standards.md`.
- **PLT-081** `[WARNING]` `httpx` for HTTP, not `requests`. `yaml.safe_load`, never `yaml.load`. NeonDB with `NullPool`. SQLite with `PRAGMA journal_mode=WAL`.

### 4.10 Commits

- **PLT-090** `[WARNING]` Conventional Commits: `feat/fix/security/docs/refactor/test/chore/BREAKING`. Scope hint: module name (`feat(slack):`, `fix(engine):`).

### 4.11 Screenshot rule

- **PLT-100** `[BLOCKING]` For visible `mira-web` UI changes, save before/after Playwright proofs to `docs/promo-screenshots/` with format `YYYY-MM-DD_feature_viewport.png`. See `references/screenshot-rule.md`.

## 5. Workflow — reviewing a feature proposal

1. **Locate the wedge.** Does this request align with the maintenance-intelligence wedge? If unclear → activate `mira-saas-scope-guard` and reroute.
2. **Locate the front door.** Does this preserve Slack as the front door? If a new front door is proposed, does it route through `mira-bots/shared/engine.py`?
3. **Locate the evidence.** Does this surface grounded answers (UNS, KG, manuals, WO history) or does it produce un-grounded chat? If un-grounded, refuse.
4. **Locate the safety surface.** Could this surface advice on energized equipment, LOTO, confined spaces? If yes → activate `mira-industrial-safety`.
5. **Locate the environment.** Does this touch prod NeonDB, the VPS, the production bot, or the KG `verified` set without staging gate? If yes → refuse or require explicit human override.
6. **Locate the abstractions.** Does this add LangChain/TensorFlow/n8n or a wrapper over the LLM call? If yes → refuse.
7. **Run the output checklist below.**

## 6. Common errors (error message → cause → fix)

| Error / symptom | Likely cause | Fix |
|---|---|---|
| "Anthropic key not set" appears in logs | Someone reintroduced an Anthropic provider | Remove the provider; restore Groq → Cerebras → Gemini cascade (PLT-010) |
| Prod NeonDB write from a feature branch | `prod-guard.sh` bypassed via `MIRA_ALLOW_PROD=1` | Revert the write; rerun against staging |
| Engine PR merged without smoke test | `smoke-test.yml` skipped | Run smoke against `factorylm.com` + `app.factorylm.com`; rollback if fails |
| Grounding score drop after merge | A change weakened evidence requirements | Surface in PR, revert if not justified by a feature change |
| Slack reply on prod from a feature branch | Feature branch pointed at `@FactoryLM_Diagnose` | Switch to dev/staging Telegram bot; verify with `tests/eval/` |
| `kg_relationships` row promoted without admin sign-off | Auto-verification path slipped in | Revert; add a `[FATAL]` PR comment referencing PLT-060 |

## 7. Output checklist

Before declaring a feature proposal aligned with `mira-platform`, confirm all of:

- [ ] Aligned with the maintenance-intelligence wedge (or explicitly out-of-scope and routed to `mira-saas-scope-guard`).
- [ ] Slack front door preserved (or new adapter routes through `shared/engine.py`).
- [ ] Provider cascade preserved (Groq → Cerebras → Gemini; no Anthropic).
- [ ] Environment boundaries respected (no prod psql, no direct VPS docker compose, no feature-branch traffic to `@FactoryLM_Diagnose`).
- [ ] Secrets via Doppler.
- [ ] UNS gate preserved (or explicitly evolved through `mira-uns-architecture`).
- [ ] Safety keywords still trigger STOP+escalate (`mira-industrial-safety` consulted if applicable).
- [ ] KG `verified` state still requires admin promotion.
- [ ] No LangChain / TensorFlow / n8n / generic LLM-abstraction framework introduced.
- [ ] Conventional Commit message used.
- [ ] Screenshot rule honored for visible `mira-web` UI changes.

## 8. References

See `references/` for depth:

- `references/provider-cascade.md` — cascade order, fallback semantics, error handling.
- `references/environment-doctrine.md` — full dev/staging/prod table, promotion workflow, hotfix bypass.
- `references/screenshot-rule.md` — Playwright proof format, viewport rules, archive location.
- `references/hard-constraints.md` — PRD §4 hard constraints in canonical form.

## 9. Cross-references

- `mira-uns-architecture/SKILL.md` — UNS path construction, resolver, location gate.
- `mira-industrial-safety/SKILL.md` — safety keyword handling, escalation.
- `mira-component-profile/SKILL.md` — reusable component memory.
- `mira-maintenance-workflow/SKILL.md` — technician dialogue + troubleshooting flow.
- `mira-saas-scope-guard/SKILL.md` — scope classification of inbound requests.
