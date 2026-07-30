# PRD — MIRA Unification Program ("One Technician Brain, Many Evidence Producers")

- **Status:** DRAFT — for Mike's review. Program-level umbrella over ADR-0033; no new
  spend, schema break, or deploy is authorized by this document alone.
- **Date:** 2026-07-30
- **Owner:** Mike Harper (program), Claude Code sessions (execution)
- **Inputs (read these first, in order):**
  1. `docs/adr/0033-one-technician-brain.md` — the decision this program executes
  2. `docs/zta/technician-unified/inventory.md` — Phase-1 source-family inventory + ranked conflicts
  3. `docs/zta/2026-07-28-technician-training-plan-v2.md` — the supported model of training
  4. `docs/zta/technician-unified/training-readiness-report.md` — NOT-READY decision + ranked blockers
  5. `NORTH_STAR.md` — the context-layer wedge every workstream must serve

## 1. Problem

MIRA grew product-by-product (Drive Commander, PrintSense, live-state diagnosis, KG,
photo memory) and each product minted its own context shape, prompt identity, storage
key, and approval ladder. The Phase-1 inventory verified the cost concretely: two live
`kg_entities` schema families; the retrieval law hand-copied in three dialects plus ≥8
bespoke `knowledge_entries` readers; evidence identity (content hash) and corpus lineage
(`document_lineage_key`) that never join; `decision_traces` carrying unified evidence
with two divergent writers and zero readers; corrections modelled twice (the shipped one
unversioned); trust ladders that disagree; four drive-pack copies with one drift guard;
and **zero records of the single most important training family (general technician
behavior)**. Meanwhile the training loop proved behavior cloning transfers ($4 LoRA,
fabrication collapse on held-out equipment) but stalled as template engineering because
the data — not the mechanism — is the bottleneck.

The result is the failure mode the NORTH_STAR wedge forbids: many partial brains, each
speaking with its own authority, none accumulating shared, trustworthy context.

## 2. Program thesis

Exactly **one conversational technician policy** (one base model, at most one general
behavior adapter), with every specialized capability living **below the conversation**
as a deterministic or narrow evidence producer that emits **typed evidence + provenance +
confidence into one versioned context contract** (ADR-0029 `EvidenceManifest`, extended —
never forked). Products become `task_mode` metadata, not personas. Knowledge stays in
retrieval/tools; weights carry behavior only. Governance (rights envelopes, frozen
manifests, lineage splits, signed spend, sealed evals) is unchanged and non-negotiable.

## 3. Goals (measurable)

| # | Goal | Metric / acceptance |
|---|---|---|
| G1 | One context contract at runtime | `materialized_evidence/schema.py` contract carries `task_mode`, `allowed_actions` (write-verbs rejected), `unknowns`, live-state overlay, `document_lineage_key` backref — and ≥3 evidence producers speak it through adapters in prod paths (shipped: context_contract.py + recall/drive-pack/KG/machine-packet/uns/PrintSense/ontology adapters; adoption is the remaining gap) |
| G2 | One conversational policy | No per-product conversational model/adapter/system-prompt identity ships; known prompt forks retired as touched (drive-pack reply formatter first). CI/eval slice for task-mode consistency exists and is green |
| G3 | Majority-general corpus at trainable scale | General family scaled ~500–1,000 records via S4 paraphrase machinery ($0), recompile holds mixture law (≥50% general; OEM ≤10%; product ≤25%; template ≤20%), ONE human sitting on the final frozen manifest |
| G4 | Spend only through the readiness gate | Training job launches only after: packing×loss-mask proof resolved, eval-slice manifest frozen (graph-reasoning + task-mode slices filled or formally accepted as gaps), fresh single-use signed authorization. Acceptance bar = per-slice base-vs-adapter, no slice regresses |
| G5 | Structural debt retired on a named list | Ranked-conflict list from the inventory burned down in order with per-item proof (see §5 WS4); no NEW instance of a retired pattern lands (checker/CI where feasible) |
| G6 | Audit row = prompt row | `decision_traces` becomes a consumer of the contract: one writer shape, a reader/resolver exists, new turns log the same evidence object the prompt was built from |

## 4. Non-goals

- **No dual-KG merge in this program's first milestones.** The two `kg_entities`
  families are the repo's highest-risk change; this program ships the *bridge design*
  (adapter + natural-key mapping) and schedules the merge as its own gated project.
- **No new runtime context schema, registry, queue, or approval ladder** (ADR-0029 rule
  15 / ADR-0033 rejected-alternatives). Extend what exists.
- **No specialist conversational adapters** unless the ADR-0033 rule-1 ladder (five
  cheaper fixes, lineage-clean negative-transfer evidence) is exhausted and documented.
- **No control writes; read-only posture unchanged** (`fieldbus-readonly`, train-before-deploy).
- **No training on ungoverned real conversations** — `conversation_eval` stays eval-only
  until a corpus-source.v1 rights envelope + lineage scheme exists for it.

## 5. Workstreams

