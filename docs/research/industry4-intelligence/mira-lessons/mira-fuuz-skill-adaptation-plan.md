# MIRA Skill Adaptation Plan — Inspired by Fuuz's Public Skill Library

> Concrete proposal for MIRA's `.claude/skills/` library taking shape from the Fuuz pattern. **Not** "copy Fuuz's skills." Rather: borrow the *structure*, *rigor*, and *naming discipline*; replace platform-bound content with MIRA-bound content; add what MIRA needs that Fuuz doesn't have.
>
> Last refreshed 2026-05-20. Authored by claude-code after deep-dive on `fuuz-skills` repo.

---

## Design principles (borrowed from Fuuz, adopted by MIRA)

1. **Numbered rules.** Every skill leads with a "Golden Rules" or "Anti-Hallucination" block, rules numbered (XX-1, XX-2, …) per skill prefix.
2. **Anti-hallucination first.** Lead block prevents the LLM from inventing artifacts the user didn't ask for.
3. **"Ask the developer" rules** are explicit and mechanical, not soft guidance.
4. **References folder** for deep dives — SKILL.md is the rule index; `references/*.md` are the deep references.
5. **YAML frontmatter with `version`, `name`, `description`** on every SKILL.md.
6. **Central manifest** (`.claude/skills/MANIFEST.md`) tracks version, status, last update, deployed-to.
7. **Examples are concrete** — every rule has at least one WRONG / CORRECT pair where applicable.
8. **Each skill cross-references the others** via a small router file (`references/cross-skill-index.md`).

---

## Proposed MIRA skill roster (10 skills)

Skills MIRA **already has** are marked existing; gaps are marked new. Where existing, the suggestion is to upgrade per the principles above.

| # | Skill | Status | Purpose | Inspired by Fuuz skill |
|---|---|---|---|---|
| 1 | `mira-platform-utilities` | **NEW** | Router + helpers index | `fuuz-platform` |
| 2 | `mira-uns-resolver` | existing as rules | UNS path discipline, vendor/model/fault extraction | `fuuz-industrial-ops` (uns-patterns) |
| 3 | `mira-component-template-builder` | existing partial (`component-profile-builder`) | Build valid component templates with evidence + confidence + promotion state | `fuuz-packages` |
| 4 | `mira-knowledge-graph-proposer` | existing | Propose `kg_entities` / `kg_relationships` with strict promotion discipline | `fuuz-schema` |
| 5 | `mira-manual-ingestion-extractor` | existing | Extract structured facts from manuals with citations | `fuuz-industrial-ops` + custom |
| 6 | `mira-plc-tag-mapper` | existing | Map PLC tags to UNS paths + components | `fuuz-industrial-ops` |
| 7 | `mira-work-order-miner` | existing (`work-order-history-miner`) | Extract maintenance intelligence from CMMS history | custom (no Fuuz analogue) |
| 8 | `mira-grounded-answer-builder` | existing partial (`slack-technician-ux-writer`) | Compose Slack replies that pass the grounded-by-default contract | `fuuz-screens` (in spirit) |
| 9 | `mira-uns-location-gate-designer` | existing | Maintain the UNS confirmation gate in engine + bot adapters | custom (uniquely MIRA) |
| 10 | `mira-bot-grounding-tests` | existing | GS11 regression net + agent-discovery surface | custom (no Fuuz analogue) |

Many of these exist today. The plan below details how to **upgrade** each to the level of the Fuuz reference standard.

---

## Skill 1 — `mira-platform-utilities` (NEW)

### Purpose
Be the **first skill Claude consults** when extending MIRA. Routes to other skills + names the platform helpers Claude should reach for first (preventing Rube-Goldberg solutions per Pattern A-7).

### Triggers
- "extend MIRA," "write a MIRA helper," "add a new bot feature," "modify the engine"
- Any prompt that touches `mira-bots/shared/`, `mira-crawler/ingest/`, or `mira-mcp/server.py`

