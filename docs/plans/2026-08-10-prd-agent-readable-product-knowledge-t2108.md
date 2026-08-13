# PRD --- Agent-Readable Product Knowledge Canary: eufy RoboVac 11S (T2108)

**Date:** 2026-08-10\
**Status:** Proposed / build plan\
**Primary canary:** eufy RoboVac 11S, T2108

## Objective

Build the first end-to-end reference implementation of a vendor-neutral
product-knowledge compiler: photograph a physical product nameplate,
resolve the exact product, discover manufacturer-authoritative
documentation, ingest it without losing structure, and emit an
evidence-preserving artifact that can be consumed by MIRA, Claude,
ChatGPT, Gemini, local models, or future agent systems.

The PDF is an input format, not the product.

## Golden physical fixture

The supplied nameplate identifies:

-   Brand: eufy
-   Product: RoboVac 11S
-   Model/product number: T2108
-   Input: 19 V DC, 0.6 A
-   Power: 25 W
-   Battery: 14.4 V Li-ion, 2600 mAh
-   Manufacturer shown: Anker Innovations Limited
-   Made in China
-   CE/WEEE/indoor-use markings and a Part 15 statement are visible.
-   The serial number is instance-private data. Never copy it into a
    public product artifact.

eufy's current support material confirms the 11S is a non-Wi-Fi product,
making it a useful test of physical identification + public
documentation without relying on a connected-device account.

## Authoritative documentation seed set

Prefer manufacturer sources over mirrors.

### Official product support hub

https://service.eufy.com/product-description/a085g000000Nm4PAAS/robovac-11s

The support hub exposes manuals, T2108 declarations, tutorials,
maintenance/replacement videos, scheduling instructions, and
troubleshooting/FAQ material.

### Official-hosted English owner manual

https://d2211byn0pk9fi.cloudfront.net/spree/accessories/attachments/72623/T2108_Manual_51005000959_20180525_148x210mm_V02_EN.pdf?1533028783=

Identity: RoboVac 11S (T2108), document 51005000959, revision V02.

### Official support articles

Product/SN/PN identification:
https://service.eufy.com/article-description/How-to-Find-Your-Product-s-Serial-Number-SN-and-Product-Number-PN

T2108 battery connector:
https://service.eufy.com/article-description/How-to-unplug-the-battery-connector-of-T2108-Series

11S battery replacement:
https://service.eufy.com/article-description/RoboVac-Battery-Replacement-and-Installation-Video-for-11S-series

11S fan-motor disassembly/assembly:
https://service.eufy.com/article-description/RoboVac-11S-Series-How-do-we-disassemble-and-assemble-the-fan-motor

Remote troubleshooting:
https://service.eufy.com/article-description/What-should-I-do-if-the-remote-control-of-my-RoboVac-doesn-t-work

Remote compatibility:
https://service.eufy.com/article-description/How-to-order-a-remote-control-for-my-RoboVac

Filter compatibility:
https://service.eufy.com/article-description/How-to-order-a-Filter-for-my-RoboVac

Battery compatibility:
https://service.eufy.com/article-description/How-to-order-the-right-battery-for-my-RoboVac

Bounce-navigation explanation:
https://service.eufy.com/article-description/Why-does-my-RoboVac-vacuum-in-a-random-path-Bounce-Technology

11S/12/R450 quick-start support:
https://service.eufy.com/article-description/RoboVac-11S-12-R450-EU-Quick-Start-Guide

Official model comparison:
https://service.eufy.com/article-description/The-difference-between-the-X8-series-and-Eufy-s-other-RoboVac-models-take-the-RoboVac-11S-G30-Hybrid-and-L70-Hybrid-as-examples

### Secondary mirrors --- corpus-integrity tests only

https://manuals.plus/m/b2e7912ed063dd118eb8db05060c2c30f18865e60ea0b33d609cf6cf473b506e

