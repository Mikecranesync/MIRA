# MIRA Visual Technician — Product Requirements Document

> **Provenance:** transcribed 2026-07-11 from the uploaded PDF `MIRA_Visual_Technician_PRD.pdf`
> (FactoryLM / MIRA, Version 1.0, July 11 2026). This markdown is the in-repo record of that PRD.
> The architecture response to it is **ADR-0027** (`docs/adr/0027-mira-visual-technician-architecture.md`).

**Owner:** FactoryLM / MIRA · **Audience:** Claude Code implementation lead and supporting agents
**Status:** Implementation-ready product definition; readiness estimates remain to be benchmarked.

**Primary product promise:** Take a picture of the print or the machine, ask what you are looking at,
and MIRA explains it using visible evidence, manufacturer documentation, and the machine's verified
history.

**Implementation directive:** preserve evidence, expose uncertainty, never invent field facts, and
keep the resulting machine artifact useful without an LLM.

**North-star distinction:** the visual interpreter is the technician-facing interaction layer; the
Verified Machine Print Pack and broader Machine Pack are the durable structured artifacts underneath
it. Support both; do not collapse them into one undifferentiated feature.

---

## 1. Executive summary

A multimodal industrial-maintenance product that accepts photographs or image snippets of wiring
diagrams, panels, drives, PLCs, terminal strips, nameplates, operator displays, and components. It
identifies what is visibly present, links the observation to manufacturer documentation and verified
machine context, answers follow-up questions, and records unresolved facts for field verification.

Three tightly connected capabilities:
1. **Print-image interpretation** — understand a cropped PDF/screenshot/photo of a wiring diagram and
   answer questions about the visible circuit.
2. **Real-equipment interpretation** — understand a field photo of installed equipment/panel using
   visible labels, manuals, drive packs, and machine context.
3. **Photo-to-print reconstruction** — accumulate photos, print fragments, manuals, PLC exports, and
   technician observations into a structured, evidence-graded electrical documentation package.

The system must be **useful before it is authoritative**: it may explain likely behavior and
recommend the next useful photo, but must not claim a conductor destination, voltage, terminal
assignment, safety state, or installed configuration is *verified* unless the evidence supports it and
the appropriate approval state is present.

## 2. Problem and opportunity

Technicians rarely have clean, complete, current documentation — folded prints, partial PDFs,
screenshots, faded wire numbers, modified panels, unmarked replacement parts. OCR recovers text but
does not reconstruct electrical meaning, maintain provenance, or support an evolving conversation.
**Opportunity:** combine multimodal reasoning with deterministic industrial schemas, manufacturer
evidence, machine-specific context, validation rules, and human approval — more useful than OCR chat,
safer than an unconstrained vision model.

## 3. Product boundary

Umbrella name **MIRA Visual Technician**; working surfaces may include **MIRA Field Lens** (capture)
and **MIRA Print Studio** (structured reconstruction/review).

| Capability | Typical inputs | Primary output |
|---|---|---|
| Print-image interpretation | PDF crop, screenshot, paper-print photo, one sheet | Plain-English circuit explanation, visible entities+connections, uncertainty, citations, next requested context |
| Real-equipment interpretation | VFD, PLC rack, panel, terminal strip, nameplate, HMI fault, damaged component | Component identity, visible labels, manual match, machine-context match, grounded answers, next inspection step |
| Photo-to-print reconstruction | Multiple panel photos, print fragments, manuals, PLC exports, field notes | Versioned Verified Machine Print Pack: drawings, connection data, evidence report, unresolved register, approval record |

**Non-goal:** not an unrestricted "AI electrician." No unsupported hazardous-energy instructions, no
panel certification, no LOTO replacement, no treating a photo as proof of de-energization.

## 4. Users and jobs to be done

| User | Primary job | Success condition |
|---|---|---|
| Maintenance technician | Understand a print fragment or field component at the machine | Fast, useful explanation with visible evidence, uncertainty, and a practical next photo/check |
| Controls technician / engineer | Trace a circuit, compare installed panel vs docs, update machine context | Inspect/correct/approve extracted entities+connections; publish a new revision |
| Reliability / maintenance leader | Recover missing documentation, preserve knowledge | Complete, searchable, evidence-controlled package surviving turnover |
| System integrator / panel shop | Create or reconcile customer documentation | Structured draft + deterministic validation + field-verification worksheet |
| Thin-client / external agent | Query visual evidence and machine context via stable contracts | Structured results with citations, confidence, approval state — not free-form prose only |