### Lead rules
- **PU-1 — Never reinvent path builders.** Routes to `mira-uns-resolver`.
- **PU-2 — Never reinvent dedup.** Use `mira-crawler/ingest/dedup.py`.
- **PU-3 — Never reinvent citation formatting.** Use `mira-bots/shared/citation_compliance.py`.
- **PU-4 — Never call an LLM provider directly.** Use `mira-bots/shared/inference/router.py` (the Groq → Cerebras → Gemini cascade).
- **PU-5 — Never hand-write a NeonDB connection.** Use the existing pool + `NullPool` config (per `python-standards.md`).
- **PU-6 — Ask the developer** before adding new dependencies, new Doppler secrets, or new tenants.

### Reference files
- `references/helper-catalog.md` — every shared helper in MIRA with one-line purpose + path.
- `references/cross-skill-index.md` — "if the user asks about X, invoke skill Y first."
- `references/architecture-cheatsheet.md` — the layer diagram (Slack → engine → KG → MCP → NeonDB) with current line counts for sanity-check.

### Effort to build
~4 hours (mostly compiling the helper catalog from existing code; the cross-skill router is short).

---

## Skill 2 — `mira-uns-resolver` (existing as `uns-compliance.md` rules → promote to skill)

### Purpose
Codify the rules every UNS-touching code path must follow. Today this lives in `.claude/rules/uns-compliance.md` — promote to a full skill with reference files.

### Triggers
- "build a UNS path," "extract vendor/model/fault from a message," "extend uns_resolver," "modify uns.py"
- Edits to `mira-bots/shared/uns_resolver.py`, `mira-crawler/ingest/uns.py`, anything that hand-formats a UNS path

### Lead rules (rewrite from current `uns-compliance.md`, numbered)
- **UC-1 — NEVER hand-format UNS paths.** Use `uns.manufacturer_path()`, `uns.model_path()`, `uns.fault_code_path()`, etc.
- **UC-2 — One extraction point per turn.** Resolve once in `uns_resolver`; downstream reads from `state["uns_context"]`.
- **UC-3 — Slugs go through `uns.slug()`.** No ad-hoc `.lower().replace(...)`.
- **UC-4 — Fault codes extracted BEFORE model candidates.** (Specific historical bug.)
- **UC-5 — Pure-digit models are valid when adjacent to a known vendor/family.** (Specific historical bug.)
- **UC-6 — Reserved labels are off-limits.** Check `uns.RESERVED_LABELS` before slugging.
- **UC-7 — Lowercase only in paths.** Display strings can be cased.
- **UC-8 — Offline mode is the floor.** DB enrichment is additive; resolver must work without NeonDB.
- **UC-9 — Confidence is a band, not a numeric score.** Use bands from `docs/specs/uns-message-resolver-spec.md §2.4`.
- **UC-10 — Optional UNS levels use a sentinel** (e.g., `nocell`), not omitted segments. (NEW — from Fuuz Pattern U-2.)

### Reference files
- `references/path-builders.md` — every `uns.*_path()` function + usage.
- `references/historical-bugs.md` — the F0004-as-model bug, the PowerFlex-525 bug, why each rule exists.
- `references/envelope-schema.md` — the standard MIRA UNS event envelope (NEW — from Fuuz Pattern U-3).

### Effort
~6 hours (most rules exist; numbering + envelope schema is the addition).

---

## Skill 3 — `mira-component-template-builder` (existing as `component-profile-builder` → upgrade)

