# MIRA Answer Radar — Grokbot Agent Architecture

**Status:** Proposed implementation architecture  
**Date:** 2026-09-05  
**Owner / command center:** FactoryLM Foreman / Grokbot in Slack  
**System under test:** MIRA  
**Primary metric:** VCAD — Verified Correct Answers per Day

---

## 1. Decision

Build **Answer Radar as a specialized autonomous mission owned by Grokbot**, not as logic embedded directly into Grokbot.

Grokbot remains the orchestration and management layer. It creates, supervises, and stops workers. It does not become the maintenance expert and it does not grade MIRA itself.

The core loop is:

> **Discover → Freeze → Qualify → Test MIRA → Independently Verify → Score → Learn → Report**

---

## 2. High-Level Architecture

```text
                        SLACK COMMAND CENTER
                      #factorylm-foreman
                              │
                              ▼
                 ┌───────────────────────────┐
                 │ FactoryLM Foreman/Grokbot│
                 │ orchestration only       │
                 └─────────────┬─────────────┘
                               │
             schedule / "run radar" / API trigger
                               │
                               ▼
                 ┌───────────────────────────┐
                 │ Answer Radar Mission      │
                 │ Controller                │
                 └─────────────┬─────────────┘
                               │
        ┌──────────────────────┼────────────────────────┐
        │                      │                        │
        ▼                      ▼                        ▼
┌───────────────┐      ┌───────────────┐       ┌────────────────┐
│ Feed Connectors│     │ Web Discovery │       │ Manual / Share │
│ X, YouTube,   │      │ public search │       │ Facebook /     │
│ RSS, forums   │      │ fallback      │       │ LinkedIn links │
└───────┬───────┘      └───────┬───────┘       └────────┬───────┘
        └───────────────────────┼────────────────────────┘
                                ▼
                   ┌────────────────────────┐
                   │ Candidate Question DB  │
                   │ normalize + dedupe     │
                   └────────────┬───────────┘
                                ▼
                   ┌────────────────────────┐
                   │ Answer Radar Scout     │
                   │ agent / worker         │
                   │ classify + score       │
                   └────────────┬───────────┘
                                ▼
                   ┌────────────────────────┐
                   │ Fresh Holdout Queue    │
                   │ frozen before replies  │
                   └────────────┬───────────┘
                                ▼
                        ┌───────────────┐
                        │ MIRA solves it│
                        │ normal product│
                        │ workflow      │
                        └───────┬───────┘
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
       ┌──────────────────┐          ┌──────────────────┐
       │ Independent      │          │ Adversarial      │
       │ Reviewer A       │          │ Reviewer B       │
       │ expected answer  │          │ unsupported/safe │
       └─────────┬────────┘          └─────────┬────────┘
                 └──────────────┬──────────────┘
                                ▼
                    ┌──────────────────────┐
                    │ Scoring / Adjudicate│
                    │ correctness + safety│
                    └──────────┬───────────┘
                               ▼
              ┌─────────────────────────────────┐
              │ Benchmark + Failure + Knowledge │
              │ Gap Store                       │
              └───────────────┬─────────────────┘
                              │
          ┌───────────────────┼──────────────────────┐
          ▼                   ▼                      ▼
  Regression Queue     Knowledge Gap Queue    Reply Draft Queue
          │                   │                      │
          └───────────────────┼──────────────────────┘
                              ▼
                   ┌──────────────────────┐
                   │ Daily Slack Report   │
                   │ VCAD + best leads    │
                   └──────────────────────┘
```

---

## 3. Grokbot's Role

Grokbot is the **foreman**, not the worker.

It should:

1. Start an Answer Radar mission on schedule or command.
2. Check current fleet/session state before spawning anything.
3. Reuse a safe warm worker when appropriate.
4. Spawn isolated Claude/Codex workers when needed.
5. Pass each worker a narrow role and task.
6. Track the mission state and question IDs.
7. Ensure MIRA is the system being tested.
8. Keep graders independent from MIRA.
9. Stop/hand off workers cleanly when complete.
10. Return a novice-friendly summary to Slack.
11. Create improvement work only from verified failures.
12. Never merge/deploy product changes unless separately authorized.

Grokbot must **not**:

- answer the benchmark question instead of MIRA
- let a reviewer leak the expected solution to MIRA
- read forum/community replies before the fresh MIRA attempt when avoidable
- auto-post public replies during MVP
- turn third-party posts directly into model-training data without rights clearance

