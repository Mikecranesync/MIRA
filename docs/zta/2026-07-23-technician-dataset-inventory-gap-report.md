# FactoryLM Industrial Technician Dataset Inventory and GAP Report

**Audit date:** 2026-07-23  
**Repository:** `Mikecranesync/MIRA`  
**Intended first model:** FactoryLM Industrial Technician v0 — LoRA SFT over `Qwen/Qwen3.5-9B`  
**Decision:** **DO NOT START THE PAID FINE-TUNE YET**

## 1. Executive verdict

The training and governance machinery is substantially built, but the actual training dataset is not.

This audit located:

- **0 committed, non-test, fully eligible `DatasetRecord` training examples**
- **0 production `train.jsonl` exports**
- **0 completed corpus/rights/composition report package that passes the paid gate**
- **At least 27 raw candidate source lineages** before rights and quality filtering:
  - 22 verified public OEM print documents in the refreshed Print Translator manifest
  - 3 Drive Commander manual/pack families
  - 1 SCU2 print package
  - 1 CV-101 owned machine/print package

The source material is promising, but raw documents, pack facts, benchmark responses, and test fixtures are **not training records**. They must be converted into original technician interactions, tied to independent answer keys, cleared for training rights, split by lineage, and approved by a human.

**Office-level status:** the company has built the training factory and has enough raw material to create a first dataset. It has not yet manufactured and approved the dataset that should be sent to Together.

## 2. Model outcome we are optimizing

The desired deliverable is a reusable FactoryLM technician-specialized LLM—not merely a better prompt and not a database of memorized manuals.

The adapter should teach the base model to:

1. Start with machine/circuit function instead of dumping components.
2. Trace power and signal flow through terminals, wires, contacts, cross-references, and device relationships.
3. Use FactoryLM evidence, Drive Commander packs, retrieval, and tools instead of inventing facts.
4. Separate observed facts from engineering inference.
5. Refuse or request a better photo/page/measurement when evidence is insufficient.
6. Produce safe, ordered troubleshooting guidance.
7. Explain industrial controls in language useful to a working technician.
8. Return consistent structured outputs for downstream software.

Facts that change by manual revision, machine, customer, or firmware should remain in retrieval, deterministic packs, and the knowledge graph. The weights should learn **technician behavior and reasoning discipline**.

## 3. Audit scope and limitations

The audit covered the live GitHub repository, recent PR evidence, dataset-governance code, corpus adapters, Drive Commander gold sets, PrintSense fixtures and benchmark reports, the synthetic-flywheel substrate, and known CV-101 artifacts.

The audit did **not** obtain a usable Neon project listing and therefore did not count off-repository Telegram, Slack, Hub, production database, or private chat interactions. Those remain an explicit unknown rather than being assumed available.

Search evidence showed `DatasetRecord(` only in the dataset test suite, and `train.jsonl` only in planning/tests—not as a committed production export.

## 4. Current inventory summary

| Source pool | Raw material | Independent lineages | Fully eligible records now | Verdict |
|---|---:|---:|---:|---|
| PrintSense SCU2 fixture | 6 photos, graph, explanation, judgment | 1 | 0 | Valuable but proposed/private-rights blocked |
| Sheet-20 correction case | 1 detailed gold-style response | Same SCU2 lineage | 0 | Page/image reconciliation required |
| Public OEM Print Translator corpus | 25 listed; 22 verified; 20 run in refreshed manifest | Up to 22 | 0 | Rights, OCR quality, and approval blocked |
| Print of the Day real runs | 5 benchmark crops plus limited E2E cases | At least 1, not established | 0 | Ungraded or gold-blocked |
| Drive Commander gold sets | 3 structured reference files | 3 | 0 | Strong answer keys; not chat records and rights unresolved |
| CV-101 owned machine/print package | Structured machine evidence and anomaly scenarios | 1 | 0 | Highest-priority trainable candidate after declaration/review |
| SimLab/MIRA frozen fixtures | Deterministic benchmark material | Eval-only | 0 | Never train; reserve for blind evaluation |
| Synthetic flywheel | Queue/contracts only | 0 produced | 0 | Data-generation stages not yet run |
| Organic user interactions | Unknown/off-repo | Unknown | Unknown | Must be inventoried separately |

