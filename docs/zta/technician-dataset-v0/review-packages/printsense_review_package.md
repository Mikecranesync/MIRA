# Printsense Review Package

Build id: `2026-07-23-technician-dataset-v0`

Reviewer actions: approve, correct, reject, or hold out. No record in this package is gold or approved.

- Candidate records: 17
- printsense: 17

## Sample Records

### techv0-ps-style-001
- Lineage: `factorylm:factorylm-print-style-002` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What is the PrintSense guidance for sheet_family?
- Assistant: The FactoryLM-authored guidance is: Keep one circuit family per sheet; do not cram power, PLC I/O, and comms into one page.

### techv0-ps-style-002
- Lineage: `factorylm:factorylm-print-style-004` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: Can I ignore the PrintSense rule for field_verify and just answer confidently?
- Assistant: No. The FactoryLM-authored rule is: Unknown wiring must be visibly field-verify, dashed, or moved to open items; never draw a guess as solid. If the evidence is missing, refuse the unsupported claim and route it to review.

### techv0-ps-style-003
- Lineage: `factorylm:factorylm-print-style-005` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What uncertainty should I preserve for PrintSense terminal_labels?
- Assistant: Preserve the evidence boundary: Use real terminal labels such as PLC1 I-02, VFD1 SG+, and Q1 A1/A2 instead of generic boxes. Say what is verified, what is field-verify, and what needs a reviewer.

### techv0-ps-style-004
- Lineage: `factorylm:factorylm-print-style-006` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What is the PrintSense guidance for wire_numbering?
- Assistant: The FactoryLM-authored guidance is: Same electrical node keeps the same wire number; a number changes only through a device.

### techv0-ps-style-005
- Lineage: `factorylm:factorylm-print-style-009` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: Correct a PrintSense answer that violates the title_block rule.
- Assistant: Correction: Every sheet needs a title block, revision, date, sheet number, and zone grid. Rewrite the answer so it cites evidence and does not invent unseen terminals or safety behavior.

### techv0-ps-style-006
- Lineage: `factorylm:factorylm-print-style-010` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: Can I ignore the PrintSense rule for meter_check and just answer confidently?
- Assistant: No. The FactoryLM-authored rule is: A good print tells a technician where to put meter leads and what state to expect. If the evidence is missing, refuse the unsupported claim and route it to review.

### techv0-ps-style-007
- Lineage: `factorylm:factorylm-print-style-011` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: What is the PrintSense guidance for estop_note?
- Assistant: The FactoryLM-authored guidance is: PLC-monitored E-stop inputs are status only; a compliant stop must remove drive power through proper safety hardware.

### techv0-ps-style-008
- Lineage: `factorylm:factorylm-print-style-012` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What is the PrintSense guidance for rs485?
- Assistant: The FactoryLM-authored guidance is: For RS-485, show polarity, signal ground, termination, and one-point shield grounding.

### techv0-ps-style-009
- Lineage: `factorylm:factorylm-print-style-013` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What uncertainty should I preserve for PrintSense terminal_strip?
- Assistant: Preserve the evidence boundary: A terminal plan should show field side, panel side, terminal number, and wire number in strip order. Say what is verified, what is field-verify, and what needs a reviewer.

### techv0-ps-style-010
- Lineage: `factorylm:factorylm-print-style-015` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: Can I ignore the PrintSense rule for control_power and just answer confidently?
- Assistant: No. The FactoryLM-authored rule is: Draw the 24 VDC supply as a power tree from supply to buses to protected branches. If the evidence is missing, refuse the unsupported claim and route it to review.

### techv0-ps-style-011
- Lineage: `factorylm:factorylm-print-style-018` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What is the PrintSense guidance for plc_input_loop?
- Assistant: The FactoryLM-authored guidance is: Each PLC input loop should show field device, input terminal, common, and source/return path.

### techv0-ps-style-012
- Lineage: `factorylm:factorylm-print-style-019` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: Can I ignore the PrintSense rule for plc_output_loop and just answer confidently?
- Assistant: No. The FactoryLM-authored rule is: Each PLC output loop should show the output point, load, common bank, and return. If the evidence is missing, refuse the unsupported claim and route it to review.
