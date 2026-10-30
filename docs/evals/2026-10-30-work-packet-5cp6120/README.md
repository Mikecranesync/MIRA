# CAT Pumps 5CP6120 work-packet demonstration — evidence (2026-10-30, CHARLIE)

Founder directive [#4982](https://github.com/Mikecranesync/MIRA/issues/4982), stage 1 of the
[GTM plan](https://claude.ai/artifact/73QPJ4ksMqcrevw9T5x7uE). Everything here is a prototype on
branch `feat/work-packet-demo-4982`; nothing is merged, deployed or sold. The pilot stays NO-GO
(T-1 11/29 lexical, 15/29 hybrid on the fresh set; T-2, T-3, T-4 open).

**The pump is the 5CP6120** (brass 5CP6120 / 5CP6120CS; gearbox 5CP6120CSSG1), the one Mike is
rebuilding — not the 3520 named in #4982's Demo 1. The 3520 documents were validated too
(35FR2Svc.pdf, 3520_J.pdf) and can be a second case.

## Sources (official, validated 2026-10-30; not committed — manufacturer copyright)

| Id | Document | URL | sha256 (prefix) | Pages |
|---|---|---|---|---|
| DS | Data sheet, PN 993450 **Rev G 5/22** | https://www.catpumps.com/sites/default/files/2022-05/5CP6120_G.pdf | `a3b9fdfeeb90bc32` | 4: specs, parts list, exploded view, seal/valve kits + cautions |
| SM | CP Plunger Pump Service Manual CPSvc(5) | https://www.catpumps.com/sites/default/files/products/pdfs/CPSvc(5).pdf | `f05fb18880eadb32` | 8: names the 5CP6120 on the cover; valves p.2, pumping section p.3, seals p.5, torque chart p.6 |

The copy on Mike's screen is **Rev F 11/20**. It was transcribed from his photos (an AI
transcription, unverified, kept out of git) only to compare against Rev G.

## What was built and tested (synthetic data only)

| Piece | Path | Evidence |
|---|---|---|
| Parts breakdown extractor (rung 1, free toolkit) | `tools/parts-breakdown/catpumps_breakdown.py` | On the real Rev G sheet: 44 parts, 8 optional, 5 service parts, seal kit 33628 ×1 and valve kit 30820 ×2 with per-material kit numbers; **12/12 kit-coverage checks pass**; 3 ambiguous quantities reported as unknown, not guessed (`parts-breakdown-5cp6120-revG.json`). Text path and pypdf path agree. 13 tests; 6 mutations each fail their named test. |
| Revision diff | same, `--diff` | Rev F → Rev G: items 37 and 38 quantity notation `1–2` → `1–1–2`; item 120 part 49436 moved from the parts list into the STHT seal-kit column; kit numbers unchanged (`parts-breakdown-revF-to-revG.diff.json`). |
| Work Packet builder | `tools/work-packet/build_packet.py`, fixture `tools/work-packet/fixtures/draft-packet-5cp6120.json` | Draft packet: 14 verified / 24 proposed / 10 unknown fields, every one with its page. Sample technician review (4 edits: set the seal material, confirm 2 items, strike the liquid gasket): 9 unknown, 1 struck, state `reviewed`, still **not approved** (`summary-*.json`, `technician-edits-sample.json`). 10 tests; 5 mutations each fail their named test (no-source verified, generated isolation steps, unrecorded review, unescaped HTML, always-approved). |
| PDF + phone view | `tools/work-packet/render_pdf.mjs` (Playwright/Chromium from mira-web) | `work-packet-5cp6120-reviewed.pdf` (6 pages, Letter): DRAFT banner, site-owned isolation box, parts, tools, 14 draft steps with page citations, torque table, exceptions, sign-off lines. Screenshots: `docs/promo-screenshots/2026-10-30_work-packet-5cp6120-reviewed_{desktop,mobile}.png`. |
| Smart Sheets first step | `tools/smart-sheets/gap_check.py`, fixture `brake-gap-synthetic.csv` | 6 synthetic brake-gap points: 2 pass, 1 fail, 2 unassessed (one unconfirmed photo value, one missing limit), 1 incomplete; exceptions listed; the "in-range never authorizes return to service" notice travels with every result (`brake-gap-synthetic-results.{json,csv}`). Comparisons use `decimal.Decimal` with the exact 25.4 in/mm factor (PR #4986 review finding F8: the prior float comparison falsely passed an exact 0.069in/1.7526mm exclusive boundary); the CSV reports `before_unit`/`after_unit` separately (finding F9) and a photo reading now defaults unconfirmed (finding F10). 11 tests; 7 mutations each fail their named test. |

## Staging evidence (MIRA, the real product path)

See `staging-results.md` in this folder (added after the run): a disposable staging notebook
with both official PDFs attached, the seven acceptance questions (parts, oil, torque, seals,
tools, an unknown, a pressurized-system safety ask), and the model-identification call on the
data-sheet image.

## What is verified, proposed, unknown

- **Verified (recorded evidence):** the extractor's numbers against the official sheet; the
  kit-coverage arithmetic; the builder's validation rules; the PDF and screenshots; the tests
  and mutation runs above.
- **Proposed (not proven in use):** the draft step order, the tool list, the scope "reseal +
  valves", any photo-to-packet claim, technician editing on a phone (the HTML is phone-friendly;
  there is no editing UI — edits are a JSON file today), approval persistence (no `work_packets`
  table; no migration was written on purpose, see `.claude/rules/mira-hub-migrations.md` rule 8).
- **Unknown (never guessed):** the pump's seal-material suffix and serial, site isolation steps,
  qualifications, functional-test acceptance limits, Tech Bulletin 053 applicability.

## Limits

- One OEM layout (CAT Pumps). Photos are not parsed here; a photographed sheet must be transcribed
  first and stays unverified until a person confirms it.
- The six-column parts table is cramped at phone width; a card layout is a follow-up.
- No model calls anywhere in these tools; the staging questions use the product's real path.
