# MIRA-1000 / P0001 — Discovery and Convergence Map

**State:** ACTIVE  
**Type:** discovery / architecture reconciliation  
**Code changes:** do not implement the new OpenAI runtime in this prompt unless a tiny docs/test-only correction is strictly required to make the map truthful.

## Goal

Before Cloud Gold implementation begins, prove exactly how the current `MIRA` repository maps to MIRA-1000.

The output must prevent us from building a second architecture on top of systems that already exist.

## Required first checks

Follow the repo's global concurrency/session protocol.

Inspect:

```bash
git status
git branch --show-current
git rev-parse HEAD
git remote -v
git worktree list
gh pr list --state open
```

Fetch current remote state when safe.

Identify active overlapping claims/PRs before touching files.

## Investigate these current capabilities

For each, cite exact files/functions/routes/tables/flags/deploy wiring and current runtime state:

1. **Actual production chat request path**
2. **Provider/inference router**
3. **Local inference path**
4. **Current cloud provider cascade**
5. **Conversation state/history**
6. **Streaming**
7. **Telegram adapter**
8. **Slack adapter**
9. **FactoryLM web/Hub chat**
10. **Android/mobile path**
11. **Approved retrieval**
12. **Document scope / asset-attached docs**
13. **Evidence/citation validation**
14. **Knowledge graph**
15. **UNS identity/context**
16. **Asset context**
17. **Live machine state**
18. **fault/parameter structured lookup and validation**
19. **nameplate/vision**
20. **CMMS/work orders**
21. **tool/MCP infrastructure**
22. **RBAC / tenant isolation**
23. **approval/idempotency infrastructure**
24. **audit / tracing**
25. **evals**
26. **staging/prod gates**
27. **feature flags that are built but off/mis-plumbed**
28. **existing OpenAI-compatible abstractions that may be reusable**
29. **current connector/business-tool infrastructure**
30. **code that is clearly legacy/dead but still confuses the architecture**

## Produce this table

Create/update a repo-backed artifact under this MIRA-1000 directory:

`CURRENT_TO_TARGET_MAP.md`

Minimum columns:

| MIRA-1000 capability | Current implementation | Runtime path | Env/flag state | Evidence it is live | Keep / wrap / replace / retire | Cloud impact | On-Prem impact | Owner/PR | Gap |
|---|---|---|---|---|---|---|---|---|---|

Do not use vague entries like "exists in engine." Cite concrete locations.

## Specifically answer the divergence question

Determine whether the target provider seam can be introduced without forking the whole runtime.

Recommend the most natural current interface point for:

```text
InferenceProvider
  ├── OpenAIProvider        # Cloud Gold
  └── LocalProvider         # On-Prem
```

If no clean seam exists, show the minimum refactor required.

## Specifically answer the single-source-of-truth question

For Web/Android/Telegram/Slack:

- identify whether they already converge on the same engine;
- identify any client-specific behavior/prompt/retrieval divergence;
- identify the smallest route to one logical MIRA runtime.

## Specifically answer the deterministic-tool question

Inventory existing functions that can become model-callable **read-only strict tools** without rewriting their business logic.

Rank the first 5 candidates by:

- value to MIRA
- existing maturity
- evidence quality
- tenant safety
- implementation effort
- On-Prem reuse

## Specifically answer the local/on-prem question

Document what the existing local inference path can already do and which MIRA-1000 contracts it currently violates or bypasses.

Do not disparage or delete it. It is the baseline On-Prem implementation.

## Specifically answer the cost architecture question

Identify:

- where stable prompt/tool content is currently constructed;
- whether prompt caching can be added without making dynamic data part of the cache prefix;
- which existing background jobs are good Flex candidates;
- which existing bulk/offline jobs are good Batch candidates;
- where usage/cost telemetry currently exists or is missing.

Do not implement model routing yet.

## OpenAI verification gate

Before recommending code, verify current official OpenAI docs for:

- Responses API
- function/tool calling
- conversation/continuation state
- prompt caching
- model pricing
- Flex
- Batch

Record the doc URLs and verification date.

## Required output

The P0001 result should include:

1. `CURRENT_TO_TARGET_MAP.md`
2. an updated `TRACKER.yaml` entry for P0001
3. appended `HISTORY.md`
4. a recommended **P0002 prompt**, but do not execute P0002 unless separately authorized/claimed under the global protocol
5. a short list of architecture assumptions from MIRA-1000 that repository evidence proved wrong

## Acceptance gate

P0001 is complete only when we can answer, with repository evidence:

- where the real production turn enters;
- where inference is selected;
- how local inference differs;
- where retrieval/evidence occurs;
- how all client surfaces converge or diverge;
- where the OpenAI provider seam should live;
- which code is reused instead of duplicated;
- the smallest real-path Cloud Gold proof slice;
- the rollback boundary;
- the measured implications for On-Prem.

## Stop rule

Do not turn discovery into a giant implementation PR.

The desired end state of P0001 is a trustworthy map that makes P0002 small.
