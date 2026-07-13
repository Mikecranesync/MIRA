---
name: print-eval-email-loop
description: Use when running a public OEM electrical print through MIRA's REAL Telegram print-translator production path to grade it and email one standalone report — the internet-print evaluation loop (tools/internet_print_test/runner.py). Triggers on "run the print email loop", "test a print", "run this diagram through the real path", "grade a print", "email me a print report", "run the next corpus case", or evaluating print-interpretation quality on a new drawing. One case at a time; the deterministic grader owns import safety, never the prose. Use this even when the user just names a manufacturer print and says "see how MIRA does with it".
---

# print-eval-email-loop

Run ONE public OEM electrical print through the **real** MIRA Telegram print-translator (the same code a technician hits), grade it, and email exactly one report. This is an **orchestration** skill — it drives `tools/internet_print_test/runner.py`; it is **not** a grader and holds no scoring logic.

## Why this exists

> **Good prose does not imply a trustworthy graph.**

The Schneider ATV340 run read fluently and scored 81/B from the LLM judge — while its structured graph invented terminal names (`DQ1`→`DO1`), mis-wired RS422, and merged frame variants. A useful explanation can still carry a machine artifact that would corrupt a wiring map, machine pack, or KG on import. So every case gets two separate verdicts — **quality tier** (useful to a tech?) and **import verdict** (safe to auto-import?) — and the deterministic grader owns the import verdict. Full contract: `docs/plans/2026-07-13-print-eval-gold-standard.md` (extends `printsense/PATH_TO_A.md`).

## Skill boundary — what this skill must NEVER contain

The value of a repeatable loop is that the *bar* lives in one place. Do not embed here: scoring thresholds, label grammar, truth data, manufacturer-specific rules, or benchmark expected values. Grading goes through the stable grader interface / `runner.py`. If you're tempted to add a "for Schneider, expect DQ1" rule here, that belongs in the case's `rubric.json`, not the skill.

## The loop (one case at a time)

1. **Pick the case.** A `test_id` from `tools/internet_print_test/sources.json`, or a new `--source-url` / `--local-file`. For the corpus queue + what's already run, see the durable spec §6.
2. **Verify the page BEFORE spending an interpret.** A paid interpret is ~90–250 s and real money — don't burn it on a cover/TOC page. Preview with `--dry-run` (the default: validates + plans, no download/submit/email), and eyeball that the selected `--page` is the actual schematic. Several corpus `page` values needed correcting this way; page choice is load-bearing (a Siemens case moved 110→127 to hit the real wiring).
3. **Run through the REAL production path** (see command below). PDFs are **not** interpreted in prod — the runner renders the selected page to PNG (PyMuPDF) and submits via the **photo** path, exactly what a technician gets by photographing a print. `--telegram-production-path` pre-flights the real bot import and **exits 2** if it can't load, so you can never accidentally grade a mock.
4. **Grade.** The runner produces the deterministic grade (import safety) and, unless `--no-judge`, the qualitative LLM judge. The deterministic verdict is authoritative — a qualitative judge may explain a failure but never clears it.
5. **Email exactly one report** (`--send-email`). One case = one email. An ungraded result is **HELD**, never sent — a report must always carry a score/tier/verdict.
6. **Confirm the send, then classify.** Success is the line `email send: {'sent': True, 'status': 200, 'id': ...}` in `internet_print_tests/<id>/run.log` — not "it probably sent". Then classify any failure and map it to the `PATH_TO_A` product backlog (Phase 0/2/3); rerun only after a relevant fix, never to manufacture a better number.

## Canonical command

```
doppler run -p factorylm -c stg -- py -3 tools/internet_print_test/runner.py \
  --telegram-production-path --test-id <id> --send-email
```

Interprets take minutes — **run it in the background** and confirm via `run.log`, don't block on it.

**Flags:** `--dry-run` (default — no download/submit/email) · `--test-id <id[,id]>` · `--category <c>` · `--count <n>` · `--source-url <url>` · `--local-file <path>` · `--page <i>` (default 0) · `--dpi <n>` (default 200) · `--caption <text>` · `--regrade` (re-judge saved artifacts — **no re-interpret, no spend**) · `--resume` (skip cases already having `telegram_response.json`) · `--send-email` · `--recipient <addr>` (default from `MORNING_REPORT_EMAIL`) · `--no-judge` (offline) · `--telegram-production-path` (require the real handler).

## Caption gate — use a passing phrase verbatim

The production caption gate (`mira-bots/shared/print_translator.py`) is a **substring** match against fixed phrases, so a single inserted word breaks it — "Explain this **safety** circuit" is REJECTED. Use one of these verbatim (each contains a listed phrase):

- `Explain this print.`
- `Explain this circuit.`
- `What devices and I/O are wired in this print?`
- `Describe the theory of operation.`
- `How does this work?`

## Safety & secrets (already enforced — respect, don't reimplement)

`safety.py` fails **closed**: robots.txt (disallow → drop, e.g. Yaskawa V1000), a content-sniffed MIME allowlist `{pdf,jpeg,png,webp,tiff}`, a 60 MB cap, 30 s timeout, 3 s/host politeness, and archive/executable magic rejection. Only public, robots-permitted manufacturer documents. Secrets come from **Doppler `factorylm/stg`** (`ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `MORNING_REPORT_EMAIL`, `RESEND_FROM`, `PRINT_VISION_PROVIDER=anthropic`) — never printed, never committed; every reported response is secret-redacted.

## Artifacts (immutable per run) — `internet_print_tests/<id>/`

`source.json` · `sha256.txt` · `tested_page.png` (gitignored) · `telegram_request.json` · `telegram_response.json` · `telegram_response.txt` (**LF-locked** by `.gitattributes` — don't "fix" its line endings) · `extraction.json` (the graph) · `deterministic_grade.json` · `judge_1.json` (+ `judge_2.json` only on a hard-fail escalation) · `report.md`/`report.html` · `run.log` · `email_manifest.json`. Preserve failures and prior attempts — never overwrite or delete a bad run.

## Done-when

The case ran against the real production path, `run.log` shows the `email send: {'sent': True …}` line (or an explicit `dry_run`/`HELD`/`failed` state), artifacts are intact and byte-faithful, and any failure is classified and linked to a `PATH_TO_A` backlog item. Evidence before assertion — confirm the send line; don't claim "emailed" from memory.

## What NOT to do

- ❌ Spend a paid interpret before eyeballing the page (use `--dry-run` first).
- ❌ Send more than one email per case, or retry a failed send into duplicates.
- ❌ Email an ungraded result (it must be HELD).
- ❌ Add scoring thresholds, label grammar, truth data, or manufacturer rules to this skill — that's the grader/`rubric.json`.
- ❌ Reword a caption so a word lands between gate phrases (it will be rejected).
- ❌ Swap a source just because it scored badly — replace only for access/robots/corruption/wrong-page reasons, and record why.

## Status

The runner + real production path + email + safety are live (merged via #2674). The **deterministic grader wiring** (two-axis verdict, `deterministic_grade.json`, grader-before-judge) lands across PRs 2/4 of the durable spec; until then the runner's grade comes from the LLM judge alone. Cross-refs: `docs/plans/2026-07-13-print-eval-gold-standard.md`, `printsense/PATH_TO_A.md`, `tools/internet_print_test/PLAN.md`.
