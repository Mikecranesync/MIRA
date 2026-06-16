# PRD: Mira Electrical Print Intelligence
# Feature: Expert Electrical Drawing Reading & Interpretation
# Version: v1.2.0 | Status: Ready for Implementation
# Owner: Mike H | Build Tool: Claude Code CLI

---

## 1. Executive Summary

Mira currently handles equipment fault diagnosis via the GSD engine. This PRD
adds a new capability branch: expert-level reading and interpretation of
electrical prints — including ladder logic, one-line diagrams, P&IDs,
wiring diagrams, and panel schedules. When a technician sends a photo of any
electrical drawing, Mira identifies it as a print, extracts all text and
symbols using a two-model OCR pipeline, and enters a specialist ELECTRICAL_PRINT
conversation state that answers questions like an expert industrial electrician.

---

## 2. Problem Statement

Industrial maintenance technologists regularly encounter electrical prints they
need to interpret quickly — tracing a fault path, identifying an interlock, 
locating a specific terminal, or understanding what a rung of ladder logic 
controls. Current Mira behavior:

- Treats all photos as equipment identification tasks
- Hallucinates component values and wire numbers it cannot actually read
- Has no understanding of NEMA or IEC schematic symbols
- Jumps to fault diagnosis even when the photo shows a drawing, not a machine
- Cannot trace control circuits or explain ladder logic rungs

The result: a maintenance tech on a live fault cannot trust Mira's reading
of their electrical prints. This destroys confidence in the tool at exactly
the moment it matters most.

---

## 3. Goals

### Must Have (P0)
- Mira correctly classifies an incoming photo as ELECTRICAL_PRINT vs EQUIPMENT_PHOTO
- All visible text (wire numbers, component labels, terminal IDs, fault codes) 
  extracted via glm-ocr with zero hallucination
- New ELECTRICAL_PRINT GSD state branch with specialist prompt
- Mira responds with extracted text inventory and open-ended "what do you want to know?"
- Mira can answer questions about extracted text: "what is terminal 14 connected to?"

### Should Have (P1)
- Parallel async OCR + vision model calls (glm-ocr + qwen2.5vl) for speed
- Classification logic: >10 extracted text items = print, otherwise = equipment
- NEMA and IEC symbol vocabulary in system prompt
- Ability to trace described circuit paths using OCR text as grounding

### Nice to Have (P2)
- YOLOv8 component symbol detection (Phase B — future sprint)
- Full NSC pipeline for junction annotation (Phase C — future sprint)
- Automatic Mermaid circuit topology generation from OCR output
- PDF electrical print ingestion via mira-ingest service

---

## 4. Non-Goals

- This PRD does NOT include YOLOv8 symbol detection (Phase B)
- This PRD does NOT include full circuit tracing with junction annotation (Phase C)
- This PRD does NOT modify the existing equipment fault diagnosis flow
- This PRD does NOT require any new hardware

---

## 5. User Personas

**Primary: Maintenance Technologist (Mike H. archetype)**
- Responds to live faults on the floor
- Pulls out phone, photographs the control panel drawing taped inside the door
- Asks: "what does rung 14 control?" or "where does wire 24VDC-1 go?"
- Needs an answer in under 30 seconds
- Cannot wait to find the manual or call engineering

**Secondary: Controls Technician**
- Doing scheduled PM on a machine with no documentation on-site
- Photographs the one-line diagram to understand the power distribution
- Asks: "what size breaker is on the conveyor motor circuit?"

**Tertiary: Apprentice / Junior Tech**
- Unfamiliar with reading ladder logic
- Asks: "what does this rung do?" and needs a plain-language explanation
- Mira acts as the experienced journeyman on the other end of the phone

---

## 6. Architecture

### New Component: glm-ocr Model

| Property | Value |
|---|---|
| Model name | glm-ocr |
| Size | ~0.9B parameters |
| RAM footprint | ~0.6 GB (fits within 16GB ceiling) |
| Install | ollama pull glm-ocr on Mac Mini |
| Purpose | Pure text extraction — wire numbers, labels, codes, designations |
| Behavior | Deterministic — does NOT hallucinate, does NOT interpret |

