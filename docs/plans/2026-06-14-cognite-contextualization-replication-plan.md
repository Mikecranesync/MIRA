# Replicating Cognite's "Document → Tag Matching" in MIRA

**Status:** ANALYSIS + BUILD PLAN — planning only, no production code yet
**Authored:** 2026-06-14
**Owner:** Mike Harper
**Trigger:** Cognite keynote "The Product Vision to Fully Unlock Industrial AI" (Impact 2025, Oct 24 2025, ~75 min, CPO Chirayu Shah + CTO of AI Geir Engdahl). The capability flagged — "matching uploaded documents to tags" — is Cognite's **contextualization / entity matching** engine.
**Companion docs (read in this order):** `docs/THEORY_OF_OPERATIONS.md` → `docs/specs/maintenance-namespace-builder-spec.md` → `docs/specs/knowledge-graph-spec.md` → `docs/specs/uns-kg-unification-spec.md` → `docs/plans/2026-06-01-mira-master-architecture-plan.md`

---

## 0. How to read this document

Two parts, as requested:

- **Part A — Strategy overview** (§1–§4): what Cognite actually demos, why it maps almost 1:1 onto MIRA, where MIRA already wins and where it's behind, and how this makes money.
- **Part B — Full build spec** (§5–§11): Cognite's matching engine step by step, a capability-by-capability mapping to MIRA's existing code/tables, the gap list, and a phased build plan with verify steps you can hand straight to a coding session.

**Honesty note on sourcing.** The keynote video has captions disabled, so there is no verbatim transcript to quote. This plan is grounded in (1) Cognite's *public product documentation* on contextualization and entity matching, (2) press coverage of Impact 2025, and (3) MIRA's own `CLAUDE.md`, specs, and master plan. The keynote's specific demo choreography is inferred from Cognite's documented product surface — which is the thing you'd actually copy anyway. Sources are listed at the bottom.

---

# PART A — STRATEGY OVERVIEW

## 1. What "matching documents to tags" really is

In Cognite's language it's **contextualization**: taking messy data from many source systems (PDFs, manuals, P&IDs, time series, work orders, 3D models) and connecting every piece to the **same canonical asset identity**. The sub-capability you saw — linking an uploaded document to equipment tags — is **entity matching**: an ML + rules engine proposes "this document / this tag / this time series **belongs to** that asset," a domain expert confirms it, and the confirmed links become the trusted data foundation that the AI agents then reason over.

The one-sentence version of Cognite's whole thesis: **intelligent data first, agents second.** You cannot get a trustworthy industrial AI answer until every document, signal, and drawing is wired to the right asset. Matching is how you wire it.

**This is MIRA's thesis already.** Your UNS location-confirmation gate, your `kg_entities`/`kg_relationships` proposed→verified flow, and your readiness levels (the Hub literally showed "L5 — Proposal flywheel … once verified outnumber proposed you cross L6") are the *same* idea: ground everything in confirmed asset context before you answer. You are not copying a foreign system — you are completing one you've already started.

## 2. Why MIRA is ~70% of the way there

| Cognite building block | MIRA equivalent that already exists | Where |
|---|---|---|
| Canonical asset identity every entity maps to | **UNS** (ISA-95 ltree paths) | `mira-crawler/ingest/uns.py`, `mira-bots/shared/uns_resolver.py` |
| "Belongs-to" relationships between resources | **KG** `kg_entities` + `kg_relationships` | migrations 004 / 005 (NeonDB) |
| ML/rules propose, domain expert validates | **AI suggestions** with `proposed→verified` human gate | `ai_suggestions` table, `/proposals` Hub surface, ADR-0017 transitions |
| Extract facts from documents/diagrams | **Ingestion pipeline** (chunk, page-ref, confidence, UNS-tag) | `mira-crawler/ingest/`, `mira-core/mira-ingest/` |
| Reusable contextualized asset model | **Component profiles** (per-instance / per-model) | `.claude/skills/component-profile-builder` |
| Agents reasoning over the trusted graph | **Supervisor engine** + grounded troubleshooting | `mira-bots/shared/engine.py`, `citation_compliance.py` |

