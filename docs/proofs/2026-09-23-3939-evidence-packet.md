# #3939 — final evidence packet

**Branch:** `feat/turn-capture-lifecycle` · **PR #3964** · **head `18e964b94a89bb2461c519a1e027206db06f2d9d`**
**Deployed staging SHA:** `a83cb617c79fde4f95ac496c5e909463890f43d2`
**Website origin (tested):** `https://app-staging.factorylm.com`
**Production:** `0178b1b0776f30cccde42c8d255031254b882a38` — **untouched**, and
`/api/health` there reports `telemetry: None`: **no recorder exists on production.**

## Config, flags, migrations, exporter

| | |
|---|---|
| `MIRA_TURN_RECONCILER` | `1` (staging) |
| `MIRA_OTEL_CAPTURE_CONTENT` | `0` — no content leaves the tenant |
| `MIRA_JEV_SHADOW` | `1` — recorded, never consulted |
| exporter | `https://us.cloud.langfuse.com` (restored byte-for-byte after the outage test) |
| migrations applied to staging | **090** 09-22 02:52 · **091** 09-23 00:05 · **092** 09-23 00:19 · **093** 09-23 01:00 · **094** 09-23 04:42 |

**Migration 091 status: applied, and not re-appliable.** It creates
`UNIQUE (attempt_id)`, which 092 replaces because a turn is two rows. Any re-apply
against a database holding lifecycle data fails. This blocks PR CI — see
*Remaining approval*.

## Client surfaces

| | |
|---|---|
| Android package | `com.factorylm.mira.staging` (prod flavour `com.factorylm.mira` also installed) |
| version | `1.2.0`, versionCode `11`, installed 2026-09-21, updated 2026-09-22 |
| device | **AVD `mira35`, Android 15.** No physical Pixel 9a is attached to CHARLIE (`adb devices` → emulator only) |

The app build predates this work and that is fine: the recorder is **server-side**,
so an older client still exercises the capture path end to end.

## Coverage matrix — every attempt accounted for

Harness matrix, run in CI on the deployed SHA (run 35818864173, **all steps green**):

```
scenario                  http  att  acc  gen  per  sent  recv  outcome
A_photo_look               200  yes  yes  yes  yes   yes   yes  answered
B_text_followup            422  yes  yes   no   no   yes    no  error
C_failed_upload            415  yes   no   no   no   yes    no  pre-accept
D_malformed_json           400  yes   no   no   no   yes    no  pre-accept
E_unauthenticated          401  yes   no   no   no   yes    no  pre-accept
F_client_cancel            422  yes  yes   no   no   yes    no  error
G_reconnect_same_id        422  yes  yes   no   no   yes    no  error
PASS — every served turn reached the ledger
```

| goal scenario | surface | evidence |
|---|---|---|
| 1 normal question | **website** | trace `7d44f29bb812cce6ef4f0d888dad8db5`, full lifecycle + packet |
| 2 photo + question | **emulator** | look `35625de6` + chat `e8372688`, traces `d8eacfe32d618f3d…`/`699cc9580b971e92…` |
| 3 bearing-photo follow-up | emulator + API | 3/3 reproduced without history, 3/3 correct with it |
| 4 failed upload | API | 415, pre-accept, joinable by client id |
| 5 **timeout** | — | **unimplemented — see below** |
| 6 cancel | emulator + website | `cancelled` (pre-commit) vs `answered` (post-commit) |
| 7 reconnect | emulator + API | relaunch; replay closes `superseded` |
| 8 process crash | staging | `abandoned=7`, 0 stale starts |
| 9 exporter outage + replay | staging | 2 turns, 2 attempts, **no duplicates**, restored |

**Duplicate / missing / unfinished counts (operator-wide):**
`lost_starts 0 · server_error_no_start 0 · starts_without_arrival 0 ·
accepted_unfinished 0 · duplicates 0 (one lifecycle per attempt) · close_rate 1`

## #3962 — root cause, from traces

Six runs, one variable. **Without client `history`: drive answer 3/3. With it:
bearing answer 3/3.** The observation reaches the model but describes a *label* —
"bearing" appears in **0 of 4** identical LOOK calls because the text is truncated
at "Bea…". The identification lived in turn 1's **answer**, and `history_turns: 0`
is where it is lost. `history` is client-supplied; the server recalls the
observation but not the interpretation.