https://www.manualslib.com/manual/1438799/Eufy-Robovac-11s-T2108.html

Mirrors must never multiply retrieval weight when they contain the same
underlying manual.

## Target experience

1.  User photographs a product/nameplate.
2.  Vision extracts identity candidates.
3.  Resolver identifies exact product/model/revision with confidence and
    evidence.
4.  Resolver discovers manufacturer-authoritative documentation.
5.  Sources are downloaded, fingerprinted and versioned.
6.  Ingestion preserves pages, sections, tables, figures, procedures and
    warnings.
7.  Product Knowledge Compiler emits a vendor-neutral artifact.
8.  Any compatible agent can query the artifact.
9.  Responses distinguish manufacturer facts, derived relationships,
    observations and agent reasoning.
10. Consequential answers trace back to source evidence.

## Standards doctrine

Do not create replacements for mature standards. Investigate and
compose:

-   JSON-LD/RDF semantics for globally meaningful entities and
    relationships.
-   JSON Schema for validation.
-   Schema.org Product/ProductModel where appropriate.
-   GS1 identifiers/Digital Link for product identity and resolution.
-   Digital Product Passport concepts where applicable.
-   Asset Administration Shell concepts for industrial assets.
-   OpenAPI for conventional device/service APIs.
-   MCP or successor protocols for live agent resources/tools.
-   URI/IRI identifiers for vocabulary terms.
-   hashes/signatures for integrity and publisher authenticity.

Use ordinary JSON as a convenient developer serialization, but design it
to be JSON-LD compatible. The schema and semantics are more important
than the bracket format.

## Working artifact: Agent-Readable Product Knowledge Package (ARPK)

The name is provisional. Do not hard-code product branding around it.

### Identity

Manufacturer, brand, family, model, variant, hardware revision, firmware
applicability, region, public identifiers, support URLs, lifecycle
status and supersession.

Separate PRODUCT identity from DEVICE INSTANCE identity.

### Evidence/provenance

Every important fact should be traceable to source URL, publisher,
document ID/revision, retrieval time, SHA-256, page, section, source
region/span, extraction method, confidence and authority class.

### Product model

Components, subassemblies, controls, indicators, sensors, actuators,
consumables, accessories, interfaces, specifications, states,
capabilities, limitations and typed relationships.

### Procedures/diagnostics

Procedures should carry prerequisites, safety prerequisites,
tools/parts, ordered steps, decision points, expected observations,
completion criteria and applicability.

Diagnostics should carry symptom, evidence, candidate causes, tests,
expected results, corrective actions and escalation criteria.

### Safety

Safety is first-class: hazard, required state, prohibited actions,
de-energization, stored energy, PPE when stated, prerequisite checks,
consequences and evidence.

### Agent interface

Provide deterministic operations for identity, product structure,
specifications, procedures, diagnostics, warnings, compatible parts,
evidence search and evidence-grounded Q&A.

Static product knowledge and live device control must remain separate.

## Epistemic truth model

Every claim returned to an agent must be classified:

-   **ASSERTED** --- directly supported by an authoritative source.
-   **DERIVED** --- normalized/inferred from asserted evidence by a
    declared transformation.
-   **REASONED** --- conclusion generated for a particular question.
-   **OBSERVED** --- observation/measurement of the particular physical
    instance.
-   **UNKNOWN/CONFLICTED** --- absent or contradictory evidence.

Never silently promote DERIVED or REASONED material to ASSERTED.

## Nameplate resolver

Use the supplied T2108 photo as the first golden fixture.

Requirements: - detect/rectify nameplate; - extract
brand/model/electrical identity candidates; - normalize formatting
without changing identity; - discover official manufacturer sources
first; - score candidate product matches; - cross-check model plus
electrical characteristics; - reject ambiguous matches; - preserve
resolution evidence; - allow user correction; - resolve to stable
product identity rather than merely a PDF URL; - discover all
authoritative documents for that identity; - work for manufacturers
never seen before.

