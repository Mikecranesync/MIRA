# Domain Docs

How the engineering skills should consume MIRA's domain documentation when exploring the codebase.

## Before exploring, read these

- **`docs/THEORY_OF_OPERATIONS.md`** — MIRA's primary doctrine (what it is, how it works, why). This is the project glossary equivalent until a real `CONTEXT.md` is grown lazily.
- **`CONTEXT-MAP.md`** at the repo root — points at MIRA's per-module contexts (mira-bots, mira-core, mira-hub, etc.).
- **`docs/adr/`** — 26 system-wide ADRs (0001–0025). Read ones that touch the area you're about to work in.
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
│   ├── THEORY_OF_OPERATIONS.md          ← primary doctrine (glossary seed)
│   ├── adr/                             ← 26 system-wide decisions
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

When your output names a domain concept (issue title, refactor proposal, hypothesis, test name), use MIRA terminology as defined in `THEORY_OF_OPERATIONS.md` and `.claude/rules/uns-compliance.md` + `.claude/rules/security-boundaries.md`.

Examples of correct MIRA vocabulary:
- "UNS path" not "namespace string"
- "fault code" not "error code"
- "asset" / "component" / "instance" — distinct concepts; don't conflate
- "proposed relationship" vs "verified relationship" — never collapse the distinction
- "UNS location confirmation gate" — the non-negotiable pre-troubleshooting checkpoint
- "Slack-first" — the product surface, not "chatbot"

If the concept you need isn't in `THEORY_OF_OPERATIONS.md` yet, that's a signal — either you're inventing language MIRA doesn't use (reconsider), or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0002 (bot adapter pattern) — but worth reopening because…_

Especially watch for conflicts with:
- ADR-0008 (sidecar deprecation) — don't propose new sidecar work
- ADR-0011 (no LangGraph migration) — don't propose LangChain/LangGraph adoption
- ADR-0013 (UNS namespace builder schema canonicalization)
- ADR-0016 (mira-bridge → FlowFuse)

## North Star objective lock

Per root `CLAUDE.md` and `NORTH_STAR.md` (canonical wedge, 2026-06-22): FactoryLM is the maintenance-context layer that makes messy factory data trustworthy for AI on *any* UNS; MIRA is the grounded agent that proves it by diagnosing with cited sources. **Lead with the context platform, never the copilot.** The active release gate is the **beta gate** — a stranger uploads their own equipment manual and gets a cited answer with no manual fixing (`tests/beta/beta_ready_upload_retrieval_citation.py`). Engineering skills that propose architectural changes, refactors, or new features must check alignment with the master architecture plan (`docs/plans/2026-06-01-mira-master-architecture-plan.md`) — no unrelated dev projects until its phases are complete. This is enforced by the `mira-saas-scope-guard` skill — invoke it when a Pocock skill output proposes scope expansion.
