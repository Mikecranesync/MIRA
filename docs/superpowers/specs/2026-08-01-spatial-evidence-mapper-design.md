# Spatial Evidence Mapper Design

**Status:** Approved product direction; awaiting written-spec review before implementation  
**Date:** 2026-08-01

## Decision

Build a tenant-scoped, idempotent background mapper that consumes the existing
VisualSession evidence ledger and writes only reviewable candidate links to
existing MIRA assets and components. Reuse the existing Hub proposal queue and
approval controls. Do not create a map service, an asset store, a spatial
chatbot, or a second background queue.

## Existing seams reused

- `mira-hub` VisualSession upload retains original evidence in `evidence_item`.
- `mira-bots/shared/visual` provides the append-only visual observation ledger.
- `ai_suggestions` is the existing Hub-facing review queue.
- `materialized_evidence/context_contract.py` adapts reviewed visual
  observations into the single TechnicianContext spine.

## Architecture

### Capture metadata

The Hub upload route parses capture metadata from the original image on the
server. It retains values only when the image contains them:

- `captured_at` in ISO-8601 form;
- `latitude` and `longitude` as decimal degrees;
- `horizontal_accuracy_m` when available; and
- existing image dimensions and EXIF orientation.

The route does not accept coordinates supplied by a browser form as trusted
data. It stores no inferred location. Metadata parsing failure leaves only the
original evidence and does not reject the upload.

### Mapper worker

The mapper is a small worker under the existing visual-evidence domain. It can
run once for a controlled backfill or repeatedly on a bounded schedule. A run:

1. reads tenant-scoped evidence that has no mapping result for the current
   mapper version and source hash;
2. obtains only existing tenant asset/component candidates;
3. evaluates auditable identity signals and produces zero or one target
   candidate per evidence item;
4. appends an unreviewed `relation` observation when a candidate is supported;
5. inserts one idempotent `ai_suggestions` review item linked to that
   observation; and
6. records a retryable failure without altering or blocking the original
   evidence.

The worker has no control-system dependency and no write path outside the
visual ledger and existing review queue.

### Candidate representation

The append-only observation is the evidence record. It uses:

- `obs_kind = relation`;
- `evidence_state = LIKELY`;
- `review_state = unreviewed`;
- a source `evidence_id` and `session_id`; and
- metadata containing mapper version, source hash, existing target id, target
  type, confidence, and matching signals.

The proposal queue row is the review task. It points back to the observation
and source evidence and has a dedicated `visual_location_link` suggestion
type. Accepting it transitions the suggestion through the existing transition
helper and confirms the linked observation. Rejecting it rejects the linked
observation. Neither action materializes a new asset, component, graph entity,
or wiring connection.

### Facility-map reference images

The user can upload a facility map in the same VisualSession as field photos.
The system stores it as normal evidence with the `area` role. In the first
release it may contribute visible labels and reviewed context but cannot
auto-georeference photos, fabricate a floor plan, or place an indoor asset from
GPS alone.

### Idempotency and retries

The natural candidate key is tenant id + mapper version + source evidence hash
+ target id. A unique database constraint or equivalent atomic insert makes a
retry safe. The worker must re-read state inside its transaction before writing
so concurrent runs cannot create duplicate candidates.

An evidence item with no supported target is recorded as processed with an
explicit `unknown` result. It can be reconsidered only by a new mapper version
or new human/visual evidence, never by an unbounded retry loop.

## Error handling

- Missing original bytes, malformed metadata, or no existing target: preserve
  evidence and make no claim.
- Candidate resolver failure: preserve evidence, journal the failure, and make
  it eligible for a bounded retry.
- Database or proposal-write failure: roll back the candidate transaction;
  never leave an accepted-looking observation without a review task.
- Unauthorized or cross-tenant target: treat as no target and emit no candidate.

## Testing

Tests must prove:

1. server-side EXIF metadata parsing retains valid values and omits malformed
   values;
2. source evidence without an existing target produces `unknown`, not a new
   asset;
3. candidate observations include complete provenance;
4. repeated mapper runs are idempotent;
5. a tenant cannot map evidence to another tenant's target;
6. accept/reject updates the correct linked observation only; and
7. a mapper failure does not make evidence upload fail.

## Deliberate deferrals

This design does not add the Android companion, continuous phone tracking,
offline map tiles, video ingestion, Google Maps, a floor-plan editor, a 3D
viewer, point-cloud generation, or auto-selection. Each needs a separate
design once the reviewed evidence set proves the mapper is useful.
