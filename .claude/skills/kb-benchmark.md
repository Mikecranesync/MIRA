---
name: kb-benchmark
description: MIRA knowledge stack benchmark — runs the 100-question industrial maintenance MCQ exam against Claude + NeonDB RAG, scores by domain/difficulty/type, identifies KB gaps, and recommends new ingestion targets.
---

# KB Benchmark

Runs `tests/mira_eval.py` against the live NeonDB knowledge stack using Claude as the
inference backend. Acts like a standardized technician certification exam (8 domains,
100 questions, scenario/recall/calculation types) to score where the KB helps and where
it misses.

## Source Files

- `tests/mira_eval.py` — Main benchmark runner (Claude API + Open WebUI + RAG modes)
- `tests/benchmark/mira_mcq_benchmark.json` — 100 MCQ questions (8 domains)
- `tests/results/` — Output directory: JSON, CSV, text report
- `mira-bots/shared/neon_recall.py` — Three-stage retrieval (vector + fault code + product)
- `mira-crawler/tasks/discover.py` — Manufacturer discovery targets (Rockwell, Siemens, ABB, etc.)
- `mira-crawler/tasks/foundational.py` — Foundational KB sources (Kuphaldt, SKF, Fluke, etc.)

---

## Benchmark Modes

### Full run — Claude + RAG (standard)
```bash
cd /Users/bravonode/Mira
doppler run --project factorylm --config prd -- \
  python3 tests/mira_eval.py --claude --rag --ollama-url http://192.168.1.11:11434
```

### RAG ablation — Claude without KB (shows baseline model knowledge)
```bash
doppler run --project factorylm --config prd -- \
  python3 tests/mira_eval.py --claude
```

### Domain spotlight — isolate one weak area
```bash
doppler run --project factorylm --config prd -- \
  python3 tests/mira_eval.py --claude --rag \
  --ollama-url http://192.168.1.11:11434 \
  --domain "Motor Theory"
```

### Hard questions only
```bash
doppler run --project factorylm --config prd -- \
  python3 tests/mira_eval.py --claude --rag \
  --ollama-url http://192.168.1.11:11434 \
  --difficulty hard
```

### Quick smoke test (first 20 questions)
```bash
doppler run --project factorylm --config prd -- \
  python3 tests/mira_eval.py --claude --rag \
  --ollama-url http://192.168.1.11:11434 \
  --limit 20
```

---

## Reading the Results

Results land in `tests/results/`:
- `mcq_eval_report.txt` — Human-readable breakdown by domain/difficulty/type
- `mcq_eval_results.json` — Full results with RAG flag, response text, latency per question
- `mcq_eval_summary.csv` — One row per question, easy to grep or analyze

Check `rag_chunks: true/false` per question in the JSON to see which questions the KB
actually served vs. questions Claude answered from parametric memory alone.

---

## Benchmark Domains

| Domain | Questions | Focus |
|--------|-----------|-------|
| VFD / Variable Frequency Drive | 15 | Fault codes, parameter tuning, harmonics |
| Motor Theory & Troubleshooting | 15 | Windings, efficiency, shaft voltage, thermal |
| PLC Ladder Logic & Structured Text | 15 | Rungs, timers, counters, function blocks |
| CMMS, Work Orders & Maintenance Mgmt | 15 | PM scheduling, MTTR, work order flows |
| Industrial Sensors, Instrumentation | 10 | 4-20mA, RTD, thermocouple, loop power |
| NFPA 70E Electrical Safety & Arc Flash | 10 | PPE categories, approach boundaries, LOTO |
| Pneumatics & Hydraulics | 10 | Cylinder sizing, valve symbols, pressure drops |
| Preventive & Predictive Maintenance | 10 | Vibration, thermography, oil analysis, grease |

---

## Known KB Gaps (as of 2026-04-07, 58K rows)

These questions were missed at 97/100. The KB is returning context but the wrong chunks
are surfacing, or the specific reference content is not yet ingested.

### Gap 1: Motor energy efficiency calculations (Q29 — hard)
**Topic:** NEMA Premium vs Standard efficiency at partial load over full year
**Issue:** Claude calculated straightforwardly and got ~4,500 kWh; correct answer ~1,100 kWh
at realistic 40-50% average loading. Needs DOE Motor Challenge / NEMA MG 1 reference content.
**Fix:** Ingest `https://www.energy.gov/eere/amo/motor-systems` and
`https://www.nema.org/Standards/view/NEMA-MG-1` (or equivalent application guides).

