# P1 baseline — production `8ca0b52be` (2026-10-18)

**Tested build:** `https://app.factorylm.com` reporting `gitSha 8ca0b52be0913103b86d7325e6ef8a83440bffa9`,
`version 3.405.5`, `builtAt 2026-10-17T00:13:48Z` (`/api/health`, read at run time).

**Why the manifest and report say `eb6e2ed2b`:** `release_gate.py` did not pass `--sha` to
`run_technician.py`, which then auto-detected the *checkout's* HEAD (`origin/main` = `eb6e2ed2b`) instead of
the build under test. Fixed in this PR (`build_run_technician_cmd(..., sha)`); the archived manifest is left as
it was written so the artifact is honest about what the tool recorded.

**Judge:** the first judge pass was a **vacuous PASS** — Groq returned HTTP 400 for `openai/gpt-oss-120b` on all
40 cases, the report showed `40 unscored`, `0 dangerous / 0 cases`, and still printed RELEASE CANDIDATE.
Re-judged with `--rejudge` through the OpenAI lane (`gpt-5.4-mini`, `judge_url`/`judge_model` now recorded in
`scores/_summary.json`). Because the judge model changed, the +6.5 technician-score delta against the
September `f06922ac6` baseline is **not** like-for-like; treat this run as the new baseline and compare future
runs against it.

**Eval notebook:** `a299a2af-5285-4de2-ba43-9c48d85edbad` ("BASELINE EVAL f06922ac6 (VFD corpus)", 2 sources).
Grounded correctness 0% is a property of that corpus — the 11 `must_cite` cases cover other equipment and all
abstained correctly — not evidence that grounding is broken. The next baseline needs a notebook whose sources
cover the grounded cases, or cases scoped to the sources it has.

**Spend:** 40 production chat turns (prod provider keys) + 40–50 judge calls on `gpt-5.4-mini` from
`factorylm/stg`; well under the declared $10 budget for the day's baseline work.
