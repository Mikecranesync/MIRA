# Fleet Orchestration PRD

**Status:** Draft / implementation-authoritative once approved  
**Date:** 2026-09-01  
**Owner:** Mike  
**Primary interface:** Grokbot in Slack  
**Repository:** MIRA

## 1. Purpose

Build a safe fleet orchestration system where Grokbot in Slack acts as the manager of development work across multiple computers, while isolated Claude and Codex sessions do the actual implementation, testing, review, investigation, and proof gathering.

The system must let Mike operate at the decision level instead of manually managing many agent terminals. Grokbot should understand the durable state of work from GitHub, dispatch work to appropriate worker sessions, collect proof-of-work, and return concise novice-level summaries that make the next decision obvious.

The system must never conflate physical computers with agent identities, and must never interrupt or take ownership of pre-existing interactive sessions that Mike already has open.

## 2. North-star experience

Mike should be able to message Grokbot in Slack with a mission such as:

> Investigate this bug with Claude on Bravo and have Codex on Charlie independently review it. Keep the PR held and tell me what decision I need to make.

Grokbot should then:

1. Inspect the relevant GitHub PRs, PRDs, issues, commits, CI state, and prior durable handoffs.
2. Decide what work is actually needed.
3. Select an appropriate node and provider for each task.
4. Launch new isolated fleet-owned Claude or Codex sessions.
5. Leave every pre-existing user session untouched.
6. Give each worker an isolated worktree at the correct Git base.
7. Monitor worker progress and collect durable proof-of-work.
8. Stop only the exact fleet-owned sessions it created when they are complete.
9. Reconcile worker outputs into one concise summary.
10. Present Mike with the minimum information needed to understand the result and make the next decision.
11. Track fleet usage and avoid exhausting weekly Claude, Codex, Grok, or API capacity unnecessarily.

## 3. Canonical terminology

These names are authoritative. Old terminology that treats Bravo, Charlie, Alpha, or other machine names as agent personas must not be used going forward.

### 3.1 Owner

**Mike** is the final decision maker.

Actions requiring explicit owner authorization should remain gated according to existing repository and deployment policy, including merges, production deployment, destructive cleanup, credential changes, or other consequential actions.

### 3.2 Orchestrator

**Grokbot in Slack** is the fleet manager / orchestration layer.

Grokbot is not normally an implementation worker.

Its responsibilities are to:

- understand outstanding missions;
- inspect GitHub state;
- dispatch Claude and Codex workers;
- monitor them;
- collect and validate proof-of-work;
- maintain mission state;
- summarize results for Mike;
- surface blockers and decisions;
- manage fleet capacity and usage.

Grokbot should not consume its context window doing large implementation jobs that should be delegated to workers unless Mike explicitly asks it to do so.

### 3.3 Nodes

**Bravo, Charlie, and future machine names refer only to physical or virtual computers.**

A node identity must never double as an agent identity.

Examples:

- Bravo = one computer.
- Charlie = another computer.

A node record should eventually contain enough durable information to prove where work actually executes, such as:

- canonical node name;
- operating system;
- observed hostname;
- connectivity/health status;
- supported providers;
- CAO/Gateway routing identity;
- repository/worktree root policy;
- capabilities and constraints.

### 3.4 Workers

**Claude and Codex are worker providers.**

A worker is an individual fleet-created session running on a node.

Human-readable naming must follow this pattern:

- Claude Session 1 on Bravo
- Claude Session 2 on Bravo
- Codex Session 1 on Bravo
- Codex Session 1 on Charlie
- Claude Session 3 on Charlie

Session numbering is local to the provider/node combination unless implementation requirements make a globally increasing number simpler.

The display name is for humans. Every worker must also receive an immutable machine-readable session ID.

### 3.5 Mission and task

A **mission** is a higher-level outcome Grokbot is responsible for advancing.

A **task** is one bounded assignment given to one worker.

A mission may contain several tasks, reviewers, retries, or handoffs.

## 4. Architectural roles

The intended hierarchy is:

Mike  
→ Slack  
→ Grokbot fleet manager  
→ GitHub durable work state  
→ node selection  
→ isolated Claude/Codex worker sessions  
→ proof-of-work and handoffs  
→ Grokbot reconciliation  
→ novice-level decision summary to Mike

GitHub and durable fleet artifacts are the source of truth. Slack conversation history must not be the only place mission state exists.

## 5. GitHub as durable development source of truth

Grokbot should use GitHub to reconstruct the development state even after Grokbot, Gateway, CAO, or worker restarts.

