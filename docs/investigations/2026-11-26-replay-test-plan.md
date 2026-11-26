# Replay Test Plan for PR #6030

**Purpose:** Verify that the smart truncation and cross-reference following fixes resolve the original false refusal cases.

**Testing approach:** These tests require real retrieval against the actual OEM manuals in the staging/production knowledge base. Cannot be run on VM without full stack setup.

## Test Cases

### 1. GS10 P06.53

**Question:** "What is parameter P06.53 on the GS10?"

**Expected behavior:**
- Retrieval returns chunks from GS10 parameter table
- Smart truncation keeps row with P06.53 even if past 2400 chars
- Answer cites parameter table page
- Answer describes P06.53

**How to verify:**
```bash
# On staging with real GS10 manual ingested:
curl -X POST "$STAGING_HUB/api/equipment-notebooks/$NOTEBOOK_ID/chat/" \
  -H "Cookie: ..." \
  -d '{"message": "What is parameter P06.53 on the GS10?"}'
```

**Success criteria:**
- Retrieved pages include parameter table page (expected: p.223 or nearby)
- Answer does NOT say "not in manual" or "excerpts do not contain"
- Answer cites parameter table page
- Answer describes P06.53 function/range

**Baseline (v3.462.9, 54afe737):** Still showed false "not in the manual" per Mike's Nov 26 note.

---

### 2. PowerFlex 525 F081

**Question:** "PowerFlex 525 showing F081, what does it mean and does it auto-reset?"

**Expected behavior:**
- Retrieval returns chunks from PowerFlex 525 fault table
- Smart truncation keeps row with F081 (even if at row 81, ~3240 chars)
- Answer cites fault table page (p.162)
- Answer says "F081 DSI Comm Loss, Type 2, manual reset"

**How to verify:**
```bash
curl -X POST "$STAGING_HUB/api/equipment-notebooks/$NOTEBOOK_ID/chat/" \
  -H "Cookie: ..." \
  -d '{"message": "PowerFlex 525 showing F081, what does it mean and does it auto-reset?"}'
```

**Success criteria:**
- Retrieved pages include fault table p.162
- Answer does NOT say "F081 is not shown here"
- Answer cites p.162
- Answer states Type 2 (manual reset)

**Baseline (v3.462.9, 54afe737):** Still showed false "F081 is not shown here" per Mike's Nov 26 note.

---

### 3. F16 P047 = 15 (p.88)

**Question:** "What does P047 = 15 mean on the F16?"

**Expected behavior:**
- Retrieval returns chunks from F16 parameter table
- Smart truncation keeps row with P047 value 15
- Answer cites p.88
- Answer explains what P047 = 15 means

**How to verify:**
```bash
curl -X POST "$STAGING_HUB/api/equipment-notebooks/$NOTEBOOK_ID/chat/" \
  -H "Cookie: ..." \
  -d '{"message": "What does P047 = 15 mean on the F16?"}'
```

**Success criteria:**
- Retrieved pages include parameter table p.88
- P047 = 15 row is in final answer context
- Answer cites p.88
- Answer explains the meaning

**Baseline (v3.462.9, 54afe737):** Dropped P047 = 15 even though p.88 was retrieved, per Mike's Nov 26 note.

---

### 4. PanelView "see page N" cross-reference

**Question:** [Question that gets answer with "see page 45" on p.44]

**Expected behavior:**
- Retrieval returns p.44 chunk
- buildGroundedContext detects "see page 45" reference
- Fetches p.45 chunk (one hop)
- Final context includes both p.44 and p.45

**How to verify:**
```bash
# First, identify a PanelView manual with "see page N" cross-refs
# Then ask a question that retrieves the referring page

curl -X POST "$STAGING_HUB/api/equipment-notebooks/$NOTEBOOK_ID/chat/" \
  -H "Cookie: ..." \
  -d '{"message": "[question that returns page with cross-ref]"}'
```

**Success criteria:**
- Both p.44 and p.45 appear in answer citations
- Cross-referenced content is used in answer
- No "not in manual" for content on p.45

**Baseline:** Cross-references not followed (original scope requirement).

---

### 5. PowerFlex 525 Overcurrent (#5998)

**Question:** "What causes overcurrent faults on a PowerFlex 525?"

**Expected behavior:**
- Retrieval returns fault table pages (pp.161-162)
- If pp.161-162 are retrieved, smart truncation keeps them
- Answer cites pp.161-162
- Answer names F063, F012

**How to verify:**
```bash
curl -X POST "$STAGING_HUB/api/equipment-notebooks/$NOTEBOOK_ID/chat/" \
  -H "Cookie: ..." \
  -d '{"message": "What causes overcurrent faults on a PowerFlex 525?"}'
```

**Success criteria:**
- Retrieved pages include pp.161 or 162 (may require retrieval tuning)
- IF retrieved, they reach answer context
- Answer cites fault table page
- Answer names F063 and/or F012

**Baseline (staging 35c61873):** Retrieved pp.1/665-672, missed fault table pp.161-162 (ranking issue).

**Limitation:** This PR fixes context assembly/truncation. If pp.161-162 aren't retrieved (ranking issue), smart truncation can't help. Full fix may require retrieval ranking tuning.

---

## Retrieved Pages Verification

For each test, log the retrieved pages to verify:

```typescript
// In route.ts, after retrieval:
console.log('[TEST] Retrieved pages:', chunks.map(c => c.sourcePage).sort((a,b) => a-b));
console.log('[TEST] Final context pages:', /* extract from buildGroundedContext output */);
```

The test passes if:
1. Expected pages ARE in `chunks` (retrieved)
2. Expected pages ARE in final context (survived truncation)
3. Answer uses content from those pages (cites them)

## Running the Full Test Suite

```bash
# On staging with this PR deployed:
cd /opt/mira/mira-hub
npm test -- src/lib/__tests__/manual-rag-smart-truncate.test.ts
npm test -- src/lib/__tests__/manual-rag-cross-ref.test.ts
npm test -- src/lib/__tests__/manual-rag-ranking-5998.test.ts

# Then run eval fixtures:
cd /opt/mira
python3 tests/eval/run_eval.py

# Then run manual replays above
```

## Success Definition

**Green:** All 5 replay cases pass with:
- Correct pages retrieved
- Correct pages in final context
- No false "not in manual" refusals
- Proper citations

**Amber:** Most pass, but #5998 still fails due to retrieval ranking (acceptable if documented).

**Red:** Any of cases 1-4 fail - indicates smart truncation or cross-ref following not working.
