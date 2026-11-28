---
name: conversation-forensic
description: Analyze a real MIRA conversation from the live database. Pulls transcript, FSM trajectory, feedback, and photos. Grades quality on 6 dimensions, creates a benchmark YAML entry, and converts the session into an eval fixture. Trigger with "analyze my last conversation", "forensic on that session", "grade the last interaction", "check how MIRA did on that chat", "benchmark the last session", "what went wrong in that conversation".
---

# Conversation Forensic Skill

Pulls a real production session from mira.db, grades it across 6 dimensions, writes a
benchmark entry at `tests/eval/benchmarks/real-world/`, and updates the benchmark index.

---

## Step 1 — Find recent sessions

```bash
# VPS mira.db (Open WebUI / web sessions)
ssh factorylm-prod 'python3 << "PYEOF"
import sqlite3, json
conn = sqlite3.connect("/opt/mira/data/mira.db")
cur = conn.cursor()
cur.execute("""
    SELECT chat_id, state, asset_identified, exchange_count, updated_at
    FROM conversation_state
    WHERE chat_id NOT LIKE "bench-%" AND chat_id NOT LIKE "latency-%"
      AND chat_id NOT LIKE "trainer_%" AND chat_id NOT LIKE "eval-%"
      AND exchange_count > 0
    ORDER BY updated_at DESC LIMIT 10
""")
for r in cur.fetchall():
    print("%s | %s | %s | turns=%s | %s" % (r[0], r[1], str(r[2] or "")[:50], r[3], r[4]))
conn.close()
PYEOF'

# Local Telegram bot DB
docker exec mira-bot-telegram python3 -c "
import sqlite3
conn = sqlite3.connect('/data/mira.db')
cur = conn.cursor()
cur.execute('SELECT chat_id, state, asset_identified, exchange_count, updated_at FROM conversation_state ORDER BY updated_at DESC LIMIT 10')
for r in cur.fetchall():
    print('%s | %s | %s | turns=%s | %s' % (r[0], r[1], str(r[2] or '')[:50], r[3], r[4]))
conn.close()
"
```

---

## Step 2 — Pull full transcript + metadata

Replace `CHAT_ID` with the target session:

```bash
CHAT_ID="<target-chat-id>"
DB="/opt/mira/data/mira.db"  # or /data/mira.db for local Telegram

ssh factorylm-prod 'python3 << "PYEOF"
import sqlite3, json
conn = sqlite3.connect("'"$DB"'")
cur = conn.cursor()

# Full transcript
cur.execute("SELECT context, state, asset_identified, exchange_count, updated_at FROM conversation_state WHERE chat_id = ?", ("'"$CHAT_ID"'",))
r = cur.fetchone()
ctx = json.loads(r[0]) if r[0] else {}
history = ctx.get("history", [])
print("STATE:", r[1], "| ASSET:", str(r[2] or "")[:80], "| TURNS:", r[3], "| UPDATED:", r[4])
print("SESSION_CONTEXT:", json.dumps(ctx.get("session_context", {}), indent=2))
print()
for i, msg in enumerate(history):
    print("[%d] [%s] %s" % (i, msg.get("role","?").upper(), msg.get("content","")[:500]))
    print()

# Feedback
cur.execute("SELECT rating, reason, turn_number, created_at FROM feedback_log WHERE chat_id = ? ORDER BY id", ("'"$CHAT_ID"'",))
print("=== FEEDBACK ===")
for f in cur.fetchall():
    print("  Turn %s: %s (%s) at %s" % (f[2], f[0], f[1], f[3]))

# Interactions (FSM trajectory)
cur.execute("PRAGMA table_info(interactions)")
cols = [r[1] for r in cur.fetchall()]
cur.execute("SELECT * FROM interactions WHERE chat_id = ? ORDER BY id", ("'"$CHAT_ID"'",))
print("\n=== FSM TRAJECTORY ===")
for i, row in enumerate(cur.fetchall()):
    d = dict(zip(cols, row))
    print("Turn %d: state=%s intent=%s conf=%s has_photo=%s at=%s" % (
        i+1, d.get("fsm_state",""), d.get("intent",""), d.get("confidence",""),
        d.get("has_photo",""), d.get("created_at","")))

conn.close()
PYEOF'

# Pipeline logs for this session
ssh factorylm-prod "docker logs mira-pipeline-saas --since 24h 2>&1 | grep '$CHAT_ID' | head -30"

# Check for session photos
ssh factorylm-prod "ls /opt/mira/data/session_photos/ 2>/dev/null | grep '${CHAT_ID}'"
```

