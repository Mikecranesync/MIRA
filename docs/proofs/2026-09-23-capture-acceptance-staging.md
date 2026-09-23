# Live capture acceptance — staging, 2026-09-23

**Deployed SHA:** `defadf5e35405df924438b6551246ec58370b152` (`deploy-staging.yml` run 35804493499)
**Migration:** `093_turn_ingress.sql` applied to staging (run 35804420614 — table, 3 indexes, 2 grants)
**Config:** `MIRA_TURN_RECONCILER=1` set in `factorylm/stg`
**Base:** `https://app-staging.factorylm.com` · production untouched throughout

```json
{ "gitSha": "defadf5e35405df924438b6551246ec58370b152", "builtAt": "2026-09-23T01:01:09Z",
  "telemetry": { "tracing": "enabled", "exporter": "otlp-http",
                 "environment": "staging", "contentCapture": false } }
```

`miraContractEnabled` is **absent** from health, which is the intended signal that staging
now serves this main-based branch rather than #3959's RC.

## Capture acceptance — PASS

`tools/qa/capture_acceptance.py`, 7 attempts registered locally **before** being sent.

| scenario | HTTP | trace |
|---|---|---|
| A photo LOOK | 200 | `1ee88cc963ff5e3104bdf2f38be48bd9` |
| B text-only follow-up | 422 | — |
| C failed upload (text/plain to /look) | 415 | — |
| D malformed JSON | 400 | — |
| E unauthenticated | 401 | — |
| F client cancel | 422 | — |
| G reconnect, same clientRequestId | 422 | — |

Server reconciliation, read from `/api/observability/coverage` — computed from
`turn_ingress`, **not** from the recorder:

```json
{ "arrived": 6, "no_response_recorded": 0, "pre_accept_rejections": 2,
  "lost_starts": 0, "accepted": 4, "accepted_closed": 4,
  "accepted_unfinished": 0, "close_rate": 1, "start_capture_rate": 1,
  "starts_without_arrival": 0 }
```

**Read the numbers, because they are the proof and two of them look wrong at a glance.**

- `arrived: 6` against 7 client attempts. Correct: attempt **E was never
  authenticated**, so its arrival row carries no tenant and it is invisible to a
  *tenant-scoped* view — exactly as the module documents ("an attempt that never
  authenticated has neither, and is visible only in the unscoped operator view").
  It is not lost; it belongs to no tenant.
- `pre_accept_rejections: 2` = C (415) and D (400). Both return **before**
  `openTurn` exists, so before this table they left no trace at all.
- `accepted: 4` = A, B, F, G. The 422s reach the recorder and then fail
  validation, so they are accepted turns with an outcome — not pre-accept
  failures. The two populations land in different buckets, which is the whole
  point of separate denominators.
- `lost_starts: 0` and `starts_without_arrival: 0` — neither ledger is missing
  anything the other saw.

Artifact: `/tmp/capture-acceptance.json`.

**Packet v2 confirmed live**: a fetched packet reports `"v": "2"` with
`answer_gate.citations_shipped` and `answer_gate.evidence_followed` present.

## #3962 repeat: NOT reproducible on this branch, and that is the finding

I ran the bearing-photo → text-only-follow-up sequence three times. The LOOK read the
label correctly every time, matching the issue verbatim:

> "32906X Tapered Roller Bea…", "Width 2pcs", "MADE IN CHINA"

**The follow-up cannot run at all on main-based code.** A text-only follow-up returns:

```
{"error":"no_sources_selected"}   HTTP 422
```

— with the photo linked to the notebook, and also with the photo explicitly re-sent as
`visualEvidence.fileId`. That is main's pre-contract behaviour; #3959 is what stops an
evidence-bearing notebook being refused for having no *document* sources.

### A wrong turn I took, recorded because it would have been a false result

To get past the 422 I first re-ran with `"mode": "general"`. All three answers came back
about a drive coupling and none named `32906X`, which looks exactly like #3962 — and I
briefly read it that way. The packet says otherwise:

```json
"visual_evidence": { "observation_in_context": false, "prior_turn_observation_count": 0 }
"retrieval":       { "strategy": "skipped_general_mode" }
```

General mode does not recall the prior observation, so the model had **no evidence to
ignore**. A generic answer with no evidence in context is not "evidence supplied but not
followed" — it is a different, far less alarming thing. Reporting it as a reproduction
would have been a fabricated confirmation of my own detector.

### Consequence

`ANSWER_IGNORED_VISUAL_EVIDENCE` is **unit-proven against the verbatim strings from the
issue and not yet live-proven**, because the failure it detects is unreachable on the
branch it ships on. It becomes live-testable when #3959 lands, or on a build with
`MIRA_PERSONA_CONTRACT=1`. Stated rather than quietly left as "shipped".

`DOCUMENTS_IN_CONTEXT_UNCITED` is reachable here — it needs only a notebook with sources —
and is exercised by the acceptance loop.

## What is still not proven live

- **Process crash** — needs a container kill mid-turn; the reconciler's behaviour is
  proven against real Postgres, its behaviour against a real crash is not.
- **Exporter outage** — `exporter-down.test.ts` proves an outage never blocks a turn;
  a live outage with replay-without-duplicates has not been run.
- **Provider timeout** — needs staging fault injection.
- **Pixel 9a** — must be `com.factorylm.mira.staging`; the production flavour has no
  recorder.