**Important:** “0 eligible” does not mean “0 useful data.” It means no located item currently satisfies every required condition simultaneously: valid messages, gold/human approval, explicit training rights, train-side lineage, provenance, validation, safety clearance, and non-sensitive tenant policy.

## 5. Detailed source assessment

### 5.1 PrintSense: SCU2 gold package

`printsense/fixtures/scu2/` contains a strong seed package built from six phone photos. It includes an evidence-backed graph, golden technician explanation, and independent judgment scoring 94/100. However, every entity remains `trust: proposed`; the fixture explicitly says it still needs machine or human verification.

The underlying print is from a real launch-coaster control cabinet. Unless ownership and permission are explicit, it should be treated as private or employer-sensitive—not silently used for a shared model.

**Use now:** evaluation, schema development, review workflow, candidate interaction drafting.  
**Do not use now:** paid training export.

### 5.2 PrintSense: Sheet-20 correction case

The case study is highly valuable because it documents exactly how a mediocre model answer should be improved: circuit overview first, signal direction, independent optical paths, machine symptoms, troubleshooting order, exact mapping, then uncertainty.

But the report itself records that the narrative’s three-module page and the committed benchmark image’s two-module page are different pages of the same book. This must be reconciled before it becomes a training example.

**Best use:** template for technician-first response style and one future correction record after source identity is pinned.

### 5.3 Print Translator public OEM corpus

The refreshed manifest lists 25 OEM documents, reports 22 authentic public PDFs, and says 20 were run through the real handler. This is the largest located PrintSense source pool.

It is not ready for training because:

- public accessibility does not establish training rights;
- historical campaign outputs were OCR-degraded;
- outputs were evaluation responses, not approved gold interactions;
- the older `GAPS.md` describes an earlier 11-case bounded run, while the refreshed manifest describes 20 runs—individual result files must be treated as the source of truth for per-case status;
- page selection was partly manual and must be pinned per lineage.

**Best use:** select a rights-clear subset, rerun with production OCR, create independent answer keys, and human-review each proposed interaction.

### 5.4 Drive Commander structured gold

Three human-approved gold references exist:

- `durapulse_gs10`
- `powerflex_40`
- `powerflex_525`

They contain structured fault and parameter facts with citations and diagnostic-critical markings. This is excellent material for producing original Q/A and troubleshooting examples because the deterministic pack can act as the answer key.

They are not themselves chat-training examples, and manual citation/approval does not automatically grant model-training rights. Training examples should paraphrase facts into original technician interactions rather than copying manual prose.

**Best use:** generate questions blind, answer from pack facts deterministically, have a technician approve wording/safety, and preserve the pack/manual lineage.

### 5.5 CV-101 owned machine package

CV-101 is the best near-term source because FactoryLM appears to have authored much of the machine model, electrical package, anomaly rules, and evidence workflow. The package includes verified and field-verify states, which is ideal for teaching both confident answers and honest refusal.

Before use, the corpus registry still needs an explicit ownership/training declaration. Only verified facts should support positive answers. `field_verify` and unmapped facts should produce uncertainty, measurement requests, or refusal examples.

**Best use:** create the first 20–30 approved interactions spanning print explanation, live evidence, communications loss, healthy idle, stale data refusal, photo-eye behavior, and safe next checks.

### 5.6 SimLab/MIRA

The current policy intentionally makes SimLab/MIRA frozen cases evaluation-only. That is correct. They should test whether the adapter improves root-cause reasoning without leaking answers into training.

**Best use:** frozen blind benchmark and promotion gate.  
**Never:** export to the training set.

### 5.7 Synthetic flywheel

The durable contracts, state machine, and queue exist, but no approved generated corpus was located. The question generator, blind target run, evidence critic, scheduled workflow, gold export, and readiness proof are not yet demonstrated as producing records.

Synthetic data should supplement—not replace—real technician corrections. Every answer key must be independent of the target model and grounded in a pack, simulator, owned print, verified relationship, or human correction.

## 6. Gap matrix against the paid-training gate

