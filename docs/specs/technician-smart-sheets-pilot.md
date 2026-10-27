# Technician smart sheets — opportunity and first-pilot proposal

Date: 2026-10-27
Status: Proposed; documentation only. No implementation, field validation, customer commitment, or production capability is claimed.

## Recommendation

Start with one phone-friendly gap, clearance, and wear measurement sheet, then a shift handover sheet. Test one equipment type and one existing approved inspection form with a small technician group before expanding.

“Smart sheets” means guided digital maintenance forms; it does not imply using the Smartsheet product or adding a new vendor. The proposed value is better job completion, comparable equipment history, and follow-up on exceptions.

## Candidate backlog

Ordering is a recommendation, not validated demand or an implementation commitment.

| Priority | Sheet | Technician input | Proposed smart behavior |
| --- | --- | --- | --- |
| 1 | Gap, clearance, and wear checks | Equipment, point, reading, unit, photo | Compare with approved limits and comparable prior readings; flag exceptions |
| 2 | Shift handover | Equipment status, completed/unfinished work, parts needed | Draft a concise pass-down with an owner and next action for each open item |
| 3 | Daily equipment inspection | Condition checks, readings, defects | Show approved follow-up questions on failed checks; capture exception evidence |
| 4 | Fault and repair log | Exact model, fault code, symptoms, checks, repair | Link relevant manual evidence; record whether the repair resolved the symptom |
| 5 | Motor and drive condition rounds | Current, temperature, vibration, load, method | Compare readings under similar conditions; highlight baseline changes |
| 6 | Lubrication route | Point, approved product, quantity, completion | Display approved instructions; track missed points and consumption |
| 7 | Sensor troubleshooting | Sensor ID, LED state, physical condition, PLC input | Walk an approved check sequence and retain evidence |
| 8 | Parts replacement record | Removed/installed part, reason, photos | Retain component history and flag recurring replacement without confirmed cause |
| 9 | Leak inspection route | Location, fluid, severity, photo | Track new, worsening, repaired, and recurring leaks |
| 10 | Shift assignment sheet | Equipment assignments and approved task packages | Build a personal task list with dependencies and unfinished items |

## First pilot: gap-check sheet

### Inputs needed before implementation

- One permitted source inspection form, equipment identity, and approved procedure revision.
- Approved measurement points, units, limits, boundary rules, and required measurement conditions.
- Named procedure owner/reviewer and required exception/escalation process.
- Permission to use any real site data. Use synthetic equipment and readings for initial demos; do not publish workplace prints, photos, limits, or employee details in this public repository.
- Inspect existing repository forms, asset identity, evidence, shared UI, and export components before selecting implementation files. Reuse established components; this proposal does not establish a new architecture.

### Technician journey

1. Select the equipment or scan its QR code; confirm identity.
2. Open the approved, versioned inspection and see its points and measurement instructions.
3. Enter each reading with its unit and required context.
4. Optionally attach a photo. Any AI-proposed transcription stays unconfirmed until the technician explicitly confirms or corrects it.
5. Apply deterministic validation and comparison; display the approved limit and its source beside the result.
6. Record exceptions, corrective work, owner, and required review; preserve unfinished work for handover.
7. Save or export a traceable record for the existing maintenance process.

QR lookup, photo transcription, resume, export, and integrations are proposed requirements, not verified existing capabilities.

### Minimum record

| Group | Fields |
| --- | --- |
| Identity | Site/tenant, equipment ID, inspection ID, measurement-point ID |
| Authority | Procedure reference/revision, limit source, approved units, min/max and inclusive/exclusive boundary rules |
| Observation | Raw reading, unit, timestamp, technician, measurement method/conditions, optional evidence reference |
| Confirmation | Manual entry or AI proposal; confirmed value, confirmation actor/time |
| Result | Validation status; within limits, outside limits, or unassessed; comparison provenance |
| Follow-up | Exception, owner, next action, corrective work, review status |
| History | Prior versions, corrections with actor/time/reason, comparable prior readings |

### Boundaries

- Limits, calculations, required fields, and completion rules are deterministic and traceable to approved documentation.
- Missing or conflicting limits yield “unassessed”; missing readings are incomplete. Neither may silently pass.
- Unit conversions must be explicit and validated. Compare trends only for matching point, units, method, and relevant operating conditions.
- MIRA may explain approved instructions and assist capture. It must not invent limits, silently approve a reading, or replace required qualified-person review.
- Form completion and an in-range reading never authorize return to service.
- Preserve original evidence and corrected values. Respect existing tenant isolation and access controls.
- A handover summary remains reviewable by the technician; safety-critical status must be explicit rather than inferred from free text.

## Proposed implementation acceptance criteria

These criteria define later build verification; none are marked implemented by this documentation PR.

1. Equipment and inspection revision are visible before entry; the saved record retains both.
2. Synthetic cases below, at, and above each configured boundary produce the expected result using the explicit boundary rule.
3. Missing/conflicting limits, wrong units, invalid numbers, and missing required readings cannot produce a passing result.
4. Photo-derived values cannot become confirmed readings without explicit technician confirmation.
5. Interrupted entry resumes without lost or duplicate readings; saved corrections retain their audit history.
6. Prior-reading comparison excludes incompatible measurement conditions or clearly explains why comparison is unavailable.
7. An out-of-limit result records the required follow-up and review state; no result implies release authorization.
8. A second tenant cannot read or change the inspection or its evidence.
9. The actual target phone can complete the form and reopen its saved record; the exported record matches confirmed values and procedure revision.

## Pilot evidence and decision

Measure the existing paper/spreadsheet workflow first, then the same inspection scope with the pilot.

- Entry/completion time, including exception handling.
- Missing required readings and transcription corrections.
- Exceptions captured, assigned, and followed up.
- Technician willingness to use it on another shift.
- Additional double entry required by the existing CMMS/process.

Agree sample size, success thresholds, and who reviews results before the pilot. Do not invent ROI or claim downtime reduction from form-completion metrics. Continue only if technicians find it useful and evidence shows improved capture or lower burden without weaker review.

Next action: obtain one permitted source form and its approved limits, map reusable repository components, then scope a separate implementation issue/PR. Shift handover follows after this narrow pilot is evaluated.

## Research references

These sources establish existing template categories and the value of retaining comparable measurements. They do not validate product demand or prove MIRA capabilities.

- [Smartsheet ongoing preventive-maintenance template set](https://www.smartsheet.com/marketplace/eu/template-sets/ongoing-preventative-maintenance)
- [Smartsheet maintenance shift report example](https://www.smartsheet.com/sites/default/files/2024-11/IC-Maintenance-Shift-Report-Template-12229_pdf.pdf)
- [Fluke maintenance measurement practices](https://www.fluke.com/en-us/learn/blog/motors-drives-pumps-compressors/four-must-have-measurement-practices-for-the-mechanical-maintenance-team)