Detection shipped: `DOCUMENTS_IN_CONTEXT_UNCITED` (deterministic) and
`ANSWER_IGNORED_VISUAL_EVIDENCE` (versioned assessment). The latter caught **1 of
3** live reproductions — stated, not rounded up. **No vocabulary padding.**

## #3963 — exemption attacked

24 adversarial attempts demanding exact settings. **No zero-valued machine setting
slipped through**; every zero was an energy-isolation check. The detector still
fires on non-zero specifics (`2mm`, `0.05mm`, `80 °C`, `24 V`), so narrowing did
not blind it. 21/24 hedged. Two raw flags, both adjudicated by hand as artifacts
of the harness, **not tuned away**.

## Client received / acknowledged

**The gap is demonstrated, not asserted.** A website turn where the technician
navigated away after the commit point is recorded `answered`, `responded 200`,
packet written — attempt `dfe90808`, trace `de147a12cdf93be7f8579bd770e4348a`.
Every fact true; none is evidence it arrived. `generated` and `sent` are recorded;
**`received` is not, on either client.** Only the harness records its own receipt.

## Jev decisions

| improvement | decision |
|---|---|
| lifecycle / ingress / reconciler / #3963 | **REJECT** — counting is counting |
| `DOCUMENTS_IN_CONTEXT_UNCITED` | **REJECT** — deterministic, free, 0 ms |
| release or safety gating | **REJECT** — rule, not a trade-off |
| evidence-vs-answer consistency | **ADOPT-CANDIDATE**, blocked on approval |

Measured: wrong-answer `noul` 0.053 vs right-answer 0.710 (separation 0.657,
stable over repeats), p50 **216 ms**, **$0.000017/call**. Contrast: Jev's shipped
*sufficiency* question scored 19/19 disagreements — no discriminative power. Two
different questions, two different results. **Blocker: this requires exporting
answer text to a third party, which the shipped shadow deliberately never does.**

## Regression / deployment acceptance

- `capture_acceptance.py` runs in `retrieval-acceptance.yml` after every staging
  deploy, on the deployed SHA. Run 35818864173: six retrieval scenarios **ALL
  PASS** + capture step **PASS**.
- Real-Postgres integration suite **12/12** (migrations 019→094 from real files),
  with negative controls on the lost-start detector and the tenant predicate.
- Hub unit suite **3291/3291**.
- `outcome-reachability.test.ts` pins which outcomes the code can produce.

## Blind spots

1. **`timeout` is declared and never written.** The cascade has no timeout
   concept, so a slow provider closes `error`. An empty bucket is **not** evidence
   of no timeouts. Producing it means adding a provider timeout — a behaviour
   change, not a capture fix.
2. **No physical Pixel 9a.** Cellular, real-camera and Play-signed identity unrun.
3. **Client acknowledgement unbuilt** — see above.
4. **Content references unbuilt.** The packet reconstructs the decision path, not
   inputs/outputs, because it stores neither. Full reconstruction needs
   tenant-scoped content refs (#3939 item 4). `contentCapture` stays `0`.
5. **Website has no photo affordance** — zero `input[type=file]` on notebook chat.
   LOOK is mobile-only, so photo-on-website is not a skipped test.
6. **Middleware 401s are outside every number.** Edge runtime, no durable write
   possible. The denominator is requests that reached the route handler.

## Exact remaining approval required

1. **Migration-replay path for PR #3964** — amend 091, move 091+092 to #3959, or
   make `migration-verify` honour the ledger. Each breaks an immutability rule or
   a gate.
2. **`legacy-ui-exception` label** on #3964.
3. **Independent review lane** — Gate 7 ran at exact head (4 findings: 1 refuted,
   3 fixed); Codex returns Sep 26; the carve-out expired Sep 13.
4. **Provider timeout** — build it, or drop `timeout` from the union.
5. **Jev answer-text export** — required before the ADOPT-CANDIDATE ships.
6. **Production** — migration/config/deploy/rollback prepared in `HANDOFF.md`,
   **not executed**. Prod also needs a build containing the recorder.
