# Print Translator Campaign — Honest Gaps

This campaign ran a bounded, real-inference measurement (11/25 corpus entries, capped at 12).
This file lists everything the campaign does **not** prove, and why, so nobody downstream reads
more into the numbers than is actually there.

## 1. OCR is unreachable from this dev box — every response in this campaign is OCR-degraded

Both OCR paths failed on every single run, for infrastructure reasons unrelated to the print
translator's own logic:

- **glm-OCR**: `glm-ocr call failed: [Errno 11001] getaddrinfo failed` — this is a
  compose-network-only service; this box has no route to it. Needs the real docker-compose
  network (`mira-core`/`mira-mcp` stack) to reach it, or a public endpoint if one exists.
- **Tesseract**: `OCR extraction failed: tesseract is not installed or it's not in your PATH` —
  no local Tesseract binary. `pip install pytesseract` alone is insufficient; the actual
  Tesseract OCR engine binary needs to be installed and on `PATH`.

Because classification runs off the vision model's *description* (which reaches Groq
successfully on every run in this campaign), the **trigger-rate / classification-gate
measurement is production-representative** — that part of the finding stands regardless of OCR
availability. But every generated response's *content* in this campaign was built from
`"No OCR labels were extracted; rely on the image"` (see
`mira-bots/shared/print_translator.py::_ocr_block`), not real extracted terminal/wire labels.
This is caveated with `"ocr_grounding": "unavailable_on_this_box"` in every deliverable that
quotes a response. **Do not treat any response text in this campaign as representative of
production answer quality** — only as evidence that the prompt/format layer executes correctly
end-to-end.

**To close:** run the campaign (or the live-Telegram runbook) from inside the real
docker-compose network, or with a local Tesseract install, and re-measure response quality.

**Note on the gate-bypassed explanations** (`results/<id>.gate_bypassed.json`): these too carry
`ocr_grounding: unavailable_on_this_box` and are subject to exactly this gap. They exist to give
a human reviewer real translator OUTPUT to judge (the prompt/format layer), NOT as evidence of
production answer quality — they were built from the real image plus an empty OCR block
(`print_translator._ocr_block`'s "No OCR labels were extracted; rely on the image" fallback). With
real OCR they would additionally cite verbatim terminal/wire labels.

## 2. Page-resolution ambiguity for vague manifest entries

The manifest's `Page/Section` column is often a page-range description ("Ch. 2, power &
control wiring", "Wiring diagram section (p. 5–8)") rather than an exact PDF page index. Page
selection in this campaign was done by dumping each PDF's page-leading-text
(`--list-pages`) and picking the single page with the strongest schematic-density signal
(dense terminal/label text, an explicit "wiring diagram" / "connection diagram" heading) —
never by re-rolling multiple candidate pages to chase a favorable classification outcome. This
is a judgment call per document, not a deterministic extraction, and a different reviewer could
reasonably pick a different page for the same entry. Documented per-entry page choice is in each
result JSON's `rendered_page_number` field and in `review_worksheet.csv`.

## 3. Manifest URL rot — 7 of 25 URLs were literal `"..."` placeholders; 1 remains unfetchable

The corpus manifest (`corpus_manifest.md`) shipped with several URLs containing a literal `"..."`
in the path — not a real, resolvable link. During this campaign:

- **7 entries** (#3, #5, #7, #9, #13, #20, #25) had their placeholder URLs resolved to real,
  verified (`content-type: application/pdf`) official-OEM URLs via web search, and the manifest
  was corrected in place (see the `Retrieval Note` column for each — each says "URL resolved via
  web search 2026-07-10"). These corrections are visible in the manifest's git diff; nothing was
  silently changed.
- **1 entry** (#22, Rockwell Bulletin 505 / GI-WD004) remains genuinely unfetchable. Web search
  found no independently-hosted GI-WD004 document — the only real match returned is GI-WD005,
  the same document already used for entry #5 (which itself contains a Bulletin 505 section on
  its pages 25–33). The literal manifest URL for #22 (still containing `"..."`) resolves via
  HTTP 200 to the Rockwell Automation marketing homepage; PyMuPDF will silently render that HTML
  page as a flowable ~40-page "PDF" of marketing copy rather than erroring. This was caught
  before running the campaign against it and recorded as `results/22.json` with
  `"status": "unfetchable"` — not run, to avoid manufacturing a false result from the wrong
  content, and not silently substituted with entry #5's document under entry #22's id (which
  would double-count one real document as two corpus entries).
- **14 entries were never attempted** in this bounded 12-entry-cap campaign (the manifest has 25
  total; this campaign explicitly capped at 12 per the task scope). Their manifest URLs are
  likely to have the same `"..."` placeholder problem — this was not checked exhaustively for
  the un-attempted 14.

**To close:** a follow-up pass could apply the same web-search-resolve-and-verify procedure to
the remaining un-attempted entries before a full 25-entry campaign run.

## 4. The classifier gate defect — root cause identified, fix NOT implemented

This campaign identifies and deterministically reproduces the classification-gate defect (see
`RANKED_REPORT.md` #1 and `regression_fixtures/test_classifier_gate.py`), but per the task scope
**does not modify `mira-bots/shared/workers/vision_worker.py`** (no production-code changes was
a hard constraint on this campaign). The regression fixtures are `xfail`-marked precisely because
the fix is not yet applied — they exist so a future PR that adds word-boundary matching +
print-keyword precedence has an immediate, real-data-backed test to flip to a plain assertion and
watch turn green.

## 5. Sample size and selection bias

11 real entries is a bounded measurement, not a statistically powered sample. The entries that
turned out to be fetchable skew toward AutomationDirect (4 of 11) because that OEM's CDN paths
were the most search-resolvable; other OEMs (Siemens, Schneider, Omron, Mitsubishi, Banner,
Eaton) are entirely absent from this run because every one of their manifest URLs was an
unresolvable placeholder or blocked (403/404) even after a search-based resolution attempt (see
the fetchability probe in this session — not persisted as a separate artifact, but every one of
those OEM domains returned either a 403, a 404, or an HTML redirect page rather than a PDF). The
91% mis-classification rate should be read as "measured on this specific 11-entry sample, all
from 5 OEMs, covering 6 of 6 manifest categories" — directionally strong (every category is
represented, and the failure mode recurs across every category) but not a claim about the exact
percentage across all 25 corpus entries or all real-world OEM manuals.
