
**Env:** staging, hub 3.419.18 (gitSha feaabc25). Diagnosis: /workspace/briefs/2026-10-25-retrieval-diagnosis.md (Foreman T-038, code read at main 8acc2769). Corresponds to that brief's fix C.

**Problem:** `embeddingCoverage` (document-readiness.ts:117-123) is embedded/chunks, and it promotes the doc to `chat_ready_enhanced` (DR:178-196). Notebook chat is lexical-only while `NOTEBOOK_HYBRID_RETRIEVAL=0` (the default in both staging and prod), and readiness has no knowledge of the model-applicability filter in manual-rag.ts. So "1.0" / "Ready to ask" tells neither users nor eval gates whether the doc can actually be cited.

**Repro (2026-10-25, staging notebook chat):**
- PF525 notebook `fc6519a4-67a8-45f9-b751-6ce5aa4a8a3f` with 520-UM001: coverage 1.0. "Which PowerFlex 525 parameter sets the motor nameplate full load amps?" returns insufficient_evidence with citations []. P034 Motor NP FLA is on pp.65, 73, 76 and others.
- Micro820 `3bb54ef7…` (1.0): the p.64 default-IP fact returns insufficient_evidence.
- TP700 Comfort `b66b1236…` (1.0): the p.91 touch calibration fact returns an empty answer.
- ACS355 at **0%** coverage cited fault 0001 on p.359 correctly. S7-1200 cited p.1047.

**Expected:** label coverage as enrichment-only, or show it only when the hybrid lane is on. Better still, gate "ready" on a per-doc citation smoke probe.

**Out of scope (tracked separately):** the root cause of the PF525 and TP700 misses is the family-coverage gap in `documentCoversRequest` (diagnosis fix A). Micro820 is still open.

**Dup-check:** GitHub search for "chat_ready_enhanced" and "embeddingCoverage readiness insufficient_evidence" returned 0 issues.

**Evidence:** /workspace/live-test/batch2-raw/ (s0-*.json, s1-pf525.json, poll.log).
