# ADR-0037: Cloud Gold — a paid frontier provider on the chat/diagnosis path

- **Status:** Accepted (owner-authorized 2026-08-19; see § Authorization)
- **Date:** 2026-08-19
- **Program:** MIRA-1000 (`docs/architecture/mira-1000/`), master PR #3339
- **Raised by:** P0001 discovery (`CURRENT_TO_TARGET_MAP.md` §8), tracked as
  `TRACKER.yaml blockers.doctrine_adr`
- **Amends:** root `CLAUDE.md` Hard Constraint #2;
  `.claude/rules/zero-token-architecture.md` Hard Rule 1
- **Supersedes:** nothing. Both amended rules remain in force outside the carve-out below.

## Context

MIRA-1000 introduces **Cloud Gold** — an online MIRA edition that uses an OpenAI frontier model as
the primary intelligence engine on the **chat/diagnosis** path, with **On-Prem** (the existing
local-inference line) converging toward the same externally observable contracts.

P0001 discovery found this collides with two standing rules that the MIRA-1000 PRD does not mention.
Neither was written carelessly; both encode real, expensive lessons. They must be amended
deliberately, not bypassed.

### Conflict 1 — root `CLAUDE.md` Hard Constraint #2

> **Cloud LLMs:** Groq + Cerebras + Together cascade (all free-tier, OpenAI-compat) … **No Anthropic
> in the diagnostic cascade** (removed PR #610 — never reintroduce there). Sole owner-authorized
> carve-out: the PrintSynth print-vision interpreter (PR #2661) — **print-photo vision only, never
> chat/diagnosis.**

The existing paid carve-out is explicitly scoped to *print vision* and explicitly excludes
*chat/diagnosis*. Cloud Gold is chat/diagnosis.

### Conflict 2 — `.claude/rules/zero-token-architecture.md` Hard Rule 1

> Metered paid inference runs **ONLY** as the bounded acceptance test of the artifact currently being
> developed or promoted … Every paid lane declares a dollar budget BEFORE it runs and hard-stops at
> the budget. … Re-validation on UNCHANGED inputs is banned.

Cloud Gold makes metered paid inference the **product runtime**, not a validation instrument. This is
the deeper conflict: it contradicts the rule's central claim rather than an edge case.

## Decision

**Cloud Gold is authorized as a distinct, budget-capped, telemetry-enforced MIRA *edition*.** It is
not a general relaxation of either rule.

1. **Scope of the carve-out.** A paid frontier provider MAY serve the chat/diagnosis path **only**
   when selected as the `cloud_gold` edition through the `InferenceProvider` seam (ADR body §
   Implementation). Every other paid-inference use remains governed by the unamended rules.

2. **The free-tier cascade remains the default.** Groq → Cerebras → Together stays the default
   provider path for all editions. Cloud Gold is opt-in per deployment, never the fallback, and
   never silently selected. If the Cloud Gold provider is unavailable or over budget, MIRA falls back
   to the cascade — it does not fail the turn.

3. **Zero-Token Rule 1 is amended, not waived.** The rule's intent — *paid inference must never be a
   casual development crutch* — is preserved verbatim. What changes is that a **declared product
   edition** is now a legitimate paid lane, subject to the same budget discipline the rule demands:
   - a dollar budget MUST be declared before the lane runs,
   - the lane MUST hard-stop at the budget,
   - development, debugging and iteration still use hermetic fixtures and the free cascade — **never**
     the paid edition,
   - re-validation on unchanged inputs remains banned.

4. **Telemetry is a precondition, not a follow-up.** No Cloud Gold traffic may run without per-turn
   cost telemetry sufficient to enforce the budget. P0001 §7 found `api_usage` missing 9 of the
   fields MIRA-1000 §23 requires; closing that gap gates Cloud Gold traffic, not merely Phase 7.

5. **Anthropic remains excluded from the diagnostic cascade.** PR #610 stands. This ADR authorizes
   *OpenAI as a Cloud Gold provider*; it does not reopen Anthropic, and the PrintSynth print-vision
   carve-out is unchanged.

6. **Read-only OT is unchanged.** Cloud Gold changes who supplies intelligence. It changes nothing
   about `.claude/rules/fieldbus-readonly.md`, the UNS gate, citation compliance, tenant scoping, or
   approval requirements. The model proposes; FactoryLM decides.

## Implementation boundary

The carve-out is expressed in exactly one place — the provider seam introduced by MIRA-1000 P0002:

```
Supervisor.process_full()
        │
        ▼
InferenceProvider.respond(conversation, context, tools, policy, metadata) -> TurnResult
        ├── CascadeProvider          # Groq → Cerebras → Together (default, free-tier)
        └── OpenAIResponsesProvider  # Cloud Gold edition (this ADR) — NOT YET BUILT
```

`CascadeProvider` is today's `InferenceRouter` behavior, unchanged. Selecting Cloud Gold is a single
explicit configuration act, and reverting is the same act inverted.

## Consequences

**Accepted:**
- MIRA's conversational ceiling is no longer bounded by free-tier model quality.
- A second cost axis enters the product; it must be measured per turn, per tenant, or it will not be
  controllable.
- Two rules now carry an exception, which raises the cost of reading them correctly. Both are amended
  in place with a pointer here so the exception cannot be discovered only by reading this ADR.

**Rejected alternatives:**
- *Add OpenAI as a fourth cascade provider.* Cheapest (≈20 lines — `_call_openai_compat` already
  speaks OpenAI Chat Completions), but forecloses the Responses API's server-side conversation state,
  typed streaming and tool semantics. It is a cost/quality experiment, not the Cloud Gold edition.
- *Leave both rules unamended and proceed.* Rejected: it would make the repository's own doctrine
  false, and the next session would correctly read Cloud Gold as a violation.
- *Abandon Cloud Gold to preserve the rules.* Rejected by the owner: the free cascade's conversational
  ceiling is the binding constraint on the product's stated goal (PRD G1).

## Budget at ratification

OpenAI credit available: **$9.25**. Verified pricing 2026-08-19 — gpt-5.6-sol $5.00/Mtok input,
$0.50 cached, $30.00/Mtok output. A representative MIRA turn (~4k in, ~600 out) costs ~$0.038
uncached, ~$0.029 with a 2k cached prefix, i.e. **~240–320 turns**.

That funds the Phase 3 spine proof and one small eval slice. It does **not** fund MIRA-1000 §24's
full behavioral suite through both editions. The eval suite is therefore sized to the credit, not the
reverse.

## Authorization

Owner (Mike) authorized the MIRA-1000 direction and this ADR's recommendations on **2026-08-19**,
following the P0001 discovery report which raised both conflicts explicitly and recommended
ratification before any Cloud Gold chat code shipped.

**Still owner-only, unchanged by this ADR:** provisioning `OPENAI_API_KEY` in Doppler `factorylm/prd`,
merging, deploying, and raising the spend budget.

## Cross-references

- `docs/architecture/mira-1000/CURRENT_TO_TARGET_MAP.md` — P0001 discovery, §8 (conflicts), §9 (budget)
- `docs/architecture/mira-1000/prompts/P0002-provider-seam.md` — the seam this ADR gates
- root `CLAUDE.md` Hard Constraint #2 — amended to point here
- `.claude/rules/zero-token-architecture.md` Hard Rule 1 — amended to point here
- `.claude/rules/fieldbus-readonly.md`, `.claude/rules/train-before-deploy.md` — unchanged; Cloud Gold
  is read-only troubleshooting intelligence like every other edition
