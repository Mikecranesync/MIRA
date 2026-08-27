# PRD — Commodity-First Mobile Architecture & Evidence Attachment Convergence

**Product:** FactoryLM / MIRA Mobile
**Status:** Proposed (authored by Mike, 2026-08-26; filed verbatim)
**Priority:** P1 Architectural Convergence
**Scope:** `mira-mobile` plus the Hub APIs/data contracts required for attachments, derived evidence, citations, and original-file resolution
**Companion audit:** `docs/architecture/mobile-commodity-convergence.md`
**Agent rule:** `.claude/rules/commodity-before-custom.md`

---

## 1. Purpose

MIRA should spend engineering effort on what makes MIRA unique:

- technician reasoning
- equipment understanding
- evidence grounding
- manuals and nameplates
- asset context
- maintenance history
- diagnostics
- citations
- provenance
- AI-assisted troubleshooting

MIRA should **not** spend engineering effort reinventing solved application infrastructure such as:

- pinch-to-zoom
- pan
- double-tap zoom
- image lightboxes
- file opening
- PDF viewing
- attachment selection
- modal mechanics
- generic mobile gestures
- hardware BACK routing
- common accessibility behavior

This PRD establishes a permanent architectural rule:

> **Commodity software functionality must use mature platform primitives or maintained
> libraries by default. Custom implementations require an explicit justification.**

The immediate trigger is the image-viewer/citation work around #3427/#3429, where significant
custom gesture and event handling was required to make standard image-viewer behavior reliable.

The objective is not merely to replace one viewer. It is to prevent MIRA from repeatedly
rebuilding solved software infrastructure.

## 2. Product Principle — Commodity Before Custom

Before implementing common mobile or web functionality, the engineer or agent must determine
whether the requirement is already solved by:

1. the operating system,
2. Capacitor/native platform capabilities,
3. an established React/mobile library,
4. an existing reusable component already approved inside MIRA.

The order of preference is:

**Platform → Approved mature library → Existing MIRA abstraction → Custom implementation**

Custom infrastructure is the last resort.

## 3. Problem

MIRA development is increasingly agent-driven. Agents receive narrow problems such as:

- "the close button does not respond"
- "BACK closes the wrong thing"
- "add pinch-to-zoom"
- "open this attachment"
- "show a PDF"
- "make the image draggable"

A coding agent will naturally repair the implementation in front of it. This can lead to local
fixes to architecture that should instead be replaced. The result can become: custom gesture
engines, duplicated modal behavior, inconsistent BACK handling, custom file viewers, bespoke
attachment flows, event-handler edge cases, browser/device-specific failures, unnecessary test
burden, larger maintenance surface, inconsistent UX.

The system needs architectural constraints strong enough that a future Claude/Codex/engineer
automatically asks:

> "Should MIRA own this implementation at all?"

before writing code.

## 4. Separate Commodity Infrastructure From MIRA Domain Logic

This distinction is mandatory.

### 4.1 Commodity infrastructure

Examples: image zooming, image panning, double-tap handling, viewer transitions, viewer close
controls, attachment picker, camera integration, file preview, file opening, PDF presentation,
image orientation, generic bottom sheets, generic modal focus handling, Android hardware BACK
stack, accessibility primitives, keyboard behavior, upload-progress components.

These should generally come from platform or maintained libraries.

### 4.2 MIRA-specific domain behavior

Examples: a nameplate photo becoming evidence; OCR text being derived from that photo;
equipment identity extracted from that evidence; linking evidence to a notebook or asset;
retrieval against derived text; citations resolving to original evidence; source trust state;
refusal when evidence is insufficient; maintenance-history relationships; provenance;
technician workflows.

These are MIRA's responsibility. **MIRA owns the meaning and relationships of evidence. MIRA
does not need to own the mechanics of pinch-to-zoom.**

## 5. Evidence Architecture

The same convergence effort must formalize how image attachments and derived artifacts behave.
A physical piece of evidence must have **one canonical identity**.

```
Canonical Evidence
Harrington Nameplate Photograph
        |
        +-- OCR/Text Extraction
        |
        +-- Searchable Chunks
        |
        +-- Equipment Metadata
        |
        +-- Citations
```

Derived artifacts must never become independent competing originals.

**Required invariant:** a citation generated from derived text must always be able to resolve
back to the canonical original evidence when one exists.

```
Citation [1]
   ↓
retrieval chunk
   ↓
derived text document
   ↓
canonical evidence ID
   ↓
original Harrington photograph
```

The user should not need to understand that OCR text, chunks, and metadata exist. To the
technician, there is simply **one source: the nameplate photograph.**

## 6. Idempotency Requirement

Repeated actions must not create duplicate logical evidence. If a technician scans a
nameplate, confirms it, and later confirms the same captured source again, MIRA must not
produce multiple independent user-visible sources representing the same evidence.

Processing may generate new versions internally when necessary, but those versions must remain
attached to the same canonical evidence object.

**Required behavior:** repeated processing of the same source must be idempotent where
possible, versioned where necessary, and never represented as unrelated duplicate evidence.

## 7. Viewer Architecture