Relevant durable sources include:

- PRDs;
- issues;
- pull requests;
- draft/held state;
- review comments;
- commits and branches;
- CI checks;
- workflow results;
- linked acceptance evidence;
- task-status artifacts;
- worker handoff artifacts.

The system should avoid requiring live terminal history in order to understand what happened.

A restart of Grokbot must not erase the mission queue or force Mike to restate all outstanding work.

## 6. Session ownership and non-interference

This is a hard safety boundary.

### 6.1 Ownership rule

The fleet may manage only sessions that it can prove it created and owns.

Every fleet-created worker must record, at minimum:

- immutable fleet session ID;
- human-readable display name;
- provider;
- node;
- creator/orchestrator identity;
- mission/task ID;
- creation timestamp;
- worktree path;
- requested base ref/SHA;
- lifecycle status;
- explicit `fleet_owned=true` or equivalent durable ownership marker.

### 6.2 Pre-existing sessions

Before the fleet begins controlling a node, existing Claude, Codex, terminal, Cursor, SSH, or related sessions must be treated as:

**PRE-EXISTING / PROTECTED**

If the fleet did not create a session, it does not own that session.

It must not:

- stop it;
- restart it;
- reuse it;
- message it;
- attach it to a mission;
- clean it up;
- repurpose its worktree;
- assume its identity.

### 6.3 Fail closed

If the fleet cannot confidently distinguish a fleet-owned session from a pre-existing user session, it must not take destructive or controlling action against either session.

It must stop that operation and report the ambiguity.

The acceptance principle is:

> If ownership is uncertain, do nothing destructive.

### 6.4 Non-interference invariant

Starting, monitoring, messaging, stopping, or cleaning a fleet-owned session must not interrupt unrelated sessions already running on that node.

This invariant must become an automated regression test.

## 7. Worktree isolation

Every fleet worker doing repository work must receive its own isolated writable worktree unless a task is explicitly read-only and the implementation can prove no shared writable state exists.

Required properties:

- no two simultaneously active workers share the same writable worktree;
- base SHA/ref is recorded;
- actual checked-out commit is verified against the claimed artifact;
- worker output identifies its own task/worktree, not another worker's;
- worker cleanup must never delete a worktree it does not own;
- detached HEAD state must be represented truthfully in task/handoff metadata.

The known defect where durable task/handoff output may say `branch=main` while Git is detached must be fixed before branch metadata is relied upon for orchestration decisions.

## 8. True node identity

A provider role and a physical node are different identities.

The fleet must not claim cross-node operation merely because a worker has a different logical role name.

A future cross-node acceptance test must prove that a worker assigned to Charlie actually executes on Charlie by correlating at least:

- requested node;
- reported fleet node identity;
- observed machine hostname or equivalent machine identity;
- CAO/Gateway route;
- filesystem/worktree root;
- provider/session identity;
- requested Git base.

Current architecture work must preserve this distinction.

## 9. Worker lifecycle

The standard lifecycle for a fleet worker is:

1. Grokbot identifies a task.
2. Grokbot selects provider and node.
3. Fleet inventories/protects unrelated sessions.
4. Fleet creates a unique task ID.
5. Fleet creates a new worker session from scratch.
6. Fleet creates an isolated worktree at the required base.
7. Worker establishes its own provider/node/session identity.
8. Worker performs the bounded task.
9. Worker produces proof-of-work and a durable handoff.
10. Grokbot validates required evidence.
11. Fleet cleanly stops only that exact fleet-owned worker.
12. Fleet verifies unrelated sessions remain unaffected.
13. Durable task status and handoff remain inspectable after stop.
14. Grokbot summarizes the result and decides whether another task is required or Mike must decide.

## 10. Standardized proof-of-work

Every worker task should produce a consistent durable result containing enough evidence that another worker or Grokbot can verify it without relying on the worker's live session.

Minimum sections:

- task ID;
- mission ID if applicable;
- provider;
- node;
- requested objective;
- requested Git base;
- actual artifact commit/base verification;
- what was inspected;
- what was changed, if anything;
- tests/checks executed;
- result and verdict;
- concrete proof;
- defects or blockers found;
- files/commits/PRs produced;
- safety constraints honored;
- next recommended action;
- whether Mike needs to make a decision.

Proof should favor durable facts over prose claims.

## 11. Sanitized handoffs

Workers should hand work to other workers through durable artifacts rather than requiring the first worker to remain alive.

A handoff may contain only information intentionally required by the next task.

It should typically contain:

- task/mission identifier;
- requested base SHA/ref;
- concise objective;
- relevant findings;
- durable artifact references;
- explicit next action.

It must not unnecessarily contain:

- previous worker's live session ID;
- previous worker's worktree path;
- previous worker's hostname;
- live terminal/pane metadata;
- credentials or secrets;
- hidden orchestration state;
- information not required by the consumer.

A consumer worker must establish its own identity and its own worktree before continuing.

Cross-role handoff and true cross-node handoff are separate acceptance gates.

## 12. Grokbot mission management

Grokbot should continuously maintain a current view of outstanding development work from GitHub and fleet artifacts.

It should be capable of recognizing, grouping, and prioritizing things such as:

- open issues;
- unfinished PRD requirements;
- draft or HELD PRs;
- pending reviews;
- CI failures;
- unresolved reviewer findings;
- incomplete acceptance evidence;
- blocked deploys;
- orphaned branches/worktrees where safe to inspect;
- missions waiting for Mike's decision.

Grokbot should not create work merely to keep workers busy. It should dispatch the minimum useful set of workers required to make meaningful progress and collect credible independent verification.

## 13. Human reporting

Grokbot's final user-facing output should optimize for decision quality, not exhaustiveness.

Mike should normally receive a concise novice-level summary answering:

1. What happened?
2. Did it work?
3. What proof do we have?
4. Is anything broken or risky?
5. What remains?
6. What decision, if any, does Mike need to make?

Detailed worker logs should remain available as drill-down evidence but should not dominate the Slack summary.

A representative summary might say:

> Four tasks completed. Three passed. One found a real defect and produced a fix. Codex independently verified the fix. Two PRs are ready but remain HELD. Nothing was merged or deployed. One decision is needed: whether to merge PR #XXXX.

## 14. Usage and weekly capacity governor

Usage management is a first-class fleet responsibility.

Grokbot should maintain a rolling view of available and consumed capacity for each relevant provider/account, including where possible:

- Claude;
- Codex;
- Grok/Grokbot;
- API-based model spend;
- other paid agent services added later.

The fleet should distinguish exact provider-reported usage from estimated usage.

### 14.1 Desired metrics

For each provider/account, track when available:

- current weekly usage;
- weekly allowance or budget;
- percentage consumed;
- time elapsed in the budget period;
- burn rate;
- projected end-of-period usage;
- active session count;
- historical usage per task type/provider;
- cost per completed mission where meaningful.

### 14.2 Budget-aware dispatch

Grokbot should be able to adjust dispatch policy when usage is running too fast, for example:

- reserve a scarcer provider for difficult implementation;
- use another provider for routine independent review;
- avoid redundant reviewers when confidence is already sufficient;
- postpone low-priority archaeology or exploratory work;
- warn Mike before projected exhaustion;
- stop creating optional work solely to consume idle compute.

Budget policy must never silently weaken required safety or acceptance evidence.

If exact account usage is unavailable from a provider, the system should maintain an explicitly labeled estimate using the best available telemetry rather than pretending the number is exact.

## 15. Grokbot guardrails

Some rules must be enforced in infrastructure and not depend only on prompts.

At minimum, design hard checks for:

- no stop/kill/restart of an unowned session;
- no deletion of an unowned worktree;
- no two active workers sharing a writable worktree;
- no silent merge of a HELD PR;
- no production deployment without required authorization/gates;
- no credentials/secrets in worker handoffs;
- no false claim that a logical role proves a physical node;
- no destructive cleanup when ownership is ambiguous;
- no transition to a later acceptance phase after a failed isolation/safety gate unless explicitly authorized.

## 16. Auditability and recovery

The fleet should be reconstructable after process or machine restarts.

Durable state should make it possible to answer:

- Which missions are outstanding?
- Which workers were launched?
- On which nodes?
- Which provider performed each task?
- What Git base did each worker receive?
- Which sessions are still active?
- Which sessions are fleet-owned?
- What proof did each worker produce?
- Which PRs/issues/commits resulted?
- What decisions are waiting for Mike?
- What usage has been consumed this week?

Grokbot should not depend on remembering prior Slack context to answer these questions.

## 17. Acceptance tests

The following tests should become permanent regression coverage as the fleet matures.

### A. Session non-interference

Given one or more pre-existing user sessions on a node, start and stop a new fleet-owned Claude or Codex worker.

PASS requires all pre-existing sessions to remain alive and unaffected.

### B. Ownership fail-closed

Present the fleet with a session whose ownership cannot be proven.