Do not make a hand-maintained alias table the primary resolver.

## Source discovery ranking

1.  manufacturer official support/docs
2.  manufacturer CDN/object storage
3.  regulator/public authority
4.  authorized distributor
5.  reputable mirror
6.  community material

Lower-authority sources may aid discovery but must not silently override
manufacturer assertions.

## Ingestion fixes required

-   Make doc_id a first-class context/retrieval boundary.
-   Server-side SHA-256 content dedup.
-   Detect equivalent documents across mirrored URLs.
-   Preserve actual pages/page labels.
-   Table-aware and section-aware extraction.
-   Real section_path.
-   Figure/image references.
-   OCR fallback for scanned PDFs.
-   Honest failure if no usable content is extracted.
-   Durable/observable embedding retries.
-   Never report success while required representations are missing.
-   Preserve unknown manufacturers/models rather than coercing them.
-   Preserve private/public provenance end-to-end.
-   Remove navigation/retrieval assumptions that force is_private=false.
-   Do not require model metadata that generic upload never populated.

## Document-scoped chat

Ship a production-backed document list/detail surface with a
per-document Chat action. Retrieval must scope by doc_id, preserve the
real source frame, and cite filename + actual page/section. Use neutral
prompts for unknown vendors.

Treat document scope as the first implementation of a general context
boundary. Later boundaries include product, asset, machine, line, site,
work order and multi-document case.

## Product Knowledge Compiler

Pipeline: 1. source inventory 2. identity reconciliation 3. structural
extraction 4. table/figure extraction 5. fact extraction 6.
component/entity extraction 7. procedure extraction 8. diagnostic
extraction 9. safety extraction 10. typed relationship construction 11.
conflict detection 12. provenance attachment 13. schema validation 14.
artifact fingerprint/signature metadata 15. benchmark generation

Every ASSERTED fact must remain traceable to original evidence.

## Packaging

Prototype: - canonical JSON/JSON-LD artifact; - optional archive
containing manifest, structured knowledge, source index and disposable
search/embedding indexes.

Embeddings are caches, not truth. They must be regenerable.

## Authenticity

Design fields/hooks for source SHA-256, artifact SHA-256, publisher
identity, compiler/version, schema version, timestamps, source revision,
signatures, revocation and supersession.

Never represent a FactoryLM-compiled legacy artifact as
manufacturer-signed.

## T2108 golden benchmark

The system must answer with evidence: - What exact product is this? -
What input does it require? - What battery does it use? - How long can
it clean and charge? - Does it have Wi-Fi or mapping? - Why does it
appear to move randomly? - How do I clean the rolling brush and
sensors? - How do I replace/disconnect the battery? - What should I
check if the remote fails? - What do LED/error tones mean? - What should
I do if it stops while cleaning? - Which filter and remote are
compatible? - What safety requirements apply before maintenance?

Score identity, retrieval, citations, truth-class separation, safety
preservation, cross-document synthesis and unsupported-claim rate
separately.

## Cross-domain generalization benchmark

Run the same compiler/schema against: - eufy T2108; - one existing
PowerFlex manual; - one Siemens/Fuji/other industrial manual not
hand-tuned for this test; - one datasheet; - one SOP/policy-style
document.

Pass only if no manufacturer-specific top-level schema additions are
required. Extensions are allowed; the core remains vendor-neutral.

## Acceptance gates

**A --- Identity:** photo resolves to RoboVac 11S/T2108 and not 11S
Max/T2126 or 15C Max/T2128.

**B --- Authority:** official eufy sources outrank mirrors.

**C --- Corpus integrity:** duplicate/mirrored ingestion does not
multiply retrieval weight.

**D --- Structure:** tables, procedures, warnings and hierarchy survive
ingestion.

**E --- Provenance:** every ASSERTED benchmark answer traces to source +
page/section.

**F --- Scope:** T2108 document chat cannot retrieve unrelated Inbox
documents.