What this means: you do **not** need to build Cognite. You need to add an explicit **matching layer** on top of the UNS + KG you already have, plus a review surface, plus (later) diagram parsing. That's the gap in §6.

## 3. Where MIRA wins vs. where Cognite wins

**MIRA already wins on:**
- **Grounding discipline.** The non-negotiable UNS confirmation gate is stricter than anything Cognite enforces — you refuse to troubleshoot until context is confirmed. That's a *feature* to sell, not a limitation.
- **Slack/Telegram-first technician UX.** Cognite is a heavy data-platform UI. You meet the tech on their phone in the plant.
- **Cost moat.** Free inference cascade (Groq → Cerebras → Gemini) vs. Cognite's enterprise platform pricing. You can give the matching engine away to win the data foundation.
- **Citation/groundedness scoring** baked into every reply.

**Cognite wins on (the real gaps):**
- **A true entity-matching model** with tunable similarity scoring and a confidence threshold — not just text→manufacturer/model resolution.
- **Pipelines that rerun and learn** from confirmed matches over time (supervised improvement).
- **A rules engine** that auto-matches future data by pattern.
- **Interactive P&ID / engineering-diagram parsing** (detect tags in a drawing, link to assets, click-through overlay).
- **Scale + polish** of the review UI.

The strategy: **copy the five gaps, keep your moats.**

## 4. How this makes money

The matched, verified graph **is** the product. Same flywheel as `NORTH_STAR.md`:

1. **Wedge (free / low-friction):** customer drops manuals, PDFs, P&IDs, work-order exports into MIRA. The matching engine auto-links them to their equipment and asks the tech to confirm a handful of suggestions. Instant "wow" — their dead document pile becomes a live, queryable asset graph.
2. **Lock-in:** every confirmation makes the graph more valuable and more theirs. Readiness levels (L5→L6→…) gamify it. Switching cost compounds.
3. **Expansion / revenue:** once the graph is verified, the grounded agent (Ask MIRA) answers troubleshooting with citations the customer trusts — because *they* built the links. That's the paid seat. Component profiles become reusable templates you resell across customers.

The doc→tag matcher is the **top of the funnel that fills the graph that powers the agent that earns the money.** Build it first.

---

# PART B — FULL BUILD SPEC

## 5. Cognite's matching engine, step by step (the thing to copy)

Paraphrased from Cognite's public entity-matching docs. This is the workflow MIRA needs an equivalent of.

**5.1 Pick a matching mode**
- **Quick match** — one-time match of a resource (or set) to assets; model is not saved.
- **Pipeline** — a saved matcher bound to a data set; **rerun it when new data arrives**, and it improves from confirmed matches.
- **3D match** — map nodes of a 3D model to assets (out of scope for MIRA near-term).

**5.2 Select source entities + target assets**
Choose what you're matching *from* (documents, time series, events, tabular rows) and what you're matching *to* (the asset hierarchy).

**5.3 Configure the matching model**
- Choose the **fields** to compare (default: `name` similarity; can add more).
- **Unsupervised** by default; optionally **"use matched resources as training data"** to go **supervised** and learn from already-confirmed links.
- Pick a **similarity scoring model**, fastest → slowest / least → most accurate:
  - **Simple** — score on identical letter/digit token sequences.
  - **Insensitive** — Simple, case-insensitive.
  - **Bigram** — adds similarity on adjacent token pairs (so `AA-11-BB` is closer to `AA-11-CC` than to `AA-00-BB`).
  - **Frequency-weighted bigram** — bigram, but rarer tokens count more.
  - **Bigram + extra tokenizers** — learns to ignore leading zeros, spaces, case.
  - **Bigram combo** — computes all of the above and lets the model pick features (best when you have training matches).
- Optional **rule generation** — the model emits regex rules; a confirmed rule auto-matches any future data that fits the pattern.

**5.4 Generate + validate suggestions**
Suggestions are surfaced in priority order: **confirmed matches → confirmed patterns → model predictions.** The reviewer filters by **All / Matched / Unmatched / Different-recommendation**, can **group by pattern**, sees a **confidence** per suggestion, confirms (✓) into a **draft** set, then **saves to the store**. Human-in-the-loop is mandatory — exactly your `proposed→verified` rule.

