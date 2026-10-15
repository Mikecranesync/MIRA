# Stranger Walk — the beta gate as a number (#4460)

Root `CLAUDE.md` says the beta gate is "MET on the retrieval path; NOT MET on the product surface".
This harness measures that gap: a brand-new technician on **staging**, through the real `/v3`
UI, uploads public OEM manuals, asks questions whose answer page was read by hand, and opens the
first citation. One number, nightly: **CORRECT / 50**.

## What a run does

1. **Sign up** on `/signup/` as `strangerwalk-<run id>@factorylm.com` (a fresh throwaway tenant;
   its id is written to `<out>/tenant.txt` immediately).
2. **Per manual** (10): *New project* → attach the manual to the **first question** (in `/v3`
   the upload rides the send — `hub-attachments.ts`; there is no separate upload step).
3. **Per question** (5 per manual): *New chat* (fresh thread, no history), wait until the
   project's source reads `canChat` / **"Ready to ask"** (the readiness the page itself fetches —
   `/v3` shows no readiness label; see Findings), ask, wait for the answer to settle, record the
   rendered turn, open the first citation and check the source viewer opened.
4. **Teardown** — `scripts/provision-beta-gate.ts --cleanup <tenant>` (verifies auth + data rows
   gone) in `finally`, and again in the workflow's `if: always()` step for a killed process.

Extraction is the fidelity harness's `surfaces.ts` (`/v3` = the "clone" surface), so both
harnesses read a turn the same way. The walk never retries a row: a row records what it settled
to, and the repeat run lists flakes by name.

## Scoring (fixed in `score.ts` before any run)

Precedence **BROKEN > ABSTAINED > UNCITED > WRONG_PAGE > CORRECT**, on the **first** citation
(the one a technician opens): the first inline `[n]` chip, else the first source card.

| Class | Meaning |
|---|---|
| CORRECT | first citation is the uploaded manual, page within ±1 of the expected page |
| WRONG_PAGE | page off by more than 1, no page, or another document (`wrong_doc`) |
| UNCITED | answered with an evidence basis but no citation |
| ABSTAINED | stream status `insufficient_evidence`, or no citation and no basis |
| BROKEN | UI or infra failure: no chat response, non-200, error part, never settled, manual unavailable, budget stop |

**Safety red line:** a safety-relevant question (15 of 50) whose turn shows no safety notice
(`NO_NOTICE`) or shows it after the answer (`NOT_FIRST`). Reported apart from the headline.

## Corpus (`corpus.json`, frozen 2026-10-15 before the first staging run)

10 public OEM manuals × 5 questions: 4 VFD (GS10 ch.6, PowerFlex 40, PowerFlex 4M, ABB ACS355),
3 PLC (Micro820 UM, Micro820 install, MicroLogix 1100), 3 motor starter (SMC Flex, E3/E3 Plus,
SMC-50). **Expected page = 1-based physical PDF page** — the unit ingest stores
(`node-knowledge-ingest.ts`, `page: p + 1`), not the printed folio. Each question carries an
`anchor` string that the generator verified is on that page. PDFs are **not committed**: each
entry has its OEM URL and sha256; a changed or missing PDF scores BROKEN, never a silently
different corpus. Never weaken an expected page to raise the score — fix the product or change
the question in its own reviewed commit.

## Spend (zero-token rule)

Hard budget **$3.00 per run**, enforced as a turn cap (`staging.ts`: ≤ $0.05 ceiling per turn —
gpt-5.4-mini plus the safety judge plus a possible cascade fallback, deliberately high — so at
most 60 turns; 50 are needed). Unasked rows are BROKEN ("budget stop"), never dropped.
Paid inference is validation only. Debug the walk at $0:

```bash
cd mira-hub
# $0 walk: real signup/upload/UI on staging, every chat POST aborted before inference
STRANGER_WALK_DRY=1 STRANGER_WALK_ONLY=gs10-ch6-q1 doppler run -p factorylm -c stg -- \
  npx playwright test --config tests/stranger-walk/playwright.stranger-walk.config.ts
# $0 replay of a recorded walk through local /v3 (fidelity harness, next dev)
STRANGER_WALK_REPLAY_FROM=<out dir> npx playwright test --config tests/stranger-walk/playwright.replay.config.ts
# seeded defects (control + strip-sources + page-offset), counts both ways
node tests/stranger-walk/mutations.mjs <out dir>
# scorer unit tests
npx vitest run --config tests/stranger-walk/vitest.stranger-walk.config.ts
```

The staging register route allows **5 sign-ups per hour per IP** (in-memory); a nightly run uses
one. Several development runs in an hour hit it — the walk then reports
`signup refused: register 429`.

## Outputs (`<out>` = `tests/stranger-walk/.out/<run id>` or `$STRANGER_WALK_OUT`)

- `scorecard.md` — headline, counts, all 50 rows, notes (budget, readiness, teardown, SUPERSEDED).
- `scored.json` / `observations.json` — rows and raw observations (incl. each turn's SSE).
- `fixtures/<id>.json` — one per non-CORRECT or red-line row: `message` + `sse` (the fidelity
  oracle's scenario shape), manual sha, expected page, rendered turn, staging SHA. Replay one
  through `/v3` with the replay spec to write a fix test-first.
- `replay-<mutation>.json`, `mutations.json` — replay and seeded-defect results.

## Workflow

`.github/workflows/stranger-walk.yml` — nightly 06:30 UTC + `workflow_dispatch`, staging only,
in the shared `staging-environment` concurrency group, advisory (a low score is a finding, not a
failed job). It only runs once on the default branch.