**G --- Unknown vendor:** unknown manufacturers remain unknown instead
of being coerced to aliases.

**H --- Safety:** summarization never weakens source safety
requirements.

**I --- Portability:** artifact validates and can be consumed outside
FactoryLM.

**J --- Model neutrality:** at least two provider/model adapters answer
from the same artifact without artifact changes.

## Synthetic testing roles

-   Resolver agent: imperfect nameplate identification.
-   Corpus auditor: duplicate/wrong-revision/wrong-product detection.
-   Technician/user agent: realistic questions.
-   Adversarial agent: prompts tempting unsupported inference.
-   Safety auditor: warning preservation.
-   Citation auditor: source/page support.
-   Schema generalization agent: hunts vendor-specific assumptions.
-   Artifact consumer: consumes only exported artifact, never FactoryLM
    DB internals.

Classify failures as IDENTITY, DISCOVERY, INGEST, STRUCTURE, METADATA,
RETRIEVAL, PROVENANCE, SAFETY, REASONING, SCHEMA or PORTABILITY.

## Delivery phases

### Phase 0 --- Audit and freeze

Read the existing generic-upload design, #3176/#3177/#3183 work, current
schemas, retrieval functions and beta gates. Write a short
implementation delta. Do not duplicate existing capabilities.

### Phase 1 --- Make one document trustworthy

Implement doc-scoped retrieval/chat, real document UI, SHA-256 dedup,
honest scanned-PDF behavior and source-frame citation assertions. Prove
with T2108.

### Phase 2 --- Compile useful product knowledge

Add metadata extraction, table/section-aware ingestion, OCR fallback,
durable embeddings and ARPK v0.1 compiler/validator. Run T2108
benchmark.

### Phase 3 --- Prove universality

Run cross-domain benchmark. Remove assumptions discovered by the test.
Add a standalone artifact reader and second model/provider adapter.

### Phase 4 --- Identity-to-artifact

Wire nameplate image -\> product resolution -\> official source
discovery -\> compile -\> chat. Use the supplied T2108 photo as a
committed test fixture only if repository privacy policy allows it;
otherwise create a redacted derivative fixture.

### Phase 5 --- Standards track

Write a concise standards mapping and ARPK v0.1 specification. Identify
what should be delegated to GS1/JSON-LD/Schema.org/AAS/DPP/MCP/OpenAPI
instead of reinvented.

Do not market this as a universal standard yet. First prove the
representation survives unrelated products and documents.

## Claude Code execution instructions

1.  Start by reading
    `docs/plans/2026-08-10-chat-with-any-manual-design.md` and the
    relevant held PRs/issues.
2.  Inspect actual code paths and migrations before proposing changes;
    do not trust comments or stale docs over production behavior.
3.  Verify the live `kg_entities.approval_state` default and
    `MIRA_ENFORCE_APPROVED_*` behavior before modifying upload/chat.
4.  Preserve current industrial doctrine: this is a generalized
    context-layer capability, not a consumer-product marketing pivot.
5.  Prefer reuse/refactor of existing chunker, retrieval, citation,
    ontology and test infrastructure over parallel implementations.
6.  Make small reviewable commits by phase.
7.  Add migration safety/rollback notes for DB changes.
8.  No production deploy and no merge without explicit authorization.
9.  At each phase, report measured before/after benchmark results and
    blockers.
10. If evidence contradicts this PRD, stop, document the contradiction,
    and propose the smallest correction rather than forcing the
    implementation.

## Definition of done for this experiment

A fresh checkout can take the T2108 nameplate fixture, resolve the
correct product, discover/download authoritative eufy documentation,
compile a validated portable artifact, and answer the golden questions
with real evidence. The same compiler then processes unrelated
industrial documentation without vendor-specific core-schema changes.

That is the proof that FactoryLM is moving from "PDF chat" toward an
intelligence-neutral product context standard.
