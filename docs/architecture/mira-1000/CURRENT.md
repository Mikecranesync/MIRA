# MIRA-1000 Current State

**Last updated:** 2026-08-19  
**Architecture ID:** MIRA-1000  
**Baseline main:** `5dfcbb8940bc2e724cf2b9b111f1837182f20688`

## Current decision

GO on the architecture direction, subject to discovery against current repo truth:

- **Cloud Gold** will use OpenAI as the frontier inference provider.
- **On-Prem** preserves the local/no-cloud-inference line and converges toward Gold behavior.
- The architectural split should occur at the provider boundary, not by cloning FactoryLM.
- Existing deterministic FactoryLM/MIRA capabilities are retained unless discovery proves they are redundant, unsafe, or superseded.
- Cloud Gold is quality-first. Prompt caching/service-class routing/model routing are introduced after the baseline is measurable.

## Active prompt

**None. P0001 is COMPLETE; P0002 is drafted but NOT AUTHORIZED.**

- **P0001 — Discovery and Convergence Map — ✅ COMPLETE (2026-08-19).**
  Result: `CURRENT_TO_TARGET_MAP.md`. Docs only; $0.00 paid inference.
- **P0002 — Provider seam (behavior-preserving) — ⚠️ PARTIAL (2026-08-19).**
  Seam BUILT + TESTED + ENABLED (default = today's cascade), but **not CONNECTED and not
  PROVEN** — nothing calls it in production yet. That is deliberate; wiring the first
  caller is P0003. Do not report the seam as done.

### ✅ Blocker RESOLVED — ADR-0037 (2026-08-19)

P0001 found that Cloud Gold conflicts with two standing repository rules:

1. Root `CLAUDE.md` Hard Constraint #2 — the cloud cascade is Groq+Cerebras+Together
   (free-tier), and the sole paid carve-out is PrintSynth print-vision,
   *"print-photo vision only, never chat/diagnosis."*
2. `.claude/rules/zero-token-architecture.md` Hard Rule 1 — metered paid inference is a
   budget-declared acceptance test, **never** a product runtime.

**Both were amended in place by ADR-0037**, which authorizes Cloud Gold as a distinct,
budget-capped, telemetry-enforced *edition* — not a general relaxation. The free cascade
remains the default for every edition; Cloud Gold is opt-in and never the fallback; and
Cloud Gold traffic stays gated on per-turn cost telemetry.

### Budget

$9.25 OpenAI credit, $0.00 spent. At verified pricing that is ~240-320 frontier turns —
the Phase 3 spine proof and one small eval slice, not the full section 24 suite.

## Why discovery is first

The repository already contains substantial systems for:

- provider routing
- conversation
- retrieval
- knowledge entries
- knowledge graph
- evidence/grounding
- UNS context
- asset context
- live state
- work orders
- Telegram/Slack/web/client surfaces
- feature flags
- eval gates
- local inference
- existing cloud providers

MIRA-1000 must connect and simplify these before creating new equivalents.

## Current queue

| Prompt | State | Intent |
|---|---|---|
| P0000 | CONTROL | permanent operating instructions |
| P0001 | **ACTIVE** | current→target discovery/convergence map |
| P0002 | PLANNED | minimal Cloud Gold provider seam |
| P0003 | PLANNED | deterministic retrieval/context tool plane |
| P0004 | PLANNED | unified conversation/evidence/client runtime |
| P0005 | PLANNED | delegated business tools + approvals |
| P0006 | PLANNED | Gold conversational/parity evals |
| P0007 | PLANNED | prompt caching + service-class/model routing |
| P0008 | PLANNED | On-Prem adapter parity program |

Only create the next immutable prompt after the current slice has repo-backed evidence and a non-overlapping owner.

## Near-term proof target

The first real implementation proof after discovery should be intentionally narrow:

```text
real FactoryLM request
  → existing auth/context
  → MIRA orchestrator seam
  → OpenAI Responses provider
  → streaming answer
  → existing/normalized FactoryLM run audit
  → real client/API path
```

No privileged tool is needed for that first proof.

Then wrap an existing **read-only deterministic FactoryLM capability** as the first strict tool.

## Stop conditions

A session should stop and report rather than improvising if it discovers:

- another active PR/session owns the same slice
- the proposed component already exists under another name
- current production behavior contradicts this document materially
- adding the provider seam requires bypassing existing security/evidence rules
- an OpenAI-specific assumption has changed in current official docs
- the intended change would force a second canonical data model

Update the ledger instead of hiding the disagreement.
