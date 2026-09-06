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

## 2026-08-19 — H0004 — P0001 discovery completed in PR #3340

P0001 found that the divergence is materially smaller than the original green-field architecture implied:

- all major clients already converge on `Supervisor.process()`;
- the repository already has 26 MCP tools;
- the OpenAI SDK and key plumbing already exist for another narrow use case;
- `TechnicianContext`/context-contract work already exists but is not adopted on the production turn path;
- current "streaming" is a complete reply emitted as one SSE chunk, not token streaming;
- the existing usage telemetry is per-container and lacks the fields required to govern Cloud Gold spend.

The recommended seam is `InferenceProvider` above `InferenceRouter`, preserving the current router and its production call sites.

PR #3340 contains the repo-backed current-to-target map. It is in review and not yet merged at this history entry.

## 2026-08-19 — H0005 — P0002 provider seam built, honestly PARTIAL, PR #3341

P0002 introduced the behavior-preserving `InferenceProvider` seam with `CascadeProvider` wrapping today's inference path. Unknown provider names fail loudly; the Cascade provider explicitly does not claim tool capability; immutable provider results are treated as records rather than editable buffers.

ADR-0037 resolved the standing doctrine conflict by authorizing Cloud Gold as a distinct, budget-capped, telemetry-enforced edition rather than a general permission for paid inference.

Closure remains **PARTIAL**:

- BUILT: yes
- TESTED: yes
- ENABLED/default-safe: yes
- CONNECTED: no
- PROVEN on a real runtime turn: no
- OBSERVABLE to Cloud Gold's required per-turn cost standard: no

That gap becomes P0003.

## 2026-08-20 — H0006 — Product surfaces converged: Hub control plane, existing native app becomes MIRA

Repository inspection changed the UI recommendation.

The existing `mira-mobile` application is not a disposable prototype. It already contains the native/auth/session/deep-link/QR/offline/files/notebook/citation/nameplate/work-order/schedule foundation required by a field technician application. Building a new chat-native client would recreate solved infrastructure.

**Decision:**

- FactoryLM Hub remains the desktop configuration/governance/control plane.
- MIRA becomes the primary technician-facing intelligent product.
- The existing `mira-mobile` codebase is refactored into MIRA's primary native interface.
- Do not create a third `mira-chat` / `mira-technician-v2` application merely to achieve a cleaner shell.
- The target native experience is minimal and conversation-first, in the family of ChatGPT/Claude.
- Existing Workorders, Schedule, Assets, Files, QR/nameplate, and Notebook capabilities are retained as secondary browse/manage surfaces and/or server-backed tools/context.
- Notebook becomes a persistent machine/incident/research context primitive instead of a mandatory source-selection front door to all intelligence.

The detailed decision is now `PRODUCT_SURFACES.md`.

Sequencing was also corrected: P0003 remains backend-first (connect the seam, close telemetry, establish the provider-independent event contract). The native shell convergence is P0004 so runtime and UI changes do not become one unreviewable slice.
