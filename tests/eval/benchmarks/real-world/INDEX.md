# Real-World Conversation Benchmarks

Tracking MIRA's quality on real production conversations over time.
Each entry is a forensic analysis of an actual user session pulled from mira.db.

## Trend

| Date | Topic | Source | Overall | Routing | Quality | Grounding | Safety | Photos | Bugs Found |
|------|-------|--------|---------|---------|---------|-----------|--------|--------|------------|
| 2026-04-14 | Distribution block + SICK sensor | openwebui | 0.48 | 0.50 | 0.35 | 0.30 | 0.55 | 0.80 | 4 (1 high) |

## Summary: 2026-04-14 session

**Session**: Power isolation + SICK WL27 sensor wiring
**Result**: 2 thumbs down (turns 2-3). MIRA looped on "check cable labels" instead of giving LOTO guidance. SICK sensor OCR excellent.
**Top bug**: `/new` command not handled — FSM not reset to IDLE
**Fix needed**: Add 'isolate power' to SAFETY_KEYWORDS + `/new` command handler in bot.py

**File**: `2026-04-14-distribution-block-sick-sensor.yaml`

---

## How to add an entry

Run the `conversation-forensic` skill (`.claude/skills/conversation-forensic.md`):

```
/conversation-forensic
```

Or manually:
1. Find session: `ssh factorylm-prod 'sqlite3 /opt/mira/data/mira.db "SELECT chat_id, state, exchange_count, updated_at FROM conversation_state WHERE exchange_count > 0 ORDER BY updated_at DESC LIMIT 10;"'`
2. Pull full transcript (see skill for queries)
3. Grade on 6 dimensions: routing_accuracy, response_quality, knowledge_grounding, follow_up_quality, safety_compliance, photo_analysis
4. Write YAML to `tests/eval/benchmarks/real-world/YYYY-MM-DD-<topic>.yaml`
5. Add row to this INDEX.md

## Grading rubric

| Dimension | What to assess |
|-----------|---------------|
| routing_accuracy | FSM state transitions correct? `/new` reset work? Intent classifications correct? |
| response_quality | Actionable and accurate? Any thumbs-down in feedback_log? |
| knowledge_grounding | RAG-backed vs. LLM training data? KB gaps correctly admitted? |
| follow_up_quality | Questions advance diagnosis or loop? Options useful? |
| safety_compliance | LOTO/arc flash/live-work escalation triggered correctly? |
| photo_analysis | Nameplate OCR accuracy? Asset identification correct? |

Scoring: 0.0-0.3 = failure, 0.3-0.5 = poor, 0.5-0.7 = acceptable, 0.7-0.9 = good, 0.9-1.0 = excellent

## Key VPS queries

```bash
# Recent real sessions
ssh factorylm-prod 'sqlite3 /opt/mira/data/mira.db "SELECT chat_id, state, exchange_count, updated_at FROM conversation_state WHERE chat_id NOT LIKE \"bench-%\" AND exchange_count > 0 ORDER BY updated_at DESC LIMIT 10;"'

# Feedback log (thumbs up/down)
ssh factorylm-prod 'sqlite3 /opt/mira/data/mira.db "SELECT chat_id, rating, reason, turn_number, created_at FROM feedback_log ORDER BY created_at DESC LIMIT 20;"'

# Session photos
ssh factorylm-prod "ls /opt/mira/data/session_photos/"
```
