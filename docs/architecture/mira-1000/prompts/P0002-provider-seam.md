# MIRA-1000 / P0002 — Provider Seam (behavior-preserving)

**State:** PLANNED — **NOT AUTHORIZED FOR EXECUTION**
**Type:** refactor / architecture seam
**Recommended by:** P0001 (`CURRENT_TO_TARGET_MAP.md` §13)
**Paid inference budget:** **$0.00** — this prompt must not call any metered provider.

> **Two gates before this prompt may become ACTIVE:**
> 1. Owner authorization under the global multi-session protocol.
> 2. **The ADR in §8 of `CURRENT_TO_TARGET_MAP.md` is ratified** — Cloud Gold currently conflicts
>    with root `CLAUDE.md` Hard Constraint #2 and with `.claude/rules/zero-token-architecture.md`
>    Hard Rule 1. The ADR may land inside this prompt, but no OpenAI chat code ships before it does.

## Goal

Introduce the `InferenceProvider` seam **above** `InferenceRouter`, and wrap today's cascade behind
it with **zero behavior change**. Nothing about the product's answers may differ after this prompt.

## Why above, not inside (from P0001)

`InferenceRouter.complete()` is `(messages, max_tokens, session_id, sanitize) -> (str, dict)` and has
**11 production call sites** (`engine.py` ×7, `pm_extractor`, `quality_gate`, `nameplate_worker`,
`query_triage`, `rag_worker`). Adding tools/policy/streaming inside it breaks all of them. Wrapping
preserves every one.

## Required first checks

Re-run the coordination check. P0001 found **four open PRs touching `mira-bots/shared/engine.py`**
(#3191, #2985, #2984, #2983). The seam lives next to that file — confirm current overlap before
editing, and claim the slice.

## Scope

**In:**
1. `InferenceProvider` interface:
   `async def respond(conversation, context, tools, policy, metadata) -> TurnResult`
   Carry **no FactoryLM business logic** (PRD §12).
2. `TurnResult` — must be able to express what `-> str` cannot: text, tool calls, usage, provider
   identity, finish reason. Do not implement tool *execution* here.
3. `CascadeProvider` — delegates to the existing `InferenceRouter` verbatim. Tools/policy accepted
   and **ignored** (documented as such), because the cascade cannot honor them yet.
4. One env flag selecting the provider; **default = today's path**.
5. Contract tests: old path vs new path over the existing golden set — identical outputs.
6. The §8 ADR.

**Out (do not build in P0002):**
- ❌ `OpenAIResponsesProvider` or any `/v1/responses` call
- ❌ model-callable tools, tool execution, approval wrappers
- ❌ streaming (P0001 §4: nothing token-streams today; this is a full-stack change)
- ❌ cost-telemetry schema changes (own prompt — P0001 §7)
- ❌ any change to the 13 client adapters
- ❌ any paid inference

## Implementation requirements

- Reuse, do not reimplement: PII sanitization, retry/backoff, provider budget tracking, gibberish
  detection, usage logging all already live in `router.py` and must keep working unchanged.
- `CascadeProvider` must be a pass-through, not a rewrite. If a line of `router.py` needs changing to
  make the wrap possible, justify it in the PR.
- Follow `.claude/rules/karpathy-principles.md` — minimum code, surgical, no speculative knobs.

## Testing requirements

- Contract test proving `CascadeProvider.respond(...)` produces the same reply as
  `InferenceRouter.complete(...)` for the existing golden cases.
- The full `mira-bots` suite must show **no new failures** vs the pre-change baseline. Capture the
  baseline first and report **net**, per `.claude/rules/session-discipline.md` §2.
- Flag-off must be byte-identical to today.

## Expected evidence

- Before/after suite counts.
- The contract-test output.
- A diff showing the 11 call sites are untouched.
- Confirmation that no metered provider was called (`$0.00` spent).

## Acceptance criteria

- [ ] `InferenceProvider` exists and carries no FactoryLM business logic.
- [ ] `CascadeProvider` wraps the existing router with zero behavior change.
- [ ] Flag defaults to today's behavior; rollback is one env var.
- [ ] Contract tests pass; no new suite failures.
- [ ] The §8 ADR is filed (ratification may be pending, but the decision record exists).
- [ ] No OpenAI call, no tools, no streaming, `$0.00` spent.

## Handoff

Recommend P0003 scope once the seam exists. The natural next slice is the **Phase 3 spine**: one
real request through `OpenAIResponsesProvider` end-to-end — but only after the ADR is ratified and
a budget is declared against the $9.25 credit.

## Stop rule

If honoring "zero behavior change" turns out to require touching the 11 call sites, **stop and
report** rather than widening the refactor. That finding would itself change P0002's shape.