| Required gate | Required | Verified now | Gap | Status |
|---|---:|---:|---:|---|
| Eligible approved records | ≥100 | 0 committed/verified | 100 | **BLOCKED** |
| Independent training lineages | ≥20 | 0 eligible; ≥27 raw candidates | 20 eligible | **BLOCKED** |
| Uncertainty/refusal/correction interactions | ≥20 | 0 structured eligible | 20 | **BLOCKED** |
| Safety-sensitive interactions | ≥15 | 0 structured eligible | 15 | **BLOCKED** |
| PrintSense represented | Yes | Raw material only | Eligible records required | **BLOCKED** |
| Drive Commander represented | Yes | Raw material only | Eligible records required | **BLOCKED** |
| Training rights for every record | 100% | No complete rights report | All records | **BLOCKED** |
| Reserved held-out lineages | ≥5 | 0 designated in a real readiness package | 5 | **BLOCKED** |
| No lineage/eval leakage | Required | No assembled production dataset | Cannot evaluate | **BLOCKED** |
| Frozen SimLab/MIRA baseline reference | Required | Capability exists; final gate reference not located | 1 report/ref | **BLOCKED** |
| Real-vs-synthetic composition report | Required | No dataset | 1 report | **BLOCKED** |
| Base-vs-tools benchmark | Required | No dataset-specific benchmark | 1 report | **BLOCKED** |
| Canonical corpus manifest/hash | Required | Machinery exists; no production manifest located | 1 manifest | **BLOCKED** |
| Token count and ≤$5 estimate | Required | No export to count | Unknown | **BLOCKED** |
| Current model-support receipt | Required | Orchestration/docs exist; final live receipt must match target | 1 current receipt | **PARTIAL** |
| Mike’s paid authorization | Required last | Not issued, correctly | 1 authorization | **WAIT** |

## 7. Recommended Dataset v0 target

Do not train at the bare minimum of 100 unless the examples are unusually strong. The first run has a $4 minimum charge, so there is little benefit in rushing a tiny corpus.

### Recommended target: 180 eligible interactions

| Product/source | Target records | Target training lineages | Purpose |
|---|---:|---:|---|
| PrintSense | 110 | 18 | Circuit explanation, signal tracing, cross-sheet reasoning, uncertainty, safe troubleshooting |
| Drive Commander | 70 | 7 | Fault meaning, parameter relationships, communications, model identification, safe diagnostic sequence |
| **Training total** | **180** | **25** | Stronger than minimum gate |
| Held-out benchmark | Separate | **≥5 lineages** | Never used for tuning or selection |

### Required behavior mix across the 180

| Behavior type | Target |
|---|---:|
| Uncertainty, refusal, correction | ≥30 |
| Safety-sensitive cases | ≥25 |
| Exact evidence/citation use | ≥60 |
| Tool/pack/retrieval use | ≥50 |
| Cross-sheet or multi-step reasoning | ≥35 |
| Technician-first troubleshooting | ≥40 |

One record may satisfy multiple behavior categories.

### Recommended real/synthetic composition

- **At least 70% real or human-corrected interactions**
- **No more than 30% synthetic** in Dataset v0
- Synthetic records must use independent answer keys and remain labeled synthetic
- Near-duplicate questions from the same document do not count as new lineages

## 8. Proposed first-source allocation

### Batch A — CV-101 owned/controlled data: 25 records

Create original interactions from verified portions of the machine pack and anomaly logic:

- whole-machine and sheet explanations;
- healthy-idle versus fault distinction;
- communications stale/refusal;
- Modbus wiring and polarity checks;
- emergency-stop channel explanation;
- photo-eye behavior;
- VFD fault/parameter handoff;
- explicit `field_verify` questions where the correct answer is “not proven.”

### Batch B — Drive Commander deterministic gold: 60 records

Produce 20 per current family initially:

- fault meaning and immediate implications;
- likely causes versus confirmed cause;
- relevant parameters;
- communications-loss distinctions;
- safe first measurements/checks;
- wrong-family/model ambiguity;
- refusal when the code or family is not supported.

Add additional drive families before freezing the final corpus if possible, so the model does not equate “industrial drive” with only three families.

### Batch C — rights-clear PrintSense corpus: 65 records

Prefer, in order:

1. FactoryLM-authored diagrams and machine-print examples;
2. user-owned lab photos and prints;
3. public-domain patent electrical drawings;
4. OEM documents only after explicit training-rights review.

Generate multiple interaction types per lineage, but keep all derivatives in the same split.

### Batch D — human corrections and refusals: 30 records

Convert documented model mistakes and technician corrections into paired examples:

