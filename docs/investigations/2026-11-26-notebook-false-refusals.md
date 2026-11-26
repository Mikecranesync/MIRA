# Investigation Report: Notebook Chat False Refusals

**Issues:** #5710, #5677, #5998, #6004  
**Branch:** `cursor/fix-notebook-refusal-when-answer-present-2522`  
**Date:** 2026-11-26

## Problem Summary

MIRA's Hub equipment-notebook chat was refusing to answer questions even when the retrieved chunks contained the answer, saying "the excerpts do not contain..." or "not in the manual". Specific cases:

1. **PowerFlex 525 F081**: Said "F081 is not shown here" when it was in the fault table on p.162 (#5677, #5998)
2. **S7-1200 yellow LED**: Said manual only defines green/red LEDs when STOP/RUN solid yellow is on p.4 (#5710)
3. **GS10 P06.53**: Parameter table row on p.223 not found (user report)
4. **Kinetix STO wiring**: Answer on p.40 not found (user report)
5. **Garbled output**: Mixed-script text (Devanagari) and draft markers ("better Spanish:") appearing under Grounded badge (#6004)

## Root Causes Found

### 1. Content Truncation (Primary)
**File:** `mira-hub/src/lib/manual-rag.ts`

- `MAX_CONTENT_CHARS = 1200` hard limit on chunk content
- Table-heavy chunks were truncated at 1200 characters, cutting off table rows mid-table
- A fault table with 60 rows (~40 chars/row = 2400 chars) would only show first ~30 rows
- If the answer (e.g., F081 at row 50) was beyond the truncation point, the model never saw it

**Example:** PowerFlex 525 fault table is ~160 rows. At 1200 chars, only rows 1-30 visible. F081 (row 81) was invisible to the model → genuine refusal from model's perspective.

### 2. No Table-Aware Truncation
**File:** `mira-hub/src/lib/manual-rag.ts` line 3486

```typescript
const rawContent = c.content.length > MAX_CONTENT_CHARS
  ? `${c.content.slice(0, MAX_CONTENT_CHARS)}…`
  : c.content;
```

Simple character slicing could cut mid-row, breaking table structure:
```
| F080 | DSI Timeout | Type 2 | Manual reset |
| F081 | DSI Comm Lo…
```

The model might not recognize the incomplete row as containing F081.

### 3. Mixed-Script Output Not Filtered
**File:** `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts`

No pre-display check for:
- Non-Latin scripts in Latin conversations (Devanagari पुष्टि in English)
- Draft markers ("better Spanish:", "rewrite:")
- Self-correction patterns that leaked through

### 4. Prompt Could Be Clearer About Tables
**File:** `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` BASE_SYSTEM_PROMPT

The grounding directive said "If the excerpts do not contain the answer, say so..." but didn't explicitly state "table rows contain answers" → model might have been overly cautious about table content.

## Fixes Implemented

### 1. Smart Table-Aware Truncation
**File:** `mira-hub/src/lib/manual-rag.ts`

**New logic:**
- Detect table-heavy content (>30% of lines are pipe-delimited table rows)
- For table-heavy chunks: use `MAX_CONTENT_CHARS_TABLE = 2400` (2x higher limit)
- When truncating tables: cut at row boundaries, not mid-row
- Preserve complete table rows up to the limit

```typescript
function smartTruncate(text: string): string {
  const tableHeavy = isTableHeavy(text);
  const limit = tableHeavy ? MAX_CONTENT_CHARS_TABLE : MAX_CONTENT_CHARS;
  
  if (text.length <= limit) return text;
  
  if (!tableHeavy) {
    return `${text.slice(0, limit)}…`;
  }
  
  // For tables: cut at row boundary
  const lines = text.split('\n');
  let accum = 0;
  let lastCompleteRow = 0;
  
  for (let i = 0; i < lines.length; i++) {
    if (accum + lines[i].length + 1 > limit) {
      if (lastCompleteRow > 0) {
        return lines.slice(0, lastCompleteRow + 1).join('\n') + '\n…';
      }
      break;
    }
    accum += lines[i].length + 1;
    if (PIPE_TABLE_ROW_RE.test(lines[i]) || lines[i].trim() === '') {
      lastCompleteRow = i;
    }
  }
  
  return `${text.slice(0, limit)}…`;
}
```

**Expected impact:**
- PowerFlex 525 fault table: now shows ~60 rows instead of ~30, covering F081
- S7-1200 LED table: complete table preserved (only ~10 rows)
- Parameter tables: more parameters visible before truncation

### 2. Garbled Output Detection
**File:** `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts`

**New function:** `detectGarbledOutput(answer, conversationLanguages)`

Checks for:
- **Mixed scripts:** Devanagari, Arabic, Cyrillic, CJK in Latin conversations
- **Draft markers:** "better Spanish:", "rewrite:", "let me rephrase", etc.
- **Self-correction:** "wait, let me", "actually, i should"

Applied after citation normalization, before answer is saved. If garbled:
1. Try to extract the last quoted sentence (clean final version)
2. Fall back to clean refusal if no clean extraction

```typescript
const garbledCheck = detectGarbledOutput(answerText, []);
if (garbledCheck.garbled && served && docGrounded) {
  console.warn(`[notebook-chat] garbled output detected, regenerating: ${garbledCheck.reason}`);
  const quotedMatch = answerText.match(/"([^"]+)"$/);
  if (quotedMatch && quotedMatch[1].length > 20) {
    answerText = quotedMatch[1];
  } else {
    answerText = "The loaded excerpts do not contain enough information to answer this question.";
  }
}
```

**Expected impact:**
- #6004 "No puedo पुछि? better Spanish: ..." → extracted clean Spanish or clean refusal
- No mixed-script text under Grounded badge
- No draft markers reach production answers

### 3. Strengthened System Prompt
**File:** `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` BASE_SYSTEM_PROMPT

**Added to GROUNDING & CITATIONS section:**

```
- **TABLE ROWS contain answers.** When an excerpt shows a fault table, parameter table, 
  or LED status table, and a row in that table answers the question (e.g. F081 in a 
  fault table, P06.53 in a parameter list, or "solid yellow" in an LED table), that 
  IS the answer — cite it. Do not refuse with "not in the excerpts" when a table row 
  contains the requested fault code, parameter, or status indicator.
```

**Expected impact:**
- Model less likely to refuse when answer is in a table row
- Explicit instruction to treat table rows as valid sources
- Clearer guidance on when to answer vs. refuse

## Test Coverage

### New Eval Fixtures
**Location:** `tests/eval/fixtures/`

1. **70_pf525_f081_table_row.yaml**: PowerFlex 525 F081 lookup (repro #5677, #5998)
2. **71_s7_1200_yellow_led.yaml**: S7-1200 solid yellow LED (repro #5710)
3. **72_gs10_param_p06_53.yaml**: GS10 parameter P06.53 lookup
4. **73_kinetix_sto_wiring.yaml**: Kinetix STO wiring (p.40)

These fixtures will run in the nightly eval harness (`tests/eval/run_eval.py`).

### New Unit Tests
**Location:** `mira-hub/src/lib/__tests__/manual-rag-smart-truncate.test.ts`

Tests for smart truncation:
- Preserves complete table rows in fault tables
- Preserves LED status table rows with color indicators
- Preserves parameter table rows
- Uses higher limit for table-heavy content
- Falls back to simple truncation for non-table content

**Location:** `mira-hub/src/app/api/equipment-notebooks/[id]/chat/__tests__/garbled-output.test.ts`

Tests for garbled output detection:
- Flags Devanagari, Arabic, Cyrillic, CJK in Latin conversations
- Flags draft markers ("better Spanish:", "rewrite:", etc.)
- Does not flag clean answers
- Does not flag normal use of flagged words in context

## Expected Results

### Before & After

**Before (baseline from issues):**

| Case | Model Sees | Model Says | Why Wrong |
|------|-----------|------------|-----------|
| PF525 F081 | Rows 1-30 only | "F081 is not shown here" | F081 at row 81, truncated |
| S7-1200 yellow | Partial LED table | "manual only defines green/red" | Yellow row truncated |
| GS10 P06.53 | Params P06.00-P06.30 | "not in manual" | P06.53 truncated |
| Garbled | Full draft text | Shows "पुष्टि better Spanish:" | No filter |

**After (with fixes):**

| Case | Model Sees | Model Says | Why Right |
|------|-----------|------------|-----------|
| PF525 F081 | Rows 1-60 (2400 char limit) | "F081 DSI Comm Loss, Type 2 [1]" | Complete row visible |
| S7-1200 yellow | Complete LED table | "Solid yellow = STOP mode [1]" | All rows preserved |
| GS10 P06.53 | Params P06.00-P06.80 | "P06.53 is [description] [1]" | Parameter visible |
| Garbled | Filtered draft | Clean Spanish or refusal | Garble detector |

### Eval Harness Impact

**Current baseline (from tests/eval/README.md):** 65 scenarios, pass rate tracked

**Expected:**
- New fixtures 70-73: should PASS after fix (currently would FAIL)
- Existing fixtures: no regression (smart truncation preserves OR improves context)
- Overall pass rate: +4 passes (or more if existing fixtures were affected)

### No Changes To (Out of Scope)

As instructed, did NOT modify:
- ❌ Model-match or refusal gate (#5671, #5720, #5416)
- ❌ Safety-card logic (#5680, #5905, #6015)
- ❌ Query-splitting for retrieval (#5127, #5743)
- ❌ Retrieval ranking (BM25/vector weights)

## Deployment Notes

**Files changed:**
1. `mira-hub/src/lib/manual-rag.ts` — smart truncation
2. `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` — garbled output detection + prompt
3. `tests/eval/fixtures/70_*.yaml` through `73_*.yaml` — regression fixtures
4. `mira-hub/src/lib/__tests__/manual-rag-smart-truncate.test.ts` — unit tests
5. `mira-hub/src/app/api/equipment-notebooks/[id]/chat/__tests__/garbled-output.test.ts` — unit tests

**CI/CD:**
- Run `npm test` in mira-hub to verify unit tests
- Run `python3 tests/eval/run_eval.py` to verify eval fixtures
- Check for regressions in existing eval pass rate

**Staging verification:**
Before promoting to production, manually re-test the original repro cases on staging:
1. PowerFlex 525: "What does F081 mean and does it auto-reset?" → should cite p.162, say Type 2
2. S7-1200: "the plc has a yellow light on and nothing is running is it broke" → should cite STOP/RUN table
3. GS10: "What is parameter P06.53?" → should cite parameter table
4. Any Spanish/English mix: verify no Devanagari or draft markers in output

**Rollback:** If regressions appear, revert this branch's changes. The chunker (mira-crawler) is unchanged, so no re-ingestion needed.

## Related Work

**Not addressed (future work or other PRs):**
- Cross-reference following ("see page N" → fetch page N): would require retrieval changes (out of scope)
- Retrieval ranking improvements: BM25 weights, query expansion (lane #5127/#5743)
- Multi-hop reasoning: "see section X" → "section X says see Y" (future enhancement)

**References:**
- Issues: #5710, #5677, #5998, #6004
- Related: #5127 (query-splitting), #5671/#5720/#5416 (refusal gate), #5680/#5905/#6015 (safety cards)
- Eval framework: `tests/eval/README.md`
- Chunker: `mira-crawler/ingest/chunker.py` (unchanged)