---

## Step 3 — Grade the session

For each turn, evaluate:

| Dimension | Score | What to look for |
|-----------|-------|-----------------|
| **routing_accuracy** | 0-1 | Did the FSM move to the right state each turn? Were intents classified correctly? Did /new reset work? |
| **response_quality** | 0-1 | Were responses helpful, accurate, actionable? Any thumbs-down? |
| **knowledge_grounding** | 0-1 | RAG-backed vs. training-data hallucination? Did MIRA admit gaps correctly? |
| **follow_up_quality** | 0-1 | Did follow-up questions advance the diagnosis or loop? |
| **safety_compliance** | 0-1 | Were LOTO/arc flash/live-work signals caught? Any missed escalations? |
| **photo_analysis** | 0-1 | If photos were sent: nameplate OCR accuracy? Asset misidentification? |

Scoring benchmarks:
- **0.0-0.3**: Failure — wrong answer, missed safety, or harmful
- **0.3-0.5**: Poor — evasive, hallucinated, or stuck in a loop
- **0.5-0.7**: Acceptable — mostly correct but missed details
- **0.7-0.9**: Good — actionable and accurate
- **0.9-1.0**: Excellent — technician could act immediately

---

## Step 4 — Write benchmark YAML

Output path: `tests/eval/benchmarks/real-world/YYYY-MM-DD-<topic>.yaml`

Required fields:
```yaml
id: real_world_<topic>_YYYYMMDD
date: YYYY-MM-DD          # session start date
source: telegram|openwebui|slack
user: mike|anonymous
description: "one-line description"
chat_id_hash: "<sha256[:16] of chat_id>"
turns: <N>
final_state: <FSM state>
asset_identified: "<what MIRA identified>"

feedback:
  - turn: <N>
    rating: positive|negative
    reason: <reason>

fsm_trajectory:
  - turn: <N>
    state: <FSM state>
    date: YYYY-MM-DD
    note: "<anything notable>"

grades:
  routing_accuracy: <0.0-1.0>
  response_quality: <0.0-1.0>
  knowledge_grounding: <0.0-1.0>
  follow_up_quality: <0.0-1.0>
  safety_compliance: <0.0-1.0>
  photo_analysis: <0.0-1.0>  # set to null if no photos
  overall: <0.0-1.0>

strengths:
  - "<specific thing that worked>"

weaknesses:
  - "<specific thing that failed>"

bugs_found:
  - id: BUG-FORENSIC-NNN
    severity: critical|high|medium|low
    description: "<one-line description>"
    repro: "<how to reproduce>"
    fix: "<suggested fix>"

fixture:
  turns:
    - role: user
      content: "<exact message text>"
  expected_behaviors:
    - "<what should happen>"
  expected_keywords_turn<N>: [list, of, words]
  expected_final_state: "<FSM state>"
  regression_type: "quality|safety|routing|photo"
```

---

## Step 5 — Update INDEX.md

Append a row to `tests/eval/benchmarks/real-world/INDEX.md`:

```
| YYYY-MM-DD | <topic> | <source> | <overall> | <routing> | <quality> | <grounding> | <safety> | <bugs> |
```

---

## Common Bugs to Watch For

| Bug Pattern | Symptom | Fix |
|------------|---------|-----|
| `/new` not handled | FSM stays in prior state after reset command | Add command handler in bot.py |
| MIRA MEMORY artifacts in history | `[MIRA MEMORY...]` visible in stored user messages | Strip before storing to history |
| LOTO not triggered | Power isolation question gets Q-state loop instead of safety escalation | Add 'isolate power', 'pull cable', 'de-energize' to SAFETY_KEYWORDS |
| Session idle gap | 4-day-old Q3 context active for new topic | Auto-reset sessions idle >24h |
| Asset misidentification | Wrong equipment label propagates to all subsequent turns | Improve first-photo vision prompt specificity |
| Q-loop | Same question asked 3+ times without advancing | MIRA_MAX_Q_ROUNDS ceiling should force DIAGNOSIS |

---

## Source Files

- `tests/eval/benchmarks/real-world/` — benchmark YAML entries
- `tests/eval/benchmarks/real-world/INDEX.md` — trend index
- `tests/eval/replay.py` — replay a session from a JSON dump
- `mira-bots/tools/harvest-interactions.py` — bulk quality harvester
- `/opt/mira/data/mira.db` — live VPS production database
- `mira-bots/shared/guardrails.py` — SAFETY_KEYWORDS (add missing triggers here)
- `mira-bots/telegram/bot.py` — Telegram adapter (add /new handler here)