**5.5 Rerun + learn**
New data into the data set → **rerun pipeline** → new suggestions, now informed by every prior confirmation.

**5.6 Diagram/P&ID parsing (separate but related)**
Detect tag strings in static PDF P&IDs, link each detected tag to its asset, and render an **interactive** diagram you can click through on any device. An ML classifier labels P&ID document types automatically.

**5.7 Agent layer (Atlas AI)**
A low-code "agent workbench" runs agents over the now-trusted knowledge graph to automate workflows (root-cause, procedure lookup, etc.). MIRA's Supervisor engine is the equivalent — it just needs the richer matched graph underneath.

## 6. Capability-by-capability mapping + gap list ("line by line")

Legend: ✅ have · ⚠️ partial · 🔲 missing

| # | Cognite capability | MIRA today | Status | Gap to close |
|---|---|---|---|---|
| 1 | Canonical asset identity | UNS ltree paths via `uns.py` builders | ✅ | none |
| 2 | Resolve text → vendor/model/fault | `uns_resolver.py` (`UNSContext`, confidence band) | ✅ | none |
| 3 | **General entity matcher** (score arbitrary doc/tag ↔ existing asset instance) | resolver maps text→KB taxonomy, but **no fuzzy matcher to the customer's own asset instances** | 🔲 | **build the matcher service** (§7) |
| 4 | Tunable similarity models (simple→bigram-combo) | n/a | 🔲 | implement scorers (§7.2) |
| 5 | Confidence score + threshold on each suggestion | confidence exists on ingestion/KG rows | ⚠️ | expose a **threshold slider** + per-suggestion score in review |
| 6 | Suggestions surfaced, human confirms | `ai_suggestions` + `/proposals` + ADR-0017 transitions | ✅ | reuse — add match-specific suggestion_type |
| 7 | Supervised learning from confirmed matches | one-shot proposals from ingestion | 🔲 | **feed confirmations back** as training signal |
| 8 | Pipelines: rerun on new data | ingestion is per-upload; no rerun loop | ⚠️ | add a **matching pipeline** entity bound to a data set |
| 9 | Rules engine (regex auto-match patterns) | none | 🔲 | **rule generation + auto-confirm** (§7.4) |
| 10 | Group-by-pattern / filter (Matched/Unmatched/Different-rec) | `/proposals` lists suggestions | ⚠️ | add filters + grouping to Hub review |
| 11 | Extract facts from docs (chunk, page-ref, confidence) | `mira-crawler/ingest/` | ✅ | none |
| 12 | De-dup before insert | `mira-crawler/ingest/dedup.py` | ✅ | none |
| 13 | Interactive P&ID / diagram tag detection | photo ingest + docling; **no tag-bbox detection or interactive overlay** | 🔲 | **diagram parser** (§9, later phase) |
| 14 | Reusable contextualized asset template | component profiles | ✅ | feed matcher output into profiles |
| 15 | Agent over trusted graph | Supervisor engine | ✅ | richer graph improves it automatically |

**Five real gaps to build: #3/#4 (matcher + scorers), #7/#8 (pipelines + learning), #9 (rules), #10 (review UX), #13 (diagram parsing).**

## 7. The matcher — design (Phase 1, the core)

**Where it lives:** new module `mira-mcp/` tool + service, e.g. `mira-crawler/match/` for the engine and a `mira-mcp/server.py` tool to invoke it. Postgres-first (NeonDB) per master-plan constraint #1 — **no Neo4j**.

**7.1 Data model (new tables / columns; migrations dev→staging→prod via `apply-migrations.yml`)**

```
match_pipeline
  id, tenant_id, name, source_kind ('document'|'chunk'|'detected_tag'|'time_series'|'work_order'),
  target_kind ('asset'|'component'),  dataset_filter (jsonb),
  scorer ('simple'|'insensitive'|'bigram'|'freq_bigram'|'bigram_extra'|'bigram_combo'),
  match_fields (text[]),  supervised (bool),  created_by, created_at

match_suggestion
  id, pipeline_id, tenant_id,
  source_ref (entity id / chunk id / file id),  source_text,
  target_uns_path (ltree)  OR  target_equipment_entity_id (fk),
  score (numeric 0..1),  status ('proposed'|'confirmed'|'rejected'|'needs_review'),
  matched_by_rule_id (nullable fk),  evidence (jsonb: fields used, token overlap, page ref),
  created_at, decided_by, decided_at

match_rule
  id, pipeline_id, tenant_id, regex (text), description, confidence,
  status ('proposed'|'confirmed'|'rejected'), auto_confirm (bool), created_at
```

