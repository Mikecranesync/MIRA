# PRD — Print of the Day: Private Email Learning Flywheel for PrintSense

**Status:** Proposed  
**Owner:** FactoryLM / PrintSense  
**Primary implementer:** Claude Code  
**Product surface:** Private email workflow first; public YouTube workflow later  
**Working name:** **Print of the Day**  
**Document purpose:** Define a build-ready system that selects one difficult, verifiable electrical print page per day, runs PrintSense against it, grades the answer, prepares a YouTube-style review script, and emails the complete review package to Mike for correction and approval.

---

## 1. Executive Summary

Print of the Day is a private, daily learning and product-improvement routine for PrintSense.

Each run must:

1. Find one unfamiliar electrical-print page from a rights-safe public source.
2. Select it using controlled randomness across industries, drawing standards, equipment types, languages, age, scan quality, and difficulty.
3. Preserve a clean, one-page image or PDF attachment of the selected print.
4. Run PrintSense blind, without giving it the source explanation or answer key.
5. Grade every important claim as confirmed, incorrect, unsupported, partially correct, or unresolved.
6. Research independent evidence needed to verify the print.
7. Generate a complete YouTube-style script showing what Mike would display, say, ask, verify, and correct.
8. Email Mike one review package containing:
   - The attached one-page print
   - Source and rights information
   - The blind PrintSense response
   - Claim-by-claim grading
   - The proposed corrected explanation
   - The full video script
   - Recommended code, rule, validator, corpus, or model improvements
9. Wait for Mike’s corrections and approval before promoting anything into gold data, rules, tests, or public content.
10. Preserve the complete case and its revision history so the system measurably improves over time.

The private email phase exists to build confidence before any live or public recording. No Print of the Day case is automatically published.

---

## 2. Product Goal

Create a repeatable flywheel that simultaneously:

- Strengthens Mike’s electrical-print-reading knowledge
- Exposes PrintSense to unfamiliar real-world prints
- Produces high-quality regression cases
- Improves deterministic validators, decoders, retrieval, and model behavior
- Builds a backlog of production-ready YouTube scripts
- Produces credible public proof only after the system is sufficiently reliable

The desired long-term outcome is:

> PrintSense is taught in private on difficult, verifiable electrical prints until Mike is confident enough to turn selected cases into honest public demonstrations.

---

## 3. Non-Goals

This PRD does **not** authorize:

- Automatic public posting
- Automatic YouTube publishing
- Automatic acceptance of Claude’s answer as ground truth
- Training on confidential employer or customer prints
- Downloading or redistributing complete copyrighted drawing packages
- Creating a second grading framework parallel to the existing PrintSense grader
- Creating a second visual-region or annotation schema
- Promoting corrections without Mike’s explicit approval
- Sending multiple Print of the Day emails in a single run
- Reusing a print already sent unless the email is explicitly a revision or rerun
- Letting source descriptions leak into the blind PrintSense attempt

---

## 4. Product Principles

### 4.1 Blind first attempt

PrintSense must analyze only the selected print page and the user-style prompt. It must not receive:

- The source document description
- Patent prose
- Manufacturer explanation
- Prior human notes
- A previous corrected answer
- Claude’s own analysis

This prevents benchmark contamination.

### 4.2 Verification before correction

A correction is not accepted merely because Claude or Mike believes it is right. The system should locate independent evidence when possible:

- Adjacent pages
- Legends and title blocks
- Manufacturer manuals
- Component datasheets
- Patent descriptions
- Standards documentation
- Other primary technical sources

### 4.3 Human approval controls learning

Mike is the final promotion authority. Claude may propose:

- A gold answer
- A validator
- A decoder rule
- A retrieval artifact
- A test
- A model-training example
- A public video candidate

Claude must not approve its own proposal.

### 4.4 One email, one print, one case

Each daily message must represent exactly one primary print page and one case ID. This preserves clarity, avoids duplicate mail, and allows a clean correction history.

### 4.5 Honest uncertainty

The correct result may be:

- The page is unreadable
- The page is incomplete
- The circuit cannot be fully understood without another sheet
- The intended machine behavior cannot be verified
- The print is unsuitable as a gold case

Those are valid outcomes and should improve PrintSense’s abstention behavior.