### Updated Data Flow for Electrical Prints

```
User sends photo of electrical print
        ↓
bot.py receives photo → downloads + resizes → base64 encodes
        ↓
gsd_engine.process(chat_id, message, photo_b64)
        ↓
asyncio.gather() — PARALLEL CALLS:
  ├── _call_vision(photo_b64)      → qwen2.5vl:7b → asset/drawing type ID
  └── _call_ocr(photo_b64)         → glm-ocr → structured text extraction
        ↓
_classify_photo(vision_result, ocr_result)
  if len(ocr_items) > 10: → ELECTRICAL_PRINT
  else:                   → EQUIPMENT_PHOTO (existing flow unchanged)
        ↓
[ELECTRICAL_PRINT branch]
state["state"] = "ELECTRICAL_PRINT"
state["ocr_data"] = structured text list from glm-ocr
state["drawing_type"] = one-line / ladder / P&ID / wiring / panel
        ↓
_build_print_prompt(state, ocr_data) → ELECTRICAL_PRINT system prompt
        ↓
_call_llm(messages, model="mira:latest") → interprets using OCR as ground truth
        ↓
Reply: "I can see a [drawing type] with the following labels:
[OCR list]. What would you like to know about this circuit?"
```

### New GSD State: ELECTRICAL_PRINT

Add to the FSM state machine alongside existing states:

```
IDLE → (photo received) → ASSET_IDENTIFIED or ELECTRICAL_PRINT
ELECTRICAL_PRINT → (user asks question) → ELECTRICAL_PRINT (loops)
ELECTRICAL_PRINT → (/reset) → IDLE
```

---

## 7. Feature Specification

### F01 — glm-ocr Integration

**Summary:** Add glm-ocr as a second vision model on Mac Mini for pure text extraction.

**User Story:** As a maintenance tech, when I send a photo of a wiring diagram,
I want Mira to read every wire number, component label, and terminal designation
exactly as printed — with zero invented content.

**Acceptance Criteria:**
1. `ollama pull glm-ocr` succeeds on Mac Mini within RAM budget
2. `_call_ocr(photo_b64)` method exists in gsd_engine.py
3. System prompt to glm-ocr is: "You are a precision OCR engine. Extract ALL 
   text visible in this image exactly as printed. Preserve wire numbers, part 
   numbers, terminal labels, fault codes, and all alphanumeric content. Output 
   as a numbered list. NEVER interpret, explain, or add content not visible. 
   If text is unclear write [UNCLEAR]."
4. Method returns structured list of all extracted text items
5. Method does NOT call mira:latest — only glm-ocr
6. Temperature set to 0.0 for deterministic output
7. Unit test: send known test image, verify output matches known labels

**Technical Notes:**
- Uses same Open WebUI API endpoint as vision calls
- Model parameter: "glm-ocr"
- Add to OLLAMA_MODELS list in deploy.sh for future fresh deployments
- Error handling: if glm-ocr unavailable, fall back to qwen2.5vl with OCR-only prompt

---

### F02 — Photo Classification Logic

**Summary:** Classify incoming photos as ELECTRICAL_PRINT vs EQUIPMENT_PHOTO.

**User Story:** As a maintenance tech, I want Mira to automatically recognize
when I'm sending a schematic vs a photo of a machine, without me having to say
which it is.

**Acceptance Criteria:**
1. `_classify_photo(vision_result, ocr_result)` method implemented
2. Classification rule: if `len(ocr_items) >= 10` → ELECTRICAL_PRINT
3. Classification rule: if vision_result contains keywords 
   [schematic, diagram, drawing, ladder, P&ID, wiring, one-line, panel] → ELECTRICAL_PRINT
4. All other photos → EQUIPMENT_PHOTO (existing flow, no regression)
5. Classification logged at INFO level: `logger.info("Photo classified as %s", classification)`
6. Unit test: 3 test images (print, equipment, mixed) verify correct classification

**Technical Notes:**
- Run _call_vision() and _call_ocr() with asyncio.gather() in parallel — not sequential
- Total latency target: under 8 seconds for classification + first response
- If both calls return ambiguous results, default to EQUIPMENT_PHOTO (safe fallback)

