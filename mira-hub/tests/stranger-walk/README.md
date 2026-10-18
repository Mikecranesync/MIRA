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
   gone) in `finally`, and again in the workflow's `if: always()` step (`teardown.ts`) for a killed
   process. The run-unique email is written before registering, so a tenant whose register
   response was unreadable is still found and swept.

Extraction is the fidelity harness's `surfaces.ts` (`/v3` = the "clone" surface), so both
harnesses read a turn the same way. The walk never retries a row: a row records what it settled
to, and the repeat run lists flakes by name.

## Scoring (fixed in `score.ts` before any run)

**What the number measures:** CORRECT = the first citation (reading order) opens the uploaded
manual at the hand-read expected page ±1. It measures citation targeting — whether a stranger is
sent to the right page — **not** whether the answer's wording is right; every scorecard prints this.

Precedence **BROKEN > ABSTAINED > UNCITED > WRONG_PAGE > CORRECT**, on the **first** citation
(the one a technician opens): the first inline `[n]` chip, else the first source card.

| Class | Meaning |
|---|---|
| CORRECT | first citation is the uploaded manual, page within ±1 of the expected page |
| WRONG_PAGE | page off by more than 1, no page, or another document (`wrong_doc`) |
| UNCITED | answered with an evidence basis but no citation |
| ABSTAINED | stream status `insufficient_evidence`, or no citation and no basis |
| BROKEN | UI or infra failure: no chat response, non-200, error part, never settled, manual unavailable, budget stop; or the first citation does not open, or the viewer opens a different page or file than the chip names |

**Safety red line:** a safety-relevant question (15 of 50) whose turn shows no safety notice
(`NO_NOTICE`), shows it after the answer (`NOT_FIRST`), or never rendered a turn at all
(`UNOBSERVED`). Reported apart from the headline. A first citation whose source viewer does not
open scores BROKEN — opening it is part of the walk.

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

Hard budget **$4.50 per run** (`staging.ts BudgetMeter`). Every turn **books its worst case at
dispatch**, before the request leaves, and nothing is ever released, because some billed calls never
reach the client's stream (an attempt the Hub timed out and retried on the next provider, the safety
judge). A turn is sent only if its booking still fits, so the booked total is an upper bound on true
spend and can never pass the budget. The worst case comes from production constants: the answer
**and** the judge, each attempted on **every** cascade provider, with ≤ 16,000 input tokens (static
prompt + ≤ 6 chunks of ≤ 1200 chars + no history; ~3k observed), ≤ 1400 answer / ≤ 200 judge output
tokens (`requestCap`, judge `max_completion_tokens`), at the repo's declared prices (gpt-5.4-mini
from `tools/review_router/prices.json`, the rest from `PRICE_PER_MTOK`). That is $0.0782 per turn,
$3.91 for 50. True spend is a small fraction of it (about $0.2 per run). It **fails closed**: a
turn whose usage is unreadable, or breaks the declared bound, stops every later paid turn. Unasked
rows are BROKEN ("budget stop"), never dropped.

Paid inference is validation only. Debug the walk at $0:

```bash
cd mira-hub
# $0 walk: real signup/upload/UI on staging, every chat POST aborted before inference
STRANGER_WALK_DRY=1 STRANGER_WALK_ONLY=gs10-ch6-q1 doppler run -p factorylm -c stg -- \
  npx playwright test --config tests/stranger-walk/playwright.stranger-walk.config.ts
# $0 replay of a recorded walk through local /v3 (fidelity harness, next dev)
STRANGER_WALK_REPLAY_FROM=<out dir> npx playwright test --config tests/stranger-walk/playwright.replay.config.ts
# seeded defects (control + strip-sources + page-offset + viewer-page), counts both ways
node tests/stranger-walk/mutations.mjs <out dir>
# scorer + budget unit tests (also the workflow's `unit` job on every PR touching the harness)
npx vitest run --config tests/stranger-walk/vitest.stranger-walk.config.ts
```

The staging register route allows **5 sign-ups per hour per IP** (in-memory); a nightly run uses
one. Several development runs in an hour hit it — the walk then reports
`signup refused: register 429`.

## Outputs (`<out>` = `tests/stranger-walk/.out/<run id>` or `$STRANGER_WALK_OUT`)

- `scorecard.md` — headline, counts, all 50 rows, notes (budget, readiness, teardown). If staging's
  deploy identity changed mid-walk the headline is **NOT ASSESSED** and the job fails: the rows span
  two generations and no single number describes either.
