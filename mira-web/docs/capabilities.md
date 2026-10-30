# Marketing capabilities file

Source of truth: `mira-web/src/capabilities/marketing-claims/capabilities.json`.

The factorylm.com homepage, `/limitations`, schema.org JSON-LD, `/llms.txt`, and `/llms-full.txt` all read this file. **Every rendered sentence is a claim.** Generators join `slots.*` claim ids and print a sentence only when that claim's `status` is `proven` or `proven-dated`. Partial and not-yet rows stay in the file so a daily steward can promote them later — they must not appear as published sentences. `/llms-full.txt` lists those unpublished **ids** under **Not yet claimed** and repeats every proven `kind: limit` row under **Full limitations**.

Dollar prices stay off the site, and no offer is published on the legacy public pages. The two pilot offer rows are `retired` (owner decision 2026-10-30, Codex iteration 3 F1): an offer goes into the canonical FactoryLM shell, not a frozen legacy page. A retired or absent offer publishes nothing, including in `llms.txt` / `llms-full.txt`; there is no hardcoded fallback. Contact still carries `signup_cta` / `signup_href` for the registry, but no legacy page renders them. Applying is not the same as being awarded a team. MIRA stands alone; a CMMS is optional, never required.

The headline and meta slots are `notebook-cited-answer` (P1; meta stays under the 160-character `head()` cap). The subhead is `equipment-notebook-not-cmms` (P3/P4). Published proven rows as of 2026-10-29:

| Id | Proven item |
|---|---|
| `notebook-cited-answer` | P1 — notebook answers from an uploaded OEM manual and cites the page |
| `magic-link-web-signin` | P2 — email magic-link sign-in |
| `not-a-cmms` | P3 — not a CMMS |
| `no-plc-or-work-order-write` | P4 — no PLC data, no work-order writes |
| `qualified-manuals-only` | P5 — Rockwell, Festo, and ABB manuals tested on production |
| `mike-central-florida` | P6 — Mike onsite in Central Florida or remote |
| `says-when-not-covered` | P7 — says when the attached manual doesn't cover the question |
| `desktop-citation-opens-page` | P8 — on desktop, a citation opens the cited page |
| `web-android-continuity` | P9 — web↔Android continuity, emulator only |
| `fault-code-right-page` | P10 — 6/6 right page on fault-code questions across two Rockwell manuals |
| `equipment-notebook-not-cmms` | P3/P4/P5 positioning sentence |

`cited-answers-with-page` ("every answer cites…") and `stranger-upload-cited-answer` stay `partial`. The optional `cited-micro810-oct19` row is unused; a dated Micro810 line is not published.

This JSON is the machine-readable registry that the 2026-10-20 Search Steward audit expected as `marketing/capabilities.md`. Do not create a second list.

## Record shape

| Field | Required | Notes |
|---|---|---|
| `id` | yes | kebab-case, unique |
| `text` | yes | the exact sentence a page may print |
| `status` | yes | `proven` \| `proven-dated` \| `partial` \| `not-yet` |
| `kind` | yes | `capability` (what it does) or `limit` (honest constraint) |
| `evidence` | yes | repo path, PR URL, or spec. No empty strings |
| `last_checked` | yes | `YYYY-MM-DD` |

`slots` is a map of claim-id arrays (`headline`, `subhead`, `meta`, `audience`, `jsonld_description`, `jsonld_features`, `llms_intro`, `llms_who`, `llms_show_today`, `llms_does_not`, `limitations`). Contact (`cta`, `email`, `href`, `signup_cta`, `signup_href`) and `chrome.ai_note` are not product claims.

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

Dollar prices, money-back guarantees, competitor product names, CMMS write-back or sync, PLC tag mapping, documentation-chunk counts, OEM logo walls, unlimited queries, the 480 V photo demo, Telegram/Slack as answer surfaces, OCR, nameplate scanning, "every safety signal gets a warning", a PowerFlex 755 trip-history sample, PM/fault history in answers, or an any-manual promise. Those stay `not-yet` or `partial` until the product can do them.

Never route customer content through OpenRouter `:free` models. This file is copy, not inference.

## Lifecycle note

The JSON and generator live under `mira-web/src/capabilities/` (the non-presentational seam). Homepage copy still renders through the existing `mira-web/src/views/home.ts` + `public/llms*.txt` path.