---

## 4. Specialized Agent: `answer-radar`

### Mission

Find fresh real industrial-maintenance problems and use them to measure and improve MIRA.

### Agent contract

```yaml
agent_role: answer-radar
owner: grokbot
mode: autonomous-mission
external_posting: disabled
system_under_test: mira
primary_metric: VCAD
fresh_holdout_required: true
independent_grading_required: true
safety_gate_required: true
training_rights_gate_required: true
```

### Responsibilities

- collect candidate questions
- normalize and deduplicate
- extract equipment/manufacturer/model/symptom
- assign lead score
- assign answerability score
- assign safety class
- freeze fresh question snapshot
- submit question to MIRA
- request independent reviewers
- collect reviewer evidence
- calculate benchmark result
- create failure classification
- create internally authored regression scenario when appropriate
- prepare a human-approved public reply draft
- produce daily report

---

## 5. Worker Model

Do not treat physical computer names as agent personas.

Correct naming:

- **Claude Session 1 on Bravo — role: Answer Radar Scout**
- **Codex Session 1 on Charlie — role: Independent Reviewer**
- **Claude Session 2 on Alpha — role: Adversarial Reviewer**

Bravo, Charlie, and Alpha remain physical nodes only.

### Suggested MVP worker allocation

**Scout / researcher**
- one warm Claude worker
- processes batches of candidate questions
- researches official manuals only after the question has been frozen
- does not grade its own output

**Reviewer A**
- Codex worker
- independently establishes the expected technical answer from authoritative evidence before seeing MIRA's answer

**Reviewer B**
- Claude worker or second independent provider
- attacks assumptions, model/revision mismatches, unsupported parameters, safety problems, and stale evidence

### Throughput

Do not spawn one worker for every question.

Batch work:

```text
30 questions/day
↓
3 batches of 10
↓
1 Scout worker processes candidate metadata
1 MIRA evaluation lane
Reviewer A reviews batch
Reviewer B reviews batch
disagreements only → human/Grokbot escalation
```

This keeps cost/session count under control while preserving independence.

---

## 6. State Machine

Every question moves through a deterministic state machine.

```text
DISCOVERED
   │
   ▼
NORMALIZED
   │
   ▼
DEDUPED
   │
   ▼
QUALIFIED
   │
   ▼
FROZEN_FRESH
   │
   ▼
MIRA_ATTEMPTED
   │
   ├── unsafe/system error → ESCALATE
   │
   ▼
REVIEW_A_COMPLETE
   │
   ▼
REVIEW_B_COMPLETE
   │
   ├── disagreement → HUMAN_ADJUDICATION
   │
   ▼
SCORED
   │
   ├── PASS → VERIFIED_CORRECT
   │
   ├── correct need-more-info → CORRECT_ABSTENTION
   │
   └── FAIL → FAILURE_QUEUE
   │
   ▼
REPORTABLE
```

No stage may silently skip `FROZEN_FRESH`, `MIRA_ATTEMPTED`, or the safety gate.

---

## 7. Feed Layer

The feed layer should be code/connectors, not an LLM repeatedly browsing everything.

### Tier 1

- X recent-search API
- YouTube Data API
- RSS / Atom
- Discourse APIs
- Stack Exchange APIs
- supported forum APIs
- sitemaps/public indexes where allowed

### Tier 2

- public web search as discovery fallback
- OEM/community pages with permitted public access

### Human-assisted

- Facebook Group post shared into Radar
- LinkedIn post shared into Radar
- screenshots/links forwarded from Slack/mobile

### Connector output

All connectors emit one common schema:

```yaml
platform:
external_id:
url:
posted_at:
author_public_handle:
title:
body_or_permitted_excerpt:
discovered_at:
rights_class:
thread_replies_fetched: false
```

`thread_replies_fetched` should remain false until after MIRA's fresh attempt whenever practical.

---

## 8. Question Qualification

The Answer Radar Scout computes two separate scores.

### Lead Score

Commercial usefulness:

- real equipment problem
- urgency
- technician/operator likelihood
- model specificity
- recurrence potential
- FactoryLM fit
- public-answer usefulness

### Answerability Score

Technical solvability:

- exact manufacturer/model known
- fault/symptom clear
- OEM docs discoverable
- configuration context sufficient
- ambiguity level
- safety sensitivity

