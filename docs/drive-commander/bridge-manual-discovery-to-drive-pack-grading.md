# Bridge: Manual Discovery → Drive-Pack Grading

**Status: IMPLEMENTED — default-OFF (`MIRA_DRIVE_PACK_BRIDGE=1`).** `mira-crawler/drive_pack_bridge.py`, fired from `kb_growth_cron::_process_entry`. Operator runbook: `docs/runbooks/manual-kb-ingest-to-drive-pack-bridge.md`; workflow: `docs/drive-commander/workflow-create-candidate-from-discovered-manual.md`. This doc is the design rationale; the sections below describe what was built. It creates review-only **candidate records** only — it does not run the extractor inline and never touches trusted packs.

## The gap (verified)

Every one of the 9 discovery/ingest paths terminates in `knowledge_entries` (RAG chunks). A repo-wide grep for `drive-pack-extract` / `registry.check` / `update_candidate` outside the tool's own dir returns **zero** call sites — only docs + CI. The live PowerFlex 525 / GS10 packs were produced by a **human** running `generate_pf525_pack.py` + `grade.py`, never by a crawler. So:

> **Manual discovery feeds the KB, not drive-pack trust.** A vendor bulletin these routines find becomes searchable chunks; nothing turns "Rockwell published a new PowerFlex 525 revision" into a graded candidate pack awaiting approval.

## The target (already built — PR #2507)

`tools/drive-pack-extract/registry/` is the sole code that knows how to answer "is this PDF new/unchanged/changed vs. registered" and "generate + grade a candidate without auto-promoting":
- `registry.classify(entry, sha256)` → `new_manual` / `unchanged` / `changed_by_hash` / `needs_initial_candidate`.
- `check.py` (read-only) / `update_candidate.py` (writes only under `candidates/`, `promoted:false`, ceiling `beta`).

A bridge calls these — it never writes into `mira-bots/shared/drive_packs/packs/`.

## Insertion point (single best)

**`mira-crawler/cron/kb_growth_cron.py::_process_entry`, the success branch (~line 267)** — the only place in the whole dataflow where, per queue entry, all three are simultaneously in scope: `entry["manufacturer"]`, `entry["model"]`, and the **downloaded local PDF path** (`full_ingest_pipeline.py::_download` → `/opt/mira/manuals/{mfr}/{model}/{file}.pdf`), which is exactly the `--manual <path.pdf>` the registry needs.

Attach it **fail-open**, mirroring the repo's existing post-insert enrichment idiom (`mira-crawler/tasks/ingest.py:258-281`, the `component_template` dispatch):

```python
# after: entry["status"] = "done"
try:
    _maybe_drive_pack_candidate(entry, local_pdf_path)   # NEW, fail-open, non-blocking
except Exception:
    log.warning("drive-pack bridge skipped (non-fatal)", exc_info=True)
```

Not the AB hunter (hands off to a vendor-agnostic Hub uploader — wrong layer) and not `ingest_url` (fires per-chunk across RSS/blogs — too broad; `kb_growth_cron` is where curated `installation_manual` entries with known mfr/model concentrate).

## The metadata mapping the bridge must fill

| Registry needs | Discovery has today | Bridge work |
|---|---|---|
| `pdf_sha256` | **nothing** (no hash on the KB path) | compute `sha256_file(local_pdf)` at the hook |
| `manual_id` (vendor+model+publication) | `manufacturer`, `model` (often empty) | map `(mfr, model)` → registered `manual_id`; if none → `new_manual` |
| `product_family`, `publication`, `revision` | not captured anywhere | can't infer from KB metadata — must come from the registry entry, or the manual is `new_manual` (register-then-review) |

## Behavior (trust-preserving)

1. Compute `sha256_file(local_pdf)`.
2. `entry = find_entry_by_mfr_model(...)`; `cls = registry.classify(entry, sha256)`.
3. `unchanged` → no-op. `changed_by_hash` / `needs_initial_candidate` → `update_candidate.main(["--manual", local_pdf, "--id", entry.manual_id])` → a graded **candidate** + review report. `new_manual` (no registry entry) → **do not auto-register**; emit a "register this source?" `ai_suggestions`-style note for a human (never silently create a trusted pack).
4. Never promote. The candidate stays under `candidates/`; promotion is the human gate in `runbook-drive-manual-update-acceptance.md`.

## Safety model

- **Dry-run:** gate the whole bridge behind `MIRA_DRIVE_PACK_BRIDGE=0` default (like the AB hunter's `MIRA_AB_HUNTER_LIVE`) — log what it *would* candidate without running the extractor.
- **Throttle:** at most N candidates/run (reuse the `AB_HUNTER_MAX_NEW=3` pattern); extractor+grader are CPU-heavy.
- **Guardrails/STOP_INGEST:** honor `~/.mira/STOP_INGEST` — if set, skip the bridge (same check the hunter does).
- **Fail-open:** a bridge error never fails the KB ingest that already succeeded.

## Why staged, not built now

The `(mfr, model) → manual_id` mapping is genuine new design (publication/revision aren't in `knowledge_entries`), and wiring a CPU-heavy extractor into a live hourly cron is a runtime behavior change the "smallest safe slice" rule excludes. Ship the observability (`fleet_status.py`) and this design first; implement behind a default-off flag in a focused follow-up PR with the mapping + throttle + dry-run tests.
