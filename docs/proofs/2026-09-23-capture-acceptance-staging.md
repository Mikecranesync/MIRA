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

- `arrived: 6` against 7 client attempts. **My first explanation of this was
  wrong and the real one is a limitation worth knowing.** I wrote that attempt E
  was counted but tenant-less and therefore operator-view only. The direct query
  says otherwise:

  ```
  TOTALS: {"arrivals":"42","responses":"42","responses_no_tenant":"0"}
  ```

  Perfectly paired arrivals and responses, and **not one** response row with a
  NULL tenant. E produced **no ingress rows at all** — because
  `src/middleware.ts` returns 401 JSON for an unauthenticated `/api/*` call
  BEFORE the route handler, so the ingress wrapper never ran.

  This cannot be patched where the wrapper lives: middleware runs in the EDGE
  runtime, which has no `pg`, so a durable write from there is impossible. So
  the honest statement of the denominator is **"requests that reached the route
  handler"**, not "HTTP requests", and pre-route rejections are outside every
  number this module reports. That is now said in the module header, in
  `copy_text`, and in a `reconciliation_denominator` field next to the numbers —
  because a limit that lives only in a proof document is a limit nobody reading
  the dashboard will ever see.
- `pre_accept_rejections: 2` = C (415) and D (400). Both return **before**
  `openTurn` exists, so before this table they left no trace at all.
- `accepted: 4` = A, B, F, G. The 422s reach the recorder and then fail
  validation, so they are accepted turns with an outcome — not pre-accept
  failures. The two populations land in different buckets, which is the whole
  point of separate denominators.
- `lost_starts: 0` and `starts_without_arrival: 0` — neither ledger is missing
  anything the other saw.

Artifact: `/tmp/capture-acceptance.json`.

### Positive control — the mirror detects, it does not merely run

`starts_without_arrival: 0` on a healthy window proves the query executes; it does
not prove it can ever be non-zero. Every arrival in that window was written by the
same code path that wrote the starts, so the zero is vacuous as evidence.

Injected one `decision_traces` row with a fresh `attempt_id`, `lifecycle='started'`
and no matching arrival, on the stranger tenant:

```
starts_without_arrival BEFORE: 0
starts_without_arrival AFTER : 1    (injected attempt c0c3ee93-bfac-4e6d-906b-d956ae06dd96)
cleaned up  : yes
POSITIVE CONTROL PASSED — the mirror detects, it does not merely run
```

## Acceptance loop — ALL SIX PASS on this SHA

Run `35805223597`, auditing `defadf5e35…` (the SHA-pin fix resolving the deployed
tree, as intended). 1 ✓ · 2 ✓ · 3 ✓ (`cit=1`, notebook badge) · 4 ✓ (`prior=1`,
`workspace_evidence`) · 5 ✓.

Scenario 4 passing is what corrected my next claim.

**Packet v2 confirmed live**: a fetched packet reports `"v": "2"` with
`answer_gate.citations_shipped` and `answer_gate.evidence_followed` present.

## #3962 — reproduced live 3/3, and my detector caught 1 of the 3

**Correction to my own earlier conclusion.** I first wrote that #3962 was
unreachable on main-based code, because a text-only follow-up returned
`{"error":"no_sources_selected"}` (HTTP 422). That was true of the sequence I ran
and false as a general claim: acceptance scenario 4 passes on this very SHA. The
difference is that **the issue's own reproduction has a middle turn** which I had
skipped — a chat turn carrying the photo, between the LOOK and the text-only
follow-up:

```
POST /look/    bearing-box label photo
POST /chat/    {"message":"what is this and what would make it fail", "visualEvidence":{"fileId":…}}
POST /chat/    {"message":"it is chattering, what do I check first"}     ← no photo
```

Run exactly that way, three times:

| run | observation in context | prior obs | answer subject | names `32906X` | verdict | anomaly |
|---|---|---|---|---|---|---|
| 1 | **true** | 1 | drive coupling / motor | no | `consistent` | — |
| 2 | **true** | 1 | drive coupling / motor | no | `consistent` | — |
| 3 | **true** | 1 | drive coupling / belt / motor | no | `unverified_mismatch` | **`ANSWER_IGNORED_VISUAL_EVIDENCE`** |

**#3962 reproduces 3/3.** The photo *was* recalled server-side and *was* in the
prompt (`observation_in_context: true`, `prior_turn_observation_count: 1`), and all
three answers were about a drive coupling. Traces `36cda615ce71f64f…`,
`5e370d2453e204e8…`, `d4c53a8acb5227f0…`.

**My detector fired on 1 of 3.** That is the measurement, and it is not a good one.

### Why it missed — measured, not guessed

The two misses recorded `evidence_classes: []`: the recalled observation named no
equipment class my closed vocabulary recognises. The cause is the photo itself.
Four identical LOOK calls on the same image:

| | contains "bearing" | contains "tapered roller" |
|---|---|---|
| 4 runs | **0 / 4** | **3 / 4** |

The label is physically truncated — the vision model reads
`"32906X Tapered Roller Bea..."`, so the word *bearing* never appears, and even
*tapered roller* is present only three times in four on **identical input**.

**A detector keyed on vision prose inherits vision's nondeterminism.** That is the
real finding, and it is a limitation of the approach rather than a tuning problem:
widening the vocabulary to catch this specific label would be fitting three
samples at 01:20 in the morning, which is how a detector becomes #3963.

### What this changes

- `ANSWER_IGNORED_VISUAL_EVIDENCE` is **live-proven to fire on a real #3962 turn**
  (run 3, with the full anomaly payload) and **measured at 1/3 sensitivity** on
  three live reproductions. Both facts belong in any decision about it; quoting
  only the first would be the overclaim this whole PR exists to prevent.
- The principled improvement is to anchor the assessment on something more stable
  than vision prose — MIRA's own turn-1 answer established the subject
  ("tapered-roller bearing") far more reliably than the observation did. That is a
  follow-up, deliberately not done tonight on three samples.
- `DOCUMENTS_IN_CONTEXT_UNCITED` is unaffected: it reads counts, not prose, and
  has no equivalent failure mode.

## Exporter outage — PROVEN live

`OTEL_EXPORTER_OTLP_ENDPOINT` in `factorylm/stg` was pointed at `http://192.0.2.1:4318`
— an RFC 5737 documentation address that routes nowhere, so the exporter fails the way a
real backend outage fails rather than the way a disabled feature does — and staging was
redeployed on `8919c69793e85cff2ee6a9f74951c8fe7c4cd210`.

Two turns during the outage:

| turn | http | latency | trace on header | answer |
|---|---|---|---|---|
| 1 | 200 | 5.27 s | `a394d9d5924de83981439361e521f1ec` | 1204 chars |
| 2 | 200 | 4.75 s | `9cb84061b35bfddfadf87104178b4212` | 407 chars |

Chat was **unaffected** — normal latency, real answers, trace ids still minted and
returned on the header.

The durable side, read straight from the database:

```
  78a5a98a  started  -           trace=a394d9d5924de839  packet=false
  78a5a98a  closed   answered    trace=a394d9d5924de839  packet=true
  6d911afb  started  -           trace=9cb84061b35bfddf  packet=false
  6d911afb  closed   safety_stop trace=9cb84061b35bfddf  packet=true

  78a5a98a  arrived    status=-    crid=-
  78a5a98a  responded  status=200  crid=00322906
  6d911afb  arrived    status=-    crid=-
  6d911afb  responded  status=200  crid=fe627a49

distinct attempts=2  starts=2  closes=2
EXPORTER OUTAGE: durable records PRESERVED, exactly one lifecycle per turn, NO DUPLICATES
```

**Records preserved, packets persisted, exactly one lifecycle per turn, no duplicate
turns.** The two failures are genuinely separate: the exporter was dead and the ledger
did not notice. Turn 2 closing as `safety_stop` also shows a non-answered outcome being
captured rather than only the happy path.

