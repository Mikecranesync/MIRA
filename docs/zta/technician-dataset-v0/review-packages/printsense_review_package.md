# Printsense Review Package

Build id: `2026-07-23-technician-dataset-v0`

Reviewer actions: approve, correct, reject, or hold out. No record in this package is gold or approved.

- Candidate records: 40
- printsense: 40

## Sample Records

### techv0-ps-style-001
- Lineage: `factorylm:factorylm-print-style-002` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What is the PrintSense guidance for sheet_family? [review case 001]
- Assistant: The FactoryLM-authored guidance is: Keep one circuit family per sheet; do not cram power, PLC I/O, and comms into one page.

### techv0-ps-style-002
- Lineage: `factorylm:factorylm-print-style-002` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: Can I ignore the PrintSense rule for field_verify and just answer confidently? [review case 002]
- Assistant: No. The FactoryLM-authored rule is: Unknown wiring must be visibly field-verify, dashed, or moved to open items; never draw a guess as solid. If the evidence is missing, refuse the unsupported claim and route it to review.

### techv0-ps-style-003
- Lineage: `factorylm:factorylm-print-style-002` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What uncertainty should I preserve for PrintSense terminal_labels? [review case 003]
- Assistant: Preserve the evidence boundary: Use real terminal labels such as PLC1 I-02, VFD1 SG+, and Q1 A1/A2 instead of generic boxes. Say what is verified, what is field-verify, and what needs a reviewer.

### techv0-ps-style-004
- Lineage: `factorylm:factorylm-print-style-004` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What is the PrintSense guidance for sheet_family? [review case 004]
- Assistant: The FactoryLM-authored guidance is: Keep one circuit family per sheet; do not cram power, PLC I/O, and comms into one page.

### techv0-ps-style-005
- Lineage: `factorylm:factorylm-print-style-004` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: Correct a PrintSense answer that violates the field_verify rule. [review case 005]
- Assistant: Correction: Unknown wiring must be visibly field-verify, dashed, or moved to open items; never draw a guess as solid. Rewrite the answer so it cites evidence and does not invent unseen terminals or safety behavior.

### techv0-ps-style-006
- Lineage: `factorylm:factorylm-print-style-004` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What uncertainty should I preserve for PrintSense terminal_labels? [review case 006]
- Assistant: Preserve the evidence boundary: Use real terminal labels such as PLC1 I-02, VFD1 SG+, and Q1 A1/A2 instead of generic boxes. Say what is verified, what is field-verify, and what needs a reviewer.

### techv0-ps-style-007
- Lineage: `factorylm:factorylm-print-style-005` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What is the PrintSense guidance for sheet_family? [review case 007]
- Assistant: The FactoryLM-authored guidance is: Keep one circuit family per sheet; do not cram power, PLC I/O, and comms into one page.

### techv0-ps-style-008
- Lineage: `factorylm:factorylm-print-style-005` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: Can I ignore the PrintSense rule for field_verify and just answer confidently? [review case 008]
- Assistant: No. The FactoryLM-authored rule is: Unknown wiring must be visibly field-verify, dashed, or moved to open items; never draw a guess as solid. If the evidence is missing, refuse the unsupported claim and route it to review.

### techv0-ps-style-009
- Lineage: `factorylm:factorylm-print-style-005` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What uncertainty should I preserve for PrintSense terminal_labels? [review case 009]
- Assistant: Preserve the evidence boundary: Use real terminal labels such as PLC1 I-02, VFD1 SG+, and Q1 A1/A2 instead of generic boxes. Say what is verified, what is field-verify, and what needs a reviewer.

### techv0-ps-style-010
- Lineage: `factorylm:factorylm-print-style-006` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: Correct a PrintSense answer that violates the sheet_family rule. [review case 010]
- Assistant: Correction: Keep one circuit family per sheet; do not cram power, PLC I/O, and comms into one page. Rewrite the answer so it cites evidence and does not invent unseen terminals or safety behavior.

### techv0-ps-style-011
- Lineage: `factorylm:factorylm-print-style-006` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: What is the PrintSense guidance for field_verify? [review case 011]
- Assistant: The FactoryLM-authored guidance is: Unknown wiring must be visibly field-verify, dashed, or moved to open items; never draw a guess as solid.

### techv0-ps-style-012
- Lineage: `factorylm:factorylm-print-style-006` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What uncertainty should I preserve for PrintSense terminal_labels? [review case 012]
- Assistant: Preserve the evidence boundary: Use real terminal labels such as PLC1 I-02, VFD1 SG+, and Q1 A1/A2 instead of generic boxes. Say what is verified, what is field-verify, and what needs a reviewer.
