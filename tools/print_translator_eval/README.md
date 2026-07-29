# Print Translator Eval Runner

Exercises the **real, merged** Print Translator code
(`mira-bots/telegram/bot.py::_try_print_translator_reply`,
`mira-bots/shared/print_translator.py`, `mira-bots/shared/workers/vision_worker.py`,
`mira-bots/shared/inference/router.py`) against a rendered page from a cited
OEM PDF in the campaign corpus manifest
(`docs/eval/print-translator-campaign/corpus_manifest.md`).

**No mocks. No replacement prompt. No Telegram. No prod. No DB writes.** See
the module docstring in `run.py` for the full honesty contract — the short
version: if inference genuinely can't run from wherever you're invoking this,
the JSON record says so explicitly (`"inference": "unavailable"`, with a
`"reason"`) instead of fabricating a response.

## What it actually calls

- `bot.py` is imported as a real Python module (not subprocessed, not
  reimplemented). That constructs the real `Supervisor` (`engine`), which
  constructs the real `VisionWorker` (`engine.vision`) and the real
  `InferenceRouter` (`engine.router`).
- `bot._try_print_translator_reply(image_bytes, caption, update, context)` is
  called directly. `update`/`context` are a minimal in-process stand-in (no
  network) that only implements what the handler reads:
  `update.message.reply_text(...)` and `update.effective_chat.id`.
- `engine.vision.process` and `engine.router.complete` are wrapped with a
  **spy** before the call — it calls straight through to the real method and
  records what was passed in / returned, it never substitutes a canned
  response. This is how the runner captures `vision_data` / the built
  messages / the router usage for the JSON record without reimplementing the
  handler's logic.
- If `bot.py` cannot be imported in your environment (missing
  `python-telegram-bot`, or `Supervisor()` construction fails for some other
  reason), the runner falls back to calling
  `shared.print_translator.build_theory_messages` +
  `shared.inference.router.InferenceRouter().complete` directly — still real
  code, still real inference, just without the vision/OCR step (which lives
  behind `Supervisor`/`bot.py`). The output record says `"bot_importable":
  false` and includes the import error.

## Environment

Cheapest path: run with `factorylm/dev` Doppler secrets (never `prd`):

```bash
doppler run --project factorylm --config dev -- python \
    tools/print_translator_eval/run.py --id 17 --page 30 \
    --caption "Explain this print."
```

`factorylm/dev` carries `GROQ_API_KEY` / `CEREBRAS_API_KEY` /
`TOGETHERAI_API_KEY` but does **not** define `INFERENCE_BACKEND` — the
runner sets `INFERENCE_BACKEND=cloud` itself (via `setdefault`, so it never
overrides a real value) to match how production actually runs
(`INFERENCE_BACKEND=cloud` per root `CLAUDE.md`), since `InferenceRouter`
defaults to `"local"`/disabled otherwise.

`VisionWorker`'s OCR call (`glm-ocr`, no cloud fallback) and its vision-model
local fallback both hit `OPENWEBUI_BASE_URL` (default
`http://mira-core:8080`), a Docker-internal hostname that will not resolve
outside the MIRA compose network. From a bare host this means:

- The vision **description** call (`_call_vision`) still runs for real via
  the cloud cascade (Groq's vision-capable model is first in the cascade) —
  as long as `INFERENCE_BACKEND=cloud` and a provider key are present.
- The **OCR** call (`_call_ocr`, `glm-ocr:latest`) has no cloud fallback and
  will fail to connect, so `ocr_items` will genuinely come back `[]` — this
  is the real code's honest behavior given the network it's reachable from,
  **not** something the runner fabricates. `print_translator._ocr_block`
  then honestly renders "No OCR labels were extracted; rely on the image."
- Tesseract (`_ocr_extract`) needs the `tesseract` binary on `PATH`; if it's
  not installed, that field comes back empty too (caught by its own
  try/except inside `VisionWorker`).

None of this is worked around by the runner — it is reported as-is in the
JSON record's `vision.ocr_item_count` / `vision.tesseract_text_len`.

## Usage

```bash
# 1. Inspect a manifest entry's PDF page-by-page to pick a schematic page
#    (wiring/schematic content is rarely page 0 of a chapter PDF).
python tools/print_translator_eval/run.py --id 17 --list-pages

# 2. Run the real path against the chosen page.
doppler run --project factorylm --config dev -- python \
    tools/print_translator_eval/run.py --id 17 --page 30 \
    --caption "Explain this print."
```

Writes `docs/eval/print-translator-campaign/results/<id two-digit>.json` and
prints the same record to stdout. Re-running with the same `--id`/`--page`
re-downloads only if the cached PDF (keyed by URL hash, under the OS temp
dir) is missing — the PDF and rendered page image are never written into the
repo, only their sha256 and the manifest metadata.

## What's NOT here

- No correctness/usefulness scoring — a human technician has to judge that.
- No full-corpus batch runner. The manifest's `Page/Section` column is a
  chapter/range reference (e.g. "Ch. 2, power & control wiring"), not a
  numeric PDF page, for 23 of 25 entries — each needs a one-time
  `--list-pages` pass to pick the right page before it can run
  unattended. That page-selection pass is the main thing a full campaign run
  needs that this tool doesn't automate.
- No DB writes, no `wiring_connections` involvement — this is a read-only,
  generation-only eval, matching the Print Translator's own scope (see
  `mira-bots/shared/print_translator.py` module docstring).