### 4.6 Reuse the existing PrintSense core

Do not build a separate learning platform. Reuse or extend the existing architecture:

- Eval runner: `tools/internet_print_test/runner.py`
- Deterministic grader: `printsense/grade_case.py`
- Judge: `tools/internet_print_test/judge.py`
- Visual-region contract: `factorylm.visual-region.v1`
- Evidence substrate: `materialized_evidence/`
- Recall and CAS: `printsense/recall.py`, `printsense/cas.py`
- Gold/rule promotion path: `ai_suggestions/relationship_proposals`
- Existing PrintSense interpreter and package-analysis paths
- Existing email delivery utilities, if present

Claude Code must inspect current `origin/main` before implementation and reconcile this PRD with live repository truth.

---

## 5. Target User

### Primary user

Mike, acting as:

- Electrical-print learner
- Technician reviewer
- Product owner
- Final correction authority
- Future presenter

### Secondary future users

- Internal PrintSense reviewers
- Electrical instructors
- Controls engineers
- Trusted domain experts
- Public viewers after selected cases are approved for release

---

## 6. End-to-End User Experience

### Daily private routine

1. The scheduled job begins.
2. The rights-aware selector finds candidate documents.
3. The selector extracts or renders one candidate page.
4. Candidate quality and rights checks run.
5. A controlled-randomness score ranks the candidate.
6. The selected page is registered and content-addressed.
7. PrintSense receives the page with a standard blind prompt.
8. The raw response is preserved unchanged.
9. The deterministic grader and independent judge evaluate the response.
10. Claude researches the source and builds a provisional verified interpretation.
11. Claude creates a claim ledger and improvement proposals.
12. Claude writes a complete YouTube-style script.
13. The system sends one email to the configured recipient with the one-page print attached.
14. The case enters `AWAITING_HUMAN_REVIEW`.
15. Mike reviews the print and replies or submits corrections.
16. Claude prepares a revision and, where needed, a code-change proposal.
17. Mike approves, rejects, or requests more research.
18. Approved cases may be promoted into the appropriate gold, rule, retrieval, or regression-test path.
19. The case may later be marked `PUBLIC_CANDIDATE`, but publication remains manual.

---

## 7. Controlled Randomness and Selection Policy

The system must not simply search for “the strangest electrical schematic.” It must sample from useful difficulty dimensions while protecting relevance and verifiability.

### 7.1 Candidate categories

Maintain a configurable taxonomy including:

#### Drawing conventions

- NFPA / North American
- IEC / European
- German industrial conventions
- British conventions
- Japanese or Asian industrial conventions
- Legacy relay logic
- Mixed or vendor-specific conventions

#### Equipment and process types

- Motor starters
- Contactors and overloads
- PLC I/O
- Safety relays and safety circuits
- VFD control
- Servo systems
- Conveyors and material handling
- Cranes and hoists
- Pumps and process skids
- HVAC controls
- Packaging machinery
- Machine tools
- Utilities and municipal equipment
- Transportation systems
- Marine systems
- Aerospace and government systems
- Laboratory or scientific equipment
- Obsolete or unusual industrial systems

#### Print types

- Power distribution
- Control ladder
- Elementary diagram
- Connection diagram
- Terminal plan
- Interconnect diagram
- Cable schedule
- PLC I/O sheet
- Panel layout with wiring references
- Functional block diagram
- Instrument loop
- Multi-sheet cross-reference challenge

#### Difficulty factors

- Foreign language
- Poor scan
- Rotation or perspective distortion
- Dense cross-references
- Multiple voltage domains
- Unfamiliar device designations
- Legacy drafting
- Handwritten revisions
- Missing neighboring page
- Ambiguous symbol
- Unusual machine function

### 7.2 Selection score

Each candidate receives a score using configurable weights:

```text
selection_score =
    novelty
  + technical_relevance
  + verification_strength
  + visual_legibility
  + rights_confidence
  + category_balance
  + expected_learning_value
  - duplication_penalty
  - confidentiality_risk
  - unusable_scan_penalty
  - answer_leakage_risk
```

The selector should introduce bounded randomness among high-scoring candidates so that the sequence is not predictable or dominated by one category.

### 7.3 Diversity memory

