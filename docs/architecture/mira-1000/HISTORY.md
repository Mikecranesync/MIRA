# MIRA-1000 Living History

This file is append-only in spirit. Correct an earlier entry with a later entry rather than rewriting history to make the sequence look cleaner.

## 2026-08-19 — H0001 — Divergence decision

**Decision:** create MIRA Cloud Gold as the online reference-intelligence path using OpenAI, while preserving the existing local-inference work as the On-Prem/no-cloud-inference line.

**Critical qualification:** do not fork FactoryLM into two products internally. Fork at the inference/provider boundary and reuse the deterministic platform, context, evidence, tools, policy, memory, audit, and client contracts.

**Reason:** rebuilding general conversational intelligence is not the differentiating value of FactoryLM. FactoryLM's moat is trustworthy industrial context, retrieval, evidence, deterministic validation, tools, integrations, and safe execution.

**Gold target:** MIRA should be conversationally comparable to a high-quality ChatGPT experience and superior on FactoryLM-specific questions because it has authorized plant context.

**On-Prem target:** same product contract and eval families, with local inference and explicit capability gaps where cloud-only features cannot be reproduced.

## 2026-08-19 — H0002 — Cost architecture added

Four distinct cost mechanisms were separated:

1. prompt caching for repeated stable context in interactive chat;
2. model routing only after Gold evals exist;
3. Flex for slower lower-priority request workloads;
4. Batch for large asynchronous grouped work.

Gold quality remains the first milestone; cost optimization follows measurement.

## 2026-08-19 — H0003 — Prompt-control surface established

MIRA-1000 now uses:

- immutable prompt IDs under `prompts/`
- `CURRENT.md` for the active next slice
- `TRACKER.yaml` for machine-readable state
- this file for narrative history
- child PRs that cite the MIRA-1000 prompt ID they execute

The first active prompt is P0001: discovery/convergence mapping.

## 2026-08-19 — H0004 — P0001 discovery executed

**Goal:** map the current repository to MIRA-1000 before any Cloud Gold code.

**Discovery — the divergence is smaller than the PRD assumed:**

- All **13** client surfaces already call one entry point, `Supervisor.process()`
  (`mira-bots/shared/engine.py:2272`), with a normalized signature carrying platform,
  tenant, user, and UNS provenance. G4 is largely already satisfied.
- Every current provider is already OpenAI-compatible through a single function,
  `_call_openai_compat` (`router.py:530`).
- The **OpenAI SDK is already in the repo** (`printsense/interpret.py:349`) and
  `OPENAI_API_KEY` is already mapped in prod and staging compose.
- **26 `@mcp.tool` functions already exist** in `mira-mcp/server.py`, including the CMMS
  write tools section 17 anticipates.
- The section 14 context architecture already exists as ADR-0033 `TechnicianContext`
  (`MIRA_CONTEXT_CONTRACT`) — **built, default-off, with no production call site**.

**Decision:** recommend the seam **above** `InferenceRouter`, not a fourth cascade entry.
`InferenceRouter.complete()` has 11 production call sites and no room for tools, policy or
streaming; wrapping preserves all of them and lets both editions inherit the fix once.

**Assumptions the repository proved wrong:** streaming does not exist at all (the current SSE
path emits the whole reply as one chunk, `mira-pipeline/main.py:1034`); the tool registry is not
greenfield; clients have not diverged; OpenAI is not a new dependency; `api_usage` is missing 9 of
the fields section 23 requires and is per-container SQLite.

**Blocker raised:** Cloud Gold conflicts with root `CLAUDE.md` Hard Constraint #2 and with
`.claude/rules/zero-token-architecture.md` Hard Rule 1. Recorded as `blockers.doctrine_adr`
(OPEN). This is not a reason to stop the program; it is a reason to ratify it explicitly.

**Budget:** verified OpenAI pricing. The $9.25 credit funds ~240-320 frontier turns — the spine
proof and one eval slice, not the full behavioral suite.

**PR:** see `CHILD_PRS` / the P0001 child PR.

**Evidence:** `CURRENT_TO_TARGET_MAP.md` (file:line citations throughout; OpenAI docs verified
2026-08-19 against `developers.openai.com`, since `platform.openai.com/docs/*` now 301s there).

**Paid inference spent:** $0.00

**Next:** P0002 — provider seam, behavior-preserving (`prompts/P0002-provider-seam.md`).
**NOT AUTHORIZED** — awaiting owner authorization and the doctrine ADR.

## 2026-08-19 — H0005 — P0002 provider seam + ADR-0037

**Goal:** introduce the `InferenceProvider` seam behavior-preservingly, and resolve the
doctrine blocker P0001 raised.

**Authorization:** owner approved the pivot and P0001's recommendations on 2026-08-19.

**ADR-0037 (Accepted).** Cloud Gold is authorized as a distinct, budget-capped,
telemetry-enforced *edition* — not a general relaxation. Both conflicting rules were
amended **in place** so the exception cannot be discovered only by reading the ADR:

- root `CLAUDE.md` Hard Constraint #2 now names two carve-outs (PrintSynth print-vision,
  and Cloud Gold via the `InferenceProvider` seam), and restates that the free cascade is
  the default for every edition and Anthropic stays out of the diagnostic cascade.
- `.claude/rules/zero-token-architecture.md` Hard Rule 1 now admits a *declared product
  edition* as a legitimate paid lane — under the rule's own discipline (budget declared up
  front, hard stop, no re-validation on unchanged inputs, and development/debugging still
  on hermetic fixtures and the free cascade).

**Implementation.** `mira-bots/shared/inference/provider.py`: `InferenceProvider`,
`TurnResult`, `ToolCall`, `CascadeProvider`, `get_provider()`. The seam sits ABOVE
`InferenceRouter`; `CascadeProvider` delegates to it with no transformation, so all 11
existing call sites are untouched and sanitization/retries/budget-tracking/usage-logging
keep working unchanged. `tools` and `policy` are accepted and **ignored** by the cascade —
stated in the docstring and locked by a test, rather than silently dropped. An unknown
provider name **raises** instead of falling back, so a deployment that asked for Cloud Gold
can never quietly get the free cascade.

**Evidence.** 16 contract tests pass. Three mutations were applied and all were caught:
changing the `max_tokens` default, disabling PII sanitization, and fabricating a tool call
on the cascade. `ruff` clean.

**Honest closure (section 28).** BUILT yes · TESTED yes · ENABLED yes (default = today's
behavior) · **CONNECTED no** · **PROVEN no** · OBSERVABLE no. Nothing calls the seam in
production yet — that is deliberate for a behavior-preserving change, and it means P0002 is
**PARTIAL**, not COMPLETE.

**Paid inference spent:** $0.00 (credit remains $9.25).

**Next:** P0003 — wire the first caller and close the telemetry gap, before any OpenAI
provider. Cloud Gold traffic stays gated on per-turn cost telemetry (ADR-0037 decision 4).
