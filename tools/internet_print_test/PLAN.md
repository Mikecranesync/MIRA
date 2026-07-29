# Internet Electrical Print Test Runner — Implementation Plan + Reuse Map

Finds legitimate **public** electrical drawings, submits each through the **real** MIRA
Telegram Print-Translator production path (no mocking), preserves all evidence, grades
with an independent multimodal judge, and emails Mike a complete report.

**Constraints:** fresh branch, PR-only, no merge, no deploy. Default **`--dry-run`**, no
email until the package validates. Every download is untrusted data. No secrets in logs.

---

## The real production path (Phase-1 inventory, evidence-backed)

A technician photo travels:
`bot.photo_handler` → `_dispatch_single_photo` → **`bot._try_print_translator_reply(raw_bytes, vision_bytes, caption, update, context)`** (`mira-bots/telegram/bot.py:935`) →
`engine.vision.process` (VisionWorker: OCR + vision-LLM + deterministic `_classify_photo`) →
if `ELECTRICAL_PRINT` → `engine._grounded_print_reply` → **`_interpret_print_anthropic`** →
`printsense.interpret.interpret_print([(bytes,"image/jpeg")], …)` (Opus 4.8, effort `xhigh`,
`max_tokens=32000`, conf gate 0.55) → `printsense.render.format_graph_for_telegram(graph)` →
`update.message.reply_text(text)` — plain text, ≤3500 chars.

- **`_try_print_translator_reply` IS the deterministic entry point.** We call it in-process
  with Telegram-shaped stand-ins (fake `update`/`message`/`context`). Nothing in the pipeline
  is mocked — only the transport objects.
- **PDFs are NOT interpreted in prod** (`document_handler` posts them to the Hub). So a PDF
  source is rendered to a page image and submitted through the **photo** path. Documented as
  a deliberate, honest decision — this tests the interpreter (what a technician gets when they
  photograph a print or send a rendered page), not the raw-PDF→Hub door.
- **The `map` follow-up has no live wiring.** `format_map_for_telegram(graph)` is called
  directly on the same graph the interpreter produced.
- **No separate citation/safety module** in this path — grounding + measurement-specific safety
  + "never invent a voltage" are baked into the `interpret._SYSTEM` prompt/schema and the
  confidence gate; `safety_context` is model-authored and surfaces as `⚠️ …` in the reply.

### Two bugs in the existing `tools/print_translator_eval/run.py` we must not inherit
1. `run_via_bot_handler` calls the handler with **4 args** (`image_bytes, caption, fake_update,
   None`) — the current signature is **5** (`raw_bytes, vision_bytes, caption, update, context`).
   The new runner calls the 5-arg form (and passes a real fake `context` with `bot.send_chat_action`).
2. Its spy only wraps `vision.process` + `router.complete`. When Anthropic succeeds,
   `router.complete` is **never called**, so the old runner reports `router_called=False` and
   misses the real answer. The new runner adds a **spy on `printsense.render.format_graph_for_telegram`**
   (wrap-never-replace) to capture the `PrintSynthGraph`, the final text, and the map text.

---

## Reuse map

| Capability | Decision | Source |
|---|---|---|
| PDF fetch (cache, UA, redirects) | **reuse** `fetch_pdf` | `tools/print_translator_eval/run.py:138` |
| PDF page → image (PyMuPDF) | **reuse** `render_page` | `run.py:186` |
| Real-handler submission + fake context | **reuse pattern, fix 5-arg + add render spy** | `run.py:230,306` |
| PrintSynthGraph schema | **reuse** | `printsense/models.py` |
| Deterministic grader (optional gate) | **reuse if we emit a graph** | `printsense/grader.py` |
| Corpus manifest style | **reuse + extend** | `docs/eval/print-translator-campaign/corpus_manifest.md` |
| Email (Resend via httpx) | **reuse pattern, add base64 attachments** | `mira-bots/shared/notifications/morning_report.py:111` |
| Recipient / Doppler `RESEND_API_KEY` | **reuse** (`harperhousebuyers@gmail.com`, `factorylm/*`) | morning_report.py:27 |
| robots.txt / rate-limit / MIME / size caps | **BUILD-NEW** (safety.py) | — |
| Provenance/rights + `source.json` | **BUILD-NEW** | — |
| Per-drawing immutable dir + run.log | **BUILD-NEW** | — |
| Multimodal Sonnet judge | **BUILD-NEW** (Anthropic Sonnet, image+response) | — |
| Aggregate index | **BUILD-NEW** | — |
| Operating modes | **BUILD-NEW** (argparse) | — |

**Do NOT duplicate:** `fetch_pdf`, `render_page`, the spy pattern, the grader, the manifest format.

---

## Module layout (`tools/internet_print_test/`)

- `runner.py` — CLI + orchestration (download → render → **real submit** → judge → report → email).
- `sources.py` — curated **public** source registry (OEM/edu/gov/patent), trust level, provenance.
- `safety.py` — untrusted-download guards: robots.txt, per-domain rate limit, MIME allow-list,
  bounded/streamed download with size cap, archive rejection, **prompt-injection neutralization**
  (document/OCR/filename/metadata text is DATA — never instructions; the judge prompt hard-wraps it).
- `submit.py` — the real entry point (import `bot`, fake context, 5-arg call, render spy).
- `judge.py` — independent Sonnet multimodal judge (sees tested_page + exact response); rubric +
  hard-failure rules; provisional score.
- `mailer.py` — Resend + base64 attachments (Doppler `RESEND_API_KEY`); dry-run builds the package
  without sending; overflow → tested-page + report + source URL.
- `report.py` — per-drawing `report.md`/`report.html` + aggregate `index.{json,md}`.

## Per-drawing immutable dir — `internet_print_tests/<test_id>/`
`source.json`, `original.{pdf,png,jpg}`, `tested_page.png`, `sha256.txt`, `telegram_request.json`,
`telegram_response.txt`, `telegram_response.json`, `extraction.json`, `judge_1.json`,
`judge_2.json` (escalation only), `report.md`, `report.html`, `run.log`. Large binaries are
gitignored; a small **sanitized** sample set is committed for the PR.

## Judge (independent, multimodal, provisional)
Sonnet inspects the **actual drawing** + the **exact bot response** and grades sheet identity,
purpose, devices, wires/cables, terminals, voltages, cross-refs, uncertainty calibration,
invented claims, technician usefulness, safety language, readability, completeness, and whether
the "map" offer is supported. **Every deduction cites a visible feature or a specific sentence.**
**Hard fails:** invented voltage/device/terminal-as-fact, missed hazardous voltage clearly shown,
false certainty on illegible areas, non-electrical image accepted as a print, lost original.
Score is **PROVISIONAL until Mike calibrates the rubric** (stated on every report).

## Operating modes
`--dry-run` (default), `--source-url`, `--local-file`, `--count`, `--category`, `--send-email`,
`--recipient`, `--resume`, `--regrade`, `--telegram-production-path` (enforces the real in-process
handler; fails if `bot` isn't importable — it never opens a live prod Telegram connection).

## Delivery sequence
P3 golden-path (one clearly-public drawing, real pipeline, byte-preserved response) → P4 prove it
hit prod code → P5 email package in dry-run, inspect attachments → P6 send ONE test email →
P7 diverse 20-print corpus → P8 PR (impl + tests + docs + sanitized samples + honest results).

## Safety
Untrusted downloads (MIME allow-list, size cap, no archives/executables, robots + rate limit);
document text never changes instructions, sends email, reads secrets, or runs commands; secrets
only via Doppler, never printed/committed; no prod deploy; PR-only; all raw results preserved.