It also confirms the client-key threading works live: the arrival row has no
`client_request_id` (it predates the body parse, by construction) and the response row
carries it.

**Restored**: the endpoint was set back to the captured original and verified byte for
byte, then redeployed.

## Process crash — PROVEN live, as a side effect

`abandoned` is written by nothing except `reconcileStaleTurns`. Staging, over the three
hours spanning the two redeploys:

```
closed outcomes, last 3h: [{"answered":24},{"error":9},{"abandoned":7}]
stale starts still open (>15m): 0
```

**Seven turns were open when their container was killed by a redeploy, and the
reconciler closed every one of them.** No start record was left dangling. That is the
process-death path the goal asks about — `endRoot` could not have run for those turns,
because the process that would have called it no longer existed.

The 24/9/7 split is also the point of the lifecycle in the first place: before this
work, the 9 errors and the 7 abandoned turns wrote **no row at all** and were
indistinguishable from turns that never happened.

## Real website — PROVEN in a real browser

Not curl. Playwright drove `https://app-staging.factorylm.com` as a stranger
would: signed up a brand-new account through the signup form, created a notebook
from the UI prompt, typed a question into the composer and pressed Enter.

Answer (real, and good): *"The most common cause of chatter in a tapered-roller
bearing is insufficient preload or a loss of axial support…"* with preload,
spalling, alignment and lubrication checks under a lockout/tagout heading, badged
**"General guidance — not grounded in this machine's documents."** — which is the
honest badge for a notebook with no sources.

Captured end to end:

```
ingress:    154c38ef arrived   -    crid=-
            154c38ef responded 200  crid=bf978ba4
lifecycle:  154c38ef started   -          trace=7d44f29bb812cce6ef4f0d888dad8db5 packet=false
            154c38ef closed    answered   trace=7d44f29bb812cce6ef4f0d888dad8db5 packet=true
```

Notebook `30048da4-333b-464d-9169-f9386bb81931`. Screenshot:
`docs/promo-screenshots/2026-09-23_web-capture-acceptance-notebook-chat_desktop.png`.

## Mobile — PROVEN on the emulator; physical Pixel NOT available

Root `CLAUDE.md` makes the emulator the **default** mobile regression gate and
reserves a physical handset for cellular behaviour, real camera capture and
release-signed Play identity — none of which this capture work touches.

`com.factorylm.mira.staging` on AVD `mira35` / Android 15, launched via its real
`MainActivity`, driven through its own WebView network stack:

```
ingress:    f4a1c988 arrived   -    → responded 200
lifecycle:  f4a1c988 started / closed/answered, packet=true,
            trace=a82d6917603a4914…, platform=hub_notebook_chat
```

A 422 in the same window bucketed correctly as a pre-accept rejection.

**No physical Pixel 9a is attached to this machine** (`adb devices` shows only the
emulator). Cellular, camera and Play-identity scenarios therefore remain unrun,
and are listed below rather than substituted.

## What is still not proven live

- **Provider timeout** — needs staging fault injection; no clean lever found.
- **Physical Pixel 9a** — no device attached. Emulator covered the capture path;
  cellular, real-camera and Play-signed-identity remain device-only.
- **THE OPEN CONTRADICTION.** While driving the emulator, three requests from a
  DIFFERENT tenant (`0e0d7d65`) returned **200 with no lifecycle row** — which my
  own metric scores as `lost_starts: 3`, against a headline of 0. `open_failed`
  was 0 in that container, and replay is not the cause (tested: replay does write
  a lifecycle). Their notebook ids were valid UUIDs, so the non-UUID defect fixed
  in this PR is not the cause either. **Unresolved.** Resolving it needs staging
  container logs, which prod-guard correctly blocks. Until it is explained,
  `lost_starts: 0` should be read as "0 for the tenant measured", not as a
  property of the system.
