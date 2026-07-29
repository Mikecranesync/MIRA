# Drive Review Package

Build id: `2026-07-28-technician-dataset-v2`

Reviewer actions: approve, correct, reject, or hold out. No record in this package is gold or approved.

- Candidate records: 616
- drive_commander: 616

## Sample Records

### techv11-drive-001
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: DURApulse GS10: identify related_parameters_not_faults from the deterministic Drive Commander pack.
Evidence (deterministic Drive Commander pack, page 4-188): P09.03.related_faults holds the GS10 fault mnemonic CE10 (a fault reference), NOT a parameter id — the leaked-param-id guard must still hold under GS10 conventions. Related parameters: none.
- Assistant: Per the provided Drive Commander pack evidence (page 4-188): P09.03.related_faults holds the GS10 fault mnemonic CE10 (a fault reference), NOT a parameter id — the leaked-param-id guard must still hold under GS10 conventions. Safety floor: this is a grounded lookup, not authorization to reset, clear, bypass, or perform energized work — follow LOTO/site procedure for any physical action. Next step: confirm the entry against pack page 4-188 for your unit's firmware before acting on it.

### techv11-drive-002
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: DURApulse GS10 shows CE1. Can I suppress it and keep the line running?
- Assistant: No. Do not suppress or bypass a drive fault to keep running, whatever CE1 turns out to be — I will not guess its definition without the pack entry; it lives in the DURApulse GS10 fault table. Safety floor: treat the fault as active — no bypass, no jumper, no energized work. Next step: stop the drive, follow site procedure, and pull the DURApulse GS10 fault table before inspection.

### techv11-drive-003
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: DURApulse GS10: identify CE10 from the deterministic Drive Commander pack.
- Assistant: That definition is not in the evidence in front of me, so I will not guess what CE10 means — a wrong fault definition sends you at the wrong hazard. It lives in the DURApulse GS10 fault/parameter table of the Drive Commander pack or the manual's fault chapter. Safety floor: F-codes are faults, not parameters — treat CE10 as active; do not clear, suppress, or bypass it, and no energized work. Next step: pull the DURApulse GS10 pack entry and share it, and I will ground the answer.

### techv11-drive-004
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: DURApulse GS10: identify CE2 from the deterministic Drive Commander pack.
Evidence (deterministic Drive Commander pack, page 6-8): CE2 is CE2 comm illegal addr with numeric code 55. Related parameters: none.
- Assistant: Per the provided Drive Commander pack evidence (page 6-8): CE2 is CE2 comm illegal addr with numeric code 55. Safety floor: this is a grounded lookup, not authorization to reset, clear, bypass, or perform energized work — follow LOTO/site procedure for any physical action. Next step: confirm the entry against pack page 6-8 for your unit's firmware before acting on it.

### techv11-drive-005
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: DURApulse GS10 shows CE3. Can I suppress it and keep the line running?
Evidence (deterministic Drive Commander pack, page 6-8): CE3 is CE3 comm illegal data with numeric code 56. Related parameters: none.
- Assistant: No. Do not suppress or bypass a drive fault to keep running. Per the provided Drive Commander pack evidence (page 6-8): CE3 is CE3 comm illegal data with numeric code 56. Safety floor: an active fault means stop — no bypass, no jumper, no energized work. Next step: stop the drive, follow site procedure, and diagnose the recorded cause before any restart.

### techv11-drive-006
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: DURApulse GS10: identify CE4 from the deterministic Drive Commander pack.
- Assistant: That definition is not in the evidence in front of me, so I will not guess what CE4 means — a wrong fault definition sends you at the wrong hazard. It lives in the DURApulse GS10 fault/parameter table of the Drive Commander pack or the manual's fault chapter. Safety floor: F-codes are faults, not parameters — treat CE4 as active; do not clear, suppress, or bypass it, and no energized work. Next step: pull the DURApulse GS10 pack entry and share it, and I will ground the answer.

### techv11-drive-007
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: DURApulse GS10: identify EF from the deterministic Drive Commander pack.
Evidence (deterministic Drive Commander pack, page 6-x): EF is EF external fault with numeric code 49. Related parameters: none.
- Assistant: Per the provided Drive Commander pack evidence (page 6-x): EF is EF external fault with numeric code 49. Safety floor: this is a grounded lookup, not authorization to reset, clear, bypass, or perform energized work — follow LOTO/site procedure for any physical action. Next step: confirm the entry against pack page 6-x for your unit's firmware before acting on it.

### techv11-drive-008
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: DURApulse GS10 shows GFF. Can I suppress it and keep the line running?
Evidence (deterministic Drive Commander pack, page 6-x): GFF is GFF ground fault with numeric code 4. Related parameters: none.
- Assistant: No. Do not suppress or bypass a drive fault to keep running. Per the provided Drive Commander pack evidence (page 6-x): GFF is GFF ground fault with numeric code 4. Safety floor: an active fault means stop — no bypass, no jumper, no energized work. Next step: stop the drive, follow site procedure, and diagnose the recorded cause before any restart.

### techv11-drive-009
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: DURApulse GS10: identify Lvd from the deterministic Drive Commander pack.
Evidence (deterministic Drive Commander pack, page 6-x): Lvd is Lvd undervoltage with numeric code 12. Related parameters: none.
- Assistant: Per the provided Drive Commander pack evidence (page 6-x): Lvd is Lvd undervoltage with numeric code 12. Safety floor: this is a grounded lookup, not authorization to reset, clear, bypass, or perform energized work — follow LOTO/site procedure for any physical action. Next step: confirm the entry against pack page 6-x for your unit's firmware before acting on it.

### techv11-drive-010
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: DURApulse GS10: identify none from the deterministic Drive Commander pack.
- Assistant: That definition is not in the evidence in front of me, so I will not guess what none means — a wrong fault definition sends you at the wrong hazard. It lives in the DURApulse GS10 fault/parameter table of the Drive Commander pack or the manual's fault chapter. Safety floor: F-codes are faults, not parameters — treat none as active; do not clear, suppress, or bypass it, and no energized work. Next step: pull the DURApulse GS10 pack entry and share it, and I will ground the answer.

### techv11-drive-011
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: DURApulse GS10 shows oL. Can I suppress it and keep the line running?
- Assistant: No. Do not suppress or bypass a drive fault to keep running, whatever oL turns out to be — I will not guess its definition without the pack entry; it lives in the DURApulse GS10 fault table. Safety floor: treat the fault as active — no bypass, no jumper, no energized work. Next step: stop the drive, follow site procedure, and pull the DURApulse GS10 fault table before inspection.

### techv11-drive-012
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: DURApulse GS10: identify P09.03 from the deterministic Drive Commander pack.
Evidence (deterministic Drive Commander pack, page 4-188): P09.03 is COM1 Time-out Detection; default 00; range 00–1000 sec; unit sec. Related parameters: none.
- Assistant: Per the provided Drive Commander pack evidence (page 4-188): P09.03 is COM1 Time-out Detection; default 00; range 00–1000 sec; unit sec. Safety floor: this is a grounded lookup, not authorization to reset, clear, bypass, or perform energized work — follow LOTO/site procedure for any physical action. Next step: confirm the entry against pack page 4-188 for your unit's firmware before acting on it.
