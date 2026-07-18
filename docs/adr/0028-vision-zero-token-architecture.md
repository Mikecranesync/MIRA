# ADR-0028: Vision Zero-Token Architecture and FactoryLM-Owned Model Program

## Status

Accepted - 2026-07-18. PR-0 scope only: inventory, decision record, and strategy docs. No production behavior change.

**Related:** ADR-0003 (edge inference strategy), ADR-0025 (Drive Commander), ADR-0027 (MIRA Visual Technician), `.claude/rules/zero-token-architecture.md`, `printsense/PATH_TO_A.md`, `docs/ops/vision-zta-fleet-inventory-2026-07-18.md`, and `NORTH_STAR.md`.

## Context

MIRA already has the product spine for visual maintenance work: PrintSense deterministic graders and pack publishing, `VisionWorker`, `NameplateWorker`, `PrintWorker`, `SchematicIntelligence`, ADR-0027's VisualSession and AnswerClaim contracts, drive packs, `knowledge_entries`, `wiring_connections`, `kg_entities`, and the review/approval workflow. The risk is building another "vision bot" next to those seams instead of turning the current system into a local-first compiler.

Vision ZTA has two goals:

1. **Zero paid vision tokens by default.** Normal production traffic must not call a paid vision provider unless an operator explicitly launches a budgeted exception.
2. **Zero repeated inference.** Once a visual fact is verified, MIRA must compile it into a deterministic artifact: cache entry, OCR rule, pack fact, graph edge, detector label, exemplar, or regression fixture.

The source plan also adds a proprietary model mandate: FactoryLM should own the adapters, fine-tunes, model manifests, training records, graders, and deterministic artifacts that make the system better over time. Outside teacher models may help bounded research, but recurring production inference must become local and owned where practical.

## Decision

### D1 - Vision ZTA is the inference implementation under ADR-0027

Vision ZTA is not a competing architecture. It becomes the implementation strategy for visual inference inside ADR-0027, PrintSense, Drive Commander packs, and future Visual Technician sessions.

The runtime ladder is:

1. tenant-safe secure intake;
2. SHA-256 identity and exact-result cache;
3. deterministic quality, rotation, crop, raster, dedup, and page classification;
4. specialized local OCR and layout parsing;
5. verified pack, catalog, graph, regex, and visual-similarity lookup;
6. local detector or grounding model for known components;
7. small local VLM for unresolved observations;
8. independent local reread or multi-pass verification;
9. human review when confidence remains inadequate;
10. compile accepted facts into permanent artifacts.

A paid provider is not a fallback step. It is an operator-only, audited benchmark or exception.

### D2 - Content-addressed identity is mandatory

Every consequential vision result must be keyed by at least:

- original or normalized input SHA-256;
- page/crop/tile transform;
- pipeline version;
- preprocessing revision;
- model ID and immutable revision;
- quantization;
- prompt revision;
- schema revision;
- code revision.

A cache hit returns the prior evidence-linked result without model inference. Tenant policy must prevent private cross-tenant discovery even when bytes match. Global reuse is allowed only for explicitly public or sanitized artifacts.

### D3 - Fleet roles are job-level, not model-sharded

Phase 1 must use job-level parallelism. Do not shard one model across the Macs over LAN or Tailscale until single-node benchmarks prove a need.

Default roles, subject to live inventory:

| Node | Vision ZTA role |
|---|---|
| VPS | Authenticated upload/API ingress, tenant/session routing, job state, signed object references, result manifests, cache metadata. No heavy VLM routine path. |
| Alpha | Orchestration, page splitting, rasterization, hashing, preprocessing, deterministic parsers, graders, metrics, scheduling. |
| Bravo | Interactive local VLM/OCR lane, Qwen-class 4B/7B benchmark lane, independent verification, local OpenAI-compatible endpoint when measured safe. |
| Charlie | Document OCR/layout, embeddings and visual-similarity indexing, batch pages, asynchronous corpus processing, benchmark and dataset curation, optional second 4B-class VLM lane only under resource limits. |

Live PR-0 inventory is recorded in `docs/ops/vision-zta-fleet-inventory-2026-07-18.md`. Measured highlights: all three Macs are M4-class with 16 GiB RAM; Charlie has T7 mounted, Docker/Colima, Ollama, and MLX present; Charlie lacks Tesseract, PaddleOCR, and MLX-VLM; Bravo exposes Ollama on Tailscale with `glm-ocr`, `qwen2.5vl:7b`, and `nomic-embed-text`; the VPS has CPU-only Ollama and Tesseract but remains disallowed for routine heavy vision.