- original question/evidence;
- rejected or weak behavior summary;
- approved technician answer;
- correction reason;
- safety and uncertainty tags.

Do not train directly on raw private chat logs. Redact, obtain policy approval, and preserve source interaction IDs.

## 9. Evaluation objective

The supervised training loss will learn the approved answer text, but the business optimization must be measured with an external rubric.

Recommended promotion score:

| Evaluation dimension | Weight |
|---|---:|
| Grounded factual correctness | 30% |
| Technician usefulness and ordering | 20% |
| Circuit/diagnostic reasoning | 15% |
| Honest uncertainty and refusal | 15% |
| Safety behavior | 10% |
| Correct tool/pack use and structure | 10% |

Hard failures override the numeric score:

- invented terminal, wire, parameter, fault meaning, or measurement;
- unsafe energized-work instruction;
- claiming certainty from unreadable evidence;
- revealing private/customer data;
- using held-out or frozen-eval answer material during training.

## 10. Required work before Train

1. **Create the corpus-source registry entries** for every selected source and resolve `training_allowed` explicitly.
2. **Choose lineage keys and splits before generating variants.** Reserve at least five held-out lineages.
3. **Build a read-only organic-interaction inventory** from connected surfaces; count corrections, approvals, products, tenants, and rights without exporting content yet.
4. **Generate candidate chat records** from deterministic answer keys and owned evidence.
5. **Human-review every record.** Approval must cover technical correctness, technician usefulness, safety, and rights.
6. **Run schema, provenance, sensitivity, duplication, leakage, and message-validity gates.**
7. **Export reproducible `train.jsonl` and validation data** with a corpus manifest/hash.
8. **Produce rights, real-vs-synthetic, and rejection reports.**
9. **Freeze SimLab/MIRA and held-out PrintSense/Drive benchmarks.**
10. **Run base-only and base-plus-tools benchmarks before tuning.** This proves whether fine-tuning is needed beyond existing tools.
11. **Count tokens and generate the exact Together dry-run package.**
12. **Only then request Mike’s one-time paid authorization.**

## 11. Go/no-go decision

### Train only when all are true

- ≥150 recommended eligible records, never below the hard 100-record gate;
- ≥20 training lineages plus ≥5 untouched held-out lineages;
- both PrintSense and Drive Commander have meaningful representation;
- ≥20 refusal/correction and ≥15 safety examples, preferably the higher targets above;
- every record has explicit rights, provenance, human approval, and an independent answer key;
- no test fixture, frozen benchmark, held-out derivative, sensitive tenant data, or unresolved private print leaked into training;
- base-vs-tools benchmark shows a behavior gap that a fine-tune could reasonably address;
- estimated spend remains within the approved cap;
- PR #2881’s authorization-ledger hardening is complete and green.

### Current decision

**NO-GO FOR PAID TRAINING. GO FOR DATASET CONSTRUCTION.**

The next valuable deliverable is not another fine-tuning API feature. It is a reproducible Dataset v0 candidate build that turns the best controlled sources into approved technician interactions and produces an honest paid-gate report.

## 12. Evidence references

Primary repository evidence used:

- `docs/zta/2026-07-22-technician-lora-phase0-reconciliation.md`
- `factorylm_ai/dataset/paid_gate.py`
- `factorylm_ai/dataset/{record.py,assemble.py}`
- `factorylm_ai/governance/`
- `factorylm_ai/adapters/{printsense.py,drive_commander.py,mira_simlab.py}`
- `factorylm_ai/synth/`
- `printsense/fixtures/scu2/README.md`
- `docs/eval/2026-07-14-printsense-sheet20-case-study.md`
- `docs/eval/print-translator-campaign/{corpus_manifest.md,GAPS.md}`
- `docs/discovery/machine-pack/inventories/03-drive-packs.md`
- `tools/drive-pack-extract/gold/{durapulse_gs10,powerflex_40,powerflex_525}/gold.json`
- `machine-print-pack/examples/cv-101/data/pack_model.json`
- `docs/RESUME_2026-07-03_electrical-prints-and-mira-grounding.md`
- PRs `#2875` through `#2881`, plus PrintSense evidence PRs `#2867`, `#2869`, and `#2871`

A machine-readable companion inventory is provided in `docs/zta/2026-07-23-technician-dataset-candidate-inventory.csv`.