The system must track recent selections and penalize repetition across:

- Source domain
- Manufacturer
- Industry
- Drawing convention
- Equipment family
- Language
- Print type
- Difficulty class

Default diversity window: the previous 30 accepted or emailed cases.

### 7.4 Minimum acceptance thresholds

A candidate must be rejected before analysis if:

- Rights classification is insufficient for attachment and review use
- The source is confidential, leaked, credential-gated, or clearly proprietary without permission
- The page contains personal data or customer-identifying information
- The image is too poor to support meaningful review
- No credible verification path exists
- It duplicates a previous case
- It is not materially related to electrical or industrial control systems
- The source explanation would be impossible to isolate from the blind run

---

## 8. Rights-Aware Source Policy

### 8.1 Preferred source classes

Prioritize:

1. Public-domain government documents
2. Patent drawings
3. Permissively licensed educational or technical documents
4. Manufacturer documents that allow public access and limited educational use
5. University or public research repositories
6. Historical technical archives with clear usage rights
7. User-owned or explicitly authorized prints

### 8.2 Rights metadata

Every candidate must record:

- Source URL
- Source organization
- Document title
- Publication date, if known
- Page number
- Rights class
- License or legal basis
- Attachment allowed: yes/no
- Public-video reuse allowed: yes/no/uncertain
- Attribution requirement
- Full-package redistribution allowed: yes/no
- Rights-review notes

### 8.3 Attachment rule

Because Mike requires the actual print page attached to the email:

- Only candidates classified as attachment-safe may be selected.
- Attach only the single relevant page or image.
- Do not attach the complete source document.
- Preserve source attribution in the email and case record.
- If a page cannot legally or confidently be attached, reject the candidate and choose another.

### 8.4 Public release is a separate decision

An email-safe case is not automatically video-safe. Public use requires a separate `PUBLIC_RIGHTS_APPROVED` decision.

---

## 9. Blind Prompt Suite

Each case should run a stable core prompt plus category-specific follow-ups.

### 9.1 Core prompt

> Explain this electrical print as if you are helping an industrial maintenance technician understand it. Identify the likely function, power sources, control path, major devices, outputs, interlocks, terminals, cross-references, and anything that cannot be confirmed from this page alone. Separate direct visual evidence from inference. Do not invent hidden connections or machine state.

### 9.2 Required follow-up questions

1. What type of drawing is this?
2. What appears to be the main function of this circuit?
3. Trace the most important current or signal path.
4. Identify every major component and designation you can read.
5. What conditions could prevent the commanded output from energizing?
6. Which claims are directly visible versus inferred?
7. What other page, legend, manual, or measurement would be needed?
8. What parts of the image are unreadable or ambiguous?
9. Are there safety-critical elements requiring special caution?
10. What technician questions should be asked next?

### 9.3 Visual-region prompts

Where supported, require PrintSense to return or propose regions using the existing `factorylm.visual-region.v1` contract for:

- Power entry
- Main control path
- Coil or final output
- Safety/interlock chain
- Cross-reference
- Ambiguous area
- Unreadable text

Do not create a new annotation format.

---

## 10. Claim Ledger and Grading

Every important PrintSense statement must be converted into a structured claim.

### 10.1 Claim statuses

- `CONFIRMED`
- `INCORRECT`
- `UNSUPPORTED`
- `PARTIALLY_CORRECT`
- `UNRESOLVED`
- `UNREADABLE`
- `NOT_APPLICABLE`

### 10.2 Claim fields

```yaml
claim_id:
case_id:
raw_claim:
normalized_claim:
claim_type:
region_refs:
status:
confidence:
evidence_refs:
correction:
failure_class:
safety_impact:
generalizable:
recommended_action:
reviewer:
reviewed_at:
```

### 10.3 Failure classes

At minimum:

- OCR/designation error
- Symbol misclassification
- Coil/contact confusion
- Terminal interpretation error
- Cross-reference failure
- Wrong voltage-domain inference
- State inferred from static symbol
- Unsupported machine-function inference
- Missing uncertainty
- Missed safety element
- Convention/profile mismatch
- Incomplete current-path trace
- Hallucinated connection
- Wrong component family
- Illegible image not acknowledged
- Source-grounding failure

