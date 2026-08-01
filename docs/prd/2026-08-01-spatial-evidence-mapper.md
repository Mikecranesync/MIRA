# Spatial Evidence Mapper PRD

**Status:** Draft for implementation review  
**Date:** 2026-08-01  
**Owner:** FactoryLM / MIRA  
**First field trial:** Garage Conveyor visual session

## 1. Purpose

Turn newly captured visual evidence into reviewable, evidence-backed links to
**existing** MIRA assets and components. The mapper helps a technician build a
trusted spatial understanding of a facility over time without creating a
second asset registry, mapping product, conversational agent, or evidence
contract.

The source of truth is the reviewed evidence ledger. A route display, facility
map overlay, or future 3D walkthrough is a projection of that ledger; it is
not a source of truth by itself.

## 2. Problem

Technicians collect photos of rooms, panels, nameplates, prints, facility
maps, and components while moving through a site. Today MIRA can retain and
interpret visual evidence, but it does not continuously propose the practical
association that makes evidence useful later: which existing asset or
component an image most likely depicts or locates.

Without a reviewable mapping path, a photo can be useful in the moment yet be
hard to retrieve as part of the machine context later.

## 3. Product outcome

After evidence is uploaded through the existing Hub VisualSession path, a
background mapper creates a candidate relation only when it can name an
existing tenant-scoped asset or component. The candidate appears in the
existing Hub proposal queue with its source evidence, confidence, and reason.

The technician accepts, rejects, or corrects the candidate. Only an accepted
candidate becomes confirmed spatial evidence. Unknown items remain unassigned;
the mapper never creates an asset or component record.

## 4. Users and primary scenario

The primary user is a maintenance technician collecting permitted photographs
on a phone during an inspection, then reviewing the results in FactoryLM Hub
on desktop or phone.

The first validation scenario is the Garage Conveyor. The technician creates
one VisualSession, uploads a facility-map reference plus a sequenced set of
conveyor-area photos, and reviews any mapping candidates after the worker has
run.

## 5. Scope

### In scope for the first implementation PR

- Reuse `visual_session`, `evidence_item`, `region_of_interest`, and
  `observation` as the visual evidence ledger.
- Preserve server-extracted capture metadata from an original photo when it is
  present, including capture time, latitude, longitude, and accuracy. Missing
  data remains missing; the system never estimates it from a filename or prose.
- Run an idempotent background mapper over new and previously unprocessed
  VisualSession evidence.
- Create candidate relation observations linking an evidence item to an
  **existing** asset or component only.
- Reuse the existing `ai_suggestions` proposal queue for technician review.
- Allow an authorized reviewer to accept, reject, or correct a candidate while
  preserving its source evidence and review history.
- Ship a backfill mode so evidence captured before deployment, including the
  Garage Conveyor field trial, can be evaluated from its preserved originals.
- Add unit, integration, tenant-isolation, idempotency, and approval-path
  tests.
- Provide the field-capture and review guide in
  `docs/guides/spatial-evidence-field-trial.md`.

### Explicitly out of scope

- A native Android app, background phone tracking, or a body-camera intake.
- Google Maps, offline map tiles, route visualization, point clouds,
  photogrammetry, AR, or a 3D walkthrough.
- Creating new facilities, rooms, assets, components, graph entities, or
  wiring connections from a mapper result.
- Automatic verification, automatic asset creation, operational control,
  safety-release, or return-to-service decisions.
- Cross-tenant learning, external training, or use of customer imagery outside
  its tenant-approved purpose.

## 6. Non-negotiable rules

1. **One technician brain.** This is an evidence producer under ADR-0033, not
   a new spatial assistant or chatbot.
2. **One evidence spine.** The mapper extends the existing VisualSession and
   TechnicianContext contracts. It creates no parallel context schema, queue,
   registry, or approval ladder.
3. **Candidate first.** Mapper output is always an unreviewed candidate in the
   first implementation. Model confidence never verifies a link by itself.
4. **Existing targets only.** A candidate target must resolve to an existing
   asset or component inside the current tenant. Otherwise the item is left
   unassigned.