### D4 - Charlie owns the document and corpus lane

Because Charlie already hosts MIRA services, bots, KB workloads, Docker/Colima, and Ollama, Charlie's Vision ZTA work must be asynchronous and resource-gated:

- document OCR/layout worker;
- embeddings and visual-similarity indexing;
- batch page/corpus processing;
- benchmark and dataset-curation worker;
- local MLX/MLX-VLM experiments only after memory and load gates pass;
- optional second 4B-class VLM lane only with `max_concurrency=1`, explicit memory limits, and rollback to no-lane when MIRA services are degraded.

Charlie must not become a dense-model host by default. Its success condition is a reliable corpus/compiler lane, not maximum model size.

### D5 - Verification beats confidence

For identifiers, wire numbers, terminal labels, model numbers, off-page references, and safety-adjacent claims:

- crop the exact region;
- ask an independent local reader without revealing the proposed answer;
- compare raw readings;
- agreement may raise machine confidence;
- disagreement becomes unresolved or needs review;
- self-confidence alone cannot promote a fact.

Hard gates:

- zero confident misreads for auto-import;
- zero unsupported safety claims;
- zero cross-tenant leakage;
- zero silent paid calls;
- every promoted fact has evidence IDs;
- deterministic replay passes;
- model/prompt/schema revisions are recorded.

### D6 - FactoryLM-owned model program is first-class

The model program starts with owned, exportable artifacts before foundation-model pretraining:

- canonical training-record schema with evidence, region, rights, tenant, and verification fields;
- dataset builders from verified PrintSense, Drive Commander, Visual Technician, and multi-photo cases;
- training-data provenance and consent enforcement;
- reproducible LoRA/QLoRA scripts for compact vision/reasoner models;
- OCR fine-tuning path;
- embedding/reranker pairs and hard-negative generation;
- detector dataset export;
- model manifests, hashes, licenses, metrics, and rollback references;
- repository-backed model registry metadata, with weights stored outside the main Git repository.

Do not train on private customer material without explicit training consent. Do not allow benchmark/train leakage. Do not call a model "FactoryLM-owned" unless the owned base weights, adapters, datasets, graders, and deterministic artifacts are named separately.

## Consequences

### Positive

- Aligns Visual Technician, PrintSense, Drive Commander, and model training into one compiler flywheel.
- Makes local inference a bounded exception resolver instead of a token-burning runtime habit.
- Gives Charlie a useful lane that matches its current services and storage instead of fighting Bravo for interactive VLM work.
- Turns technician corrections into reusable company IP: packs, rules, graph edges, exemplars, labels, and eventually FactoryLM-owned adapters.

### Costs and obligations

- The existing "Claude first, local fallback" vision posture must change in later PRs to deterministic/cache first, specialized local second, local VLM third, review fourth, paid exception only by explicit override.
- The repo needs a content-addressed result schema, manifest discipline, and node capability registry before production routing changes.
- OCR/runtime packages must be license-checked, pinned, benchmarked, and resource-limited before installation.
- The model registry must store metadata and immutable references, not multi-gigabyte weights.

## PR ladder

1. Inventory and ADR: fleet inventory script/report, this ADR, North Star update, updated node docs. No production behavior change.
2. Content-addressed vision job/cache: job schema, cache key, immutable result manifest, tenant-safe cache, replay tests, paid-off default flag.
3. Deterministic preprocessing and OCR ensemble: full-resolution print path, quality gates, rotation/deskew/tiling, PP-OCRv6/PaddleOCR-VL/GLM-OCR/Tesseract raw-output preservation and reconciliation.
4. Local VLM gateway: MLX-VLM/Ollama benchmark, OpenAI-compatible endpoint, model manifest, node health/capability advertisements, Ollama rollback.
5. Capability-aware routing and blind verifier: Celery routing, easy/difficult lanes, second-reader verification, disagreement to unresolved, no paid fallback.
6. Compile-to-artifact flywheel: accepted observation triage into cache/rules/packs/catalog/graph/exemplars/labels/fixtures with reuse report.
7. FactoryLM proprietary model foundation: training records, consent policy, dataset builders, model registry, LoRA/OCR/embed proof, immutable manifests.
8. Visual retrieval/detector proof: FiftyOne/CVAT exports, duplicate/embedding retrieval, detector proof on reviewed class set.
9. Production cutover and cost proof: `PAID_VISION_ALLOWED=0`, operator-only override with audit log, fleet dashboards, quality/latency/cost report, rollback runbook.

Each PR must state measured versus inferred facts, exact changed files, tests, rollback, resource usage, and paid-inference budget if any.