### 10.4 Existing grader integration

Extend `printsense/grade_case.py` only where required. The final case report should preserve the existing two-axis concept:

- **Technical correctness**
- **Epistemic discipline / evidence honesty**

Safety-critical unsupported claims must remain hard-gate failures.

---

## 11. Verification Workflow

### 11.1 Evidence hierarchy

Use the strongest available evidence in this order:

1. Same document’s legend, title block, notes, and adjacent pages
2. Manufacturer primary documentation
3. Component datasheet
4. Patent or government prose describing the figure
5. Applicable technical standard
6. Credible educational or engineering reference
7. Expert human review

### 11.2 Independence requirement

The judge must record an evidence independence class. An answer is not independently verified if the “verification” merely repeats text generated by the same model or copied from the same contaminated prompt context.

### 11.3 Unresolved case behavior

If the circuit cannot be reliably verified:

- Do not fabricate a gold answer.
- Mark the case `RESEARCH_BLOCKED` or `INSUFFICIENT_EVIDENCE`.
- Still email the case if it has strong learning value, but clearly label uncertainties.
- Do not promote it into gold data.

---

## 12. Email Product Specification

### 12.1 Delivery frequency

Default: one Print of the Day email per day.

Required operational safeguards:

- Never send more than one new case per scheduled run.
- Never send the same case twice.
- Revisions must use the same case ID and email thread when supported.
- Provide a manual dry-run mode.
- Provide a manual `send-one` command.
- Provide a global email enable/disable flag.
- No public posting side effects.

### 12.2 Configuration

Use environment or secret configuration:

```text
PRINT_OF_DAY_ENABLED=0|1
PRINT_OF_DAY_RECIPIENT=<configured email>
PRINT_OF_DAY_SENDER=<configured sender>
PRINT_OF_DAY_SCHEDULE=<cron or scheduler config>
PRINT_OF_DAY_MAX_PER_RUN=1
PRINT_OF_DAY_REQUIRE_RIGHTS_APPROVAL=1
PRINT_OF_DAY_PUBLICATION_ENABLED=0
```

Do not hard-code Mike’s email address.

### 12.3 Subject format

```text
Print of the Day #<sequence> — <short equipment or circuit description> — Review Required
```

Example:

```text
Print of the Day #017 — Legacy Hoist Contactor Interlock — Review Required
```

### 12.4 Required attachment

Attach exactly one primary review artifact:

- Preferred: one-page PDF
- Acceptable: high-resolution PNG
- Filename:

```text
print_of_the_day_<case_id>_page_<page_number>.pdf
```

Optional secondary machine-readable attachments may be added later, but the first release should keep the email simple.

### 12.5 Required email sections

#### A. Today’s challenge

- Case ID
- Equipment/industry
- Drawing convention
- Why it was selected
- Difficulty factors

#### B. Source and rights

- Source name
- Page
- Attribution
- Rights class
- Link
- Public-video rights status

#### C. What to inspect before reading the answer

Three to five viewer questions that Mike should consider before reviewing PrintSense.

#### D. Blind PrintSense response

The complete original response, unedited.

#### E. Grading summary

- Technical correctness score
- Evidence-honesty score
- Hard-gate result
- Confirmed claim count
- Incorrect claim count
- Unsupported claim count
- Unresolved claim count
- Safety concerns

#### F. Claim-by-claim review

A compact table or structured list showing:

- Claim
- Status
- Evidence
- Correction
- Failure class

#### G. Proposed corrected explanation

Claude’s best evidence-backed interpretation, clearly distinguishing confirmed facts from unresolved questions.

#### H. Full YouTube script

The exact proposed sequence of what Mike should show and say.

#### I. What this case should teach

- Electrical lesson
- Troubleshooting lesson
- Drawing-convention lesson
- AI-use lesson

#### J. Recommended PrintSense improvements

Separate proposals into:

- Prompt change
- OCR/preprocessing
- Drawing-profile decoder
- Deterministic validator
- Retrieval/evidence
- Visual-region behavior
- Regression test
- Gold example
- Model or fine-tuning candidate
- No change required

#### K. Mike’s review actions

Provide an explicit checklist:

```text
[ ] Print and source are acceptable
[ ] Corrected explanation is accurate
[ ] Claims marked incorrect are truly incorrect
[ ] Proposed code/rule changes are appropriate
[ ] Suitable for gold promotion
[ ] Suitable for a future video
[ ] Needs another expert or source
```

#### L. Reply instructions

Use a simple correction format:

```text
APPROVE CASE
or
CORRECTIONS:
- Claim <id>: ...
- Script section <n>: ...
- Additional evidence: ...
- Code change requested: ...
- Public candidate: YES/NO
```

---

## 13. YouTube Script Specification

The script must be written as a complete production script, not an outline.

### 13.1 Script sections

1. **Cold open**
   - Show the print
   - State the practical mystery
   - Do not reveal the answer

2. **Viewer challenge**
   - Ask viewers what they notice
   - Give them a short pause point

3. **Print context**
   - Explain only what is known from the title block/source
   - Avoid contaminating the blind test

4. **PrintSense upload**
   - Exact instruction to show the phone or application
   - Exact prompt Mike enters

5. **Blind response**
   - Which sections of the response to display
   - Which visual regions to highlight

6. **What PrintSense got right**
   - Trace each confirmed claim on the print

7. **What PrintSense got wrong or could not prove**
   - State the failure honestly
   - Explain why it matters

8. **Corrected electrical lesson**
   - Mike’s evidence-backed explanation
   - Current path, signal path, interlocks, components, references

9. **Technician troubleshooting lesson**
   - Measurements or checks a technician would perform
   - Safety caveats
   - No unsafe energized-work instructions

10. **What Mike learned**
    - New convention, device, or circuit insight

11. **What PrintSense learned**
    - Concrete validator, rule, evidence, or test improvement

12. **Rerun result**
    - Include only after an approved improvement exists
    - Compare before and after without hiding remaining failures

13. **Closing**
    - Invite viewers to submit rights-safe prints
    - Explain PrintSense’s purpose
    - Avoid exaggerated claims

### 13.2 Stage directions

Use explicit production cues:

```text
[SHOW: full print page]
[ZOOM: terminal strip X12]
[HIGHLIGHT: overload contact]
[ON SCREEN: blind PrintSense response]
[PAUSE FOR VIEWER]
[SHOW: corrected current path]
[DISPLAY: source citation]
```

### 13.3 Honesty requirements

The script must not:

- Claim PrintSense “understands any print”
- Hide a failed answer
- Present inference as confirmed evidence
- Imply the system learned permanently before promotion occurred
- Show confidential content
- Give unsafe electrical instructions
- Claim a correction is final when evidence is incomplete

---

## 14. Human Feedback and Revision Loop

### 14.1 Case states

```text
DISCOVERED
RIGHTS_CHECKED
SELECTED
BLIND_RUN_COMPLETE
GRADED
SCRIPTED
EMAILED
AWAITING_HUMAN_REVIEW
CORRECTIONS_RECEIVED
REVISION_PROPOSED
CODE_CHANGE_PROPOSED
APPROVED_FOR_GOLD
APPROVED_FOR_RULE
APPROVED_FOR_TEST
APPROVED_FOR_PUBLIC_CANDIDATE
REJECTED
RESEARCH_BLOCKED
ARCHIVED
```

### 14.2 Corrections

All Mike corrections must be stored as immutable review events, not destructive edits.

```yaml
review_event_id:
case_id:
reviewer:
received_at:
source: email|cli|ui|file
corrections:
approval_flags:
notes:
```

### 14.3 Revision email

When corrections are processed, send a revision in the same email thread where possible:

```text
Print of the Day #017 — Revision 2 — Legacy Hoist Contactor Interlock
```

The revision email must show:

- What changed
- Why it changed
- Which claims remain unresolved
- Proposed code changes
- Updated script sections
- Whether a rerun passed

### 14.4 Promotion gate

No artifact is promoted until Mike explicitly approves the relevant action.

Approval categories are separate:

- Gold answer approval
- Rule/validator approval
- Regression-test approval
- Retrieval evidence approval
- Model-training approval
- Public-video approval

---

## 15. Learning and Improvement Outputs

A reviewed case may generate one or more of the following.

### 15.1 Gold case

A human-approved expected answer and claim ledger.

### 15.2 Deterministic validator

