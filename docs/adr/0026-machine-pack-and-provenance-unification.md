# ADR-0026: Machine Pack evidence classes and provenance/trust unification

## Status
Draft — 2026-07-10 (approved in principle by product owner with required boundaries; this draft encodes them and the findings of three independent reviews: safety, schema-consistency, Train & Approve compatibility)

**Related:** ADR-0017 (proposal state-machine mapping), ADR-0025 (drive intelligence packs and Drive Commander), ADR-0014 (`ai_suggestions` as broad work queue), ADR-0023 (Hub as system of record for contextualization), `docs/drive-commander/drive-pack-trust-doctrine.md`, `.claude/rules/train-before-deploy.md`, `docs/discovery/machine-pack/README.md` (discovery synthesis + locked decisions — lands via PR #2612 on a sibling branch; merge that PR first or together).
**Implements:** the provenance/trust prerequisite (AD-2) of the Machine Pack plan — no pack-generalization code lands before this ADR is accepted.

---

## Context

The Machine Pack generalizes ADR-0025's drive pack into a versioned, machine-specific artifact that FactoryLM, MIRA, thin clients, and external agents consume. Discovery (`docs/discovery/machine-pack/`) found **five independent provenance/trust vocabularies** already in production, none cross-mapped:

| System | Vocabulary | Where |
|---|---|---|
| Drive pack provenance tiers | `bench_verified`, `manual_cited` (closed set) | `mira-bots/shared/drive_packs/schema.py`, `mira-bots/shared/drive_packs/packs/README.md` |
| Drive pack trust status | `rejected < internal_only < beta < trusted` (worst-wins, fail-closed) | `tools/drive-pack-extract/grading/GRADING_SPEC.md` |
| PLC IR extraction confidence | `HIGH / MEDIUM / LOW / REVIEW` | `mira-plc-parser/mira_plc_parser/ir.py` (`Provenance.confidence`) |
| KG approval state machine | `ai_suggestions.status` / `relationship_proposals.status` / `kg_*.approval_state` (three enums, one logical machine) | ADR-0017, migrations 018/027/029 |
| Contextualization review | `ctx_extractions.status` / `ctx_import_batches.review_status` | ADR-0023, migrations 055/056, Hub batch-review route |

Adjacent vocabularies that must not diverge further: `component_templates.verification_status` (`proposed/verified/rejected`, mig 016), `wiring_connections.approval_state` (`proposed/verified/rejected/needs_review`, mig 026), asset-identity `approval_status` (starts `unreviewed`, never auto-promoted), and the Train & Approve asset-agent lifecycle (`draft→training→validating→approved→deployed`, mig `046_asset_agent_status.sql`, Hub onboarding). Note: `kg_entities.approval_state` additionally carries `deprecated` (mig 029) — a value ADR-0017's tables omit; inherited gap, recorded here rather than silently repeated.

ADR-0017's lesson applies verbatim: divergent vocabularies with no documented mapping produce silent breakage. A Machine Pack that bundles PLC logic, wiring, drive data, manuals, live tags, and repair history will touch **all** of these vocabularies at once — without a mapping, "verified" becomes ambiguous and agent inference can leak into machine truth.

## Decision

**Keep each subsystem's vocabulary. Define evidence classes as the shared semantic layer. Document the mapping. Centralize promotion through the existing ADR-0017 machinery.** No new approval queue, no new status enum, no parallel review surface.

### 1. Evidence classes

Every fact in a Machine Pack (and every artifact derived from one) carries exactly one evidence class:

| Class | Meaning | Producer | Mutable? |
|---|---|---|---|
| `observed` | Read directly from a live system (tag value, drive register, connectivity state) at a recorded time | collectors, `mira-relay` ingest, `live_snapshot` | **Immutable** (append-only stream; `tag_events` is the model) |
| `extracted` | Mechanically derived from a source document or export (manual text, L5X rung, wiring YAML, nameplate OCR) with a locator | parsers, extractors, OCR | **Immutable** (re-extract to supersede, never edit in place) |
| `inferred` | Produced by rules, graph traversal, correlation, or an LLM from observed/extracted inputs | anomaly rules, `correlate.py`, KG inference, LLM proposers | Mutable only via new proposal versions |
| `technician_confirmed` | A human at the machine attested it (repair record, measurement, field verification) | technicians via WO/Telegram/Hub | Immutable once recorded; corrections are new records |
| `approved` | A named reviewer promoted it through a Hub promotion surface (§5) | Hub decide/review routes | Only via a new approval (supersede), never silent edit |
| `historical` | A past fact retained for audit (superseded pack versions, closed WOs, prior baselines) | promotion/closure events | **Immutable** |

**Boundary (required):** raw and extracted evidence is immutable. `observed`, `extracted`, `inferred`, `technician_confirmed`, and `approved` remain distinct end-to-end — a pack field, a KG edge, and a diagnostic reply must each be able to say which class every claim belongs to. **Agent inference cannot silently become approved machine truth**; the only path from `inferred` to `approved` is a human decision recorded through the ADR-0017 machinery.

### 2. Trust/approval state mapping (the canonical table)

| Evidence class | Pack provenance tier | Pack trust ceiling | PLC IR confidence | KG / proposals | component_templates / wiring |
|---|---|---|---|---|---|
| `observed` (live, fresh) | n/a (runtime, not packed) | n/a | n/a | n/a (never a KG fact by itself) | n/a |
| `extracted` (cited) | `manual_cited` | `beta` | `HIGH/MEDIUM/LOW` per locator quality; **`REVIEW` overrides all three whenever the content is safety-relevant** (e-stop / guard / interlock / bypass patterns), regardless of extraction mechanics or locator quality | `relationship_proposals.status='proposed'` | `proposed` |
| `inferred` | — (must not appear as a pack provenance tier) | `internal_only` | `REVIEW` (safety-relevant inferences always `REVIEW`) | `proposed` (`created_by='llm'|'rule'`, `requires_human_review` honored) | `proposed` |
| `technician_confirmed` | `bench_verified` | `trusted` **only after** named-reviewer sign-off | n/a | evidence rows (`relationship_evidence.evidence_type='technician_note'|'human_observation'`) raising proposal confidence — still requires decide | — |
| `approved` | `bench_verified` + approval record | `trusted` | n/a | `verified` (via a §5 promotion surface only) | `verified` |
| rejected at any stage | — | `rejected` | — | `rejected` (terminal); `contradicted` is **distinct and non-terminal** — see §4 | `rejected` |

Rules the table encodes:

- **`REVIEW` is an orthogonal safety-relevance overlay, not a class-specific grade.** Any fact — extracted or inferred — whose content matches safety patterns (the `_SAFETY_PAT` screen in `mira-plc-parser/mira_plc_parser/analyze.py` is the reference implementation) is graded `REVIEW` and blocked from consequential guidance until a human decides.
- `manual_cited` alone can never exceed trust `beta` (existing drive-pack doctrine, now general).
- `trusted` ⇔ KG `verified` ⇔ `component_templates.verified` — all three require the **same kind of human sign-off**, recorded (see §5). No vocabulary offers a cheaper "verified".
- The bare word **"verified" remains reserved** for `kg_*.approval_state` and its mapped equivalents (existing rule); pack provenance tiers stay `bench_verified`/`manual_cited`.

### 3. Provenance requirements

Every non-`observed` fact must retain provenance to its origin. Minimum record, at the granularity of the individual claim:

- **Document evidence:** source document id + page/section locator + excerpt (the drive-pack `provenance.sources[{doc,page,excerpt}]` shape).
- **PLC evidence:** source file + format + rung/routine/program locator (`mira-plc-parser` `Provenance{source_file, source_format, locator}`).
- **Wiring evidence:** `wiring_connections` row id + `drawing_reference` (sheet/grid).
- **Live evidence:** UNS path + `tag_events` id/timestamp + freshness classification at read time.
- **Technician evidence:** WO id or `relationship_evidence` row (`technician_note`/`human_observation`) + who + when.
- **Derived artifacts** (packs, diagnostic cards, procedure steps, benchmark cases) must retain the chain back to one or more of the above — a downstream consumer must always be able to walk from a claim to a source document, PLC location, live tag, or technician record. A claim with no walkable chain is invalid and must be dropped at load time (fail-closed, per the drive-pack loader pattern).

### 4. Conflict handling

- Conflicts are **preserved and surfaced, never silently merged** (compiler requirement). The storage shape already exists: `relationship_evidence.confidence_contribution` accepts negative values (contradicting evidence) and `relationship_proposals.status='contradicted'` names the state. `contradicted` is **not** a flavor of `rejected`: a contradicted proposal carries both live claims pending human resolution; `rejected` is terminal.
- A Machine Pack that bundles contradictory evidence (e.g. print says terminal X2:4, PLC comment says X2:5) carries **both** claims, each with its own provenance, plus a conflict marker; the pack grader caps trust at `internal_only` until a human resolves it through decide.
- Resolution is itself an `approved` fact recording which claim won and why; the losing claim becomes `historical`, not deleted.

### 5. Promotion rules

**Promotion surfaces.** The following are the real, current surfaces that can produce `verified`/`approved` state (per `scripts/kg_write_guard_allowlist.txt` and code inspection); this ADR's recording requirements apply to **all** of them:

1. Hub `/api/proposals/[id]/decide` (ADR-0017 canonical path).
2. Hub `/api/suggestions/[id]/decide` (`ai_suggestions` queue).
3. Hub contextualization batch review — `/api/contextualization/batches/[batchId]/review` → `mira-hub/src/lib/contextualization/approval.ts` (sets `kg_entities.approval_state='verified'` on human approve). **Follow-up:** bring its approval record to the same reviewer/time/evidence/version standard as the decide routes.
4. `mira_connectors/confirmation_gate.py::ConnectorConfirmationGate.confirm()` — mirrors the decide semantics for connector-imported data; its `.confirm()` has no HTTP route yet. Per the locked product decision (Tag Mapper GUI home = FactoryLM Hub), **its confirmation UI must land in the Hub** when wired; it must not become a standalone review surface.
5. `MIRA_KG_INGEST_AUTOVERIFY` (flag-gated legacy auto-verify in `mira-crawler/ingest/kg_writer.py` + `full_ingest_pipeline.py`) — **the sole non-human exception**, default OFF, reserved for bulk/debug seeding. It bypasses human review by design; it may never be enabled for safety-relevant (`REVIEW`) content, and enabling it in any shared environment requires explicit product-owner sign-off recorded in the run log.

No other code path may write `verified`/`approved` state; new pack kinds add **no** new promotion surfaces.

**Approval record.** Every approval records: **reviewer identity, timestamp, the evidence rows relied on, and the artifact version being approved** (for packs: `schema_version` + a pack content hash, defined as the canonical-JSON hash of `pack.json`).

**Approval binding (new requirement).** An approval binds to a specific artifact version. The drive-pack registry today classifies *source-manual* changes (`CHANGED_BY_HASH` on the manual's `pdf_sha256`, read-only, human-review-only output — `tools/drive-pack-extract/registry/registry.py`); this ADR **extends** that discipline to the artifact itself: a changed pack content hash invalidates the approval back to candidate. This is new behavior to build, not existing behavior — the registry's "changed source → candidate, never auto-promote" doctrine is the model.

- **No automatic promotion.** Graders assign ceilings, never grants; the extractor running is not trust (existing doctrine, now general). Structural writer guards in the style of `update_candidate.py::assert_not_live_packs` (writers physically cannot touch the promoted tree — exists today for drive packs) are **required for every future pack kind**.
- **Train & Approve compatibility — future work, explicitly.** The intended rule — *an asset agent may only reach `approved` (mig 046) when the mappings it depends on are `approved`/`verified`* — is **not implementable today**: the actual gate (`mira-hub/src/lib/asset-agent-transition.ts::meetsApprovalCriteria`) checks citation coverage, groundedness, and open safety-critical items only, and mig 046 has no hard FK defining "the mappings it depends on." Implementing it requires: (a) a defined dependency query (equipment-scoped `wiring_connections` + `tag_entities` + `component_templates` rows), (b) a new `ApprovalSignals` field, and (c) changes to the asset-agent status route. Until that lands, the rule is a target, not a claim. `validating` may exercise `beta`/`inferred` material under §6 labeling; Ignition/HMI deploys approved agents only (`train-before-deploy.md`) — unchanged.

### 6. Runtime consumption rules

- Runtime diagnostics **may** use unapproved information (`inferred`, `extracted`-at-`beta`, stale `observed`) **only when clearly labeled** as such in the reply/artifact, and must never present it as authoritative. Existing normative patterns: `wiring_profile.answer_wiring_question` answers from `verified` rows only and refuses otherwise; drive-pack parameter/keypad cards carry `provenance_tier` + `confidence_tier` (the fault-table `DiagnosticCard` carries `provenance_tier` + a `confidence` field to be aligned to `confidence_tier` under this ADR's implementation); `live_snapshot` returns `None` rather than fabricate.
- **`REVIEW`-graded facts are structurally gated, not prose-gated.** A `REVIEW` fact must be **either** (a) excluded entirely from any context assembled for an LLM — preferred; this is the `wiring_profile` trusted-only pattern — **or** (b) rendered only through a non-LLM code path with a hardcoded, non-strippable `UNVERIFIED — HUMAN REVIEW REQUIRED` wrapper (the `live_snapshot._render_keypad_card` suppress-if-unsafe pattern). A `REVIEW` fact is never handed to an LLM as free text it could restate as fact. Labeling instructions to the model are not a control.
- **Consequential guidance** (anything a technician would act on at the machine: which breaker, which terminal, which parameter, part interchangeability) requires `approved` mappings — or the explicit insufficient-evidence behavior (honest refusal naming what's missing; existing on-main analog: `tools/drive-pack-extract/grading/scientific.py::_missing_evidence`; the fuller `missing_evidence` bundle pattern lives in `fault_bundle.py` on the unmerged branch `feat/proveit-difference-engine-demo` — forthcoming, merge prerequisite recorded in the discovery index).
- **Freshness is part of truth — one classification, one source column.** The Hub surface uses `command-center-freshness.ts` (`live/stale/simulated/unknown`). The bot-facing surface (`mira-bots/shared/live_snapshot.py`) today grades only `GOOD/STALE/UNKNOWN` and **has no `simulated` value** — a bench/simulated feed can render as GOOD there. Before Machine Pack content routes through Telegram/Slack, `live_snapshot`'s quality classification must gain an equivalent `simulated` value sourced from the same underlying `simulated` column the ingest contract derives. Divergent freshness taxonomies across surfaces are a defect, not a style choice.
- **Stale or simulated data is excluded from consequential guidance structurally**, not merely labeled: rows classified stale/simulated must be dropped from any context path that feeds consequential-guidance generation (today's `[STALE]` marker in `live_snapshot.render_status_block` labels but does not exclude — implementation of this ADR closes that gap). For non-consequential narration they remain usable, labeled.
- LLMs explain already-assembled evidence chains; they do not originate facts at any evidence class above `inferred`, and inferred LLM output enters the system only as proposals.

### 7. Human-review boundaries

- Humans decide: promotion to `approved`/`verified`/`trusted`, conflict resolution, part-interchangeability claims, anything graded `REVIEW` (safety permissives, e-stop chains, LOTO-adjacent logic), and pack version acceptance.
- Agents may: propose, grade against ceilings, label, refuse, and assemble evidence — never decide.
- Reviewer qualification: for ordinary facts, the reviewer must be **named and recorded** (Hub roles are the product mechanism; not defined here). **For `REVIEW`-graded (safety-relevant) facts, approval additionally requires a Hub role flagged safety-qualified. Until that role exists, `REVIEW`-graded facts may not be promoted to `approved` at all** (fail-closed).

### 8. Audit requirements

- All class transitions and approvals are auditable: `decision_traces` (migs 032/055), `kg_triples_log` (mig 001), `ai_suggestions` lifecycle rows, registry `sources.json` hash history, and pack version history (packs are files in git — the commit is the audit record).
- Superseded artifacts are retained (`historical`), never rewritten — the "never rewrite an applied migration" rule (`.claude/rules/mira-hub-migrations.md`) extends to promoted pack versions: publish a new version, never edit a promoted one.

### 9. Schema-version implications

- Machine Pack `schema_version` bumps to 3 (additive): `kind` discriminator + `evidence_class` on every provenance item + conflict markers. v1/v2 drive packs load unchanged under a v3-aware loader (existing additive-only discipline, `drive_packs/loader.py`); their `provenance.items` tiers map per §2 with `evidence_class` defaulted (`manual_cited→extracted`, `bench_verified→technician_confirmed`) — the loader labels, it does not upgrade trust.
- **Legacy safety screen (required):** the v3 loader (or a one-time migration pass) must run the safety-pattern screen (`analyze.py` `_SAFETY_PAT` reference implementation) over legacy pack content during the defaulting pass; matches are graded `REVIEW` rather than blindly relabeled — legacy e-stop/guard/interlock content must not inherit `beta` trust unscreened.
- Unknown `schema_version` remains a hard load error (fail-closed).
- The `report@1` PLC report contract and `.miraprofile`/`bundle@1` formats are inputs; they keep their own versions and are cited by reference, not re-held.

## Examples (CV-101, concrete)

1. **Live tag (observed):** `enterprise.….conveyor_lab.conveyor_1` DC-bus reads 318.9 V, `live` freshness, `tag_events` id + timestamp attached. Usable in diagnostics as "observed now"; never becomes a pack fact by itself; if stale/simulated → structurally excluded from consequential guidance (§6).
2. **PLC logic (extracted, safety-relevant → REVIEW):** the parser extracts the `Conv_Run` motor-start rung with permissives `E_Stop_OK AND Guard_Closed` from `Prog2` (locator: routine/rung). The extraction is mechanical and well-locatored, but the content is safety-relevant → `REVIEW` per §2's overlay rule. It surfaces only as a proposal ("blocking permissive candidates") and — until decided — is either absent from LLM context or rendered through the non-LLM `UNVERIFIED — HUMAN REVIEW REQUIRED` path (§6). The system must not issue "reset the guard switch" as authoritative guidance from it.
3. **Wiring evidence (extracted, cited):** `wiring_map_import.py` lands CV-101 conductor rows from `plc/conv_simple_electrical/model/*.yaml` as `approval_state='proposed'` with `drawing_reference` (sheet E-00x). `wiring_profile` Q&A cites only rows a human verified; proposed rows are invisible to answers — existing behavior, now doctrine for all pack kinds.
4. **Drive Commander data (extracted `manual_cited`, trust `beta`):** GS10 pack fault-code table cites manual page per code. A diagnostic card built from it carries `provenance_tier=manual_cited`; the pack cannot reach `trusted` on citations alone — bench verification (technician_confirmed) plus named sign-off promotes it, recording reviewer/time/evidence/pack-hash.
5. **Technician-confirmed repair (technician_confirmed → approved):** technician confirms the conveyor no-start root cause was a failed guard-switch interlock; the WO (with `source_run_diff_id` linking the anomaly) closes with resolution notes. A `relationship_evidence(technician_note)` row backs a `HAS_FAILURE_MODE` proposal; when a reviewer decides it in the Hub, the edge becomes `verified` and future diagnostics cite it as approved machine history. The raw WO record is immutable; the promotion is a separate, audited event.

## Non-goals

- **No control writes.** Nothing in this ADR creates or eases any PLC/VFD/control-system write path; read-only doctrine (`.claude/rules/fieldbus-readonly.md`, drive-pack no-write-FC test gate) is untouched and out of scope for any future pack kind.
- **No automatic promotion of agent conclusions.** There is no confidence threshold, grader score, or corroboration count that turns `inferred` into `approved` without a named human decision (§5's flag-gated legacy autoverify is the sole, non-safety, explicitly-logged exception).
- **No replacement of LOTO or qualified-technician judgment.** Evidence classes describe data trust, not permission to work; safety behavior (guardrails STOP+escalate, LOTO awareness) is unchanged. **Caveat recorded honestly:** the safety review found that `engine.py`'s Stage-0 fast paths (WO-action, live-tag query, don't-know) return before the safety short-circuit — a pre-existing ordering issue, not introduced here. "Safety always wins" therefore requires independent verification/fix of that ordering **before any Machine Pack fast-path is added to `engine.py`**; tracked as a required follow-up.
- **Machine Pack content must never touch the SAFETY_ALERT path.** The fixed-string STOP+escalate reply is not personalized, templated, or influenced by pack content of any evidence class. (True by code structure today; stated here as an invariant so it survives refactors.)
- **No hidden confidence-to-truth conversion.** Numeric confidence scores and tiers order review queues and label output; they are never a promotion mechanism, and no consumer may treat "high confidence" as "approved".

## Consequences

- **Positive:** one semantic layer over five vocabularies without a migration; every mandate safety bullet ("do not store unsupported conclusions as facts", "separate observed/extracted/inferred/approved/historical") has a concrete storage answer; Machine Pack generalization (plan Phase 2) can proceed against a stable contract.
- **Negative / accepted cost:** every producer must classify its output (small constant overhead); v3 loader work must label legacy tiers *and* run the legacy safety screen; conflict-carrying packs are larger than silently-merged ones — deliberately.
- **Enforcement points:** pack loader (fail-closed on missing class/provenance + legacy safety screen), grader (trust ceilings), the §5 promotion surfaces (only promotion paths, all recording reviewer/time/evidence/version), CI (fixtures asserting §6 structural gating and §2 ceilings).

## Review checklist for acceptance

- [ ] Product owner confirms §2 mapping (esp. the REVIEW safety overlay, `bench_verified→technician_confirmed` labeling, and the `trusted`⇔`verified` equivalence)
- [ ] Safety review: §6 structural gating + §7 safety-qualified-reviewer fail-closed rule against `mira-industrial-safety` expectations
- [ ] **Engine ordering verification:** confirm/fix `engine.py` Stage-0 fast-path ordering vs. the safety short-circuit before any Machine Pack fast-path lands (Non-goals caveat)
- [ ] Schema review: §9 additive-only claim against `drive_packs/loader.py` behavior
- [ ] Train & Approve compatibility: §5's future-work item (dependency query + `ApprovalSignals` extension) scoped against mig 046 lifecycle and `train-before-deploy.md`
- [ ] Freshness unification: `live_snapshot.py` gains `simulated` before pack content routes through Telegram/Slack (§6)
