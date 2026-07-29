# Rejection / Triage Log — Print Translator Campaign

Candidates rejected from the run set, or run but excluded from the **first-10** evaluation set,
with one-line reasons. Rejection reasons: marketing illustration, generic/AI-generated diagram,
unreadable scan, duplicate circuit, or a diagram without enough context to explain. All decisions
made on the source document / rendered page, never on the downstream classification outcome.

## Rejected from the run set entirely

| id | Source | Reason |
|---|---|---|
| 22 | Rockwell Bulletin 505 Reversing Starters (GI-WD004), manifest URL `literature.rockwellautomation.com/.../GI-WD004_EN_E_P.pdf` | **Unfetchable — no context to explain.** Manifest URL is a literal `"..."` placeholder; it returns HTTP 200 but redirects to the Rockwell marketing homepage (`text/html`, ~205 KB — "2025 Sustainability Report", "Industrial AI Designed for Optimizing Operations"). PyMuPDF renders that HTML as a flowable ~40-page "PDF" of **marketing copy**, not a schematic. Not run — running it would classify Rockwell's marketing homepage as a print submission. Web search found no independently-hosted GI-WD004; the only real hit is GI-WD005 (already entry #5, whose pages 25–33 cover Bulletin 505 anyway), so substituting it under id 22 would double-count one document. Recorded honestly as `results/22.json` `"status":"unfetchable"`. |

## Run, but excluded from the first-10 evaluation set

| id | Source | Reason |
|---|---|---|
| 21 | AutomationDirect AN-GS-022 "Common External Wiring Setups" (Technical Note), page 1 | **Weak schematic — text-heavy application note, not a clean self-contained wiring diagram.** The rendered page is mostly prose (parameter tables, `00.20 / 00.21 / 01.12` setting explanations) with the actual wiring figures on later pages of the note. The real vision model described it as an "Application Note document ... with tables and flowcharts", and the real classifier routed it to NAMEPLATE (a *different* mis-classification target than the other prints — see `regression_fixtures/test_classifier_gate.py`, which keeps it as a real defect case). Kept in the run set and worksheet (`first_10=N`), but not among the 10 clearest schematics for first review. |

## Not attempted (out of scope of this bounded run)

Entries #1, 2, 4, 6, 8, 10, 11, 12, 15, 16, 19, 23, 24 were not attempted — this campaign was
capped at 12 entries. Most carry unresolved `"..."` placeholder URLs in the manifest (see
`GAPS.md` §3 and §5); the OEM domains that were probed (Siemens `cache.industry.siemens.com`,
Schneider `productinfo.se.com`, Omron, Mitsubishi, Banner, Eaton) returned 403/404 or HTML
redirect pages rather than a direct PDF during this session's fetchability probe. These are not
rejections on quality grounds — they were simply outside the bounded scope and would each need a
web-search-resolve-and-verify pass (the procedure that recovered the 7 corrected URLs) before a
full 25-entry run.


## 2026-07-10 autonomous refresh — rejections & exclusions

| id | OEM / Doc | Disposition | Reason |
|---|---|---|---|
| 4  | Siemens SIRIUS Overview (60311318) | REJECTED-NO-SOURCE | No authentic official direct-PDF located via discovery; dropped from runnable corpus. |
| 23 | Schneider TeSys Giga reversing (LV429349) | NEEDS-PDF | Official source is an HTML documentation viewer (content-type text/html), not a downloadable PDF — not runnable by the PDF runner. Kept as reference. |
| 2  | Schneider TeSys Star-Delta (LV429349) | NEEDS-BROWSER | Placeholder "…" URL; mislabeled CONFIRMED in the old manifest; missed by this batch (targeted NEEDS-BROWSER only). Still needs a real URL. |
| 24 | Siemens 3RU/3RB overload+braking (60298164) | RUN, excluded from first-10 | Verified 206 application/pdf but hosted on pes-group.co.uk (authorized UK Siemens DISTRIBUTOR mirror, scanned/image-based) — authentic content, non-OEM host. |
| 1  | Siemens 3RT2 Contactors (60306557) | RUN, excluded from first-10 | 420-page manual; density heuristic landed a table page (weak schematic). Re-run on a true wiring page to promote. |
| 8  | Siemens 3RW30/40 Soft Starter (38752095) | RUN, excluded from first-10 | 180-page manual; landed an index page. The "Typical circuit diagrams" section (~pp.167-198) is the page to re-run. |
| 22 | Rockwell Bulletin 505 (GI-WD004) | NOT RUN | GI-WD004 does not exist; the real doc (gi-wd005) is the SAME booklet as entry #5 — skipped to avoid a duplicate source/image. |