Examples:

- Do not treat a normally open symbol as current machine state.
- Require adjacent-page evidence before asserting a cross-reference destination.
- Require an uncertainty warning when a terminal continuation is cropped.
- Prevent numeric IEC conventions from becoming standalone equipment entities.

### 15.3 Drawing-profile decoder improvement

Examples:

- German/European designation patterns
- Legacy relay annotations
- Japanese terminal conventions
- Vendor-specific safety-relay symbols

### 15.4 Retrieval evidence

A verified manufacturer document, standard excerpt, legend, or component datasheet stored with provenance.

### 15.5 Visual-region fixture

Approved coordinates for critical components or ambiguous areas using `factorylm.visual-region.v1`.

### 15.6 Regression test

The original failure must remain reproducible.

### 15.7 Model-training candidate

Only if:

- Rights allow it
- The corrected answer is approved
- The example adds generalizable value
- It is not reserved for private holdout evaluation

### 15.8 Abstention case

Cases where the correct behavior is to say:

- Image unreadable
- Missing page
- Cannot confirm machine state
- Cannot identify component confidently

These are essential training examples.

---

## 16. Public and Private Corpus Separation

### 16.1 Development corpus

Cases used for:

- Email review
- Corrections
- Rule development
- Regression testing
- YouTube scripts

### 16.2 Private holdout corpus

A separate set must remain unseen by:

- Prompt tuning
- Rule development
- Training
- Public scripts

Its purpose is to measure true generalization.

### 16.3 Public candidate corpus

Cases explicitly approved for future content. Required fields:

- Rights approved
- Technical interpretation approved
- Script approved
- Safety reviewed
- Source attribution prepared
- Known remaining limitations disclosed

---

## 17. Data Model

Recommended top-level case manifest:

```yaml
schema_version: factorylm.print-of-day.v1
case_id:
sequence_number:
status:
created_at:
updated_at:

source:
  url:
  organization:
  document_title:
  publication_date:
  page_number:
  rights_class:
  license:
  attachment_allowed:
  public_reuse_status:
  attribution:
  source_hash:

selection:
  seed:
  category:
  drawing_convention:
  equipment_type:
  print_type:
  language:
  difficulty_factors:
  novelty_score:
  verification_score:
  rights_score:
  final_score:
  selection_reason:

artifacts:
  original_document_ref:
  page_image_ref:
  attachment_ref:
  blind_response_ref:
  grade_report_ref:
  claim_ledger_ref:
  verification_evidence_refs:
  corrected_explanation_ref:
  script_ref:
  email_ref:
  review_event_refs:
  rerun_refs:

promotion:
  gold_status:
  rule_status:
  test_status:
  evidence_status:
  model_training_status:
  public_candidate_status:
```

All binary and large artifacts should use the existing CAS/evidence substrate rather than being duplicated in arbitrary folders.

---

## 18. Proposed Repository Shape

Claude must first inspect the repository and adapt names to existing conventions. A likely additive shape is:

```text
printsense/print_of_day/
  __init__.py
  selector.py
  rights.py
  candidate.py
  workflow.py
  claims.py
  script.py
  email_package.py
  review.py
  promotion.py
  models.py

tools/print_of_day/
  run.py
  send_one.py
  ingest_review.py
  rerun_case.py
  export_case.py

tests/print_of_day/
  test_selector.py
  test_rights.py
  test_blindness.py
  test_duplicate_prevention.py
  test_claim_ledger.py
  test_email_package.py
  test_review_events.py
  test_promotion_gate.py
  test_holdout_separation.py
```

Do not use this exact structure if the current repository already has a more appropriate workflow package.

---

## 19. Scheduler and Operational Behavior

### 19.1 Initial release

Support:

- Manual dry run
- Manual candidate selection preview
- Manual send-one
- Daily scheduled run
- Retry-safe execution
- Idempotent case creation
- Duplicate-email prevention
- Structured logs
- Failure report without sending a partial email

### 19.2 Recommended daily sequence

```text
discover
→ rights check
→ deduplicate
→ score and select
→ extract one page
→ blind PrintSense run
→ grade
→ verify
→ script
→ package email
→ final pre-send validation
→ send once
→ mark EMAILED
```

### 19.3 Send gate