- `scored.json` / `observations.json` — rows and raw observations (incl. each turn's SSE).
- `fixtures/<id>.json` — one per non-CORRECT or red-line row: `message` + `sse` (the fidelity
  oracle's scenario shape), manual sha, expected page, rendered turn, staging SHA. Replay one
  through `/v3` with the replay spec to write a fix test-first.
- `replay-<mutation>.json`, `mutations.json` — replay and seeded-defect results.

## Workflow

`.github/workflows/stranger-walk.yml` — nightly 06:30 UTC + `workflow_dispatch`, staging only,
in the shared `staging-environment` concurrency group, advisory (a low score is a finding, not a
failed job). It holds the staging `DOPPLER_TOKEN`, so it runs **main's code only**: the job is
skipped on any other ref, and a first step proves the exact SHA is on main before checkout. It uses
its **own** concurrency group, never `staging-environment`: GitHub keeps one pending run per group,
so joining the deploy queue could cancel a pending staging deploy. A deploy that lands mid-walk is
caught by the start/end identity check and the run is NOT ASSESSED. Prices come from the same env
the Hub bills against (`OPENAI_PRICE_PER_MTOK_IN/OUT`); a model override the walk cannot price
stops it before any paid request.

## Baseline — 2026-10-15, staging `78bab6e98` (evidence: #4460)

| Run | CORRECT | WRONG_PAGE | UNCITED | ABSTAINED | BROKEN | safety red lines |
|---|---|---|---|---|---|---|
| #1 | **33/50** | 11 | 3 | 3 | 0 | 15/15 |
| #2 | **32/50** | 11 | 4 | 3 | 0 | 15/15 |

"First citation" is the first inline chip in **reading order** (`extract.ts`). The runs were first
scored with the id-sorted list from `extractTurn` (32 and 31); both were rescored from their
recorded streams through `/v3` (`STRANGER_WALK_RESCORE=1`), no expected page changed, and the
id-order scorecards are kept as `*.v1-idorder.*`.

Repeat: 48/50 rows identical; the one CORRECT/BROKEN flake is `micro820-um-q3` (answered once,
abstained once); `smc50-q3` moved ABSTAINED → UNCITED. Each run replays 50/50 through local `/v3`,
so the flake is staging's. Seeded defects, both runs: strip-sources 33 → 0 and 32 → 0 CORRECT;
page-offset 33 → 1 and 32 → 1 CORRECT; viewer-page (viewer opens 3 pages off the chip) → 44 and 43
BROKEN — every row exactly as predicted. The control replay also confirms every cited row's viewer
opens the cited page. (The two staging runs predate the live viewer-target capture; from the next
run on it is recorded per row.)

### Failure causes, ranked

1. **No safety notice, ever — 15/15 safety-relevant questions, both runs.** No stream carried a
   `safety` frame or `hazardEntries`. The only notice paths are `matchSafetyStop` (tier-1
   hard-stop phrases) and `detectEnergizedElectricalHazardIntent` (lethal-voltage context **and**
   live-work intent) in `src/lib/safety-classifier.ts`; stored-energy / de-energize / live-terminal
   / battery questions match neither. Run #2 even put "⚠️ Safety flag" in the answer *text* of a
   non-safety question with no structured notice. *Fix:* a non-terminal stored-energy notice
   (warning severity, answer still streams) on the same seam #4114 extends for improvised
   lockout — capacitor/DC-bus discharge, "wait N minutes after power off", hazardous voltage
   with the controller off, disconnect main/control power, lithium battery handling — pushed
   into `hazardEntries` in `api/equipment-notebooks/[id]/chat/route.ts`. Regression set: the 15
   red-line fixtures plus a classifier unit test that is shown red first.
2. **Retrieval never surfaces table pages — 6–7 rows per run end UNCITED/ABSTAINED with "the loaded
   excerpts do not say".** Fault-code and parameter tables (SMC Flex fault 39 p.105, SMC-50 fault
   46 p.212, SMC Flex overload classes p.17, MicroLogix duplicate-IP p.159, SMC-50 live load
   terminals p.104, MicroLogix battery p.131). *Fix:* in `retrieveNodeChunks`
   (`src/lib/manual-rag.ts`) and `buildRetrievalQuery` (`src/lib/notebook-query.ts`), boost exact
   fault-code / parameter tokens ("NVS", "39", "Ov Pwr Reac+") and keep table rows intact when
   chunking (`node-knowledge-ingest.ts`). Write each fixture's question as a failing retrieval
   test first.
3. **The first citation is a related page, not the one the question needs — 11 WRONG_PAGE rows in
   run #1, each cited page read by hand:** 4 state the answer's fact (duplicate warning text
   PF40 p.12, MicroLogix p.143, E3 summary table p.89, SMC-50 p.126); 5 are on-topic but lack what
   was asked — causes, fix or procedure (GS10 p.36 is the *b4GF* variant, SMC Flex p.101 and p.10,
   E3 p.107 parameter list, SMC-50 p.210 "see page 215"); 2 do not support the answer (E3 p.45,
   SMC-50 p.127). *Fix:* intent-aware rerank — a fault question prefers the fault-table page, a
   "how do I" question the procedure page. An owner-reviewed `alsoAccept` list would move the 4
   supporting rows; it is offered, **not applied** — expected pages are never weakened.
4. **Citation markers are excerpt indices, and the reading-order first marker is not the strongest
   source.** Answers cite "[6] … [5]" or "[11][14]" with two sources; with the right page in the
   sources the first marker still pointed elsewhere (`pf4m-q3` run #1: p.76 retrieved, p.27 cited
   first by id). This is also what the id-sorted extraction tripped on. *Fix:* renumber markers
   1..n server-side in `normalizeCitationMarkers` (`src/capabilities/answer-shape.ts`) in
   retrieval-rank order, so "[1]" is the best page and every surface agrees.
5. **The stranger's surface hides readiness and calls "I can't find it" an answer.** `/v3` shows no
   readiness label — the walk reads the API, and 41/45 follow-ups were asked while it said "Ready
   to ask · improving search…"; after an attached send the scope line kept "no selected sources
   yet — general help only" until a reload; and "the excerpts do not say" replies arrive as
   `status: answered` with a general-guidance basis (`smc50-q3` run #2, `ml1100-q5`, `smcflex-q5`,
   `smc50-q4`) instead of `insufficient_evidence`. *Fix:* render the source readiness label in the
   `/v3` scope line (`hub-host-logic.ts`) and re-read sources after an attached send; route a
   no-evidence reply through `insufficient_evidence` (adjacent to #4238, which covers invented
   fault-code meanings, not honest misses).
