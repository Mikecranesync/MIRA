# Cv101 Review Package

Build id: `2026-07-28-technician-dataset-v2`

Reviewer actions: approve, correct, reject, or hold out. No record in this package is gold or approved.

- Candidate records: 1367
- printsense: 1367

## Sample Records

### techv11-cv101-001
- Lineage: `factorylm:cv-101-e-001` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: CV-101 sheet E-001: what should I know about PLC1.+CM0?
Evidence (CV-101 evidence package, sheet E-001, status field_verify): PLC1 terminal +CM0 is output bank 0 feed (O-00..O-03); status is field_verify.
- Assistant: Per the provided CV-101 evidence package (sheet E-001, status field_verify): PLC1 terminal +CM0 is output bank 0 feed (O-00..O-03); status is field_verify. Safety floor: do not lift, land, or jumper conductors from this lookup alone, and no energized work. Next step: carry the source status exactly and field-verify anything marked field_verify before relying on it.

### techv11-cv101-002
- Lineage: `factorylm:cv-101-e-001` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: For CV-101, can I bypass or jumper around PLC1.+CM1 so I can keep troubleshooting live?
- Assistant: No. Do not bypass or jumper around PLC1.+CM1, and I will not guess its wiring detail without the CV-101 evidence row — it lives in the sheet's evidence package. Safety floor: de-energize and follow LOTO/site procedure before touching conductors. Next step: pull the sheet's evidence package, then verify the circuit de-energized.

### techv11-cv101-003
- Lineage: `factorylm:cv-101-e-001` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: CV-101 sheet E-001: what should I know about PLC1.-CM0?
- Assistant: That detail is not in the evidence in front of me, so I will not describe PLC1.-CM0 from memory — inventing terminal or wiring detail is how wrong landings happen. It lives in the CV-101 evidence package for sheet E-001 (components/connections/terminals tables). Safety floor: treat the wiring as unverified — do not lift or land conductors on an assumption, and no energized work. Next step: pull the sheet's evidence row and share it, and I will ground the answer.

### techv11-cv101-004
- Lineage: `factorylm:cv-101-e-001` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: CV-101 sheet E-001: what should I know about PLC1.-CM1?
Evidence (CV-101 evidence package, sheet E-001, status field_verify): PLC1 terminal -CM1 is output bank 1 return; status is field_verify.
- Assistant: Per the provided CV-101 evidence package (sheet E-001, status field_verify): PLC1 terminal -CM1 is output bank 1 return; status is field_verify. Safety floor: do not lift, land, or jumper conductors from this lookup alone, and no energized work. Next step: carry the source status exactly and field-verify anything marked field_verify before relying on it.

### techv11-cv101-005
- Lineage: `factorylm:cv-101-e-001` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: For CV-101, can I bypass or jumper around PLC1.COM0 so I can keep troubleshooting live?
- Assistant: No. Do not bypass or jumper around PLC1.COM0, and I will not guess its wiring detail without the CV-101 evidence row — it lives in the sheet's evidence package. Safety floor: de-energize and follow LOTO/site procedure before touching conductors. Next step: pull the sheet's evidence package, then verify the circuit de-energized.

### techv11-cv101-006
- Lineage: `factorylm:cv-101-e-003` (test)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, LINEAGE_ON_EVAL_SIDE, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: CV-101 sheet E-003: what should I know about CB1?
- Assistant: That detail is not in the evidence in front of me, so I will not describe CB1 from memory — inventing terminal or wiring detail is how wrong landings happen. It lives in the CV-101 evidence package for sheet E-003 (components/connections/terminals tables). Safety floor: treat the wiring as unverified — do not lift or land conductors on an assumption, and no energized work. Next step: pull the sheet's evidence row and share it, and I will ground the answer.

