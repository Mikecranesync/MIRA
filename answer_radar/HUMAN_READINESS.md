# Technician human-readiness pilot

Tracking issue: #4101. This eval asks whether a technician can finish a useful
conversation in the web or Pixel app. The 100-question exam measures model
knowledge; this pilot measures the whole product journey.

## What is implemented

- `human_readiness_manifest_v1.json` lists twelve cases and the required
  surfaces/repeats (51 attempts total). Both photo fixtures are pinned by
  sha256; the MG17 bytes stay off-repo (`fixture_bytes: off_repo`) because the
  photo shows a serial number.
- `human_readiness.py` scores signed observation records and returns GO or HOLD.
  Any unsafe result, absent attempt, missing source proof, unverified UI action,
  or missed preregistered product target yields HOLD.
- `jev_human_readiness.py` reports how Jev's post-answer signals agree with
  independent labels made without seeing those signals. It cannot change GO.

## Run after the capture adapter supplies evidence

```bash
python -m answer_radar.human_readiness \
  answer_radar/human_readiness_manifest_v1.json run.json --out scorecard.json
python -m answer_radar.jev_human_readiness run.json > jev-comparison.json
```

`run.json` has `build_sha` and an `attempts` array. Each attempt identifies
`case_id`, `surface`, zero-based `rep`, and its deployed `build_sha`; records
`trace_id`, `turn_id`, `rendered_answer`, `turn_status`, latency, any hard
blockers, action receipts, six 0/1/2 scores with reasons, a signed human review,
and either Jev signals or an explicit skip reason. `source_review` must bind
two independent providers' grades to the same answer hash and cited passages;
when the grader packet carried reference notes, the same notes are recorded
on `source_review.reference_notes` and are part of that hash. A photo case's
`photo_link` receipt must be `{"sha256": <hash of the uploaded bytes>}` equal
to the case's `fixture_sha256`; anything else holds.
The fixture in `tests/answer_radar/test_human_readiness.py` shows the shape.

The scorecard script checks completeness and arithmetic. It cannot inspect a
phone, authenticate a signature, or establish that a passage truly supports a
claim. The capture adapter must derive receipts from the existing staging Hub
runner/Turn Evidence Packet and actual web/Pixel actions; a technician must
review the rendered interaction. #4097 must make source passages available to
the independent graders. Never fill a missing field with an invented value to
turn HOLD into GO.

## Jev decision

The existing Jev Decision Fabric runs after an answer has been sent. Its
latency is therefore not an answer-speed improvement. The comparison reports
AUC and Brier error for over-specificity, wrong-family grounding,
contradiction, and unsupported numerics, plus typed failure-class confusion,
skips, latency and tokens. AUC is unavailable when a set contains only correct
or only defective examples. No threshold is fitted to these cases.

To test Jev before generation, freeze new cases with the fields available at
that earlier point, compare its decision with the current path and independent
truth, then measure any proposed staged variant against the same cases. An
inline Jev call may add latency; record full-turn p50/p95 as well as Jev's own
time. Keep deterministic safety, authorization and identity confirmation.

## Work remaining

1. Done: both photo hashes pinned; the staging hub runner feeds this record
   schema (`human_readiness_capture.py`). Web/Pixel/multi-turn runners remain.
2. Capture source passages (#4097), UI action receipts and blind human labels.
3. Run all attempts on one deployed SHA, independently grade the answers, and
   publish the HOLD reasons and Jev comparison.
4. Fix the first observed product failure, rerun on a new SHA, and complete a
   cold-start technician walkthrough on both surfaces.
