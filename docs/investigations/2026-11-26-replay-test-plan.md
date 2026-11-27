# Replay / field verification plan for PR #6030

**This document is a plan for checks that have NOT been run.** Nothing here was verified on staging,
production or a device. Local, synthetic evidence is described in
`docs/investigations/2026-11-26-notebook-false-refusals.md`.

## Why a field replay is still needed

The unit, route and real-SQL tests use controlled auth, controlled ordinary retrieval and a stubbed
provider with synthetic text. They prove the context, expansion, identity and hygiene behavior, not that
the real OEM manuals, the real ingest (page labels) and the real retrieval ranking line up.

## Replay cases (staging only, authorized session, real manuals)

For each case use an authenticated Hub notebook with the real manual attached and ingested, send the
question through the app (or the authenticated notebook chat endpoint), and record: the status, the
reply, the cited document and **physical page**, and whether the cited text contains the expected row.

| Case | Question | Expect |
|---|---|---|
| PowerFlex 525 F081 | "PowerFlex 525 showing F081, what does it mean and does it auto-reset?" | Answered; cites the fault table page; names F081 and its Type/reset behavior from the table |
| S7-1200 yellow LED | "the plc has a yellow light on and nothing is running is it broke" | Answered from the status LED table (solid yellow row) |
| GS10 P06.53 | "What is parameter P06.53 on the GS10?" | Answered from the parameter table row for P06.53 |
| Kinetix STO | "How do I wire the STO terminals on the Kinetix drive?" | Answered with the STO wiring page |
| PowerFlex 525 overcurrent (#5998) | "What causes overcurrent faults on a PowerFlex 525?" | **Open limitation:** if retrieval does not return the fault-table pages (161-162) the answer still cannot cite them. Record which pages were retrieved; this is a ranking question, separate from this PR |
| Cross-reference | A page that says "see page N" with the referenced page outside top-K | The referenced page's text reaches the answer and is cited at its physical page; a document without stored page labels gets no expansion |

Also check, per case: a technician question in a non-Latin script gets a same-language answer (no
"clean reply" failure text), and no answer contains "rewrite:" or an unexpected-script fragment.

## Not covered by the local tests (explicit)

- real provider behavior and latency; real manual page labels; real retrieval ranking;
- the shared-OEM lane and the asset, namespace, quickstart and hub-ask routes (not expanded);
- documents ingested without stored page labels;
- a physical-device or mobile walk.

Report results with the exact build SHA and the cited document/page for each case. Do not mark the PR's
field acceptance complete from local results.
