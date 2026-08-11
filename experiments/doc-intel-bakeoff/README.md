# Phase 1.5 — Document Intelligence Bake-off

Empirical falsification harness for the ARPK question: *do current native/model/
open-source document systems already solve the hard problems well enough?*
Report + verdict: `docs/architecture/PHASE-1.5-DOCUMENT-INTELLIGENCE-BAKEOFF.md`.

**Everything here is disposable experiment code** — not production, not wired
into CI, never imported by shipping modules. PR #3185's behavior is the
immutable baseline; nothing here modifies it.

## Layout

```
questions.yaml       27-question benchmark, 15 adversarial classes, every marker
                     verified against actual fixture text (no guessed oracles)
ir.py                minimal Experiment IR (deliberately NOT an ARPK spec)
common.py            #3185-shaped chunker port + held-constant FTS5 BM25 +
                     deterministic scoring + QResult JSONL records
run_bakeoff.py       lane runner (retrieval lanes + answer lanes)
adapters/            parse_pymupdf, parse_docling, native_gemini, textqa_llm
fixtures/            PDFs (gitignored; see "Fixtures" for provenance)
out/                 IRs + results.jsonl (gitignored; summary tables live in the report)
```

## Fixtures (binaries gitignored — reproduce locally)

| doc | source | sha256 |
|---|---|---|
| T2108_Manual_EN.pdf | official eufy CDN — `py ../../tests/beta/fixtures/t2108/fetch.py` then copy | `b2e7912e…` |
| pf525_user_manual.pdf | https://literature.rockwellautomation.com/idc/groups/literature/documents/um/520-um001_-en-e.pdf (rev O, Sept 2025, 274 pp) | `b9445a63…` |
| gs10_user_manual.pdf | local copy of the AutomationDirect GS10 user manual (452 pp; 1st Ed Rev B) | `090aa1b3…` |
| gs10_fault_codes.pdf | `tests/beta/fixtures/gs10_fault_codes.pdf` (repo) | `3a4418b3…` |
| t2108_scanned_excerpt.pdf | generated image-only PDF of T2108 pages 12+15 (see command below) | varies |

Full hashes are pinned in `questions.yaml`.

## Reproduce the whole bake-off

```bash
cd experiments/doc-intel-bakeoff

# 0. One-time env (Windows; py = Python launcher)
py -m pip install pymupdf pyyaml httpx
py -3.11 -m venv .venv-docling && ./.venv-docling/Scripts/python -m pip install --no-cache-dir docling
# (pinned by results: docling 2.119.0, pymupdf 1.28.0)

# 1. Fixtures + scanned excerpt
py - <<'EOF'
import fitz
src = fitz.open('fixtures/T2108_Manual_EN.pdf'); out = fitz.open()
for pno in (11, 14):
    pix = src[pno].get_pixmap(dpi=150)
    page = out.new_page(width=pix.width, height=pix.height)
    page.insert_image(page.rect, pixmap=pix)
out.save('fixtures/t2108_scanned_excerpt.pdf')
EOF

# 2. Parser IRs
for d in T2108_Manual_EN pf525_user_manual gs10_user_manual t2108_scanned_excerpt; do
  py adapters/parse_pymupdf.py fixtures/$d.pdf out/ir/$d.pymupdf.json
  py adapters/parse_pymupdf.py fixtures/$d.pdf out/ir/$d.pymupdf-tables.json --tables
done
V=./.venv-docling/Scripts/python
$V adapters/parse_docling.py fixtures/T2108_Manual_EN.pdf     out/ir/T2108_Manual_EN.docling.json --no-ocr
$V adapters/parse_docling.py fixtures/t2108_scanned_excerpt.pdf out/ir/t2108_scanned_excerpt.docling-ocr.json
$V adapters/parse_docling.py fixtures/pf525_user_manual.pdf   out/ir/pf525_user_manual.docling.json --no-ocr
$V adapters/parse_docling.py fixtures/gs10_user_manual.pdf    out/ir/gs10_user_manual.docling.json --no-ocr

# 3. Retrieval lanes (deterministic, offline)
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1     # cp1252 trap
py -c "import json,yaml; json.dump(yaml.safe_load(open('questions.yaml',encoding='utf-8')), open('out/questions.json','w',encoding='utf-8'))"
py run_bakeoff.py --lane pymupdf,pymupdf-tables --run-id r1
py run_bakeoff.py --lane docling,docling-tables,docling-scanned --run-id r1

# 4. FactoryLM baseline lane (#3185 real code, disposable postgres)
docker run -d --name arpk-itest-pg -e POSTGRES_PASSWORD=itest -p 54329:5432 pgvector/pgvector:pg16
cd ../../mira-hub && TEST_DATABASE_URL="postgres://postgres:itest@localhost:54329/postgres" \
  MIRA_TEST_DB_CONFIRM=DISPOSABLE BAKEOFF_DIR="$(cd ../experiments/doc-intel-bakeoff && pwd)" \
  npx vitest run --config vitest.integration.config.ts src/lib/__tests__/bakeoff-factorylm.integration.test.ts
cd ../experiments/doc-intel-bakeoff

# 5. Provider lanes (live; keys from Doppler factorylm/dev; fail loud without)
doppler run -p factorylm -c dev -- py run_bakeoff.py --lane gemini --run-id r1
doppler run -p factorylm -c dev -- py run_bakeoff.py --lane textqa --run-id r1

# 6. Summarize
py summarize.py out/results.jsonl
```

## Honest exclusions

- **Marker 2.x** — model-weights license (modified OpenRAIL-M) bars use
  "competitive with the Datalab API" + <$5M threshold; a benchmark win would be
  unusable in the product, so the slot is wasted. Code is Apache-2.0; weights
  are not.
- **PaddleOCR-VL** — failed its 30-minute install gate on this Windows CPU
  machine (`libpaddle` DLL import error after a clean `paddlepaddle` wheel
  install). Highest OmniDocBench scores in class; revisit on Linux/GPU.
- **olmOCR** — needs ~12 GB VRAM; not viable on this laptop.
- **Groq/Together/Cerebras native-document lanes** — none accepts PDFs
  (image-only vision, and Groq caps 5 images/request); they appear instead as
  the text-QA stage over parser output (`textqa` lane), which is the
  architecture current benchmarks favor anyway.

## Budget

Declared inference budget for the whole bake-off: **≤ $3** (Gemini free tier +
Groq free tier; Gemini worst case ~1.4M input tokens ≈ $2.1 if billed).
Actual spend is recorded per-row in `results.jsonl` (`cost_usd`).
