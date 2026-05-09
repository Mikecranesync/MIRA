---
name: mira-response-quality
description: >
  Diagnose and fix poor MIRA bot response quality — use this skill whenever the Telegram or Slack
  bot is giving bad answers, saying "I don't have documentation", returning generic responses,
  failing to identify a fault code, getting stuck in conversation loops, or not using the knowledge
  base properly. Trigger on phrases like: "responses are bad/generic/wrong", "not giving good
  answers", "why is it saying it doesn't know", "fault code not recognized", "bot not working well",
  "diagnose bot quality", "responses are poor", "bot keeps saying no documentation", "bot is stuck",
  "MIRA not answering correctly", or any complaint about bot output quality.
---

# MIRA Response Quality Diagnostic

A 7-step loop for diagnosing why MIRA bot responses are poor and producing a ranked fix list.
Run the steps in order — most issues surface by step 4.

## Architecture Quick Reference

**Message path:** Telegram/Slack → `mira-bots/shared/chat/dispatcher.py` → `engine.py:Supervisor.process_full()` → `workers/rag_worker.py:RAGWorker` → `inference/router.py:InferenceRouter`

**Key files:**
| File | What to look at |
|------|----------------|
| `mira-bots/shared/fsm.py` | `_MAX_Q_ROUNDS` (default 3), `_MAX_TURNS_PER_STATE` (default 6), backward-guard logs |
| `mira-bots/shared/workers/rag_worker.py:328-385` | Similarity gate + cross-vendor filter |
| `mira-bots/shared/neon_recall.py:585` | `recall_knowledge(limit=5)` — chunk count |
| `mira-bots/prompts/diagnose/active.yaml` | Active system prompt (60s TTL, edit = live deploy) |
| `mira-bots/shared/guardrails.py:729` | `classify_intent()` — routing decision |
| `mira-bots/shared/inference/router.py:136` | Cascade: Groq → Cerebras → Gemini |

**Failure modes ranked by frequency:**
1. FSM Q-state stalls (Q1↔Q2 oscillation, never reaches DIAGNOSIS)
2. KB retrieval returns 0 chunks → hard "I don't have docs" refusal
3. Cross-vendor contamination zeroes out all chunks
4. Inference provider down / API key expired (all fall to Ollama)
5. System prompt lacking fault-code response structure

---

## Step 1 — Run Offline Eval Baseline

```bash
python3.12 tests/eval/run_eval.py
```

Note pass rate and failure cluster. If <60%, check infrastructure first (Step 7) before debugging logic.

**Healthy baseline:** ≥84% pass rate. Below 70% = systematic problem.

---

## Step 2 — Send a Live Probe

Send a concrete fault code to the bot. Use the exact test case that triggered the complaint:

```
PowerFlex 525 F004 fault
```

Or substitute the equipment/fault the user reported. Capture the full response text.

**Pass criteria:** structured answer with — fault identification + probable causes + diagnostic steps.  
**Fail signals:** "I don't have documentation", one-sentence generic answer, question back to user about what equipment they have (when they already said it), conversation that loops without reaching a diagnosis.

---

## Step 3 — Trace Intent Classification

Check that the message is being routed to the industrial diagnostic flow:

```bash
cd /Users/bravonode/Mira/mira-bots
python3.12 -c "
from shared.guardrails import classify_intent
msg = 'PowerFlex 525 F004 fault'
print(classify_intent(msg))
"
```

**Expected:** `industrial`  
**If `greeting`:** message is too short + contains a greeting word → intent classifier false positive. Check `guardrails.py:782-799`.  
**If `off_topic`:** missing equipment/fault keywords. The default is `industrial` so this is rare.

---

## Step 4 — Audit KB Coverage

Check whether the equipment is actually in the knowledge base:

```bash
doppler run --project factorylm --config prd -- python3.12 -c "
import os, sqlalchemy
url = os.environ['NEON_DATABASE_URL']
engine = sqlalchemy.create_engine(url, connect_args={'sslmode': 'require'})
with engine.connect() as conn:
    rows = conn.execute(sqlalchemy.text(
        \"SELECT count(*), manufacturer FROM knowledge_entries \"
        \"WHERE content ILIKE '%PowerFlex 525%' OR content ILIKE '%F004%' \"
        \"GROUP BY manufacturer\"
    )).fetchall()
    for r in rows:
        print(r)
"
```