## 5. Functional requirements

- **FR-1 Persistent visual evidence sessions** — session continuity across multiple images/docs/
  questions; source preservation (original + corrected derivative + capture metadata + content hash);
  incremental interpretation (confirm/contradict/refine without deleting history); machine
  association (tenant/site/line/machine/asset or unassigned); revision awareness (working observation
  vs published revision).
- **FR-2 Input classification and routing** — classify each input (print/panel/component/nameplate/
  terminal-strip/PLC/drive/HMI-fault/area/mixed/unknown); allow multiple classifications; route to
  deterministic + model tools by evidence type/quality/text/known context; return explicit `unknown`
  rather than a forced confident route.
- **FR-3 Image preparation** — correct rotation/perspective/crop/contrast/glare where possible;
  preserve original + record every transformation; score image quality and request a better photo
  when critical text/terminals are unreadable; support user + system regions of interest.
- **FR-4 Print understanding** — extract text, tags, terminal ids, wire numbers, sheet references,
  symbols, connection geometry; create candidate **nodes and edges** (not just an OCR transcript);
  identify contacts/coils/protective devices/power+control paths/connectors/buses/off-page refs where
  evidence allows; explain the circuit in plain English separating observation from inference; state
  which questions the crop cannot answer.
- **FR-5 Real-equipment understanding** — detect visible manufacturer/model/rating/terminal+wire
  labels/device tag/condition; match against Drive Commander packs, manuals, approved asset records,
  machine-pack components; compare field photo vs expected print/BOM and surface mismatches; allow
  confirm/correct; treat "looks like" vs "verified installed model" as different states.
- **FR-6 Grounded conversational Q&A** — answer against visible observations, cited manuals,
  structured drive packs, wiring connections, approved machine context; show the evidence class behind
  each important claim; carry session context; ask for the single most useful next evidence when
  blocked; never silently convert a likely interpretation into a verified fact.
- **FR-7 Photo-to-print reconstruction** — accumulate candidate devices/terminals/conductors/
  relationships; support review+correction before publishing; generate/update a versioned print
  package without erasing prior revisions; export searchable PDF, structured JSON/YAML, connection
  data, evidence report, unresolved-items register, field-verification worksheet, revision/approval
  record; keep the exported bundle usable without MIRA.
- **FR-8 Mismatch and contradiction handling** — record contradictions between print/photo/manual/PLC
  export/technician statement; do not auto-resolve on model confidence; let a reviewer designate the
  accepted current state while retaining rejected/superseded evidence; surface high-risk mismatches
  (terminals, voltages, protective devices, motor/VFD identity).

## 6. Evidence, uncertainty, and safety model

Every extracted fact and answer claim carries a status. Minimum vocabulary:

| Status | Meaning | Allowed use |
|---|---|---|
| `VISIBLE` | Directly readable/visually supported in the image | State as visible; does not prove installed function beyond the frame |
| `DOCUMENTED` | Supported by a cited manufacturer/approved source | Describe documented function, not necessarily the installed configuration |
| `MACHINE_VERIFIED` | Approved in the current machine pack or confirmed by authorized field review | Machine-specific fact within revision scope |
| `LIKELY` | Reasonable interpretation on partial evidence | Label as inference; must not auto-become a verified edge |
| `NEEDS_CONTEXT` | Required sheet/destination/label/identity absent | State what is missing; request the best next evidence |
| `CONFLICTING` | ≥2 sources disagree | Surface for review; no silent resolution |
| `FIELD_VERIFICATION_REQUIRED` | Coherent enough to review, not field-approved | Draft packages / "approvable with field verification" |
| `REJECTED / SUPERSEDED` | Reviewed and found incorrect/outdated | Retained for audit, excluded from current answers by default |

**Required answer pattern (consequential questions):** (1) what is visible, (2) what documentation
says, (3) what the machine pack verifies, (4) what is inferred, (5) what cannot be determined, (6) the
next safest evidence-gathering step.

**Hard safety constraints:** never claim de-energized/safe-to-touch/safe-to-operate from an image;
never invent conductor destinations, terminal assignments, voltages, ratings, or protective
functions; do not instruct bypassing guards/interlocks/protective devices/LOTO; for hazardous work,
provide documentation-grounded info and require site procedures + qualified personnel + field
verification; preserve **"APPROVABLE WITH FIELD VERIFICATION"** as distinct from approved/commissioned/
as-built/field-verified.

## 7. Product architecture

