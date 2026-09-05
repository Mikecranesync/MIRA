# Domain Docs

How the engineering skills should consume MIRA's domain documentation when exploring the codebase.

## Before exploring, read these

- **`AGENTS.md`** — root resolver and precedence rules.
- **`docs/PRODUCT_CONSTITUTION.md`** — canonical durable product direction.
- **`docs/ENGINEERING_GUARDRAILS.md`** — canonical safety, evidence, tenant, git, secrets, and deployment constraints.
- **`docs/THEORY_OF_OPERATIONS.md`** — historical operational context and vocabulary where consistent with the canonical authorities above.
- **`CONTEXT-MAP.md`** at the repo root — points at MIRA's per-module contexts (mira-bots, mira-core, mira-hub, etc.).
- **`docs/adr/`** — 16 system-wide ADRs (0001–0016). Read ones that touch the area you're about to work in.
- **Per-module `CLAUDE.md`** — each module dir (`mira-bots/`, `mira-core/`, `mira-hub/`, `mira-cmms/`, `mira-mcp/`, `mira-pipeline/`, `mira-web/`, `mira-sidecar/`, `mira-bridge/`) carries its own deep context. These are the seed "CONTEXT.md per context" until lazy per-module CONTEXT.md files emerge via `/grill-with-docs`.
- **Specs:** `docs/specs/` — product surface contracts (UNS gate, namespace builder, DST FSM).
- **Plans:** `docs/plans/` — phased execution. Active: 90-day MVP plan + namespace-builder plan.

If any per-module `CONTEXT.md` doesn't exist yet, proceed silently — `/grill-with-docs` creates them lazily when terms or decisions actually get resolved.

## File structure (multi-context)

```
/
├── CONTEXT-MAP.md                       ← lists per-module contexts
├── CLAUDE.md                            ← root build-state + repo map
├── docs/
│   ├── PRODUCT_CONSTITUTION.md           ← canonical product direction
│   ├── ENGINEERING_GUARDRAILS.md         ← canonical engineering constraints
│   ├── THEORY_OF_OPERATIONS.md           ← historical operational context
│   ├── adr/                             ← 16 system-wide decisions
│   ├── specs/                           ← product-surface contracts
│   └── plans/                           ← phased execution
├── mira-bots/      CLAUDE.md            ← Slack/Telegram adapters + engine
├── mira-core/      CLAUDE.md            ← Open WebUI + ingest
├── mira-hub/       CLAUDE.md + AGENTS.md
├── mira-cmms/      CLAUDE.md            ← Atlas CMMS
├── mira-mcp/       CLAUDE.md            ← FastMCP server
├── mira-pipeline/  CLAUDE.md            ← OpenAI-compat wrapper
├── mira-web/       CLAUDE.md            ← PLG funnel
├── mira-sidecar/   CLAUDE.md            ← legacy ChromaDB
├── mira-bridge/    CLAUDE.md            ← Node-RED orchestration
└── ...
```

## Use the glossary's vocabulary

When your output names a domain concept (issue title, refactor proposal, hypothesis, test name), use
MIRA terminology consistent with `docs/PRODUCT_CONSTITUTION.md`,
`docs/ENGINEERING_GUARDRAILS.md`, `THEORY_OF_OPERATIONS.md`, and the applicable `.claude/rules/`.

Examples of correct MIRA vocabulary:
- "UNS path" not "namespace string"
- "fault code" not "error code"
- "asset" / "component" / "instance" — distinct concepts; don't conflate
- "proposed relationship" vs "verified relationship" — never collapse the distinction
- "UNS location confirmation gate" — required before asset-specific, historical, or live claims
- "FactoryLM mobile and web" — the primary customer surfaces of one product
- "Slack/Foreman" — the internal orchestration command center, not the customer-product authority

If the concept you need isn't in `THEORY_OF_OPERATIONS.md` yet, that's a signal — either you're inventing language MIRA doesn't use (reconsider), or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0002 (bot adapter pattern) — but worth reopening because…_

Especially watch for conflicts with:
- ADR-0008 (sidecar deprecation) — don't propose new sidecar work
- ADR-0011 (no LangGraph migration) — don't propose LangChain/LangGraph adoption
- ADR-0013 (UNS namespace builder schema canonicalization)
- ADR-0016 (mira-bridge → FlowFuse)

## Historical marketplace objective

The former monday.com marketplace lock ended 2026-07-19 and is not current product authority. Keep
its plans as history. Scope decisions now follow `docs/PRODUCT_CONSTITUTION.md` plus the user's
explicit mission; preserve useful ideas in `docs/ideation/` rather than reviving an expired lock.