MIRA must have **one approved media-viewer abstraction**. The application should not scatter
touch-event implementations across components.

The viewer abstraction must support, where applicable: pinch zoom, pan, double-tap zoom,
reset, close, hardware BACK, orientation changes, portrait and landscape, accessibility, large
images, touch jitter, cancellation, browser/native-WebView differences.

The implementation should delegate gesture mechanics to a mature library or native primitive
unless an explicit ADR documents why this is impossible.

## 8. File Attachment Architecture

MIRA must treat files as canonical attachments with typed capabilities.

- **Images** — prefer in-app viewer.
- **PDFs** — prefer an established viewer/native capability; must support cited-page opening
  where feasible.
- **Text** — may render directly.
- **Office and arbitrary file formats** — do not build custom Word/Excel/etc. rendering unless
  it becomes a product requirement. Prefer "Open with device/default application" when
  appropriate.

## 9. Attachment Contract

Each canonical attachment/evidence object should expose sufficient metadata to answer: What is
it? Who uploaded/captured it? When? What notebook/asset does it belong to? What MIME/content
type is it? Where is the original? What artifacts were derived from it? Which artifact is
canonical? Which citations reference it? Which processing version created the derived data?

The exact schema is an implementation decision, but the domain contract must make original
evidence explicit. **Derived documents must never silently become the user's canonical
evidence.**

## 10. Citation Contract

A citation should represent **evidence**, not merely whichever database row happened to
produce the retrieved text. For derived sources:

```
retrieval document != necessarily canonical user evidence
```

A citation payload must carry or resolve sufficient provenance to reach its canonical evidence
object.

**Required behavior:** if an answer says "Serial number 49849 [1]" and [1] came from text
extracted from a photograph, tapping [1] must lead the technician to that photograph. The
implementation must not depend upon nondeterministically selecting one of several duplicate
document rows.

## 11. Navigation Contract

The application must have a predictable hierarchical BACK model.

```
Fullscreen viewer
       ↓ BACK
Citation sheet
       ↓ BACK
Conversation
       ↓ BACK
Previous application/navigation state
```

BACK must close the most recently opened transient UI layer before navigating out of its
parent. Individual components should not independently invent conflicting BACK semantics. A
centralized navigation/modal stack or equivalent architectural abstraction should own this
behavior.

## 12. Agent Development Rule

The following must become persistent repository guidance for Claude, Codex, and human
contributors (persisted at `.claude/rules/commodity-before-custom.md`).

**Rule.** Before implementing commodity UI/infrastructure, answer:

1. Is this a standard OS/platform behavior?
2. Does Capacitor already expose it?
3. Does a mature maintained library solve it?
4. Does MIRA already have an approved abstraction?
5. Why would custom code be superior?

If questions 1–4 identify an adequate solution, use it.

**Custom-code escalation.** If implementing approximately 50+ lines of custom
interaction/infrastructure logic for a commodity behavior, stop. The PR or design note must
explain: alternatives evaluated, why they were rejected, maintenance impact, accessibility
impact, platform compatibility, test burden, expected longevity.

This is a design guardrail, not a strict line-count gate.

## 13. Library Selection Criteria

Do not blindly add dependencies. A proposed library should be evaluated for: active
maintenance, React compatibility, Capacitor/WebView compatibility, Android behavior, iOS
compatibility where relevant, accessibility, touch support, bundle impact, licensing,
TypeScript support, testability, API stability, community adoption, dependency-chain risk.

A smaller custom implementation is not automatically preferable to a maintained dependency.
Likewise, a popular dependency is not automatically acceptable. Use engineering judgment.

## 14. Initial Audit

Before major refactoring, Claude must perform a read-only audit of `mira-mobile`. Classify
each applicable subsystem as: **PLATFORM / MATURE LIBRARY / MIRA DOMAIN / CUSTOM — JUSTIFIED /
CUSTOM — REPLACE**.

Audit at minimum:

- **Media** — fullscreen image viewing, zoom, pan, double tap, rotation/orientation, closing.
- **Attachments** — file picking, camera input, upload, thumbnails, preview, open-original
  behavior.
- **Documents** — PDF viewing, text viewing, arbitrary-file opening.
- **Navigation** — modal stack, sheet behavior, Android BACK, app resume behavior,
  transient-screen restoration.
- **Shared interaction infrastructure** — gesture handlers, pointer handlers, touch-action
  rules, global event listeners, custom overlays.

## 15. Audit Deliverable

Produce `docs/architecture/mobile-commodity-convergence.md` containing a classification table
(Area / Current Implementation / Classification / Recommendation). Do not modify production
code during the initial audit unless fixing a critical regression is separately authorized.

## 16. Relationship to #3429

#3429 should be treated as a valid bug fix to the current viewer implementation. It is not
automatically evidence that the current viewer should remain the long-term architecture.
After the audit, classify the existing viewer as KEEP / WRAP / REPLACE. If replacement is
recommended, do not discard proven behavior — port the required acceptance behavior to the
replacement implementation.

## 17. Immediate Provenance Investigation

In parallel with architecture convergence, investigate the current citation-to-original
defect. The investigation must determine, with evidence:

