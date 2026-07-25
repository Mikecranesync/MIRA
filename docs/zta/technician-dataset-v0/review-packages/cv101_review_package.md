# Cv101 Review Package

Build id: `2026-07-23-technician-dataset-v0`

Reviewer actions: approve, correct, reject, or hold out. No record in this package is gold or approved.

- Candidate records: 70
- printsense: 70

## Sample Records

### techv0-cv101-001
- Lineage: `factorylm:cv-101-e-001` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: CV-101 sheet E-001: what should I know about PLC1.+CM0? [review case 001]
- Assistant: From the CV-101 evidence package, PLC1 terminal +CM0 is output bank 0 feed (O-00..O-03); status is field_verify. Source status is field_verify. Use the sheet and evidence reference together; do not infer missing landings.

### techv0-cv101-002
- Lineage: `factorylm:cv-101-e-001` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: CV-101 sheet E-001: what should I know about PLC1.+CM1? [review case 002]
- Assistant: From the CV-101 evidence package, PLC1 terminal +CM1 is output bank 1 feed (O-04..O-06, spare); status is field_verify. Source status is field_verify. Use the sheet and evidence reference together; do not infer missing landings.

### techv0-cv101-003
- Lineage: `factorylm:cv-101-e-001` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: Can I rely on the CV-101 PLC1.-CM0 detail without checking the machine? [review case 003]
- Assistant: Use calibrated uncertainty. The pack says: PLC1 terminal -CM0 is output bank 0 return; status is field_verify. Because the status is field_verify, preserve that status in the answer and field-verify anything marked field_verify before relying on it for work.

### techv0-cv101-004
- Lineage: `factorylm:cv-101-e-001` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: CV-101 sheet E-001: what should I know about PLC1.-CM1? [review case 004]
- Assistant: From the CV-101 evidence package, PLC1 terminal -CM1 is output bank 1 return; status is field_verify. Source status is field_verify. Use the sheet and evidence reference together; do not infer missing landings.

### techv0-cv101-005
- Lineage: `factorylm:cv-101-e-001` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: Correct my CV-101 note for PLC1.COM0; I may have treated an uncertain item as verified. [review case 005]
- Assistant: Correction: carry the source status exactly. For PLC1.COM0, the evidence says PLC1 terminal COM0 is Digital-input common (return to 0V); status is field_verify. Do not promote it beyond field_verify; put remaining uncertainty into the open-items/review flow.

### techv0-cv101-006
- Lineage: `factorylm:cv-101-e-001` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: Can I rely on the CV-101 PLC1.+CM0 detail without checking the machine? [review case 006]
- Assistant: Use calibrated uncertainty. The pack says: PLC1 terminal +CM0 is output bank 0 feed (O-00..O-03); status is field_verify. Because the status is field_verify, preserve that status in the answer and field-verify anything marked field_verify before relying on it for work.

### techv0-cv101-007
- Lineage: `factorylm:cv-101-e-001` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: CV-101 sheet E-001: what should I know about PLC1.+CM1? [review case 007]
- Assistant: From the CV-101 evidence package, PLC1 terminal +CM1 is output bank 1 feed (O-04..O-06, spare); status is field_verify. Source status is field_verify. Use the sheet and evidence reference together; do not infer missing landings.

### techv0-cv101-008
- Lineage: `factorylm:cv-101-e-001` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: CV-101 sheet E-001: what should I know about PLC1.-CM0? [review case 008]
- Assistant: From the CV-101 evidence package, PLC1 terminal -CM0 is output bank 0 return; status is field_verify. Source status is field_verify. Use the sheet and evidence reference together; do not infer missing landings.

### techv0-cv101-009
- Lineage: `factorylm:cv-101-e-005` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: Can I rely on the CV-101 B1 detail without checking the machine? [review case 009]
- Assistant: Use calibrated uncertainty. The pack says: B1 is a photo eye used as Product-present beam to I-05 (blocked -> pe_latched soft stop). Because the status is verified, preserve that status in the answer and field-verify anything marked field_verify before relying on it for work.

### techv0-cv101-010
- Lineage: `factorylm:cv-101-e-005` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: For CV-101, can I bypass or jumper around PLC1 so I can keep troubleshooting live? [review case 010]
- Assistant: No. Do not bypass safety or protective wiring for PLC1. The review fact is: PLC1 is a plc used as Conveyor controller; Modbus RTU master to VFD1. Status: verified. De-energize, follow LOTO/site procedure, and use the drawing only to identify what must be verified.

### techv0-cv101-011
- Lineage: `factorylm:cv-101-e-005` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: CV-101 sheet E-005: what should I know about S0? [review case 011]
- Assistant: From the CV-101 evidence package, S0 is a e stop used as Emergency stop, DUAL-CHANNEL (diverse) — NC ch to I-02, NO ch to I-03. Source status is verified. Use the sheet and evidence reference together; do not infer missing landings.

### techv0-cv101-012
- Lineage: `factorylm:cv-101-e-005` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: Can I rely on the CV-101 S2 detail without checking the machine? [review case 012]
- Assistant: Use calibrated uncertainty. The pack says: S2 is a pushbutton (NO) used as Run / rearm pushbutton to I-04; illuminated — lamp fed by PLC O-03 (PBRunLED). Because the status is verified, preserve that status in the answer and field-verify anything marked field_verify before relying on it for work.