**If 0 rows:** the manual is not in the KB. Trigger ingest — see `mira-crawler/` or the manual ingest pipeline.  
**If rows exist but bot still says no docs:** similarity threshold is too tight. Check `MIRA_MIN_SIMILARITY` env var (default 0.70). Try lowering to 0.60 in Doppler.

---

## Step 5 — Check Chunk Quality and Retrieval Path

Enable debug logging and run a test query to see what the retrieval pipeline returns:

```bash
cd /Users/bravonode/Mira/mira-bots
MIRA_LOG_LEVEL=DEBUG python3.12 -c "
import asyncio, os, sys
sys.path.insert(0, '.')
from shared.neon_recall import recall_knowledge
# ... embed query and call recall_knowledge to inspect results
" 2>&1 | grep -E "RAG_QUALITY_GATE|CROSS_VENDOR|NO_KB_COVERAGE|top_score|chunks"
```

Or check Langfuse traces for the session — vector search spans show similarity scores per chunk.

**What to look for:**
- `RAG_QUALITY_GATE ... suppressed` → top chunk score below threshold, lower `MIRA_MIN_SIMILARITY`
- `CROSS_VENDOR_CONTAMINATION ... fully suppressed` → all chunks are wrong vendor, check if manufacturer is tagged in KB
- 0 chunks returned at step 3 → KB ingest needed (Step 4)
- Chunks returned but response is still bad → system prompt issue (Step 6)

---

## Step 6 — Inspect the System Prompt

Read the active prompt:

```bash
cat /Users/bravonode/Mira/mira-bots/prompts/diagnose/active.yaml
```

Check for:
- Fault-code response structure (fault ID → causes → steps → escalation)
- Rule about what to do when KB coverage is partial: should use general knowledge + disclaimer, NOT refuse
- Rule about staying in DIAGNOSIS once reached (not regressing to clarification questions)

Editing `active.yaml` deploys in ≤60 seconds with no container restart needed (60s TTL cache).

---

## Step 7 — Check Inference Cascade Health

Verify all providers are responding:

```bash
doppler run --project factorylm --config prd -- python3.12 -c "
import os, httpx
providers = [
    ('Groq', os.getenv('GROQ_API_KEY'), 'https://api.groq.com/openai/v1/models'),
    ('Gemini', os.getenv('GEMINI_API_KEY'), 'https://generativelanguage.googleapis.com/v1beta/models'),
    ('Cerebras', os.getenv('CEREBRAS_API_KEY'), 'https://api.cerebras.ai/v1/models'),
]
for name, key, url in providers:
    if not key:
        print(f'{name}: NO KEY')
        continue
    try:
        r = httpx.get(url, headers={'Authorization': f'Bearer {key}'}, timeout=5)
        print(f'{name}: {r.status_code}')
    except Exception as e:
        print(f'{name}: ERROR {e}')
"
```

**If Gemini returns 403:** rotate key at aistudio.google.com → update in Doppler:
```bash
doppler secrets set GEMINI_API_KEY=<new_key> --project factorylm --config prd
```

**If Groq returns 429:** quota exhausted, check usage at console.groq.com.  
**If all fail:** bot falls back to local Ollama (`qwen2.5vl:7b`) — responses will be slower and lower quality.

---

## Ranked Fix List

After running the steps, apply fixes in this order (highest eval impact first):

| Priority | Fix | File | Est. eval gain |
|----------|-----|------|---------------|
| 1 | FSM backward-transition guard (already in fsm.py) | `fsm.py:137` | +10-15% |
| 2 | No-KB-coverage → general_knowledge for fault codes (already in rag_worker.py) | `rag_worker.py:429` | +5-8% |
| 3 | Rotate expired provider key | Doppler | +3-5% |
| 4 | Lower `MIRA_MIN_SIMILARITY` (0.70 → 0.60) | Doppler env var | +3-5% |
| 5 | Ingest missing equipment manuals | mira-crawler | +5-20% (equipment-specific) |
| 6 | Edit system prompt fault-code template | `prompts/diagnose/active.yaml` | +2-5% |

---

## Quick Checklist

```
[ ] Offline eval ≥ 84% pass rate
[ ] classify_intent("PowerFlex 525 F004 fault") == "industrial"
[ ] KB has ≥ 1 row matching the equipment
[ ] Chunk similarity scores ≥ 0.60 for top result
[ ] All 3 cascade providers return 200 (not 403/429)
[ ] System prompt has fault-code response structure
[ ] No BACKWARD_GUARD or Q_TRAP_COMMIT firing repeatedly in logs
```