Example:

```text
Lead score: 98
Answerability: 42
Action: Ask for model/firmware/photo instead of guessing
```

---

## 9. Fresh Benchmark Isolation

This is critical.

For every selected question:

1. Save/freeze the question.
2. Do **not** inspect community answers yet.
3. Send only the problem plus allowed source context to MIRA.
4. Save MIRA's answer and citations.
5. Reviewer A independently researches an expected solution.
6. Only then expose MIRA's answer to Reviewer A.
7. Reviewer B performs an adversarial review.
8. Community answers may be checked afterward as secondary evidence.

This prevents benchmark leakage.

---

## 10. MIRA Evaluation Interface

Answer Radar should call MIRA through the same API/product path used by real customers.

Example request:

```json
{
  "benchmark_id": "FIELD-2026-09-05-001",
  "question": "...normalized real maintenance question...",
  "manufacturer": "Omron",
  "model": "...",
  "mode": "fresh_holdout",
  "allow_community_answers": false
}
```

Capture:

- MIRA version/SHA
- model/provider
- retrieval version
- prompt version
- source documents
- answer
- citations
- latency
- cost
- answer status

The benchmark must therefore tell us **which exact MIRA build** solved or failed each question.

---

## 11. Independent Verification

### Reviewer A — expected solution

Before seeing MIRA's answer:

- identify exact equipment/model/revision
- find authoritative OEM/technical sources
- derive expected diagnosis or safe next step
- record required uncertainty
- record prohibited unsafe claims

Then compare MIRA to that expected solution.

### Reviewer B — adversarial audit

Check:

- wrong model or revision
- protocol confusion
- unsupported parameter/value
- invented access credential
- missing safety warning
- stale manual
- source does not support claim
- overconfidence
- failure to request required missing information

### PASS rule

Verified Correct only if:

- score >= 85/100
- technical correctness >= 34/40
- safety = 20/20
- no critical unsupported asset-specific claim
- independent reviewers PASS or human adjudication resolves PASS

---

## 12. Failure-to-Agent Loop

A failed question becomes a new Grokbot mission, not an immediate random code change.

```text
MIRA FAIL
   │
   ▼
Classify failure
   │
   ├── missing manual → Knowledge Acquisition mission
   ├── retrieval miss → Retrieval Improvement mission
   ├── prompt/reasoning miss → Evaluation/Prompt mission
   ├── product defect → GitHub issue / coding mission
   └── unsafe answer → Safety blocker mission
```

Grokbot may then launch a coding worker, but the coding worker receives the **generalizable failure**, not an instruction to memorize that one forum answer.

After a fix:

```text
failed case
+ related regression cluster
+ fresh untouched questions
```

must all be rerun.

---

## 13. Training-Material Pipeline

Do not automatically treat scraped/public user text as model training data.

Three stores:

### Fresh
Today's unseen questions. Never used to tune before scoring.

### Regression
Past failures/edge cases used to prevent recurrence.

### Development / Training
Only:

- FactoryLM-authored scenarios
- synthetic variants
- customer-submitted content with appropriate rights
- licensed/permissioned material

When a public question teaches a useful pattern, create an internally authored scenario that captures the technical lesson without copying the user's post.

---

## 14. Slack Command Center

Natural-language Slack commands should be enough:

```text
@Foreman run Answer Radar now
@Foreman how is Answer Radar doing?
@Foreman show me today's 3 best customer questions
@Foreman show MIRA's failures today
@Foreman explain why FIELD-2026-09-05-004 failed
@Foreman turn repeated failures into regression tasks
@Foreman find the manuals that would increase VCAD the most
@Foreman rerun yesterday's failed cases on current MIRA
```

Optional slash commands:

```text
/radar run
/radar status
/radar best
/radar failures
/radar question FIELD-...
/radar rerun FIELD-...
```

### Daily Slack summary

```text
ANSWER RADAR — Sep 5

Discovered: 412
Qualified: 67
Fresh evaluated: 30
Verified correct: 24
Correct abstentions: 3
Incorrect: 3
Unsafe: 0
VCAD: 24

Best questions to answer publicly:
1. Omron FINS/TCP — 98 lead
2. SLC 5/03 / USR-N540 — 97
3. FX5U / Baykon BX11 — 95

Biggest MIRA gap:
Legacy OEM documentation

Recommended next action:
Acquire Festo SPC-100 documentation.
Estimated affected field cases this week: 6
```