The email must not send if:

- Attachment missing
- Rights metadata incomplete
- Case duplicate detected
- Blind response missing
- Source URL missing
- Email recipient missing
- Script generation failed
- The selected page differs from the graded page
- A prior email record already exists for the case
- More than one primary attachment is queued

---

## 20. Security and Privacy

- Never search private employer systems for candidate prints.
- Never use connected drives or mailboxes as a print source unless Mike explicitly authorizes a specific document.
- Strip credentials, query tokens, and private metadata from saved source URLs.
- Malware-scan downloaded files where existing infrastructure supports it.
- Enforce file-size and page-count limits.
- Do not execute embedded scripts or attachments.
- Store email credentials only in the existing secrets system.
- Log recipient identifiers minimally.
- Avoid storing unnecessary personal data from email replies.

---

## 21. Safety Requirements

The generated explanation and script must:

- Treat electrical safety as a hard gate
- Avoid instructions for unsafe energized work
- Avoid implying that AI output authorizes work
- Separate diagnostic reasoning from physical execution
- Recommend qualified-person procedures where appropriate
- Identify missing voltage, grounding, or system-context information
- Flag safety circuits, interlocks, emergency stops, and protective devices
- Never suggest bypassing a safety device as a troubleshooting shortcut

---

## 22. Metrics

Track:

### Selection quality

- Candidate rejection rate
- Rights rejection rate
- Duplicate rate
- Category distribution
- Source diversity
- Verification success rate

### PrintSense quality

- Technical correctness
- Evidence-honesty score
- Hard-gate pass rate
- Unsupported-claim rate
- OCR/designation accuracy
- Cross-reference accuracy
- Safety-element recall
- Abstention quality

### Learning value

- Cases corrected by Mike
- New electrical concepts documented
- New failure classes discovered
- New validators added
- New profiles/decoders added
- Regression tests added
- Gold cases approved
- Rerun improvement

### Content readiness

- Scripts approved
- Public-rights approvals
- Cases marked public candidate
- Cases with acceptable small failures
- Cases rejected from public use

---

## 23. Acceptance Criteria

### Core workflow

- [ ] System selects one attachment-safe electrical print page.
- [ ] Selection uses controlled randomness and recent-history diversity.
- [ ] PrintSense blind run cannot access verification material.
- [ ] Original PrintSense response is preserved immutably.
- [ ] Existing grader and judge produce a case report.
- [ ] Claim ledger is generated.
- [ ] Verification evidence is stored with provenance.
- [ ] Full YouTube script is generated.
- [ ] One email is sent with exactly one primary print attachment.
- [ ] Case transitions to `AWAITING_HUMAN_REVIEW`.
- [ ] Duplicate runs do not send duplicate emails.

### Review and learning

- [ ] Mike’s corrections can be attached to the existing case.
- [ ] Corrections create immutable review events.
- [ ] Revision packages can be generated.
- [ ] Promotion requires explicit human approval.
- [ ] Approved failures can become regression tests.
- [ ] Approved evidence can enter the existing evidence substrate.
- [ ] Public-candidate approval remains separate from gold approval.

### Safety and rights

- [ ] Confidential or rights-uncertain pages cannot be attached.
- [ ] Full proprietary drawing packages are not redistributed.
- [ ] Safety-critical unsupported claims fail the hard gate.
- [ ] Public publication remains disabled by default.

---

## 24. Test Plan

### Unit tests

- Candidate scoring
- Diversity penalties
- Rights classification
- One-page extraction
- Hash-based duplicate detection
- Blind-context isolation
- Claim normalization
- Email section completeness
- Attachment count enforcement
- Case-state transitions
- Approval gate
- Holdout separation

### Integration tests

- Public document discovery to case creation
- Page extraction to PrintSense analysis
- PrintSense response to grade report
- Grade report to script package
- Email package to test mailbox
- Reply/correction ingestion to revision
- Approved case to regression-test proposal
- CAS and evidence provenance round-trip

### Failure tests

- Source disappears
- PDF corrupt
- Attachment extraction fails
- Email provider unavailable
- Verification insufficient
- Candidate duplicates prior case
- Rights become uncertain
- PrintSense times out
- Judge disagreement
- Revision arrives for unknown case
- Scheduler retries after send

