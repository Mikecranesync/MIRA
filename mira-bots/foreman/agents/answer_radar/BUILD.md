# Answer Radar — Grokbot Build Handoff

**Status:** Ready for Grokbot implementation planning  
**Owner:** FactoryLM Foreman / Grokbot  
**Canonical architecture:** `docs/architecture/2026-09-05-mira-answer-radar-grokbot-agent-architecture.md`

## Mission

Build `answer-radar` as a specialized autonomous mission controlled by FactoryLM Foreman/Grokbot.

Grokbot stays the orchestration layer. MIRA is the system under test. Independent Claude/Codex workers verify MIRA's answers from authoritative evidence.

The required loop is:

> Discover → Freeze → Qualify → Test MIRA → Independently Verify → Score → Learn → Report

## Before coding

1. Read the canonical architecture document in full.
2. Inspect the existing `mira-bots/foreman/` implementation and Fleet Gateway interfaces before designing new abstractions.
3. Reuse existing Foreman session management, worker launch, ownership, handoff, review, and stop mechanisms wherever possible.
4. Identify the smallest implementation slice that proves one complete Answer Radar mission end to end.
5. Do not create a competing orchestration framework.

## V1 target

One Slack instruction — `@Foreman run Answer Radar` — must be able to drive a mission that:

1. ingests fresh real industrial-maintenance questions,
2. selects and freezes a balanced holdout set,
3. runs those questions through the real MIRA product path,
4. records the exact MIRA/retrieval/prompt version,
5. independently verifies answers with Claude/Codex reviewers,
6. calculates VCAD (Verified Correct Answers per Day),
7. classifies failures and knowledge gaps,
8. prepares human-approved public reply candidates,
9. reports a concise result back to Slack.

Start with a target of 30 fresh evaluated questions per day. Batch workers rather than spawning one session per question.

## Hard boundaries

- Do not turn Grokbot into the maintenance-answering worker.
- Do not let reviewer answers leak into MIRA before the fresh attempt is frozen.
- Do not auto-post, comment, or DM externally in V1.
- Do not bypass platform restrictions.
- Do not expose passwords/access codes or weaken safety systems.
- Do not use third-party public posts as model-weight training data without rights clearance.
- Do not merge or deploy without explicit approval.
- Keep Alpha, Bravo, and Charlie strictly as physical node names. Name workers by provider/session and attach Answer Radar roles as metadata.
- Do not interrupt or adopt unrelated existing sessions.

## Expected first delivery

Return to Mike in Slack with:

- the implementation plan,
- exact files/modules to add or modify,
- how existing Foreman/Fleet Gateway pieces will be reused,
- the minimal end-to-end proof case,
- tests and acceptance gates,
- any credentials/API access that only Mike must supply,
- and a clear `READY TO BUILD`, `BLOCKED`, or `NEEDS DECISION` status.

After that, launch isolated coding workers only as needed to implement and prove the V1 slice. Keep all changes on a branch/PR and leave merge/deploy held for explicit approval.

## Grokbot entry instruction

Use this exact instruction from Slack:

> Read `mira-bots/foreman/agents/answer-radar/BUILD.md` and its canonical architecture at `docs/architecture/2026-09-05-mira-answer-radar-grokbot-agent-architecture.md`. Treat them as the source of truth for ANSWER-RADAR-001. Inspect the existing Foreman and Fleet Gateway code first, then plan and build the smallest end-to-end Answer Radar V1 by reusing existing infrastructure. You own orchestration; MIRA must be the system under test and independent Claude/Codex workers must verify it. Keep all work isolated, do not interrupt unrelated sessions, and do not merge, deploy, or post publicly. Return concise status and proof to this Slack thread.