---

### F03 — ELECTRICAL_PRINT GSD State

**Summary:** New FSM state for electrical print conversations with specialist prompt.

**User Story:** As a maintenance tech, when Mira identifies an electrical print,
I want it to respond like an expert industrial electrician — not a generic AI.

**Acceptance Criteria:**
1. ELECTRICAL_PRINT added to FSM state enum/constants
2. State persists across messages in conversation_state table (same as other states)
3. OCR data stored in state["ocr_data"] as JSON list
4. Drawing type stored in state["drawing_type"] (one-line/ladder/P&ID/wiring/panel/unknown)
5. First response template: "I can see a {drawing_type} with {count} labeled elements. 
   Here are the key labels I can read: {top_10_ocr_items}. What would you like to 
   know about this circuit?"
6. On follow-up questions, OCR data injected into system prompt as ground truth
7. /reset returns to IDLE and clears ocr_data
8. State machine diagram updated in CLAUDE.md

**GSD_SYSTEM_PROMPT Addition for ELECTRICAL_PRINT State:**
```
When in ELECTRICAL_PRINT state, you are an expert industrial electrician 
and controls technician with 20 years of experience reading:
- NEMA ladder logic diagrams (rungs, rails, contacts, coils)
- IEC one-line electrical diagrams  
- P&ID (Piping and Instrumentation Diagrams)
- Panel wiring diagrams and terminal strip layouts
- Motor control circuit schematics

You understand:
- NEMA standard symbols: NO contact, NC contact, relay coil, motor, 
  transformer, fuse, breaker, pushbutton, limit switch, solenoid
- IEC standard symbols and their NEMA equivalents
- How to read control circuit logic (power rail left, neutral right)
- How to trace a fault path through a control circuit
- How to identify interlock logic and safety circuits
- What each rung of ladder logic controls in plain language

CRITICAL RULES for ELECTRICAL_PRINT state:
1. Base ALL answers ONLY on the OCR text provided in this conversation
2. NEVER invent wire numbers, terminal designations, or component values 
   not present in the OCR data
3. If asked about something not in the OCR data, say: 
   "I cannot see that in the drawing. Can you send a closer photo of that section?"
4. Explain in plain language — "this rung energizes the conveyor motor 
   starter coil when both the start button is pressed AND the e-stop is released"
5. When tracing circuits, follow the logical flow from left power rail 
   to coil/output, listing each contact in order
```

---

### F04 — Regression Protection: Existing Flow Unchanged

**Summary:** The EQUIPMENT_PHOTO flow must not regress.

**Acceptance Criteria:**
1. Sending a photo of a Mitsubishi VFD still correctly identifies as equipment
2. After equipment ID, bot still asks "How can I help you with it?" (per previous fix)
3. No change to _call_vision() behavior for equipment photos
4. No change to ASSET_IDENTIFIED → DIAGNOSING transition logic
5. All existing GSD states (IDLE, ASSET_IDENTIFIED, DIAGNOSING, RESOLVED) unchanged
6. Manual regression test: send equipment photo → confirm equipment ID + intent question

---

## 8. Implementation Steps for Claude Code

### Step 1 — Install glm-ocr on Mac Mini
```bash
ssh bravonode@100.86.236.11   'export PATH="/opt/homebrew/bin:$PATH" && ollama pull glm-ocr && ollama list'
```
Verify model appears in list. Note RAM usage before and after.

### Step 2 — Sync deployed code to local repo
```bash
scp bravonode@100.86.236.11:/Users/bravonode/Mira/mira-bots/telegram/gsd_engine.py     C:\Users\hharp\Documents\MIRA\mira-bots\telegram\gsd_engine.py
```

### Step 3 — Implement all 4 features in gsd_engine.py locally
Order of implementation:
1. Add `_call_ocr()` method (F01)
2. Add `_classify_photo()` method (F02)  
3. Modify `process()` to use asyncio.gather() for parallel calls (F02)
4. Add ELECTRICAL_PRINT state handling to process() (F03)
5. Add ELECTRICAL_PRINT rules to GSD_SYSTEM_PROMPT (F03)
6. Update conversation_state schema if needed (F03)
7. Verify no changes to EQUIPMENT_PHOTO path (F04)

