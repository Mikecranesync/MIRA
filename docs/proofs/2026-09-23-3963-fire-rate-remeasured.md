# #3963 — `ungrounded_unit_claim` fire rate, re-measured

**Date:** 2026-09-23 · **Branch:** `feat/turn-capture-lifecycle`
**Asked for by the issue:** *"Apply the same all-zero exemption `unsupportedExactRating`
got, and re-measure the fire rate against the same 40-turn window before promoting it
above P3."* The exemption was applied; this is the measurement.

## Result

| predicate | fired | rate |
|---|---|---|
| **before** (first match decides, no exemption) | **23 / 40** | **57.5%** |
| **after** (every match judged, all-zero exempt) | **8 / 40** | **20.0%** |
| suppressed by the exemption | 15 | — |

**The new predicate never fires where the old one did not** — verified over the same
window, not assumed. So the change is a strict narrowing: it cannot have introduced a
new false positive, only removed old ones.

## Method

40 most recent answers with real text from staging `decision_traces`
(`platform IN ('hub_notebook_chat','hub_notebook_look')`, `length(recommendation) > 40`),
read read-only through `doppler run --project factorylm --config stg`. The script refuses
a host matching `prod|prd`, so this could not have run against production.

Both predicates were applied by the **real implementation** — the shipped
`ungroundedUnitClaim` from `anomalies.ts`, not a transcription of it — with the pre-fix
regex (`/\d+(\.\d+)?\s*(in|mm|cm|°C|V|A)\b/`, first match decides) as the control.

No answer text was retained: the working file was local and deleted, and only the counts
above are recorded.

## Comparability, stated honestly

This is **not literally the same 40 turns** the issue measured — those were a sweep of
Mike's own session on 2026-09-22, and that sweep tool (`tools/qa/session_issue_sweep.py`)
lives on the `feat/mira-intelligence-contract` branch, not here. This is a comparable
40-turn window from the same environment, one day later.

The control rate lands at 57.5% against the issue's reported 62.5% (25/40) — close enough
to treat the windows as comparable, far enough apart that the exact figure should not be
quoted as a reproduction of the original.

## What this does and does not settle

- **Settled:** the false-positive class the issue named is gone, and the detector no
  longer fires on the energy-isolation clause the persona requires. Fifteen of the
  twenty-three old firings were exactly that.
- **Not settled:** whether 20% is a *useful* signal. That is a triage judgment about
  whether `GENERIC_ANSWER_UNGROUNDED_CLAIM` should move above P3, and it belongs to
  whoever owns the alerting — not to this change. One in five answers still carrying the
  code is better than three in five, and may still be too many to alert on.
- **Unchanged:** the detector gates nothing. It is telemetry; no technician is affected
  either way.

## Reproduce

```bash
cd mira-hub
doppler run --project factorylm --config stg -- node ./pull-answers.mjs > /tmp/answers.json
# then apply ungroundedUnitClaim (anomalies.ts) and the pre-fix regex to each
```

The fix itself is `isZeroMagnitude` in
`mira-hub/src/capabilities/observability/anomalies.ts`, with its positive/negative cases
in `__tests__/anomalies.test.ts`.
