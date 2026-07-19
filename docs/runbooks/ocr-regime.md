# Runbook — OCR Regime (floor / model / paid lanes, recall gate, keep-alive)

**Owns:** every OCR lane behind a MIRA photo turn — the deterministic Tesseract floor, the
off-by-default model-OCR lane, the paid electrical-print interpreter, and the (unrelated)
KB-ingest PDF extractor. Lives in `mira-bots/shared/workers/vision_worker.py`,
`mira-bots/shared/print_autoeval.py`, `mira-bots/telegram/{bot.py,printsense_testkit.py}`,
`printsense/xref_extractor.py`.

**Status:** Active doctrine, 2026-07-18. Design + full task-by-task build log:
`docs/plans/2026-07-18-ocr-regime-repair.md` — read that for *why*; this page is the
day-to-day *how do I check / what do I do when it breaks* reference. Don't duplicate the
plan here — link it.

---

## When this runbook applies

- A print-photo turn comes back with no grounded tags (`ocr_items` looks empty/thin).
- The `ocr-lane-health` scheduled GitHub Actions run goes red.
- An `ocr_floor_dead` P0 ntfy push arrives.
- You're about to touch `vision_worker.py`'s OCR path, the Dockerfile, or the OCR env vars.
- Pre-demo / pre-deploy sanity check that the deterministic floor is alive.

Does NOT apply to: the paid print-interpreter's *content quality* (that's
`printsense/interpret.py` + the eval harness in `printsense/benchmarks/`), or the KB-manual
ingest extractor (`mira-crawler/ingest/pdf_extract.py`) — see the Docling row below for why
that one's a dead end here.

---

## Lane map

| Lane | Default | What it does | Where it lives |
|---|---|---|---|
| **Deterministic floor (Tesseract)** | Always on, in-image | Word-box OCR (`{text, bbox, line}`) feeds `ocr_tokens`/`ocr_items`/`ocr_source`/`tesseract_text` on **every** photo turn | `printsense/xref_extractor.py:47` (`ocr_tokens()`) bridged live in `mira-bots/shared/workers/vision_worker.py:337-434` (`VisionWorker.process()`) |
| **Model-OCR lane** | **Off** (`OCR_MODEL_LANE=off`) | Supplements — never replaces — the floor by sending the same photo through the free inference cascade | `vision_worker.py:496-533` (`_call_ocr()`), gated by `_model_lane_on()` at `vision_worker.py:296-299` |
| **Paid interpreter** | Off (quota exhausted) | Full electrical-print *interpretation* (not raw OCR) — a separate product lane, not part of the floor/model choice above | `printsense/interpret.py` — re-enable is **PR-F, blocked on Mike** (credits + guarded-file sign-off) |
| **Docling (KB-ingest OCR)** | RESOLVED-STALE | PDF/manual text extraction for KB ingest — a *different* pipeline from the photo-OCR lanes above | Excised from the kb_growth path in v3.87.0 (2026-07-07); extraction is in-process (`mira-crawler/ingest/pdf_extract.py`, fallback chain in `mira-crawler/ingest/converter.py:254` `extract_from_pdf_with_fallback` / `:279` `extract_from_docling`, guarded-import only). No `mira-docling` service exists in any compose file. **No decision pending** — mentioned here only so it isn't confused with the lanes above. |

`ocr_source` on every `VisionWorker.process()` result is one of `tesseract` \| `tesseract+model`
\| `model` \| `none` (`vision_worker.py:395-402`) — `none` on an `ELECTRICAL_PRINT` turn is the
signal everything below is built to catch.

---

## Env vars

| Var | Default | Meaning |
|---|---|---|
| `OCR_MODEL_LANE` | `off` | `on` routes the model-OCR lane through the free cascade (adds inference cost); `off` = floor only. Rows: `docs/env-vars.md:29`; compose: `docker-compose.staging-vps.yml:452`, `docker-compose.saas.yml:371`, `mira-bots/docker-compose.yml:44`. |
| `OCR_EXPECT_TESSERACT` | `1` in containers, `0` local dev | Boot self-check expectation. `1` = floor is required, missing binary reports `DEAD`; `0` = floor optional (Windows dev machines lack the binary), missing binary reports `DEGRADED`. Rows: `docs/env-vars.md:30`; compose: `docker-compose.staging-vps.yml:454` (default `1`), `docker-compose.saas.yml:373` (default `1`), `mira-bots/docker-compose.yml:45` (default `0`). Both vars added by commit `0e8efc264`. |
| `PRINT_THEORY_MAX_TOKENS` | *(not yet shipped)* | **PR-D, pending** — raises the theory-reply token cap past the `engine.py:937` `max_tokens=1200` truncation. No compose row / `env-vars.md` row exists yet. Don't treat it as live until PR-D merges. |

`OCR_EXPECT_TESSERACT` is read with the identical `.strip() or "0"` normalization in
`ocr_lane_report()` (`vision_worker.py:307`) and the autoeval rule (`print_autoeval.py:246`) —
confirmed parity, since compose's `${VAR:-}` can deliver an empty string and both call sites
must guard against that the same way. `OCR_MODEL_LANE` gets the equivalent `.strip().lower()`
treatment centrally in `_model_lane_on()` (`vision_worker.py:296-299`), shared by both
`ocr_lane_report()` and `_call_ocr()`.

---

## How to check — from the phone

Send `/printsense_test ocr` to the bot. Expect:

```
OCR: ok — tesseract 5.x, model lane off, floor expected
```

Dispatcher: `run_ocr_report_live()` in `mira-bots/telegram/printsense_testkit.py:1069-1075`
(read-only, no state changes); the one-line phone format comes from `ocr_phone_summary()`
at `printsense_testkit.py:1057-1066`. Verdict word comes first — `ok`, `DEGRADED`, or `DEAD`.