### Gap 2: VFD-driven motor shaft voltage / bearing fluting (Q30 — hard)
**Topic:** Shaft voltage threshold (1V peak) for EDM bearing damage with VFD
**Issue:** Aegis/Electro Static Technology guidance is not in KB. Claude defaulted to 500mV.
**Fix:** Ingest Aegis SGR bearing protection application notes and EASA/IEEE papers on shaft
voltage and bearing fluting. Start URL: `https://www.est-aegis.com/resources`

### Gap 3: Bearing lubrication failure modes (Q61 — medium)
**Topic:** Over-greasing vs. under-greasing as leading rolling element bearing failure cause
**Issue:** SKF content was retrieved (rag_chunks: true) but the specific SKF bearing
maintenance chapter on over-greasing wasn't surfaced. The SKF knowledge centre crawler
produced 0 inserts (playwright JS-heavy site).
**Fix:** Ingest `https://www.skf.com/group/knowledge-centre/maintenance/lubrication` directly
as a PDF or use SKF's static lubrication handbooks. Candidate:
`https://www.skf.com/binaries/pub12/Images/0901d19680416953-SKF-Bearing-maintenance-handbook_tcm_12-297819.pdf`

---

## Recommended New KB Targets

Priority order based on gap analysis and domain coverage:

### Tier 1 — Fix active misses
1. **Aegis/EST shaft voltage app notes** — bearing fluting, EDM protection
   URL: `https://www.est-aegis.com/resources` (Apify cheerio crawl, ~50 pages)
2. **DOE AMO Motor Systems** — efficiency calculations, NEMA Premium guidance
   URL: `https://www.energy.gov/eere/amo/motor-systems`
3. **SKF Bearing Maintenance Handbook PDF** — lubrication failure modes, re-greasing intervals
   Direct PDF ingest via `mira-mcp :8009 POST /ingest/pdf`

### Tier 2 — Strengthen weak domains (Motor Theory 86.7%)
4. **EASA Technical Manual** — motor rewinding, insulation testing, efficiency restoration
   URL: `https://easa.com/resources/technical-manuals`
5. **Fluke Motor & Drive Troubleshooting guide** — shaft voltage, VFD bearing currents
   URL: `https://www.fluke.com/en-us/learn/best-practices/test-tools-overview/motors-drives`
6. **IEEE 841 / API 541** — petroleum/chemical plant motor standards, efficiency classes
   Source: IEEE Xplore (requires account) or ANSI webstore summaries

### Tier 3 — Close PM/PdM gap (90%)
7. **Mobius Institute bearing training PDFs** — vibration analysis, grease life calculation
   URL: `https://www.mobiusinstitute.com/resources`
8. **Machinery Lubrication magazine** — grease compatibility, re-lubrication intervals
   URL: `https://www.machinerylubrication.com` (Apify cheerio crawl)

---

## How to Ingest a New Target

### Single PDF (direct)
```bash
doppler run --project factorylm --config prd -- \
  curl -s -X POST http://localhost:8009/ingest/pdf \
  -H "Authorization: Bearer $MCP_REST_API_KEY" \
  -F "file=@/path/to/manual.pdf"
```

### URL via Celery ingest task
```bash
doppler run --project factorylm --config prd -- \
  docker compose exec mira-celery-worker \
  celery -A mira_crawler.celery_app call \
  mira_crawler.tasks.ingest.ingest_url \
  --args '["https://example.com/manual.pdf", "Manufacturer", "Model", "equipment_manual"]'
```

### Add a permanent target to foundational KB
Edit `mira-crawler/tasks/foundational.py` — add an entry to `APIFY_TARGETS` (cheerio for
static sites, playwright:chrome for JS-heavy), then trigger:
```bash
doppler run --project factorylm --config prd -- \
  docker compose exec mira-celery-worker \
  celery -A mira_crawler.celery_app call \
  mira_crawler.tasks.ingest.ingest_foundational_kb
```

---

## Benchmark History

| Date       | Model              | Mode        | Score  | Rows in KB |
|------------|--------------------|-------------|--------|------------|
| 2026-04-07 | claude-sonnet-4-6  | Claude+RAG  | 97/100 | 58,201     |

Add rows here after each benchmark run. Compare score deltas against row count growth to
track whether new ingestion is actually improving recall.