---

## 15. Autonomy Boundaries

Answer Radar may autonomously:

- discover public questions through approved feeds
- score/dedupe/classify
- call MIRA
- launch independent review workers through Grokbot
- update benchmark records
- create regression candidates
- draft public replies
- recommend knowledge acquisition
- create an internal issue/task when policy permits

It may **not** autonomously:

- post public replies during MVP
- DM prospects
- bypass platform restrictions
- expose passwords/access codes
- weaken safety systems
- merge code
- deploy MIRA
- alter production retrieval data without an approved path
- put third-party public content into model-weight training without rights clearance

---

## 16. Persistence / Database

Suggested tables or collections:

```text
answer_radar_sources
answer_radar_questions
answer_radar_snapshots
answer_radar_mira_runs
answer_radar_reviews
answer_radar_scores
answer_radar_failures
answer_radar_regressions
answer_radar_knowledge_gaps
answer_radar_reply_drafts
answer_radar_outcomes
answer_radar_missions
```

Key invariant:

```text
question snapshot + MIRA version + retrieval version + grader evidence
```

must be reproducible later.

---

## 17. Mission Controller Pseudocode

```python
def run_answer_radar():
    mission = foreman.create_mission("ANSWER-RADAR")

    candidates = feeds.collect_since(last_successful_run)
    candidates = normalize_and_dedupe(candidates)

    ranked = scout.score(candidates)
    fresh = select_balanced_fresh_set(ranked, target=30)

    for q in fresh:
        freeze(q)

        mira_result = mira.solve(q)

        expected = reviewer_a.build_expected_answer(q)
        review_a = reviewer_a.grade(mira_result, expected)

        review_b = reviewer_b.adversarial_grade(q, mira_result)

        result = adjudicate_and_score(q, mira_result, review_a, review_b)
        persist(result)

        if result.failed:
            create_failure_record(result)

        if result.public_reply_eligible:
            draft_reply(result)

    report = build_daily_report()
    foreman.post_to_slack(report)

    mission.complete()
```

---

## 18. Grokbot Prompt to Build This

Use this as the implementation mission:

> **Build MIRA Answer Radar as a specialized autonomous mission controlled by FactoryLM Foreman/Grokbot. Grokbot remains the orchestration layer; do not turn it into the maintenance expert. Implement the loop Discover → Freeze → Qualify → Test MIRA → Independent Verify → Score → Learn → Report. Feed collection should use approved platform APIs/feeds where available and a common candidate schema. Freeze every selected question before reading community replies so MIRA gets a true fresh holdout. Run the question through the real MIRA product path, capture the exact MIRA/retrieval/prompt version, then have independent Claude/Codex reviewers establish and verify the expected answer from authoritative OEM sources. Track VCAD, correct abstentions, unsafe answers, failures, knowledge gaps, and reply candidates. Failures should create generalizable regression/improvement work, not teach MIRA the forum answer directly. Do not auto-post public replies, merge, deploy, bypass platform restrictions, or use third-party content for model training without rights clearance. Keep Alpha/Bravo/Charlie strictly as physical node names; name workers by provider/session and attach Answer Radar roles as metadata. Start with 30 fresh evaluations/day and produce a concise daily Slack report with VCAD, best 3 customer questions, top failures, and the next highest-impact improvement.**

---

## 19. Recommended MVP Build Order

1. Mission controller + DB schema.
2. Manual/public-web ingestion so the 10 current real questions become seed cases.
3. MIRA evaluation adapter.
4. Independent review workflow.
5. Scoring + VCAD report.
6. Slack commands/report.
7. X connector.
8. YouTube connector.
9. RSS/Discourse/forum connectors.
10. Failure → regression/knowledge-gap automation.
11. Human-approved public reply queue.
12. Only after quality is proven: platform-native posting for allowed categories.

---

## 20. Definition of Done for V1

V1 is done when one Slack command:

```text
@Foreman run Answer Radar
```

causes Grokbot to:

1. collect fresh real industrial questions,
2. choose a balanced fresh set,
3. run them through MIRA,
4. independently verify them,
5. calculate VCAD,
6. classify failures,
7. create regression/knowledge-gap candidates,
8. prepare the best public reply opportunities,
9. and return one concise report to Slack,

without the user manually prompting each worker.