1. Why repeated nameplate confirmations created duplicate source records.
2. Whether those records share the same canonical original.
3. Which rows contain original-file provenance.
4. Which rows do not.
5. How citation generation selects the document.
6. How "Open original" resolves the attachment.
7. Why the Harrington citation currently opens .txt.
8. Whether other notebooks can exhibit the same defect.

Do not patch the Harrington notebook specifically. **Fix the system contract.**

## 18. Required Provenance Fix

The eventual implementation must guarantee:

- **A. One logical evidence source** — one captured photograph appears as one user source.
- **B. Derived artifacts remain derived** — OCR text/chunks never masquerade as unrelated
  source files.
- **C. Deterministic citation resolution** — citation → original works regardless of how many
  times processing occurs.
- **D. Idempotency** — repeated confirm/reprocess does not create duplicate logical evidence.
- **E. Existing data safety** — do not blindly delete existing production rows. If
  repair/backfill is necessary: inspect first, make it deterministic, make it repeatable,
  preserve auditability.

## 19. Acceptance Tests

**Test A — Basic photograph provenance.** Capture/upload a nameplate photograph → confirm →
ask a question answered from that photograph → receive citation [1] → tap [1] → tap Open
Original. PASS: original photograph opens.

**Test B — Repeated confirmation.** Capture one photograph → confirm → repeat the applicable
confirmation/reprocessing path three times → inspect Sources. PASS: technician sees one
logical source. Then ask a cited question and open [1]. PASS: citation still resolves to the
original photograph.

**Test C — Viewer behavior.** Open photograph. Verify pinch zoom, pan, double tap, close
button, jittery real finger tap, portrait, landscape where supported. PASS: behavior is
reliable without application-specific gesture failures.

**Test D — BACK behavior.** From conversation → citation sheet → fullscreen image, press
BACK. PASS: fullscreen image closes, citation sheet remains. Press BACK again. PASS: citation
sheet closes, conversation remains.

**Test E — Arbitrary file.** Attach a supported non-image document. PASS: MIRA either
previews it using an approved viewer, or opens it with an appropriate device application. No
bespoke renderer is introduced merely to support the file type.

**Test F — Existing duplicate condition.** Construct or safely reproduce the current
duplicate-source state. PASS: citation resolution remains deterministic and reaches canonical
evidence.

## 20. Regression Requirements

Automated tests must cover: provenance linking, duplicate prevention/idempotency, citation
original resolution, viewer close behavior, BACK ordering, repeated processing, missing
original, unsupported file type, derived-only source, stale/bad provenance where feasible.
Device tests should validate platform behavior that unit tests cannot prove.

## 21. Implementation Phases

- **Phase 1 — Audit.** No broad refactoring. Deliver commodity-vs-domain classification,
  dependency assessment, architecture recommendations.
- **Phase 2 — Provenance Repair.** Fix duplicate nameplate source creation, canonical
  evidence relationships, citation-to-original resolution. Domain-critical; does not depend on
  replacing the viewer.
- **Phase 3 — Commodity UI Convergence.** Replace or wrap unnecessary custom infrastructure
  identified by the audit. Prioritize: media viewer, navigation/BACK semantics, file/document
  opening, common attachment UI.
- **Phase 4 — Device Acceptance.** Create the next approved APK. Run the complete technician
  flow on the Pixel.

## 22. Full Device Acceptance Journey

Launch MIRA → open/create notebook → capture nameplate → recognition → confirm → ask grounded
question → receive cited answer → tap [1] → view evidence/source → open original photograph →
pinch/zoom/pan → close viewer → reopen → hardware BACK → citation sheet remains → BACK →
conversation remains → force-stop/relaunch → application returns to sane conversational state.

The run must not require knowledge of internal document rows or derived text artifacts.

## 23. Non-Goals

This PRD does not require: rewriting all mobile UI, changing MIRA's product design language,
replacing React, replacing Capacitor, building a universal document editor, rendering every
possible file type, eliminating all custom components, changing AI models, changing retrieval
architecture beyond provenance requirements, redesigning the notebook concept.

## 24. Definition of Done

This initiative is complete when:

- commodity-before-custom guidance is persisted in the repository;
- the mobile commodity audit is complete;
- common functionality has clear approved primitives;
- nameplate processing is idempotent at the logical-evidence level;
- derived artifacts retain deterministic provenance;
- citations reliably resolve to canonical original evidence;
- image viewing uses an explicitly approved architecture;
- hardware BACK follows a predictable UI hierarchy;
- duplicate sources do not corrupt citation behavior;
- the full Pixel acceptance journey passes.

## 25. North Star

A technician should experience:

> I took a picture. MIRA understood it. MIRA used it as evidence. I tapped the citation and
> saw my picture.

They should never experience:

> MIRA generated three text files from my picture, cited one database record, lost the parent
> relationship, and opened the OCR sidecar instead.

All of that complexity belongs behind the product boundary. Likewise: a technician should be
impressed that MIRA understands machinery. They should never be depending on FactoryLM's
bespoke implementation of pinch-to-zoom.

**MIRA owns industrial intelligence. Standard software infrastructure should remain standard
software infrastructure.**
