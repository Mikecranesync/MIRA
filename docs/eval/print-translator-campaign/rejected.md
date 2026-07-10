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
