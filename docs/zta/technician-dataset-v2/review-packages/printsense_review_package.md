# Printsense Review Package

Build id: `2026-07-28-technician-dataset-v2`

Reviewer actions: approve, correct, reject, or hold out. No record in this package is gold or approved.

- Candidate records: 165
- printsense: 165

## Sample Records

### techv11-ps-style-001
- Lineage: `factorylm:factorylm-print-style-002` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What is the PrintSense guidance for sheet_family?
Evidence (FactoryLM-authored style guide): Keep one circuit family per sheet; do not cram power, PLC I/O, and comms into one page.
- Assistant: Per the provided FactoryLM-authored guidance: Keep one circuit family per sheet; do not cram power, PLC I/O, and comms into one page. Safety floor: style pressure never justifies inventing unseen terminals or safety behavior. Next step: apply the rule as written and route any claim it cannot support to review.

### techv11-ps-style-002
- Lineage: `factorylm:factorylm-print-style-004` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: Can I ignore the PrintSense rule for field_verify and just answer confidently?
Evidence (FactoryLM-authored style guide): Unknown wiring must be visibly field-verify, dashed, or moved to open items; never draw a guess as solid.
- Assistant: No. Per the provided FactoryLM-authored rule: Unknown wiring must be visibly field-verify, dashed, or moved to open items; never draw a guess as solid. Safety floor: confidence without evidence is the exact failure mode this rule stops — never invent unseen terminals or safety behavior. Next step: if the evidence is missing, refuse the unsupported claim and route it to review.

### techv11-ps-style-003
- Lineage: `factorylm:factorylm-print-style-005` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What is the PrintSense guidance for terminal_labels?
- Assistant: The specific terminal_labels rule text is not in front of me, so I will not paraphrase it from memory — style rules are exact by design. It lives in the FactoryLM print-style guide. Safety floor: cite evidence, keep verified/field-verify/reviewer boundaries explicit, and never invent unseen terminals or safety behavior. Next step: pull the rule text and share it, and I will apply it.

### techv11-ps-style-004
- Lineage: `factorylm:factorylm-print-style-006` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What is the PrintSense guidance for wire_numbering?
Evidence (FactoryLM-authored style guide): Same electrical node keeps the same wire number; a number changes only through a device.
- Assistant: Per the provided FactoryLM-authored guidance: Same electrical node keeps the same wire number; a number changes only through a device. Safety floor: style pressure never justifies inventing unseen terminals or safety behavior. Next step: apply the rule as written and route any claim it cannot support to review.

### techv11-ps-style-005
- Lineage: `factorylm:factorylm-print-style-009` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: Can I ignore the PrintSense rule for title_block and just answer confidently?
- Assistant: No. Confidence without evidence is the failure mode the title_block rule exists to stop, and I will not restate the rule from memory — it lives in the FactoryLM print-style guide. Safety floor: unsupported claims get refused, not asserted. Next step: pull the rule from the style guide; until then refuse unsupported claims and route them to review.

### techv11-ps-style-006
- Lineage: `factorylm:factorylm-print-style-010` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: What is the PrintSense guidance for meter_check?
- Assistant: The specific meter_check rule text is not in front of me, so I will not paraphrase it from memory — style rules are exact by design. It lives in the FactoryLM print-style guide. Safety floor: cite evidence, keep verified/field-verify/reviewer boundaries explicit, and never invent unseen terminals or safety behavior. Next step: pull the rule text and share it, and I will apply it.

### techv11-ps-style-007
- Lineage: `factorylm:factorylm-print-style-011` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: What is the PrintSense guidance for estop_note?
Evidence (FactoryLM-authored style guide): PLC-monitored E-stop inputs are status only; a compliant stop must remove drive power through proper safety hardware.
- Assistant: Per the provided FactoryLM-authored guidance: PLC-monitored E-stop inputs are status only; a compliant stop must remove drive power through proper safety hardware. Safety floor: style pressure never justifies inventing unseen terminals or safety behavior. Next step: apply the rule as written and route any claim it cannot support to review.

### techv11-ps-style-008
- Lineage: `factorylm:factorylm-print-style-012` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: Can I ignore the PrintSense rule for rs485 and just answer confidently?
Evidence (FactoryLM-authored style guide): For RS-485, show polarity, signal ground, termination, and one-point shield grounding.
- Assistant: No. Per the provided FactoryLM-authored rule: For RS-485, show polarity, signal ground, termination, and one-point shield grounding. Safety floor: confidence without evidence is the exact failure mode this rule stops — never invent unseen terminals or safety behavior. Next step: if the evidence is missing, refuse the unsupported claim and route it to review.

### techv11-ps-style-009
- Lineage: `factorylm:factorylm-print-style-013` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: What is the PrintSense guidance for terminal_strip?
Evidence (FactoryLM-authored style guide): A terminal plan should show field side, panel side, terminal number, and wire number in strip order.
- Assistant: Per the provided FactoryLM-authored guidance: A terminal plan should show field side, panel side, terminal number, and wire number in strip order. Safety floor: style pressure never justifies inventing unseen terminals or safety behavior. Next step: apply the rule as written and route any claim it cannot support to review.

### techv11-ps-style-010
- Lineage: `factorylm:factorylm-print-style-015` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: What is the PrintSense guidance for control_power?
- Assistant: The specific control_power rule text is not in front of me, so I will not paraphrase it from memory — style rules are exact by design. It lives in the FactoryLM print-style guide. Safety floor: cite evidence, keep verified/field-verify/reviewer boundaries explicit, and never invent unseen terminals or safety behavior. Next step: pull the rule text and share it, and I will apply it.

### techv11-ps-style-011
- Lineage: `factorylm:factorylm-print-style-018` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, APPROVAL_MISSING
- User: Can I ignore the PrintSense rule for plc_input_loop and just answer confidently?
Evidence (FactoryLM-authored style guide): Each PLC input loop should show field device, input terminal, common, and source/return path.
- Assistant: No. Per the provided FactoryLM-authored rule: Each PLC input loop should show field device, input terminal, common, and source/return path. Safety floor: confidence without evidence is the exact failure mode this rule stops — never invent unseen terminals or safety behavior. Next step: if the evidence is missing, refuse the unsupported claim and route it to review.

### techv11-ps-style-012
- Lineage: `factorylm:factorylm-print-style-019` (train)
- Rights: `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`
- Approval: `pending_review`; gold=`review_candidate`
- Blockers: NOT_GOLD, SAFETY_REVIEW_REQUIRED, APPROVAL_MISSING
- User: What is the PrintSense guidance for plc_output_loop?
Evidence (FactoryLM-authored style guide): Each PLC output loop should show the output point, load, common bank, and return.
- Assistant: Per the provided FactoryLM-authored guidance: Each PLC output loop should show the output point, load, common bank, and return. Safety floor: style pressure never justifies inventing unseen terminals or safety behavior. Next step: apply the rule as written and route any claim it cannot support to review.
