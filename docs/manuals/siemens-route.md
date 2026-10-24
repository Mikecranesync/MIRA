# Route to Siemens manuals (SIOS) — for future manual extraction

## How to find any Siemens manual
1. **Search engine first (fastest, no JS):** query `<product> operating instructions pdf cache.industry.siemens.com`
   (e.g. "SIMATIC HMI Comfort Panels operating instructions"). Direct PDF links come back.
2. **SIOS (Siemens Industry Online Support):** https://support.industry.siemens.com/cs/ww/en/
   - Search the product name or article number (MLFB, e.g. `6AV2124-0GC01-0AX0` = TP700 Comfort).
   - Filter **Entry type = Manual**. Pick language English and the newest edition (date + A5E number on the cover).
   - Each entry has a **document id**: `https://support.industry.siemens.com/cs/document/<id>/` (Comfort Panels = 49313233).
   - Old links `support.automation.siemens.com/WW/view/en/<id>` map to the same id.
   - SIOS pages are JavaScript-heavy; the browser works, plain curl/WebFetch gets **403 (Akamai)**.
3. **Direct PDF (works with curl, no login):**
   `https://cache.industry.siemens.com/dl/files/<last3digits-of-id>/<id>/att_<attachment>/v1/<file>.pdf`
   Alt mirror: `https://support.industry.siemens.com/cs/attachments/<id>/<file>.pdf`
   Several editions can sit under one id (different att_ numbers) — check the cover edition.
4. **Login-walled:** mySupport "Manual Collection"/documentation packages, My Documentation Manager, some
   downloads (software, certificates). Don't sign in or bypass; report the URL to Mike.
5. Product pages and spec sheets: SIOS product support / Industry Mall (article number) link to the same docs.

## Working example (Oct 23, 2026)
```
curl -sSL -A "Mozilla/5.0" -o out.pdf \
  https://cache.industry.siemens.com/dl/files/233/49313233/att_904646/v1/HWComfortPanelsenUS_en-US.pdf
pdfinfo out.pdf; sha256sum out.pdf
```
`curl -I https://support.industry.siemens.com/cs/document/49313233` -> 403 (use a browser for SIOS pages).

## Pitfalls
- Akamai 403 on SIOS HTML for non-browser clients; cache.industry PDFs are fine. Set a User-Agent.
- Older editions stay online (e.g. att_59649 = 03/2012 A5E03404994-02). Always confirm edition on cover.
- Similar manuals: "Unified Comfort Panels" (109773257) and "Comfort Outdoor" (109485603) are different products.
- Be gentle: one request per file, no bulk crawling.
- Only Siemens domains (support.industry.siemens.com, cache.industry.siemens.com).

## Provenance to record per file
source URL, document id, title, edition (date + A5E no.), language, pages, sha256, download date (ET).

## Log
| File | Source URL | Doc id | Edition | Pages | sha256 | Downloaded |
|---|---|---|---|---|---|---|
| siemens-comfort-panels-operating-instructions-A5E36770603-AE-2022-07-en.pdf (covers KP400–TP2200 Comfort incl. TP700/TP900/TP1200) | https://cache.industry.siemens.com/dl/files/233/49313233/att_904646/v1/HWComfortPanelsenUS_en-US.pdf | 49313233 | 07/2022, A5E36770603-AE, en-US | 252 | fa79e60e39d19165e5bdeea45189efff06eca3823948de3c81c436d093170f81 | 2026-10-23 ~4:40 AM ET |

Alarm acknowledge content (printed page = PDF page): p.74 (ACK acknowledges current fault / alarm group),
p.235 (acknowledge error alarm), p.240 (acknowledge error message each time), p.247 (glossary: Acknowledge).