## How to check — from a shell

**1. Boot-log grep** — every bot process logs its lane report once at startup:

```bash
docker logs mira-bot-telegram 2>&1 | grep OCR_LANES | tail -1       # prod
docker logs stg-mira-bot-telegram 2>&1 | grep OCR_LANES | tail -1   # staging
```

Logged at `mira-bots/telegram/bot.py:145`
(`logger.info("OCR_LANES %s", json.dumps(ocr_lane_report()))`), imported at `bot.py:55`.

**2. Scheduled probe (`ocr-lane-health`)** — `.github/workflows/printsense-staging-e2e.yml`,
job at `:156`, riding the workflow's existing triggers (`workflow_dispatch` +
`schedule: cron "*/30 * * * *"` at `:23-25`). Three skip-clean guards run before it ever
touches the bot — `VPS_SSH_KEY` secret present (`:166-176`), VPS reachable over ssh
(`:194-204`), `stg-mira-bot-telegram` container actually running (`:206-217`). Any guard
failing short-circuits with `::notice`/`::warning` and never reds the run. Only when the
container **is** running does it `docker exec -w /app stg-mira-bot-telegram` the same
`ocr_lane_report()` used above (`:227-233`) and fail (exit 1) if `verdict != "ok"`. Check the
Actions tab for this workflow, job `ocr-lane-health`.

**3. Recall gate (`ocr-recall-gate`)** — **PR #2801 (PR-B), open, stacked on
`fix/ocr-regime-floor` — not yet on this branch, merges separately.** Adds a dedicated
`ocr-recall-gate` job to `.github/workflows/ci.yml` running
`tests/printsense/test_ocr_recall_gate.py` against `printsense/benchmarks/ocr_recall_bench.py`'s
`recall()` over a synthetic, $0, deterministic fixture (known token strings + bboxes). The
floor value (`RECALL_FLOOR`) starts at `0.60` and is meant to be recalibrated at PR-B's first
real CI run to (measured recall − 0.10) — see that PR's body for the actual number once it
lands.

---

## Failure modes + first moves

| Symptom | Likely cause | First move |
|---|---|---|
| `ocr_lane_report()["verdict"] == "DEAD"` (phone check, boot log, or the scheduled probe reds) | Image build dropped Tesseract | Confirm `mira-bots/telegram/Dockerfile:3` (`apt-get install ... tesseract-ocr`) actually ran in the deployed image and `mira-bots/telegram/requirements.txt:3-4` (`Pillow>=12.2.0`, `pytesseract>=0.3.13`) are installed — `docker exec <container> tesseract --version`. |
| `ocr-recall-gate` red (once PR-B is merged) | Tesseract/PSM/render drift on the fixture | Read the printed recall number in the CI job log **first** (`psm=... recall=X.XX (found/expected) missing=[...]`). Never touch the floor code without the measured number in hand — see the plan's "never calibrate truth away" law. |
| Autoeval `ocr_floor_dead` P0 ntfy push (`print_autoeval.py:243-254`) | The floor died mid-flight in prod, on a live `ELECTRICAL_PRINT` turn | Check the container's `OCR_EXPECT_TESSERACT` value, then re-run the boot-log grep above for the current verdict. If `DEAD`, redeploy or investigate the image build; the rule only fires when the floor was *expected* up (backward-compatible — pre-provenance rows and `OCR_EXPECT_TESSERACT` unset never fire). |

The P0 rides the bot's existing generic alert path — `should_alert()` / `ALERT_LIMITER` /
`send_push()` at `mira-bots/telegram/bot.py:1125-1132` — same rate-limited ntfy channel every
other autoeval P0 uses, so it pages within one live turn instead of rotting silently for weeks
(the original glm-ocr failure mode this whole plan exists to prevent).

---

## Re-enable procedures

**Model lane:** set `OCR_MODEL_LANE=on` in the relevant compose row
(`docker-compose.staging-vps.yml:452`, `docker-compose.saas.yml:371`, or
`mira-bots/docker-compose.yml:44` for local dev) and redeploy. It routes through the same free
inference cascade as vision classification (`_inference_router.complete()`,
`vision_worker.py:496-533`) and only **supplements** the floor — `ocr_source` becomes
`tesseract+model` when both lanes return items; it never suppresses floor results. Benchmarked
weak on dense schematics (2026-07-17 UNSEEN benchmark) — don't rely on it as a primary source
without a fresh calibration run.

**Paid interpreter:** PR-F, blocked on Mike — needs OpenAI credits/dashboard cap plus explicit
sign-off, because `printsense/interpret.py` is a never-calibrate guarded file. See the plan's
PR-F section for the exact scope.

---

## Linked references

- Design + build log: `docs/plans/2026-07-18-ocr-regime-repair.md`
- `mira-bots/shared/workers/vision_worker.py` — floor bridge, model lane, `ocr_lane_report()`
- `mira-bots/shared/print_autoeval.py` — `ocr_floor_dead` P0 rule
- `mira-bots/telegram/bot.py` — boot self-check log, P0→ntfy wiring
- `mira-bots/telegram/printsense_testkit.py` — `/printsense_test ocr`
- `printsense/xref_extractor.py` — `ocr_tokens()`, `line_items()`, `OcrUnavailable`
- `.github/workflows/printsense-staging-e2e.yml` — `ocr-lane-health` scheduled probe
- `.github/workflows/ci.yml` — `ocr-recall-gate` (PR-B, pending merge)
- `docs/env-vars.md` — full env var reference
- Zero-token spend law: `.claude/rules/zero-token-architecture.md`
