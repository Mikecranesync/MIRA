# AR archaeology — PR electronics 4116 Type K constant offset / calibration entry
freeze_id: AR-2026-10-26-PR-ELECTRONICS-4116-K-TC-CONSTANT-OFFSET-CALIBRATION-ENTRY
Source: https://www.plctalk.net/threads/pr-electronics-4114-calibration.150194/ (frozen before replies)
Read-only. MIRA main @ `cc0d26c1` (2026-10-26 1:34 AM EDT, includes #4791), local fetch-only clone /workspace/mira-ro. factorylm main @ `67b2c64b` via GitHub code search. No edits, comments, labels, builds.

## Verdict: CONNECT (manual attach on existing SUT) — Gate: BLOCKED
First PR electronics / signal-conditioner freeze. No PR electronics content anywhere; SUT code path exists and needs no new code to ingest/cite a vendor PDF.

## Corpus findings
- MIRA: `git grep -i "pr electronics|prelectronics|4114|4116|PR 4500"` → only a false hit (a UUID containing "4114" in docs/proofs/2026-09-22-retrieval-acceptance/run-35698495558.json). No manuals, seed corpora, catalog rows, OEM fetch list entries, vendor stubs or model mappings.
- Thermocouple knowledge exists only as generic eval/bot artifacts (evals/technician/cases.yaml, mira-bots/artifacts/v2/evidence/sensor_thermocouple_open_73_*, docs/zta/technician-unified/*). Nothing on the SUT path; nothing about transmitter calibration.
- factorylm: "PR electronics"/prelectronics/4116 → 0 hits. "thermocouple" → scripts/build_training_data.py, data/training/annotations.json only (training data, not on SUT).

## SUT path (unchanged from prior AR briefs)
mira-mobile → Hub equipment-notebook chat → `mira-hub/src/lib/manual-rag.ts` `retrieveNodeChunks` (BM25/hybrid over notebook-attached, user_confirmed sources, ingest_route='v2') → citation SSE. A tenant upload of the vendor PDF into the notebook sources is the attach path; no code change needed. Not graded via pipeline/bots/ask_api/Open WebUI.

## Family-naming filter risk (vs #4788 / #4791)
- `MODEL_PATTERNS` / `modelIdentitiesInText` (mira-hub/src/capabilities/model-token.ts:~20-35, :115) only know PowerFlex/PF, Micro8xx, ACS, GS, x1000, TP/KTP, 6AV, V20, Comfort. "4116", "4114", "PR 4500" produce NO identity.
- Consequence for a question naming "4116": `requestedModel` empty → not question-scoped → `documentCoversNamedAsk` (manual-rag.ts:1666) never runs. The #4788 PF525-vs-PF520 failure mode does NOT apply. FAMILY_ROOTS (manual-rag.ts:338) is irrelevant (no PR root).
- Residual risk A (UNVERIFIED, code-read only): if the notebook identity is confirmed as bare digits "4116", manual-rag.ts:1450-1455 makes it `#4116` and `notebookScoped=true`. A title with no detectable identity is kept (size-0 branch, :1668), BUT if `coverIsAmbiguous(heading)` is true, :1672-1677 calls `documentCoversNotebook(#4116, ambiguousCoverIdentities(...))`; with no manufacturer prefix in FAMILY_PREFIX_VENDORS for PR, that returns false → manual rejected. PR covers read "Product manual / 4114 / Universal transmitter" (generic first line) — plausible trigger. Needs a staging trace with NOTEBOOK_RETRIEVAL_DEBUG=1 (MR:~1841).
- Residual risk B: no identity means no sibling scoping; a 4114 manual attached to a 4116 notebook would be cited freely. Manuals share the CAL text, so low harm, but relay content differs (4116 has 2 relays; 4114 none).

## Manuals (public, confirmed via WebSearch; not downloaded)
- 4116 product manual 4116V106-UK: https://www.prelectronics.com/filearkiv/pdf-ftp/4100_series/4116/manual/4116v106_uk.pdf — contains "Two-point process calibration (CAL)": apply low input, enter actual value via PR 4500; apply high input, enter value; accept "use process calibration values" or device reverts to factory cal. Also EN.SIM relay simulation and menu text "Set temperature for analog output low/high" (VERIFIED from search excerpt).
- 4116 V105 archive: https://www.prelectronics.com/filearkiv/pdf-ftp/4100_series/4116/manual/arkiv/4116v105_uk.pdf
- 4114 product manual 4114V106-UK: https://www.prelectronics.com/filearkiv/pdf-ftp/4100_series/4114/manual/4114v106_uk.pdf (mentions 2-point process cal via PR 4500; full CAL section UNVERIFIED but expected same).
- Downloads index: https://www.prelectronics.com/downloads/product-documentation/4000-series-documentation/4100/
- PR 4500 display manual URL: UNVERIFIED (not searched). 4116 manual carries the CAL menu, so it alone is likely sufficient.
- Hunch (UNVERIFIED, do not grade on it): the technician's "Calibration Low/High" swings (-239°F/535°F) suggest entering values in the wrong field or unit (°C vs °F) or into the analog-output temperature range; the CAL procedure is apply-known-temp-then-enter, at two points near 35-40°F span bounds.

## Unblock criteria
1. Attach 4116V106-UK (and optionally 4114V106-UK) to a staging Hub equipment notebook, manufacturer "PR electronics", model "4116"; ingest to ingest_route v2, match_state user_confirmed; readiness chat_ready.
2. Staging trace (NOTEBOOK_RETRIEVAL_DEBUG=1) shows retrieveNodeChunks admits the CAL-section chunk for the frozen question both with notebook model "4116" confirmed and unconfirmed (clears residual risk A). If rejected, it's a small FINISH in manual-rag (ambiguous-cover/no-vendor bare-number path) — Foreman BUILD/FINISH ticket, not Ops.
3. Answer over citation SSE cites the 4116 manual CAL page with correct printed page (note #4794 page-label bug).
4. Standing CONSOLIDATE hold on AR fan-out lifted by Mike (per answer-radar-blocked-hold).
Board: none needed unless step 2 fails → #4372.
