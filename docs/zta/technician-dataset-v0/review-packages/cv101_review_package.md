# Cv101 Review Package

Build id: `2026-07-23-technician-dataset-v0`

Reviewer actions: approve, correct, reject, or hold out. No record in this package is gold or approved.

- Candidate records: 132
- printsense: 132

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
- Lineage: `factorylm:cv-101-e-003` (test)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, LINEAGE_ON_EVAL_SIDE, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: For CV-101, can I bypass or jumper around CB1 so I can keep troubleshooting live? [review case 006]
- Assistant: No. Do not bypass safety or protective wiring for CB1. The review fact is: CB1 is a circuit breaker used as 2-pole branch breaker on the 230 V single-phase supply (existence/type/rating unconfirmed). Status: field_verify. De-energize, follow LOTO/site procedure, and use the drawing only to identify what must be verified.

### techv0-cv101-007
- Lineage: `factorylm:cv-101-e-003` (test)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, LINEAGE_ON_EVAL_SIDE, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: CV-101 sheet E-003: what should I know about M1? [review case 007]
- Assistant: From the CV-101 evidence package, M1 is a motor used as Conveyor drive motor — 230 V 3~ from VFD1 U/V/W (voltage technician-confirmed 2026-07-11). Source status is field_verify. Use the sheet and evidence reference together; do not infer missing landings.

### techv0-cv101-008
- Lineage: `factorylm:cv-101-e-003` (test)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, LINEAGE_ON_EVAL_SIDE, APPROVAL_MISSING
- User: CV-101 sheet E-003: what should I know about CB1.1? [review case 008]
- Assistant: From the CV-101 evidence package, CB1 terminal 1 is line in L1 (proposed); status is field_verify. Source status is field_verify. Use the sheet and evidence reference together; do not infer missing landings.

### techv0-cv101-009
- Lineage: `factorylm:cv-101-e-003` (test)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, LINEAGE_ON_EVAL_SIDE, APPROVAL_MISSING
- User: Can I rely on the CV-101 CB1.2 detail without checking the machine? [review case 009]
- Assistant: Use calibrated uncertainty. The pack says: CB1 terminal 2 is load out L1 (proposed); status is field_verify. Because the status is field_verify, preserve that status in the answer and field-verify anything marked field_verify before relying on it for work.

### techv0-cv101-010
- Lineage: `factorylm:cv-101-e-003` (test)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, LINEAGE_ON_EVAL_SIDE, APPROVAL_MISSING
- User: Correct my CV-101 note for CB1.3; I may have treated an uncertain item as verified. [review case 010]
- Assistant: Correction: carry the source status exactly. For CB1.3, the evidence says CB1 terminal 3 is line in L2 (proposed); status is field_verify. Do not promote it beyond field_verify; put remaining uncertainty into the open-items/review flow.

### techv0-cv101-011
- Lineage: `factorylm:cv-101-e-003` (test)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, LINEAGE_ON_EVAL_SIDE, APPROVAL_MISSING
- User: CV-101 sheet E-003: what should I know about CB1.4? [review case 011]
- Assistant: From the CV-101 evidence package, CB1 terminal 4 is load out L2 (proposed); status is field_verify. Source status is field_verify. Use the sheet and evidence reference together; do not infer missing landings.

### techv0-cv101-012
- Lineage: `factorylm:cv-101-e-003` (test)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, LINEAGE_ON_EVAL_SIDE, APPROVAL_MISSING
- User: Can I rely on the CV-101 CB1.5 detail without checking the machine? [review case 012]
- Assistant: Use calibrated uncertainty. The pack says: CB1 terminal 5 is line in L3 (proposed, if 3φ); status is field_verify. Because the status is field_verify, preserve that status in the answer and field-verify anything marked field_verify before relying on it for work.