### Golden test

Create one fixed, rights-safe print case with known:

- Source
- Page hash
- Blind prompt
- Expected claim ledger
- Expected attachment filename
- Expected email sections
- Expected state transitions
- Duplicate-send prevention behavior

---

## 25. Phased Delivery Plan

### Phase 0 — Repository reconnaissance and design reconciliation

Claude Code must:

- Read current `origin/main`
- Identify existing email adapters
- Identify scheduler conventions
- Confirm the current eval runner, grader, judge, visual-region, CAS, recall, and promotion APIs
- Produce a reuse map
- Identify packaging and deployment implications
- Identify secrets required
- Stop for design approval before implementation if repository truth materially conflicts with this PRD

### Phase 1 — Manual Print of the Day package

Build:

- Rights-aware case manifest
- Manual candidate input
- One-page attachment generation
- Blind PrintSense run
- Grade report
- Claim ledger
- Script generator
- Email preview
- Dry-run artifact bundle

No scheduled email yet.

### Phase 2 — Send-one email

Build:

- Email adapter integration
- Recipient configuration
- Exactly-one attachment rule
- Idempotent send record
- Manual send-one command
- Test mailbox integration

### Phase 3 — Controlled-random selector

Build:

- Candidate discovery adapters
- Rights classifier
- Diversity memory
- Scoring
- Deduplication
- Verification-path checks

### Phase 4 — Daily scheduler

Build:

- Daily job
- Global enable flag
- Retry behavior
- Failure notifications
- No-duplicate guarantees

### Phase 5 — Human correction loop

Build:

- Review-event ingestion
- Revision generation
- Same-thread response where supported
- Promotion proposals
- Explicit approval gate

### Phase 6 — Learning integration

Build:

- Gold-case proposal
- Validator proposal
- Decoder/profile proposal
- Retrieval-evidence proposal
- Regression-test generation
- Rerun comparison

### Phase 7 — Public-candidate workflow

Only after Mike requests it:

- Public-rights review
- Final script approval
- Source overlays
- Video asset export
- Remaining-failure disclosure

No automatic publishing.

---

## 26. First Release Definition

The first useful release is not the fully autonomous daily system.

It is complete when Claude Code can run one command against a rights-safe source and produce:

```text
case manifest
+ one-page print attachment
+ blind PrintSense response
+ grade report
+ claim ledger
+ corrected explanation
+ full YouTube script
+ email preview
```

Mike must be able to inspect that bundle before the email-send step is enabled.

---

## 27. Example Command Surface

Names may change to match repository conventions.

```bash
# Preview candidate and rights information
python -m tools.print_of_day.run discover --dry-run

# Build a full review package without sending
python -m tools.print_of_day.run build \
  --source-url "<url>" \
  --page 7 \
  --dry-run

# Send exactly one approved package
python -m tools.print_of_day.send_one --case-id POTD-00017

# Ingest Mike's correction file
python -m tools.print_of_day.ingest_review \
  --case-id POTD-00017 \
  --review-file reviews/POTD-00017-mike.md

# Rerun after an approved improvement
python -m tools.print_of_day.rerun_case --case-id POTD-00017

# Export a future public-video bundle
python -m tools.print_of_day.export_case \
  --case-id POTD-00017 \
  --public-candidate
```

---

## 28. Definition of Done

Print of the Day is done when it operates as a trustworthy private learning flywheel:

- The selected print is unfamiliar, relevant, legal to attach, and independently verifiable.
- PrintSense is tested blind.
- Errors are visible rather than hidden.
- Mike receives a complete review package by email.
- Mike can correct both the electrical interpretation and the proposed software changes.
- No correction becomes system truth without approval.
- Every approved lesson can become durable evidence, a regression case, a validator, or a decoder improvement.
- A growing library of approved YouTube scripts accumulates without forcing Mike to record before he is ready.
- Public release remains a deliberate later step.

---

## 29. Product Statement

> **Print of the Day privately teaches Mike and PrintSense together. Every day, one unfamiliar electrical print is selected, analyzed, verified, corrected, converted into a complete video script, and emailed for human review. The system learns only from approved corrections, while the best cases gradually become honest public demonstrations and customer-attracting educational content.**