Treat visual interpretation as an orchestrated evidence pipeline, not a single model call: capture →
classifier + quality gate → (image correction / region selection · OCR/symbol/object/geometry
extractors · equipment identity resolver → manuals/drive-packs/asset-records · print-graph candidate
builder) → evidence ledger + contradiction detector → grounded answer composer · reviewer/
field-verification workflow → versioned Verified Print Pack / Machine Pack publisher.

Required components: visual session service, classifier/router, observation ledger, document+pack
retrieval, candidate graph builder, contradiction engine, answer composer, review+approval workflow,
pack publisher. **Tool-selection principle:** deterministic extraction/validation wherever possible;
models for classification/interpretation/ambiguity/explanation; a model may *propose* a candidate
edge, but deterministic validators + human review decide whether it enters the verified artifact.
**Tenancy:** all machine-specific retrieval tenant-scoped; anonymous/unassigned sessions never
retrieve another customer's uploads/context; record exactly which chunks/pack entries/machine facts
supported an answer; thin clients get the same evidence model (no weaker uncited path).

## 8. Core data contracts

Conceptual minimums — reconcile with existing repository schemas rather than creating parallel
representations: `VisualSession`, `EvidenceItem`, `RegionOfInterest`, `Observation`,
`EntityCandidate`, `ConnectionCandidate`, `AnswerClaim`, `VerificationTask`, `PackRevision`.
(Field-level minimums in the source PDF; the canonical mapping to existing schemas is ADR-0027.)

Illustrative structured answer envelope:
```json
{
  "answer": "The visible contact appears to energize relay coil CR3...",
  "claims": [
    {"text": "contact is normally open", "status": "VISIBLE", "evidence_ids": ["ev-12"]},
    {"text": "coil is CR3", "status": "VISIBLE", "evidence_ids": ["ev-13"]},
    {"text": "CR3 controls the conveyor", "status": "NEEDS_CONTEXT", "reason": "coil destination is off crop"}
  ],
  "next_best_evidence": "Photograph the CR3 cross-reference and the referenced destination sheet.",
  "safety_notes": ["Image evidence does not establish an electrically safe state."]
}
```

## 9. UX and thin-client behavior

Works from Telegram, Slack, kiosk, web, and future agent clients; the surface may be thin but the
evidence session + structured result are shared. Flow: capture (ack detected type + quality limits) →
first explanation (no overclaim) → question (answer from same session, cite evidence) → missing
context (request one specific next photo/sheet/label) → accumulation (join to session; resolve or
contradict) → review (confirm/correct/reject/field-verify) → publish (draft or approved revision +
standalone bundle download). Default response layout mirrors the §6 answer pattern. Keep internal
confidence scores out of the technician's face; expose plain-language certainty + evidence categories,
with detailed provenance in an expandable view.

## 10. Evaluation, benchmarks, and readiness

Current readiness figures are **planning estimates**, not measured metrics — establish a real
benchmark before claiming production readiness. Planning estimates range from ~75–85% (identify a
clear VFD/nameplate; match to a known drive pack) down through ~60–75% (explain a clean print snippet;
bounded Q&A), ~40–55% (arbitrary panel photo), ~30–50% (trace across photos; reconstruct a print), to
**Not ready** (field-authoritative conclusions automatically).

**Required benchmark corpus:** ≥100 preserved **real phone photographs** (not just clean PDFs) —
snippets, full sheets, skewed/glare/handwriting/low-contrast, panel interiors, terminal strips,
drives, PLCs, nameplates, HMI faults, mixed scenes; preserve original + expected visible facts +
acceptable uncertainty + required citations + technician judgment; separate known-machine from
unknown-machine tests; run each hard failure through an independent second judge; retain raw outputs.

**Release gates:** visible-entity identification ≥90% on clearly readable components; label fidelity
≥95%; **zero** invented destinations/cross-sheet relationships in the hard-gate set; **zero**
unsupported safety claims (de-energized/safe, invented voltage/rating); correct uncertainty behavior
(marks insufficient context + requests useful next evidence); citation integrity (claims resolve to
the cited tenant-scoped source); technician usefulness ≥85% of incomplete cases get a useful
next-step; pack determinism (byte/manifest-stable output); standalone validity (bundle validates +
understandable without MIRA).

**Hard-failure examples:** invents a wire destination; misreads a label and presents it as verified;
uses another tenant's manual/context; treats a documented default terminal function as the installed
programmed function; claims safe from a photo; publishes field-verified when only approvable-with-
field-verification; drops conflicting evidence or silently overwrites a prior revision.

