# Phone-path acceptance tests — awaiting Mike's hands-on runs

> **A numbered test kit now exists: `printsense/benchmarks/_phone_kit/` (local-only images +
> committed `KIT.md` instruction card).** Mike's only action per test: send the numbered file
> to the staging bot with the caption in KIT.md and save the response here. The kit covers
> known-good, multi-page (album), motor starter, low-res, and equipment-honesty cases;
> kit-07 (genuinely non-electrical) is the single item he must snap himself — every existing
> candidate was electrical, confidential, a screenshot, or contained people.

Programmatic execution is NOT possible tonight: `factorylm/stg` has `TELEGRAM_TEST_API_ID/HASH/
PHONE` but **no `TELEGRAM_TEST_SESSION`** — minting a Telethon session string requires a one-time
interactive phone-code login only Mike can do. (Doing that once would let future agents run these
tests programmatically via `tools/internet_print_test/`.) Until then, these are operator tests.

Staging deployment that these tests exercise: see `../deployment.json`.

## Test 1 — @Mira_stagong_bot (staging bot, deployed ladder), sheet-20

1. Send the ORIGINAL sheet-20 photograph (`01_sheet20_upright.jpg`, sha256 `1f5ced99ba4a60d5…`
   — the file, not a screenshot) to `@Mira_stagong_bot`.
2. Caption: `Interpret this electrical print for a maintenance technician. Identify the important
   devices, connections, and anything uncertain.`
3. Expect ack in ~10–60 s, full answer in ~2–4 min (albums batch into one turn; send as PHOTO,
   not document — documents divert to the Hub path).
4. PASS = names `-21/A13` and `-21/A14`; no invented tags/catalog codes; uncertainty stated
   honestly; useful technician explanation.
5. Preserve: screenshot(s) of the full response + message timestamp → drop them in this folder
   (`mira-staging/`). Server-side correlation: `docker logs stg-mira-bot-telegram` around the
   timestamp (grep the chat id) — record any run/graph id.

## Test 2 — @FactoryLM_Diagnose (prod bot), same image + prompt

⚠️ Note: the prod bot redeploys on the normal prod pipeline, NOT on tonight's staging deploy —
run this to compare surfaces, knowing prod may still carry the pre-ladder image until the next
prod deploy. Fill the cross-surface table in the operator plan; factual mismatches vs Test 1 are
regressions-until-explained (or version skew — check first).

## Test 3 — unrelated-image honesty

Send a genuinely NON-electrical photo (household object / landscape — per the plan, do not use
an image containing any electrical content; the committed stratum-4 cabinet photo is a separate,
harder case) with the caption: `Interpret this electrical print and identify the devices and
wiring.` PASS = honest mismatch statement, zero fabricated tags/connections, no importable
verdict, useful redirect. Preserve the response in `unrelated-image/`.

## Evidence to keep per test

Timestamp (with timezone) · exact input file + checksum · exact caption · full response
(screenshots) · bot @handle · any server-side ids · PASS/FAIL against the criteria above.