5. **Evidence and provenance are mandatory.** Every candidate carries the
   evidence-item identifier, original hash, session identifier, mapper version,
   matching signals, and confidence. A missing audit anchor means no candidate.
6. **GPS is contextual.** GPS and accuracy describe where the phone reported it
   was. They do not prove an indoor cabinet location or override a reviewed
   facility-map reference.
7. **Read-only OT boundary.** The mapper can read evidence and create review
   candidates only. It cannot issue control actions or make safety judgments.
8. **Tenant privacy.** Original facility maps and photos remain tenant-private.
   The feature is disabled until the customer has authorized capture and upload.

## 7. Data flow

```text
Existing Hub VisualSession upload
  -> original image and capture metadata retained in evidence_item
  -> idempotent mapper finds an unprocessed item
  -> deterministic candidate resolver searches existing tenant assets/components
  -> candidate relation observation is appended to the visual ledger
  -> matching ai_suggestions row enters the existing Hub review queue
  -> technician accepts, rejects, or corrects
  -> accepted relation is confirmed evidence available to TechnicianContext
```

Facility-map photos are ordinary visual evidence with the role `area`. They
may supply labels, landmarks, and context for a reviewed mapping decision. A
facility-map photo does not establish a coordinate system, a route, or an asset
location automatically.

## 8. Candidate behavior

The mapper evaluates only evidence that has not already produced a mapper
record for the same mapper version and source hash. It uses only auditable
signals:

- an existing session asset association;
- a visible, extracted, or technician-labeled existing asset identifier;
- an existing component/nameplate identity tied to a tenant asset;
- a reviewer-provided region label; and
- retained capture metadata as contextual support, never as sole identity.

The candidate record includes a plain-language explanation of which signals
matched and which expected evidence is missing. It must say `unknown` rather
than force a target where no existing target is supported.

Worker failure is fail-open for evidence capture: the original upload remains
available, the failure is recorded for retry, and no candidate is fabricated.

## 9. Review and confidence calibration

The existing Hub proposal queue is the review surface. A reviewer sees the
source image, session, target candidate, confidence, matching signals, and
candidate state. The reviewer can accept, reject, or correct the target.

The first implementation has no auto-selection path. Review outcomes form a
tenant-local calibration record.

Automatic selection is a later, separately approved release. It may be enabled
for a tenant only when all of the following are true:

- the tenant has at least 100 finalized mapper review decisions;
- two separate 50-item held-out review sets each show at least 98% precision;
- neither held-out set contains a wrong accepted target for a safety-critical
  or high-risk candidate;
- a qualified tenant administrator explicitly enables the feature; and
- every automatic result remains auditable, reversible, and visible in the
  review history.

This gate prevents a model score from becoming an unearned claim of ground
truth.

## 10. Acceptance criteria

1. A Hub upload retains its original bytes and parses supported capture metadata
   without trusting client-supplied coordinates.
2. A run over the same evidence twice creates no duplicate observation or
   proposal.
3. A candidate never targets a record outside the current tenant.
4. A candidate without a source session, source evidence, source hash, or
   target identifier is not created.
5. An accepted candidate confirms the linked relation without creating a new
   asset or component; a rejected candidate is excluded from active context.
6. A worker outage cannot block photo upload or delete captured evidence.
7. The Garage Conveyor backfill run produces either reviewable candidates or
   explicit `unknown` results; it never silently claims a map is complete.
8. The feature makes no operational-control, safety, or return-to-service
   recommendation.

## 11. Success measures

- Every candidate has a source image and an explainable target match.
- The initial field trial can be captured with the current phone-to-Hub path.
- A reviewer can reach a correct accept/reject/correct outcome without database
  access.
- No duplicate candidate appears after retry or backfill.
- The implementation adds no second asset store, mapping queue, or context
  contract.

## 12. Delivery sequence

1. Land the mapper contract, capture-metadata parsing, candidate observation,
   proposal-queue integration, and tests.
2. Deploy to a non-production environment and run the Garage Conveyor backfill
   against authorized trial evidence.
3. Review every candidate manually and record results.
4. Correct mapper defects before any broader customer trial.
5. Treat route, map, and reconstruction views as separate follow-on projects
   that consume reviewed spatial evidence rather than replace it.