PASS requires the fleet to refuse stop/restart/cleanup and report ambiguity.

### C. Worktree isolation

Run two workers concurrently on the same repository.

PASS requires distinct writable worktrees and no cross-worker file contamination.

### D. Provider/session identity

Launch fresh Claude and Codex workers.

PASS requires each to report its own provider/session identity and durable task status without inheriting another worker's session identity.

### E. Sanitized handoff/resume

Worker A produces a sanitized durable handoff and is fully stopped before Worker B starts.

PASS requires Worker B to continue successfully without access to Worker A's live session and without claiming Worker A's session/worktree identity.

### F. True cross-node routing

Assign a worker to Charlie while unrelated sessions exist on Bravo and Charlie.

PASS requires proof that execution occurred on the Charlie machine itself, using independent machine identity evidence, while protected sessions remain unaffected.

### G. Grokbot restart recovery

Restart or recreate the orchestrator.

PASS requires Grokbot to reconstruct outstanding missions and durable worker results from GitHub/fleet state without Mike restating the mission history.

### H. Usage governor

Simulate or observe a provider approaching its weekly capacity threshold.

PASS requires Grokbot to detect excessive burn rate, report it accurately as exact or estimated, and adjust optional dispatch behavior according to policy without weakening required safety gates.

## 18. Implementation phases

### Phase 1 — Foundations

- freeze canonical naming;
- durable node registry;
- explicit fleet session ownership;
- protected-session inventory;
- unique worker IDs;
- isolated worktree lifecycle;
- accurate stopped/running status;
- standardized proof/handoff format.

### Phase 2 — Safe handoff

- producer/consumer durable handoff;
- prove no live-session dependency;
- prove identity isolation;
- retain task evidence after both workers stop.

### Phase 3 — True multi-node routing

- route workers to actual requested machines;
- prove machine identity independently;
- maintain protected-session invariants on every node;
- support simultaneous work across Bravo and Charlie.

### Phase 4 — Grokbot mission manager

- GitHub mission discovery;
- task decomposition;
- provider/node selection;
- worker dispatch and monitoring;
- proof collection;
- novice-level reconciliation and decision summaries.

### Phase 5 — Usage governor

- provider usage adapters;
- exact-vs-estimated telemetry;
- weekly burn-rate calculation;
- provider-aware dispatch policy;
- budget warnings and reporting.

### Phase 6 — Recovery and scale

- orchestrator restart recovery;
- more nodes;
- concurrent mission management;
- stale-session/worktree detection with ownership-safe cleanup;
- long-running mission dashboards and audit trails.

## 19. Current known facts and defects

At the time this PRD was written:

- real Gateway → CAO launch has been proven for fresh Claude/Codex task sessions;
- independent provider/session/worktree identities have been proven;
- durable `task_status` and handoff artifacts survive worker stop;
- Charlie logical-role testing has still executed through the Bravo physical host path, so true Charlie machine routing is not yet proven;
- durable metadata may still label `branch=main` while Git is actually detached at the requested base SHA;
- Gateway MCP does not yet provide a durable read-reply tool for worker chat content;
- existing user sessions on fleet nodes must be explicitly protected before broader orchestration/cleanup is enabled.

These known defects must not be hidden by naming or reporting conventions.

## 20. Non-goals

This PRD does not authorize:

- Grokbot to merge every passing PR automatically;
- Grokbot to deploy production automatically without the existing required gates/authorization;
- arbitrary control of user-created terminal/Claude/Codex sessions;
- destructive cleanup of unknown processes or worktrees;
- embedding credentials in worker prompts or handoffs;
- treating Grokbot as the primary coding worker;
- claiming cross-node capability before physical node identity is proven.

## 21. Definition of done

The fleet orchestration system is successful when Mike can use Slack as the high-level command surface and reliably trust that:

- Grokbot understands outstanding work from durable sources;
- Grokbot launches the right new Claude/Codex workers on the right computers;
- existing sessions remain untouched;
- every worker gets isolated repository state;
- workers can hand work off without remaining alive;
- worker claims are backed by inspectable proof;
- Grokbot can condense many worker outputs into one understandable decision report;
- GitHub retains the durable development record;
- the system can recover from orchestrator restarts;
- weekly AI capacity is measured and managed;
- safety rules fail closed when ownership or identity is uncertain.

The desired end state is not "one AI writes all the software." It is a controlled, auditable, budget-aware AI development fleet where Grokbot manages the work, Claude and Codex perform bounded tasks, GitHub preserves truth, and Mike remains the final decision maker.
