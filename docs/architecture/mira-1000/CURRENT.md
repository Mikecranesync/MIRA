# MIRA-1000 Current State

**Last updated:** 2026-08-20  
**Architecture ID:** MIRA-1000  
**Master architecture PR:** #3339

## Current architecture decisions

- **Cloud Gold** uses OpenAI as the frontier inference provider.
- **On-Prem** preserves the local/no-cloud-inference line and converges toward Gold behavior.
- The inference split occurs at `InferenceProvider`, not by cloning FactoryLM.
- Existing deterministic FactoryLM/MIRA capabilities remain canonical unless repo evidence proves otherwise.
- Cloud Gold traffic remains gated on per-turn spend telemetry under ADR-0037.

## Product-surface decision — NEW

Read:
`PRODUCT_SURFACES.md`

The product boundary is now explicit:

- **FactoryLM Hub** = desktop configuration, governance, knowledge, integrations, users/permissions, telemetry, evals, and operational control plane.
- **MIRA** = the technician-facing intelligent product.
- **Existing `mira-mobile`** = the native codebase to evolve into MIRA's primary technician interface.
- **Do not create a third chat/native app.** Preserve the native foundation and replace its information architecture.
- Target UX = minimal ChatGPT/Claude-style conversation-first shell with FactoryLM tools/context rendered inline.
- Notebook remains a persistent machine/incident/workspace context primitive; it is not a required setup step before ordinary MIRA chat.
- Workorders, Schedule, Assets, Files, QR/nameplate, and other existing native features remain useful secondary surfaces and tool-backed capabilities.

## Completed / in-review program slices

### P0001 — Discovery and Convergence

PR: **#3340**  
State: **REVIEW / implementation artifact complete, not merged**

Key result: the divergence is smaller than the original PRD assumed. Major clients already converge on `Supervisor.process()`, 26 MCP tools already exist, OpenAI SDK/key plumbing already exists, and the real gaps are provider/tool/streaming contracts, centralized cost telemetry, and adoption of existing context systems.

### P0002 — Provider seam

PR: **#3341**  
State: **REVIEW / PARTIAL by closure doctrine**

Built and tested `InferenceProvider` above `InferenceRouter` with `CascadeProvider` preserving current behavior. ADR-0037 authorizes Cloud Gold as a distinct budget-capped, telemetry-enforced edition.

P0002 is intentionally **not CONNECTED or PROVEN** yet: no real production/runtime caller goes through the seam. That is P0003.

## Active prompt

**P0003 — First Connected Caller, Cost Telemetry, and Conversation Event Contract**

Read:
`prompts/P0003-first-caller-telemetry-conversation-contract.md`

Before executing, read `PRODUCT_SURFACES.md` and inspect current #3340/#3341 heads/claims.

### P0003 objective

Backend-first only:

1. connect a real MIRA runtime caller through the provider seam using the existing Cascade path;
2. close ADR-0037's per-turn telemetry prerequisite;
3. establish the provider-independent event/result contract needed for future real streaming, tools, approvals, citations, and the minimal native MIRA UI;
4. prove the path without paid OpenAI runtime traffic.

**Do not redesign the mobile UI in P0003. Do not create a new client.**

## Updated queue

| Prompt | State | Intent |
|---|---|---|
| P0000 | CONTROL | permanent operating instructions |
| P0001 | REVIEW | discovery/current→target map — PR #3340 |
| P0002 | REVIEW / PARTIAL | provider seam + ADR-0037 — PR #3341 |
| P0003 | **ACTIVE** | first connected caller + durable cost telemetry + conversation/event contract |
| P0004 | PLANNED | refactor existing `mira-mobile` into conversation-first MIRA shell |
| P0005 | PLANNED | deterministic read tools in conversational runtime + approvals progression |
| P0006 | PLANNED | delegated business tools (email/Slack/calendar) + approval policy |
| P0007 | PLANNED | Gold conversational/industrial parity evals |
| P0008 | PLANNED | prompt caching + Flex/Batch + eval-backed model routing |
| P0009 | PLANNED | On-Prem provider parity program |

## Near-term architecture sequence

```text
P0002 seam
  → P0003 real caller + telemetry + event contract
  → P0004 existing mira-mobile becomes chat-first MIRA
  → deterministic FactoryLM tools appear inside conversation
  → approval-gated business actions
  → Cloud Gold quality/evals/cost optimization
  → On-Prem parity
```

## Product shorthand

> **FactoryLM builds and governs MIRA's world. MIRA is how the technician works inside that world.**

> **Keep the native app. Replace the information architecture, not the foundation.**

## Stop conditions

A session should stop and report rather than improvising if it discovers:

- another active PR/session owns the same slice;
- the proposed component already exists under another name;
- #3340/#3341 have moved materially and the prompt assumptions no longer hold;
- the intended runtime connection bypasses existing security/evidence rules;
- telemetry would create a second canonical run/audit ledger unnecessarily;
- the work requires a new native client rather than reuse of `mira-mobile`;
- an OpenAI-specific assumption has changed in current official docs;
- the change would force a second canonical FactoryLM data model.

Update the ledger instead of hiding the disagreement.
