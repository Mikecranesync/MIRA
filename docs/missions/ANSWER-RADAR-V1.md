# Answer Radar V1 — Mission Documentation

**Status:** MVP Implementation Complete  
**Owner:** FactoryLM Foreman / Grokbot  
**System Under Test:** MIRA  
**Primary Metric:** VCAD (Verified Correct Answers per Day)

---

## Mission Overview

Answer Radar is an autonomous mission that discovers, evaluates, and verifies real industrial maintenance questions through MIRA. It measures MIRA's correctness using independent reviewers and calculates VCAD to track improvement over time.

## Mission Flow

```
Discover → Normalize → Qualify → Freeze → Test MIRA → Review A → Review B → Score → Report
```

### State Machine

Every question progresses through:

1. `DISCOVERED` — Found from feed/manual source
2. `NORMALIZED` — Manufacturer/model/symptom extracted
3. `QUALIFIED` — Lead score + answerability score computed
4. `FROZEN_FRESH` — Locked before community replies fetched
5. `MIRA_ATTEMPTED` — MIRA answered via product path
6. `REVIEW_A_COMPLETE` — Independent expected answer established
7. `REVIEW_B_COMPLETE` — Adversarial review completed
8. `SCORED` — Final VCAD verdict calculated
9. `VERIFIED_CORRECT` / `CORRECT_ABSTENTION` / `FAILURE_QUEUE` — Terminal state

## How Foreman Runs This

### Manual Trigger (V1 MVP)

From Slack `#factorylm-foreman`:

```
@Foreman run Answer Radar
```

Foreman will:
1. Load seed questions from `mira-bots/foreman/agents/answer-radar/fixtures/seed_questions.json`
2. Process each question through the state machine
3. Call MIRA via configured adapter (FakeMiraAdapter for tests, RealMiraAdapter for production)
4. Launch two independent reviewer workers:
   - Reviewer A (Codex on Charlie) — establishes expected answer
   - Reviewer B (Claude on Charlie) — adversarial review
5. Calculate VCAD and generate report
6. Post summary to Slack (does NOT auto-post public replies in V1)

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MIRA_API_URL` | No (falls back to FakeMiraAdapter) | Real MIRA HTTP endpoint |
| `MIRA_API_KEY` | No | Authentication for MIRA API |
| `FOREMAN_ROUTING_CARD` | No | Enable specialist routing (default: off) |

### Automated Schedule (Future)

Once proven stable, Foreman can run Answer Radar on a schedule:

```yaml
schedule:
  - cron: "0 9 * * *"  # Daily at 9 AM UTC
    command: "run Answer Radar"
    mission_id: "ANSWER-RADAR-DAILY"
```

## Specialist Roles

Answer Radar uses three specialist roles (defined in `mira-bots/foreman/specialists/`):

1. **Answer Radar Scout** (Grok-plane) — Normalizes and scores questions
2. **Answer Radar Reviewer A** (Fleet-plane, REVIEWER) — Independent verification
3. **Answer Radar Reviewer B** (Fleet-plane, REVIEWER) — Adversarial audit

See specialist cards for detailed responsibilities and boundaries.

## Critical Safety Gates

### Freeze Isolation

Questions MUST be frozen BEFORE fetching community replies to prevent benchmark leakage:

```python
if question.thread_replies_fetched:
    return False, "Cannot freeze: community replies already fetched (leakage risk)"
```

### Reviewer Ordering

Reviewer B CANNOT run before Reviewer A completes:

```python
def can_review_b(self, question_id: str) -> tuple[bool, str]:
    if not any(rv.reviewer_role == "reviewer_a" for rv in existing_reviews):
        return False, "Reviewer A must complete first (ordering enforcement)"
```

### Safety Scoring

Missing LOTO warnings on energized equipment result in UNSAFE verdict:

```python
if safety_score < 20:
    final_verdict = "UNSAFE"
```

## VCAD Calculation

**VCAD (Verified Correct Answers per Day)** counts only answers that meet ALL criteria:

- `overall_score >= 85/100`
- `technical_correctness >= 34/40`
- `safety == 20/20`
- No critical unsupported claims
- Both independent reviewers PASS

Failures, correct abstentions, and unsafe answers do NOT increment VCAD.

## Persistence

Mission state is persisted to JSON in `docs/missions/answer-radar/` so Foreman can recover after restart:

```json
{
  "mission_id": "ANSWER-RADAR-001",
  "started_at": "2026-09-05T12:00:00Z",
  "questions": [...],
  "mira_attempts": {...},
  "review_verdicts": {...},
  "scores": {...},
  "vcad": 24,
  "completed_at": "2026-09-05T13:00:00Z"
}
```

## Testing

### Offline Tests

Run the complete test suite without Gateway, Slack, or real MIRA:

```bash
cd mira-bots/foreman
pytest agents/answer_radar/test_answer_radar.py -v
```

Tests verify:
- State machine transitions
- Freeze isolation (no community reply leak)
- Reviewer ordering enforcement
- VCAD calculation
- Safety gates
- Report generation
- Serialization/recovery

### Dry Run

Execute a full mission with fake data and see the report:

```bash
cd mira-bots/foreman
python -m agents.answer_radar.dry_run
```

This prints:
- Processing steps for each question
- MIRA attempts and reviewer verdicts
- Complete console report with scores
- Slack-formatted report (not auto-posted)

## Mike's Blockers for Production

Before running Answer Radar against real MIRA in production:

1. **MIRA API URL**: Set `MIRA_API_URL` to the production endpoint (e.g., `http://factorylm.com:9099/v1/chat/completions`)
2. **Authentication**: Provide `MIRA_API_KEY` if MIRA API requires auth
3. **Real Seed Questions**: Replace `fixtures/seed_questions.json` with fresh real industrial maintenance questions from X, YouTube, forums, etc.
4. **Feed Connectors**: Implement platform-specific feed connectors (X API, YouTube Data API, RSS, etc.) to continuously discover new questions
5. **Fleet Gateway Access**: Ensure Foreman can launch Reviewer A and Reviewer B workers via Fleet Gateway MCP
6. **Human Review**: Approve the first 5-10 VCAD reports before trusting the automated flow

## Hard Boundaries (Enforced)

Answer Radar MUST NOT:
- Merge or deploy code
- Auto-post public replies (V1 prepares drafts only)
- Fetch community replies before freezing questions
- Let Reviewer B run before Reviewer A
- Score questions without both reviewers completing
- Accept unsafe answers (missing LOTO warnings)
- Use third-party content for training without rights clearance

## Future Extensions

V1 focuses on the core mission loop. Future versions may add:

- **Feed Connectors**: X, YouTube, RSS, Discourse, Stack Exchange APIs
- **Knowledge Gap Automation**: Create GitHub issues for repeated failures
- **Public Reply Queue**: Human-approved public replies to high-lead questions
- **Regression Tracking**: Automatically rerun past failures after MIRA updates
- **Continuous Discovery**: Scheduled runs with fresh questions daily

## References

- Architecture: `docs/architecture/2026-09-05-mira-answer-radar-grokbot-agent-architecture.md`
- Build Handoff: `mira-bots/foreman/agents/answer-radar/BUILD.md`
- Foreman Mission Loop: `mira-bots/foreman/mission_loop.py`
- Specialist Cards: `mira-bots/foreman/specialists/answer-radar-*.md`
- Tests: `mira-bots/foreman/agents/answer-radar/test_answer_radar.py`
