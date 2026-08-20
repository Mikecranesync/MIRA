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