Reuse, don't reinvent: surface `match_suggestion` to the user **through the existing `ai_suggestions` pipeline** (add a `suggestion_type` value such as `entity_match`) so the Hub `/proposals` page and the ADR-0017 status-transition helpers (`mira-hub/lib/proposal-transition.ts`, `mira_bots/shared/proposal_transition.py`) handle it for free. **Never** `UPDATE … SET status` directly — go through the helper (per `.claude/CLAUDE.md`).

**7.2 Similarity scorers** (`mira-crawler/match/scorers.py`, pure functions, ruff-clean, Python 3.12)
Implement the ladder: `simple`, `insensitive`, `bigram`, `freq_bigram`, `bigram_extra`, `bigram_combo`. Tokenize with the **same** `uns.slug()` rules so matching and path-building agree (per `.claude/rules/uns-compliance.md`). Each scorer returns 0..1. No ML framework — these are token/bigram functions, not TensorFlow (PRD §4 bans it). `bigram_combo` can be a weighted blend; only reach for a learned weight once you have confirmations (§7.3).

**7.3 Supervised signal** — when a suggestion is confirmed/rejected in `ai_suggestions`, write the (source_text, target, decision) back as training rows. On pipeline rerun, weight scorer features toward what the confirmations support. Keep it simple (logistic weighting over scorer outputs), not a deep model.

**7.4 Rules engine** — when several confirmed matches share a regex-able pattern (e.g. `^PF525-\d{3}$ → PowerFlex 525 line`), propose a `match_rule`. A confirmed rule with `auto_confirm` short-circuits future suggestions (status `confirmed`, `matched_by_rule_id` set) — mirrors Cognite's "confirmed patterns" priority tier. **Auto-confirm by rule is allowed; auto-*verify* into the KG is still a human action** (constraint #7 / `.claude/CLAUDE.md` "no auto-promote proposed→verified").

**7.5 Verify (Phase 1 done = )**
- Golden set: hand-label ~40 (document/tag → asset) pairs from a real customer dump; add as `tests/golden_match.csv`.
- Matcher precision/recall reported on the golden set; pick the default scorer empirically.
- Round-trip test: upload → suggestions appear in `/proposals` → confirm → `kg_relationships` row lands `proposed` (not `verified`) with evidence + score.
- Staging gate (`smoke-test.yml` + eval) green before merge to `main`.

## 8. Phased build plan

| Phase | Goal | Lives in | Done when |
|---|---|---|---|
| **1. Matcher core** | Score source↔asset, write `match_suggestion`, surface via `ai_suggestions` | `mira-crawler/match/`, migration, `mira-mcp` tool | golden-set precision/recall reported; round-trip confirm → `proposed` KG edge |
| **2. Review UX** | Confirm/reject in Hub with score, threshold slider, filters (All/Matched/Unmatched/Different-rec), group-by-pattern | `mira-hub` `/proposals` extension | tech can clear 50 suggestions in <5 min; screenshots to `docs/promo-screenshots/` |
| **3. Pipelines + learning** | Saved matcher per data set; rerun on new uploads; learn from confirmations | `match_pipeline` + worker | rerun finds new matches; confirmed matches measurably lift precision |
| **4. Rules engine** | Propose regex rules; auto-confirm future matches by confirmed pattern | `match_rule` + scorers | a confirmed rule auto-matches new conforming data on rerun |
| **5. Diagram/P&ID parsing** | Detect tags in PDF drawings, link to assets, interactive overlay | new `mira-crawler/ingest/diagrams.py` + Hub viewer | upload a P&ID → detected tags become confirmable suggestions → click-through diagram |
| **6. Agent leverage** | Ask MIRA answers richer because the graph is denser | existing `engine.py` (no new gate logic) | grounded answers cite matched docs; groundedness score holds/improves |

