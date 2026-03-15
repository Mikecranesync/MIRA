# MIRA Bottom Layer — Test Results

**Date:** _(run after deploy)_
**Tester:** Mike Harper
**Target:** Mac Mini M4 (192.168.1.11)

---

## Test 1: Vision (single photo)
- **Action:** Send a VFD fault display photo to the Slack bot
- **Pass criteria:** Response contains fault code explanation + diagnostic steps
- **Result:** [ ] PASS / [ ] FAIL
- **Notes:**

## Test 2: Vision (multi-photo)
- **Action:** Send 3 photos in one Slack message
- **Pass criteria:** MIRA analyzes at least the first image and returns analysis
- **Result:** [ ] PASS / [ ] FAIL
- **Notes:**

## Test 3: RAG (text query)
- **Action:** Ask "What does OL1 mean on a GS10 VFD?"
- **Pass criteria:** Answer references the GS10 fault code table, matches manual
- **Result:** [ ] PASS / [ ] FAIL
- **Notes:**

## Test 4: Memory (multi-turn)
- **Action:** 5-message troubleshooting thread in Slack:
  1. "VFD showing OL1, motor keeps tripping"
  2. "I checked the current, it's 11.4A nameplate 10A"
  3. "motor is warm but not hot"
  4. "ok I checked the belt tension, it was fine"
  5. "what else should I try?"
- **Pass criteria:** MIRA never repeats belt tension after message 4
- **Result:** [ ] PASS / [ ] FAIL
- **Notes:**

## Test 5: PDF ingestion
- **Action:** Upload a PDF to Slack. Ask a question about its contents.
- **Pass criteria:** Answer comes from the PDF content, not hallucination
- **Result:** [ ] PASS / [ ] FAIL
- **Notes:**

## Test 6: Dashboard
- **Action:** Open http://192.168.1.11:1880/dashboard
- **Pass criteria:** 4 gauges show data, fault log table populates
- **Result:** [ ] PASS / [ ] FAIL
- **Notes:**

## Test 7: Fault watchdog
- **Action:** Manually insert a fault into mira.db:
  ```sql
  INSERT INTO faults (equipment_id, fault_code, description, severity, resolved, alerted)
  VALUES ('CONV-001', 'TEST-01', 'Manual test fault', 'critical', 0, 0);
  ```
- **Pass criteria:** Slack alert arrives within 60 seconds
- **Result:** [ ] PASS / [ ] FAIL
- **Notes:**

---

## Summary
- Total: 7 tests
- Passed: _/7
- Failed: _/7
- Bottom layer status: [ ] COMPLETE / [ ] INCOMPLETE