### WS1 — Context contract & adapters (runtime spine)
Extend-adopt-consume: the Phase-3 contract (`materialized_evidence/context_contract.py`)
is built; drive adoption into the live answer paths (engine turn assembly, drive-pack
fast-path, PrintSense workspace follow-ups, equipment photo memory (#3008), Ignition
direct-connection turns). Untyped producers adapt IN via adapters; they are never
extended (`state["uns_context"]`, `ignition_chat.asset_context`). Exit: G1 + G6.

### WS2 — One policy, product modes
Retire duplicated/contradictory system prompts as touched (inventory names the forks;
drive-pack reply formatter first). `task_mode` + `allowed_actions` flow from the
contract, with write-verb rejection tested in lockstep with `agent_registry`. Exit: G2.

### WS3 — Data: scale the general family, then compile, then sit, then spend
Order is law (training-readiness report): (1) S4 paraphrase scale-up of the general
family to ~500–1,000 records, deterministic gates + A/B fact partition intact; (2)
recompile with the mixture law + FactoryLM house-content exemption (caps apply to real
OEMs); (3) ONE review-by-exception sitting on the final frozen manifest; (4) resolve the
packing×completion-loss-mask proof (pre-tokenized Parquet path recommended) — Mike's
call; (5) fill or formally accept the two unfilled eval slices, freeze the slice
manifest; (6) signed single-use training authorization; (7) $4 LoRA SFT + per-slice
eval. Exit: G3 + G4.

### WS4 — Structural-debt burn-down (ranked, surgical)
Work the inventory's ranked list in order, one PR per item, each with its own proof:
1. Retrieval law → one shared implementation/helper consumed by all three dialects; the
   ≥8 bespoke readers routed or allowlisted; document the `verified`-column hazard (gate
   flip would zero retrieval — backfill design before any flip).
2. Evidence↔lineage bridge: `document_lineage_key` backref populated where both exist so
   leakage partitioning can cover recalled evidence.
3. `decision_traces`: single writer shape + first reader (G6).
4. Corrections: shipped path writes `correction-event.v1` (versioned, immutable), review
   queue migrates; PrintSense corrections stop being mutable dicts.
5. Trust-ladder reconciliation (DC registry vs scorecard; ontology TrustState vs DB
   CHECK) — one documented mapping, drift test.
6. Console/tooling dedupe: retire review_console v1 (data-destroying export bug),
   repoint v2 defaults, single ledger filename, judge protocol pinned.
7. Pack hygiene: one pack source of truth + drift guard coverage; register `siemens_g120`
   (sold but invisible); wire Magnetek when scheduled.
8. Dual-KG **bridge design only** (see Non-goals).

### WS5 — Rights & real-data governance
SCU2/real-photo corpora get corpus-source.v1 registry rows (fail-closed, LOCAL-ONLY
customer-private); `PrintSynthGraph` graph.json gets `$id` + versioning; conversation
capture gets a corpus-source.v1 adapter **spec** (eval-only until rights resolve).

### WS6 — Eval & observability spine
Frozen assets stay frozen (PF40 held-out invariant, SimLab double-lock, sha256 corpora).
Fill graph-reasoning + task-mode-consistency slices; calibrate the internet-print judge
rubric; keep per-slice regression detection as the program's acceptance instrument.

## 6. Milestones

| M | Deliverable | Gate to pass |
|---|---|---|
| M0 ✅ | Phase 0–5 of the mission (inventory, ADR-0033, contract+adapters, unified compile 180 rec, eval manifest, NOT-READY decision) | shipped v3.229.0 + review fixes |
| M1 | Mike reviews/accepts ADR-0033 + this PRD | ADR status → Accepted |
| M2 | General family at scale + final compile + ONE sitting | mixture gates green on ≥~1,000-record general class; sitting recorded on frozen manifest |
| M3 | Readiness blockers cleared (packing proof, slice manifest frozen) | training-readiness report superseded by a READY decision |
| M4 | Training run + per-slice eval | signed authorization; no slice regresses vs base; receipts appended |
| M5 | Runtime adoption + debt items 1–4 landed | G1/G6 metrics met; each debt PR carries its own proof |

## 7. Risks

- **General-behavior transfer is unproven** (the v1 evidence covers discipline lenses,
  not general situations). Mitigation: M4's per-slice bar; $4 blast radius; no deploy
  without eval.
- **Retrieval is upstream of trainable behavior** (readiness blocker 5): some target
  behaviors (missing-retrieval honesty, conflict reconciliation) are *caused* by context
  assembly. Mitigation: WS4 item 1 and WS1 adoption are sequenced before/alongside spend.
- **Surgical scope creep** into the dual-KG merge or a contract fork. Mitigation: §4
  non-goals; reviewers reject on sight.
- **Governance fatigue** (skipping the sitting or reusing an authorization). Mitigation:
  fail-closed gates already in code; ADR-0033 rule 6.
- **Shared-checkout / parallel-session churn** on `main` (this repo merges hourly).
  Mitigation: worktree isolation + scoped commits per session discipline.

## 8. Dependencies & carve-outs

- Anthropic stays out of the diagnostic cascade (PRD §4 carve-outs unchanged).
- Zero-token architecture (`.claude/rules/zero-token-architecture.md`): paid inference
  only as budget-declared validation of the artifact under development — the M4 job and
  its eval are exactly that; everything else in this program is $0.
- Prod incidents that gate verification surface honestly (e.g. #3014 Tailscale/mira-ask)
  rather than being routed around.

## 9. References

ADR-0029 (materialized evidence) · ADR-0030 (continuous learning factory) · ADR-0032
(ontology foundation) · ADR-0033 (one technician brain) ·
`docs/zta/technician-unified/{inventory.md,eval-manifest.md,training-readiness-report.md,mixture_report.json}` ·
`docs/zta/2026-07-28-technician-training-plan-v2.md` ·
`docs/research/2026-07-28-hf-training-best-practices-vs-technician-program.md` ·
`.claude/rules/{materialized-evidence,zero-token-architecture,train-before-deploy,knowledge-entries-tenant-scoping}.md`
