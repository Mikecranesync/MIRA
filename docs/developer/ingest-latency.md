# Ingest Latency Tracking

MIRA records document-ingest latency as append-only JSONL so parser and chunking
choices can be compared with production data.

Default log path:

```bash
mira-crawler/data/ingest_latency.jsonl
```

Override with:

```bash
export MIRA_INGEST_LATENCY_LOG=/var/log/mira-agents/ingest_latency.jsonl
```

## What Gets Recorded

Each row is one delivered document or wrapped command:

- `parser`: parser/platform label, such as `docling`, `pdfplumber`, or `tika`
- `delivery_to_start_ms`: time from file delivery timestamp to ingest start
- `delivery_to_done_ms`: time from delivery to completed ingest attempt
- `total_ms`: active processing time
- `stages`: per-stage timing for `read`, `dedup`, `parse`, `chunk`, `embed`, `store`, or `command`
- `metrics`: bytes, parsed chars, block count, chunk count, embedding count, stored chunk count, and return code where available
- `status`: `ok`, `skipped`, `no_content`, `embed_failed`, or `error`

## Folder Watcher

`mira-crawler/main.py` records stage timings automatically for files dropped into
the incoming folder. It uses the file modification time as `delivered_at`, which
is close enough for measuring "dropped file to KB" latency.

## Wrapping One-Off Pipelines

Use the side script when testing a parser or running a cron command that is not
instrumented internally yet:

```bash
python mira-crawler/tools/record_ingest_latency.py \
  --parser docling \
  --source-url https://example.com/manual.pdf \
  --metadata pipeline=kb_growth \
  -- python mira-crawler/tasks/full_ingest_pipeline.py \
    --pdf-url https://example.com/manual.pdf \
    --manufacturer "Allen-Bradley" \
    --model "PowerFlex-525" \
    --type installation_manual \
    --no-quality-gate
```

For VPS cron:

```bash
MIRA_INGEST_LATENCY_LOG=/var/log/mira-agents/ingest_latency.jsonl \
python mira-crawler/tools/record_ingest_latency.py --parser docling --source-id kb_growth -- \
  python mira-crawler/cron/kb_growth_cron.py
```

This gives end-to-end timing immediately. For deeper parser/chunk/embed/store
stage timing, import `metrics.latency.IngestLatencyRecorder` inside the pipeline
and wrap each stage with `recorder.stage(...)`.