Sequencing rationale: 1→2 gives a demoable "drop docs, confirm, watch your graph fill" loop (the money wedge) fast. 3→4 add the compounding/learning moat. 5 is the visual showstopper but heaviest; do it once the loop converts. 6 is mostly free once the graph is fuller.

## 9. Diagram parsing notes (Phase 5, when you get there)
- Render PDF pages, OCR text + bounding boxes (you already run docling/`mira-docling`; extend it — don't add a new heavy dep).
- Detect tag-shaped tokens (reuse `uns_resolver` fault/model heuristics + `uns.slug`), emit each as a `detected_tag` source entity into the **same** matcher (§7) → suggestions → confirm.
- Store bbox + page so the Hub can render an interactive overlay (clickable tags → asset detail). This is where Cognite's demo "wow" comes from; it's a viewer on top of the same match data, not a separate system.

## 10. Constraints this plan must honor (do not violate)
- **Postgres-first** (NeonDB). No Neo4j/graph DB until master-plan Phase 13, only if proven necessary.
- **No LangChain / TensorFlow / n8n.** Scorers are plain Python; "ML" here = token/bigram features + logistic weighting.
- **Inference cascade Groq → Cerebras → Gemini. Never Anthropic** (removed PR #610). The matcher is mostly deterministic; any LLM assist (e.g. tie-breaking) goes through the cascade router with sanitization on.
- **UNS compliance.** Paths only via `uns.py` builders; tokenize via `uns.slug()`; never hand-format `enterprise.*`.
- **No auto-verify.** Rules may auto-*confirm a match suggestion*; promotion `proposed→verified` in `kg_*` stays a human action through the ADR-0017 helper.
- **Env discipline.** Migrations + seeds dev → staging → prod; never `psql` prod from a code session; prove BM25/retrieval on staging first (lesson of issue #1385).
- **Screenshot rule** for any Hub UI change.

## 11. Open questions (resolve before Phase 1 code)
1. **Primary source kind first?** Manuals/PDF chunks (closest to your current ingest) vs. work-order exports vs. detected P&ID tags. Recommend **PDF/manual chunks** — least new plumbing, fastest demo.
2. **Match target granularity:** asset instance only, or also component (per-instance vs per-model profile)? Recommend asset instance for Phase 1.
3. **Where does the reviewer live** — Hub `/proposals` only, or also a Slack confirm affordance for techs? Recommend Hub for Phase 1–2, Slack later.
4. **Single-tenant or multi-tenant matcher** at launch? (`tenant_id` is in the schema either way.)
5. Do we fold this into the **maintenance-namespace-builder** plan (`docs/plans/2026-05-15-…`) as its matching sub-phase, or keep a standalone plan? Recommend folding in so readiness levels and `/proposals` stay one surface.

---

## Sources
- Cognite — *About contextualization* (CDF docs): https://docs.cognite.com/cdf/integration/concepts/contextualization
- Cognite — *Match entities* guide (6-step workflow, similarity models, rules, pipelines): https://docs.cognite.com/cdf/integration/guides/contextualization/match_entities/
- Cognite — *Data contextualization* (product page): https://www.cognite.com/en/contextualization
- Cognite — *Atlas AI major release* (agent workbench over the knowledge graph): https://www.cognite.com/en/company/newsroom/cognite-atlas-ai-drives-customer-momentum-with-new-major-release
- Cognite — *Impact 2025* newsroom (agentic AI, customer showcases): https://www.cognite.com/en/company/newsroom/agentic-ai-takes-center-stage-at-cognite-s-global-impact-2025-conference-to-showcase-industrial
- Techzine — *Cognite Impact 2025* coverage: https://www.techzine.eu/blogs/data-management/135432/cognite-impact-2025-fusing-new-metal-inside-the-industrial-ai-furnace/
- Source video: *The Product Vision to Fully Unlock Industrial AI*, Cognite, YouTube `1-7prszGruQ` (captions disabled — no verbatim transcript available)
- MIRA internal: `CLAUDE.md`, `.claude/CLAUDE.md`, `docs/specs/maintenance-namespace-builder-spec.md`, `docs/plans/2026-06-01-mira-master-architecture-plan.md`, `.claude/rules/uns-compliance.md`
