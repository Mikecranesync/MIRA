# Marketing capabilities file

Source of truth: `mira-web/src/capabilities/marketing-claims/capabilities.json`.

The factorylm.com homepage, `/limitations`, schema.org JSON-LD, `/llms.txt`, and `/llms-full.txt` all read this file. **Every rendered sentence is a claim.** Generators join `slots.*` claim ids and print a sentence only when that claim's `status` is `proven` or `proven-dated`. Partial and not-yet rows stay in the file so a daily steward can promote them later — they must not appear as published sentences. `/llms-full.txt` lists those unpublished **ids** under **Not yet claimed** and repeats every proven `kind: limit` row under **Full limitations**. It still publishes no prices.

The headline slot is `answers-from-uploaded-manual` (P3 qualified-manuals-only / A8, P4 magic-link sign-in). The older `notebook-for-one-crew` line stays `partial`. The optional `cited-micro810-oct19` row is prepended when present; drop that commit (or that row) and the dated line disappears.

This JSON is the machine-readable registry that the 2026-10-20 Search Steward audit expected as `marketing/capabilities.md`. Do not create a second list.

The 2026-10-21 steward check locked the published `proven` set to: the P3/P4 notebook headline; not a CMMS (A5); no PLC data and no work-order writes (A6); tested Rockwell and Festo manuals so far (A8); Mike onsite in Central Florida or remote (A9); magic-link web sign-in. A1 (cited answers in general) stays HOLD.

## Record shape

| Field | Required | Notes |
|---|---|---|
| `id` | yes | kebab-case, unique |
| `text` | yes | the exact sentence a page may print |
| `status` | yes | `proven` \| `proven-dated` \| `partial` \| `not-yet` |
| `kind` | yes | `capability` (what it does) or `limit` (honest constraint) |
| `evidence` | yes | repo path, PR URL, or spec. No empty strings |
| `last_checked` | yes | `YYYY-MM-DD` |

`slots` is a map of claim-id arrays (`headline`, `subhead`, `meta`, `audience`, `jsonld_description`, `jsonld_features`, `llms_intro`, `llms_who`, `llms_show_today`, `llms_does_not`, `limitations`). Contact (`cta`, `email`, `href`) and `chrome.ai_note` are not product claims.

## Daily update process

A scheduled steward will open a **new draft PR** when a status should change. Humans still merge.

1. Edit only `mira-web/src/capabilities/marketing-claims/capabilities.json`.
2. Change `status` and set `last_checked` to today. Point `evidence` at the proof (test, PR, or live walk).
3. Promote to `proven` only when a stranger can do it on the live product without Mike patching anything.
4. From `mira-web/`: `bun run scripts/generate-capabilities-artifacts.ts` — rewrites `public/llms.txt` and `public/llms-full.txt`.
5. From `mira-web/`: `bun test src/capabilities/marketing-claims/capabilities.test.ts src/views/__tests__/home.test.ts src/views/__tests__/honest-claims.test.ts`.
6. Open a **draft** PR stacked on the current marketing-copy branch. Do not merge or deploy from the steward.

If the drift test fails, the generated llms files are stale — rerun step 4. Do not hand-edit those two files.

## What must never go in a `proven` row

Prices, money-back guarantees, competitor product names, CMMS write-back, PLC tag mapping, documentation-chunk counts, OEM logo walls, unlimited queries, the 480 V photo demo, Telegram/Slack as answer surfaces, or an any-manual promise. Those stay `not-yet` or `partial` until the product can do them.

Never route customer content through OpenRouter `:free` models. This file is copy, not inference.

## Lifecycle note

The JSON and generator live under `mira-web/src/capabilities/` (the non-presentational seam). Homepage copy still renders through the existing `mira-web/src/views/home.ts` + `public/llms*.txt` path.