## 11. Scope, milestones, and acceptance

- **Phase 0 — Inventory & contract alignment.** Locate/document existing Print Translator, image
  classifier, OCR, drive ID, Drive Commander packs, manual retrieval, wiring schemas,
  `wiring_connections` seam, print renderer, evidence grader, benchmark harness, thin-client adapters.
  Choose one canonical representation (extend existing contracts). Produce an ADR describing how the
  visual session connects to the Machine Pack without coupling the exported bundle to MIRA runtime.
- **Phase 1 — Snippet Interpreter MVP.** One wiring-print image/crop → visible text/entities +
  plain-English explanation + missing context + next-best evidence; follow-up questions in a
  persistent session; claim-level evidence + uncertainty; preserved golden corpus + hard-failure
  tests.
- **Phase 2 — Equipment and panel interpretation.** VFD/nameplate, PLC, terminal strip,
  relay/contactor, HMI fault, panel-photo routes; resolve known models to manual + drive-pack
  evidence; compare vs assigned machine pack + flag mismatches; technician correct/confirm.
- **Phase 3 — Multi-photo visual sessions.** Reconcile entities/terminals across photos; track
  contradictions + view requests; preserve derived-crop→original mappings; expose a review queue.
- **Phase 4 — Photo-to-print draft publishing.** Draft connection graph → Verified Machine Print Pack;
  deterministic validation (evidence gaps, duplicate conductors, broken cross-refs, sheet consistency,
  unsupported claims); export the full bundle; preserve APPROVABLE WITH FIELD VERIFICATION.
- **Phase 5 — Connected Machine Pack & operationalization.** Link verified print entities to PLC
  tags/IO/drive parameters/manuals/work-orders/live telemetry; same session from Telegram/Slack/kiosk/
  web/agents; tenant-isolation tests, observability, cost controls, latency targets, runbooks.

**MVP acceptance:** persistent session (2nd image + follow-up refines an earlier unknown without
losing provenance); evidence-bounded explanation (each consequential claim identifies its support);
known-drive path (clear VFD/nameplate → correct pack + manual-backed fact); print-snippet path (clean
snippet → entities + candidate connections + plain function + explicit off-crop limits); panel
mismatch surfaced as conflicting; no hallucinated edge on an incomplete crop; next-evidence guidance;
export builds a deterministic draft bundle with validation report + field-verification status;
thin-client parity (Telegram + one more, same structured evidence); CI protection (golden cases, hard
failures, tenant isolation, pack validation).

## 12. Claude execution directive

**Do not restart completed work** — treat the CV-101 package, wiring-connection loader, Print
Translator, Drive Commander packs, and machine-pack tooling as existing assets to inventory and reuse;
do not rebuild functioning seams to fit a new abstraction. Agent plan: Opus architecture lead; Sonnet
visual-pipeline / evidence-safety / machine-pack agents; Haiku repository scouts + test/fixture
agents. **Repository/operational discipline:** start from a written plan + inventory; isolated
worktrees + narrow PRs; **PRs only** — no merge/deploy/prod-secrets/Stripe/irreversible prod ops; do
not weaken tenant scoping or create anonymous retrieval paths; do not bypass validators/graders/
deployment gates/approval states; review diffs+tests+CI directly (no success-from-summaries); every PR
body includes before/after evidence, changed files, tests+outputs, risks, dependency order, rollback.

**Required deliverables:** (1) repo inventory + ADR; (2) versioned visual-session + observation
contracts; (3) Snippet Interpreter MVP with grounded follow-up Q&A; (4) known-equipment path using
existing packs+manuals; (5) evidence ledger + contradiction handling + reviewer workflow; (6)
deterministic draft print-pack publisher integration; (7) redacted CV-101 demonstration session; (8)
benchmark corpus manifest + rubric + hard-failure tests + CI guards; (9) thin-client integration proof
(Telegram + one more); (10) operator documentation + rollout risks + rollback + final PR dependency
order.

## Product north star

A technician can photograph either the documentation or the machine, ask a useful question, and
receive an answer that distinguishes visible evidence, manufacturer documentation, verified machine
context, and inference. As the technician adds evidence, MIRA does not merely continue a chat — it
builds a reviewable, versioned source of truth for that machine. **Definition of done:**
simultaneously helpful in the field, honest about uncertainty, grounded in cited evidence, safe around
industrial work, deterministic when publishing artifacts, and useful to both humans and other agents.
