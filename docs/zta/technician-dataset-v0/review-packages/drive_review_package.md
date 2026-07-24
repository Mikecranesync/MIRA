# Drive Review Package

Build id: `2026-07-23-technician-dataset-v0`

Reviewer actions: approve, correct, reject, or hold out. No record in this package is gold or approved.

- Candidate records: 70
- drive_commander: 70

## Sample Records

### techv0-drive-001
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `BLOCK_TRAINING_UNTIL_OEM_RIGHTS_APPROVED`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, TRAINING_NOT_ALLOWED, APPROVAL_MISSING
- User: DURApulse GS10: identify related_parameters_not_faults from the deterministic Drive Commander pack. [review case 001]
- Assistant: P09.03.related_faults holds the GS10 fault mnemonic CE10 (a fault reference), NOT a parameter id — the leaked-param-id guard must still hold under GS10 conventions. Evidence page/ref: 4-188. This is a pack-grounded lookup, not authorization to reset, bypass, or perform energized work.

### techv0-drive-002
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `BLOCK_TRAINING_UNTIL_OEM_RIGHTS_APPROVED`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, TRAINING_NOT_ALLOWED, APPROVAL_MISSING
- User: DURApulse GS10: identify CE1 from the deterministic Drive Commander pack. [review case 002]
- Assistant: CE1 is CE1 comm illegal cmd with numeric code 54. Evidence page/ref: 6-8. This is a pack-grounded lookup, not authorization to reset, bypass, or perform energized work.

### techv0-drive-003
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `BLOCK_TRAINING_UNTIL_OEM_RIGHTS_APPROVED`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, TRAINING_NOT_ALLOWED, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: I see CE10 on a DURApulse GS10. What is known, and what is still uncertain? [review case 003]
- Assistant: Known from the deterministic pack: CE10 is CE10 modbus timeout with numeric code 58. Related parameters: P09.03. The pack is review evidence only until rights and record approval are complete.

### techv0-drive-004
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `BLOCK_TRAINING_UNTIL_OEM_RIGHTS_APPROVED`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, TRAINING_NOT_ALLOWED, APPROVAL_MISSING
- User: DURApulse GS10: identify CE2 from the deterministic Drive Commander pack. [review case 004]
- Assistant: CE2 is CE2 comm illegal addr with numeric code 55. Evidence page/ref: 6-8. This is a pack-grounded lookup, not authorization to reset, bypass, or perform energized work.

### techv0-drive-005
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `BLOCK_TRAINING_UNTIL_OEM_RIGHTS_APPROVED`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, TRAINING_NOT_ALLOWED, APPROVAL_MISSING
- User: Correct this DURApulse GS10 lookup for CE3; I may be mixing parameters and faults. [review case 005]
- Assistant: Correction: keep fault IDs and parameter IDs separate. For CE3, the pack says CE3 is CE3 comm illegal data with numeric code 56. Related faults: none; related parameters: none.

### techv0-drive-006
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `BLOCK_TRAINING_UNTIL_OEM_RIGHTS_APPROVED`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, TRAINING_NOT_ALLOWED, APPROVAL_MISSING
- User: I see CE4 on a DURApulse GS10. What is known, and what is still uncertain? [review case 006]
- Assistant: Known from the deterministic pack: CE4 is CE4 comm fail with numeric code 57. Related parameters: none. The pack is review evidence only until rights and record approval are complete.

### techv0-drive-007
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `BLOCK_TRAINING_UNTIL_OEM_RIGHTS_APPROVED`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, TRAINING_NOT_ALLOWED, APPROVAL_MISSING
- User: DURApulse GS10: identify EF from the deterministic Drive Commander pack. [review case 007]
- Assistant: EF is EF external fault with numeric code 49. Evidence page/ref: 6-x. This is a pack-grounded lookup, not authorization to reset, bypass, or perform energized work.

### techv0-drive-008
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `BLOCK_TRAINING_UNTIL_OEM_RIGHTS_APPROVED`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, TRAINING_NOT_ALLOWED, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: DURApulse GS10 shows GFF. Can I suppress it and keep the line running? [review case 008]
- Assistant: No. Do not suppress or bypass a drive fault to keep running. The deterministic pack fact is: GFF is GFF ground fault with numeric code 4. Stop and follow site procedure before inspection.

### techv0-drive-009
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `BLOCK_TRAINING_UNTIL_OEM_RIGHTS_APPROVED`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, TRAINING_NOT_ALLOWED, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: I see Lvd on a DURApulse GS10. What is known, and what is still uncertain? [review case 009]
- Assistant: Known from the deterministic pack: Lvd is Lvd undervoltage with numeric code 12. Related parameters: none. The pack is review evidence only until rights and record approval are complete.

### techv0-drive-010
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `BLOCK_TRAINING_UNTIL_OEM_RIGHTS_APPROVED`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, TRAINING_NOT_ALLOWED, APPROVAL_MISSING
- User: Correct this DURApulse GS10 lookup for none; I may be mixing parameters and faults. [review case 010]
- Assistant: Correction: keep fault IDs and parameter IDs separate. For none, the pack says none is no active fault with numeric code 0. Related faults: none; related parameters: none.

### techv0-drive-011
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `BLOCK_TRAINING_UNTIL_OEM_RIGHTS_APPROVED`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, TRAINING_NOT_ALLOWED, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: DURApulse GS10: identify oL from the deterministic Drive Commander pack. [review case 011]
- Assistant: oL is oL overload with numeric code 21. Evidence page/ref: 6-x. This is a pack-grounded lookup, not authorization to reset, bypass, or perform energized work.

### techv0-drive-012
- Lineage: `automationdirect:gs10-um` (train)
- Rights: `BLOCK_TRAINING_UNTIL_OEM_RIGHTS_APPROVED`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, TRAINING_NOT_ALLOWED, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: DURApulse GS10 shows P09.03. Can I suppress it and keep the line running? [review case 012]
- Assistant: No. Do not suppress or bypass a drive fault to keep running. The deterministic pack fact is: P09.03 is COM1 Time-out Detection; default 00; range 00–1000 sec; unit sec. Stop and follow site procedure before inspection.