### Purpose
Build valid component templates that satisfy:
- Evidence-based fields (every field traces to a manual / tag / work order / technician).
- Promotion-state discipline (proposed → verified is admin-gated).
- Per-instance vs per-model distinction (don't conflate `pf-525-line2-asset123` with the model template `PowerFlex 525`).

### Triggers
- Existing triggers + "build a component template," "import a manual into a template," "promote a proposal."

### Lead rules (modeled on `fuuz-packages` golden rules)
- **CT-1 — Every field has an evidence source.** No invented values.
- **CT-2 — `confidence` is required.** Low/medium/high per `uns-message-resolver-spec`.
- **CT-3 — `promotion_state` defaults to `proposed`.** Only humans transition to `verified`.
- **CT-4 — Per-instance vs per-model is explicit.** Decide before building.
- **CT-5 — Citations include page/section.** No "see the manual."
- **CT-6 — Unknown is `unknown`, not best-guess.**
- **CT-7 — Ask the developer about ambiguity.** Conflicting evidence → ask, don't pick.
- **CT-8 — NEVER hallucinate manufacturer/model strings.** Only from manual / nameplate / PLC tag / technician.
- **CT-9 — Template export must round-trip.** A downstream LLM should be able to summarize the template back to the original facts (Fuuz Pattern A-8).
- **CT-10 — UoM as FK, never string** (Fuuz Pattern D-3).
- **CT-11 — `_external_refs` JSONB** for site-specific extensions; never bake them into core schema (Fuuz Pattern D-7).
- **CT-12 — `deletionReferenceBehavior` explicit per relationship** (Fuuz Pattern D-8).

### Reference files
- `references/template-schema.md` — JSON schema with annotated examples.
- `references/evidence-table.md` — types of evidence and how each carries citation metadata.
- `references/promotion-workflow.md` — proposed → verified flow with admin-action diagram.
- `references/round-trip-test.md` — how to verify a template summarizes back faithfully.

### Effort
~2 weeks (the existing `component-profile-builder` is a good foundation; the upgrade is rigor + reference files + the round-trip test).

---

## Skill 4 — `mira-knowledge-graph-proposer` (existing → upgrade)

### Purpose
Propose entries to `kg_entities` and `kg_relationships`. Strict promotion + evidence + confidence discipline.

### Lead rules (modeled on `fuuz-schema`)
- **KG-1 — Default `status` is `proposed`.** Auto-verify is forbidden.
- **KG-2 — Evidence is required.** Source doc + page, or work-order id, or technician-confirmation id.
- **KG-3 — Confidence band required.** Match column convention (string `low`/`med`/`high` or numeric per surrounding code).
- **KG-4 — FK inverse must exist** (Fuuz Pattern D-2). Audit before adding new FK columns.
- **KG-5 — Cascade vs prevent is explicit** per relationship (Fuuz Pattern D-8).
- **KG-6 — Ask the developer about ambiguous relationships.** Don't silently pick.
- **KG-7 — Dedup before insert.** Check `kg_writer.py` patterns.
- **KG-8 — Cross-tenant references are one-way only** (Fuuz Pattern D-13).
- **KG-9 — Promotion to `verified` is a Hub admin action**, not autonomous.

### Reference files
- `references/kg-schema.md` — current schema + migration ADR pointers.
- `references/promotion-state-machine.md` — proposed → verified → rejected → needs_review.
- `references/dedup-strategy.md` — how `kg_writer.py` dedups today.

### Effort
~1 week.

---

## Skill 5 — `mira-manual-ingestion-extractor` (existing → upgrade)

### Purpose
Extract structured facts from manuals/PDFs with full citation.

### Lead rules
- **MI-1 — Preserve source on every fact.** Page/section ref required.
- **MI-2 — Don't invent missing data.** `unknown` is valid.
- **MI-3 — Confidence band on every extraction.**
- **MI-4 — Tag every chunk with a UNS path.**
- **MI-5 — Dedup before insert.**
- **MI-6 — Normalize into a component template** when the source supports it.
- **MI-7 — Three-tier raw type for telemetry data** (numeric / bool / string — Fuuz Pattern D-11) when manual references PLC tags.

### Reference files
- `references/extraction-schema.md`
- `references/chunker-rules.md`
- `references/citation-format.md`

### Effort
~1 week (skill exists; the upgrade is rigor + numbered rules).

---

## Skill 6 — `mira-plc-tag-mapper` (existing → upgrade)

### Purpose
Map PLC tags to UNS paths and components.

### Lead rules
- **PT-1 — Never invent tag-to-component mappings.** Require nameplate / manual / technician.
- **PT-2 — Tags exported as CSV go through `uns.py` builders.** No ad-hoc paths.
- **PT-3 — Mapping is per-instance, not per-model** (unless customer explicitly wants per-model templating).
- **PT-4 — Confidence band on every mapping.**
- **PT-5 — Quality codes carried through to UNS** (Fuuz Pattern U-10).

### Reference files
- `references/csv-import-flow.md`
- `references/ignition-tag-naming.md`

### Effort
~3 days.

---

## Skill 7 — `mira-work-order-miner` (existing as `work-order-history-miner` → upgrade)

### Purpose
Extract maintenance intelligence from CMMS history. (No direct Fuuz analogue — this is MIRA's unique surface.)

### Lead rules
- **WO-1 — Source CMMS is named in every extracted fact.** (Atlas vs MaintainX vs Limble.)
- **WO-2 — Reason-code normalization required.** Map customer-specific to ISO-14224-aligned categories.
- **WO-3 — Deadband on auto-creation events** (Fuuz Pattern U-9 transposed). If the same maintenance signal fires repeatedly, dedup.
- **WO-4 — MTBF / MTTR computed via standard formula** (Fuuz fuuz-industrial-ops reference). Don't reinvent.
- **WO-5 — Cross-link to UNS** — every work order extracted gets a UNS path.

### Reference files
- `references/cmms-source-adapters.md` — Atlas, MaintainX, Limble, Fiix
- `references/reliability-formulas.md` — MTBF, MTTR, availability, OEE-pieces

### Effort
~1 week.

---

## Skill 8 — `mira-grounded-answer-builder` (existing as `slack-technician-ux-writer` → upgrade)

### Purpose
Compose Slack replies that:
- Lead with suspected UNS context.
- Confirm before troubleshooting (UNS gate).
- Cite ≤3 evidence sources.
- Refuse if ungrounded.
- Stay short (technician-on-phone-in-noisy-plant constraint).

### Lead rules (replace current `slack-technician-ux-writer` ad-hoc rules with numbered, anti-hallucination-led ones)
- **GA-1 — NEVER answer without UNS context.** If unresolved, ask.
- **GA-2 — Cite ≤3 sources.** More is noise.
- **GA-3 — NEVER invent plant data, PLC tag meaning, work-order history, or manual references.**
- **GA-4 — Lead with suspected context** (Site → Asset → Component → Fault).
- **GA-5 — Confirmation question is mandatory** before troubleshooting steps.
- **GA-6 — Steps come after confirmation** — never before.
- **GA-7 — Quality codes / confidence bands surface in the reply** when low (Fuuz Pattern U-10). "Based on a medium-confidence manual extraction…"
- **GA-8 — Layout consistency** (Fuuz Pattern A-10): every reply follows the same structure.

### Reference files
- `references/reply-templates.md` — known-good templates per intent class.
- `references/confidence-language.md` — phrasing for low/med/high.
- `references/refusal-templates.md` — when MIRA must say "I don't have grounding for that."

### Effort
~1 week.

---

## Skill 9 — `mira-uns-location-gate-designer` (existing → upgrade)

### Purpose
Maintain the UNS confirmation gate. Triggers on edits to `mira-bots/slack/bot.py`, `mira-bots/shared/engine.py`, FSM.

### Lead rules
- **LG-1 — Gate is non-negotiable.** Code paths that begin troubleshooting before context confirmation are bugs.
- **LG-2 — Evidence-gathering is multi-source.** UNS, work-order history, manual ref, PLC tag, prior session, technician hint.
- **LG-3 — Confirmation message includes evidence used + confidence band.**
- **LG-4 — Wait for confirmation or correction.** Don't proceed on silence.
- **LG-5 — On correction, re-ground.** Don't carry forward stale context.
- **LG-6 — Run `mira-run-hallucination-audit` after edits** to engine.py or bot.py.

### Reference files
- `references/gate-flow.md` — the state machine diagram.
- `references/hallucination-audit.md` — how the audit detects bypasses.

### Effort
Exists. Upgrade ~3 days.

---

## Skill 10 — `mira-bot-grounding-tests` (existing → upgrade per rigor)

### Purpose
GS11 regression net. Triggers per existing skill description.

### Lead rules (already exist; numbering is the upgrade)
- **BG-1 — Mandatory pre-push check for retrieval-layer edits.**
- **BG-2 — Embedding gate must NOT block BM25** (the May 2026 bug that the skill prevents).
- **BG-3 — Golden cases live in `tests/golden_*.csv`.** Add when adding a new troubleshooting path.
- **BG-4 — No "trust me" reviews** — evidence required.

### Effort
Exists. Numbering ~1 hour.

---

## What MIRA explicitly does NOT need (despite being in Fuuz's skill library)

- **`fuuz-packages` equivalent.** MIRA doesn't ship platform packages; component templates fill that role with a different format.
- **`fuuz-screens` equivalent.** MIRA doesn't generate dashboards; Slack messages are the surface, and `mira-grounded-answer-builder` covers that.
- **`fuuz-flows` equivalent.** MIRA's "flows" are engine state transitions + Celery workers; documented in code, not declarative JSON.
- **`fuuz-platform` equivalent for connectors.** MIRA's connector list is much smaller (Atlas + MaintainX via Nango); a one-page reference is enough, not a 14-file deep dive.

## Roll-out order (recommended sequence)

1. **Week 1:** Skill 1 (`mira-platform-utilities`) + Skill 2 (`mira-uns-resolver`) numbering. Highest leverage, lowest risk.
2. **Week 2–3:** Skill 8 (`mira-grounded-answer-builder`) + Skill 9 (`mira-uns-location-gate-designer`) numbering. The Slack-facing surface — biggest customer impact.
3. **Week 4–5:** Skill 4 (`mira-knowledge-graph-proposer`) + Skill 3 (`mira-component-template-builder`) upgrade. The data-quality flywheel.
4. **Week 6–7:** Skill 5 (manual extraction) + Skill 6 (PLC mapper) + Skill 7 (WO miner). Ingest side.
5. **Week 8:** Skill 10 (grounding tests) numbering. Last because it's already most rigorous.

## Open questions

- [ ] **Public or private?** Fuuz publishes skills (proprietary-but-readable). MIRA could go either way:
  - **Private:** defensive, doesn't help competitors copy prompts.
  - **Public, Apache-2.0:** thought-leadership, recruiting, partner integrations.
  - Mike to decide.
- [ ] **Skill-to-rule split.** Some MIRA content currently lives in `.claude/rules/` and some in `.claude/skills/`. The Fuuz model is **skills** everywhere with `references/` for deep content. Should MIRA consolidate? Tentatively yes — rules become the lead block of each skill.
- [ ] **Versioning cadence.** Per-skill semver? Per-skill-package semver (group of skills)? Per `MANIFEST.md` revision?
- [ ] **Eval coverage.** Fuuz doesn't publish skill evals. MIRA's `tests/eval/` regime already does. Worth extending to per-skill eval suites where applicable.

## Cross-reference

- Lessons synthesis → [`mira-lessons-from-fuuz.md`](mira-lessons-from-fuuz.md)
- Architecture decisions → [`mira-architecture-decisions.md`](mira-architecture-decisions.md)
- Wedge + positioning → [`mira-wedge-and-positioning.md`](mira-wedge-and-positioning.md)
- Pattern files → [`../architecture-patterns/`](../architecture-patterns/)
- Repo analysis → [`../repos/fuuz-repo-analysis.md`](../repos/fuuz-repo-analysis.md)
- Video analysis → [`../videos/fuuz-video-analysis.md`](../videos/fuuz-video-analysis.md)