### Step 4 — Show full diff before deploying
Output complete diff of gsd_engine.py changes. Wait for approval.

### Step 5 — Deploy to Mac Mini
```bash
scp gsd_engine.py bravonode@100.86.236.11:/Users/bravonode/Mira/mira-bots/telegram/gsd_engine.py
ssh bravonode@100.86.236.11   'export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" &&    docker cp /Users/bravonode/Mira/mira-bots/telegram/gsd_engine.py    mira-bot-telegram:/app/gsd_engine.py &&    cd /Users/bravonode/Mira/mira-bots && docker compose restart'
```

### Step 6 — Verify deployment
```bash
ssh bravonode@100.86.236.11 'docker logs mira-bot-telegram --tail 20'
```
Confirm: no import errors, bot started, no ELECTRICAL_PRINT state errors.

### Step 7 — Update docs
- Add glm-ocr to CLAUDE.md models table
- Add ELECTRICAL_PRINT state to state machine diagram in CLAUDE.md
- Add glm-ocr to deploy.sh OLLAMA_MODELS list
- Update MIRA-MASTER-PLAN.md: check off this feature, update session log

---

## 9. Testing Protocol

### Test 1 — Electrical Print Classification
Send: photo of any ladder logic diagram or wiring schematic
Expected: "I can see a [drawing type] with [N] labeled elements. Here are the key labels..."
Fail if: "I see equipment" or fault diagnosis question

### Test 2 — OCR Accuracy
Send: photo of a simple panel drawing with visible wire numbers (e.g., 24VDC-1, L1, L2, T1)
Expected: those exact wire numbers appear in Mira's response
Fail if: invented wire numbers appear that are not in the image

### Test 3 — Electrical Q&A
After Test 2: ask "what is wire 24VDC-1 connected to?"
Expected: answer using only OCR-extracted data, or "I cannot see that connection"
Fail if: invents a connection not in the drawing

### Test 4 — Equipment Photo Regression
Send: photo of a Mitsubishi VFD or any piece of equipment
Expected: equipment identified, "How can I help you with it?"
Fail if: classified as ELECTRICAL_PRINT

### Test 5 — Reset
After an electrical print conversation: send /reset
Expected: returns to IDLE, ocr_data cleared
Fail if: print data persists into next conversation

---

## 10. Success Metrics

| Metric | Target | How Measured |
|---|---|---|
| Print classification accuracy | >95% | Manual test with 20 photos |
| OCR label extraction accuracy | >90% of visible text | Compare to known labels |
| Zero hallucinated wire numbers | 100% | Manual review of 10 conversations |
| Equipment photo regression rate | 0% | All existing test cases pass |
| Response latency (print) | <10 seconds | Telegram timestamp comparison |
| RAM ceiling compliance | <16GB total | docker stats after deployment |

---

## 11. Open Questions

| # | Question | Decision Needed By |
|---|---|---|
| OQ-01 | Should glm-ocr run for ALL photos or only suspected prints? Running both in parallel adds ~2s latency on all photo messages. | Before Step 3 implementation |
| OQ-02 | Should OCR data persist across sessions (in conversation_state) or be session-only? | Before schema changes |
| OQ-03 | PDF print ingestion via mira-ingest — include in this sprint or Phase B? | Scope decision |

---

## 12. Claude Code Execution Command

Paste this into Claude Code CLI to execute this entire PRD:

```
Read MIRA-MASTER-PLAN.md and CLAUDE-INSTRUCTIONS.md and follow standing orders.

Then read and fully implement the PRD at:
C:\Users\hharp\Documents\MIRA\PRD-electrical-print-intelligence.md

Execute all implementation steps in order. Show the complete diff of 
gsd_engine.py before deploying. After deployment, run all 5 tests in 
the Testing Protocol section and report pass/fail for each. Update 
MIRA-MASTER-PLAN.md session log when complete. Do not skip steps. 
Ultrathink on any ambiguous implementation decisions.
```