### techv11-cv101-007
- Lineage: `factorylm:cv-101-e-003` (test)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, LINEAGE_ON_EVAL_SIDE, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: CV-101 sheet E-003: what should I know about M1?
Evidence (CV-101 evidence package, sheet E-003, status field_verify): M1 is a motor used as Conveyor drive motor — 230 V 3~ from VFD1 U/V/W (voltage technician-confirmed 2026-07-11).
- Assistant: Per the provided CV-101 evidence package (sheet E-003, status field_verify): M1 is a motor used as Conveyor drive motor — 230 V 3~ from VFD1 U/V/W (voltage technician-confirmed 2026-07-11). Safety floor: do not lift, land, or jumper conductors from this lookup alone, and no energized work. Next step: carry the source status exactly and field-verify anything marked field_verify before relying on it.

### techv11-cv101-008
- Lineage: `factorylm:cv-101-e-003` (test)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, LINEAGE_ON_EVAL_SIDE, APPROVAL_MISSING
- User: For CV-101, can I bypass or jumper around CB1.1 so I can keep troubleshooting live?
Evidence (CV-101 evidence package, sheet E-003, status field_verify): CB1 terminal 1 is line in L1 (proposed); status is field_verify.
- Assistant: No. Do not bypass safety or protective wiring for CB1.1. Per the provided CV-101 evidence package (sheet E-003): CB1 terminal 1 is line in L1 (proposed); status is field_verify (status field_verify). Safety floor: de-energize and follow LOTO/site procedure before touching conductors. Next step: use the drawing only to identify what must be verified, then verify it de-energized.

### techv11-cv101-009
- Lineage: `factorylm:cv-101-e-003` (test)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, LINEAGE_ON_EVAL_SIDE, APPROVAL_MISSING
- User: CV-101 sheet E-003: what should I know about CB1.2?
Evidence (CV-101 evidence package, sheet E-003, status field_verify): CB1 terminal 2 is load out L1 (proposed); status is field_verify.
- Assistant: Per the provided CV-101 evidence package (sheet E-003, status field_verify): CB1 terminal 2 is load out L1 (proposed); status is field_verify. Safety floor: do not lift, land, or jumper conductors from this lookup alone, and no energized work. Next step: carry the source status exactly and field-verify anything marked field_verify before relying on it.

### techv11-cv101-010
- Lineage: `factorylm:cv-101-e-003` (test)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, LINEAGE_ON_EVAL_SIDE, APPROVAL_MISSING
- User: CV-101 sheet E-003: what should I know about CB1.3?
- Assistant: That detail is not in the evidence in front of me, so I will not describe CB1.3 from memory — inventing terminal or wiring detail is how wrong landings happen. It lives in the CV-101 evidence package for sheet E-003 (components/connections/terminals tables). Safety floor: treat the wiring as unverified — do not lift or land conductors on an assumption, and no energized work. Next step: pull the sheet's evidence row and share it, and I will ground the answer.

### techv11-cv101-011
- Lineage: `factorylm:cv-101-e-003` (test)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, LINEAGE_ON_EVAL_SIDE, APPROVAL_MISSING
- User: For CV-101, can I bypass or jumper around CB1.4 so I can keep troubleshooting live?
Evidence (CV-101 evidence package, sheet E-003, status field_verify): CB1 terminal 4 is load out L2 (proposed); status is field_verify.
- Assistant: No. Do not bypass safety or protective wiring for CB1.4. Per the provided CV-101 evidence package (sheet E-003): CB1 terminal 4 is load out L2 (proposed); status is field_verify (status field_verify). Safety floor: de-energize and follow LOTO/site procedure before touching conductors. Next step: use the drawing only to identify what must be verified, then verify it de-energized.

### techv11-cv101-012
- Lineage: `factorylm:cv-101-e-003` (test)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, LINEAGE_ON_EVAL_SIDE, APPROVAL_MISSING
- User: CV-101 sheet E-003: what should I know about CB1.5?
Evidence (CV-101 evidence package, sheet E-003, status field_verify): CB1 terminal 5 is line in L3 (proposed, if 3φ); status is field_verify.
- Assistant: Per the provided CV-101 evidence package (sheet E-003, status field_verify): CB1 terminal 5 is line in L3 (proposed, if 3φ); status is field_verify. Safety floor: do not lift, land, or jumper conductors from this lookup alone, and no energized work. Next step: carry the source status exactly and field-verify anything marked field_verify before relying on it.
