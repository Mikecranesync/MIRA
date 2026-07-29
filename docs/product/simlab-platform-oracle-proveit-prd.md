# PRD: SimLab as the FactoryLM/MIRA Platform Oracle

> **Status:** Authoritative product direction for the February **ProveIt 2027** objective.
> **Owner:** Mike. **Captured:** 2026-06-21. **Companion plan:**
> `docs/plans/2026-06-21-simlab-platform-oracle-implementation-plan.md` (phased, sub-agent execution).
>
> This PRD is intentionally focused on **winning ProveIt 2027**, not on adding features. The next
> ~8 months prioritize exactly three things, in this order of leverage:
> **(1) Parser → Contextualizer → UNS · (2) SimLab as the oracle · (3) MIRA evidence-backed diagnosis.**
> Everything else (agents, autonomous actions, MCP integrations, fancy workflows) becomes easy to
> justify *after* we can stand at ProveIt and objectively prove MIRA diagnosed a fault correctly
> against known industrial ground truth.

## Executive Summary

FactoryLM/MIRA's February ProveIt objective is **not** to demonstrate a chatbot. It is to demonstrate
a complete **industrial intelligence loop**:

1. Ingest industrial artifacts.
2. Build contextualized factory knowledge.
3. Observe live factory state.
4. Diagnose faults.
5. Produce evidence-backed answers.
6. Score performance against known ground truth.

**SimLab becomes the authoritative ground-truth system for the platform.** Every major capability
(parser, contextualizer, retrieval, diagnostics, UNS mapping, root-cause analysis) must be measurable
against SimLab.

**End state:** *"A stranger uploads industrial information and MIRA produces a cited diagnosis that can
be objectively scored against known truth."*

## Problem Statement

Current platform components operate largely independently — PLC Parser, Contextualizer, Document
Ingestion, UNS Builder, MIRA Assistant, Root-Cause Analysis, SimLab. There is no single authoritative
mechanism proving the entire pipeline works end-to-end. As a result: regressions go unnoticed,
retrieval/parser/diagnostic quality are each hard to measure, and demo success depends on manual
verification. **This is incompatible with ProveIt-style validation.**

## Vision

Elevate SimLab from **"diagnostic benchmark"** to **"platform oracle"** — the single source of truth
for, per scenario: expected asset · expected root cause · expected evidence · expected citations ·
expected corrective actions · expected UNS mappings. All platform components are measured against
these expectations.

## Success Criteria

A scenario can be executed and **automatically scored**. Example:

```
Question:   "Why did Conveyor 3 stop?"
Ground Truth:
  Asset:     Conveyor3
  Root Cause: Blocked Photoeye
  Evidence:  Conveyor3.PhotoeyeBlocked
  Citation:  photoeye_manual.pdf
  Action:    Clear obstruction
```

MIRA's response is automatically graded on root-cause accuracy, evidence recall, citation accuracy,
asset identification, and corrective-action accuracy → an overall scenario score.

## ProveIt Demonstration Workflow

**Phase 1 — Context Creation.** User uploads manuals + PLC export + tag list + asset documentation.
System parses, extracts, classifies, contextualizes, and builds the UNS mapping → **approved
industrial context.**

**Phase 2 — Live Factory State.** SimLab publishes live telemetry. A fault is injected (jam, blocked
photoeye, VFD fault, motor overload). The system observes abnormal conditions.

**Phase 3 — Diagnosis.** MIRA produces root cause + evidence + citations + corrective actions,
**grounded only in approved context.**

**Phase 4 — Automated Scoring.** SimLab grades root-cause accuracy, evidence recall, citation
accuracy, asset identification, corrective-action accuracy → overall scenario score, displayed live.

## Architecture Objectives

### Objective 1 — Make SimLab a mandatory evaluation layer
Reusable scenario runner + reusable scoring interface; deterministic, repeatable outputs.
**Deliverable:** SimLab Evaluation Service.

### Objective 2 — Create an end-to-end Beta Gate
Input: manuals + documents. Output: question-answering scorecard. Measures citation correctness,
retrieval correctness, answer quality. **Deliverable:** Beta Gate Harness.

### Objective 3 — Connect the PLC Parser to SimLab
Parser outputs (assets, tags, signals, inferred equipment) convert into an **industrial intermediate
representation** that SimLab consumes — static structure and dynamic behavior share one model.
**Deliverable:** Parser → IR → SimLab Bridge.

### Objective 4 — Scenario Difficulty Framework
Support fault-timing changes, multiple faults, noisy telemetry, misleading symptoms, cascading
failures; measure **performance-degradation curves.** **Deliverable:** Scenario Mutation Engine.

### Objective 5 — Continuous Integration Validation
Every PR automatically executes parser / retrieval / citation / diagnostic tests → a SimLab scorecard.
**Regression blocks merge.** **Deliverable:** SimLab CI Pipeline.

## February ProveIt Deliverables

**Must Have:** upload industrial documentation · auto-contextualization · live telemetry · SimLab
fault injection · root-cause analysis · evidence citations · ground-truth scoring · live dashboard.

**Should Have:** PLC-export ingestion · UNS generation · i3X exposure · human approval workflow.

**Nice To Have:** multi-fault scenarios · comparative model testing · robustness scoring.

## Definition of Success

A conference attendee can: (1) upload industrial information, (2) watch context creation, (3) trigger
a fault, (4) ask MIRA what happened, (5) see evidence and citations, (6) compare the answer against
known truth, (7) watch the system score itself — **no manual intervention, no hidden prompts, no
hand-crafted demo paths. The platform proves its own correctness.**

## Eight-Month Priority

Focus on only three things; everything else follows once the loop is objectively provable:

1. **Parser → Contextualizer → UNS**
2. **SimLab as the oracle**
3. **MIRA evidence-backed diagnosis**
