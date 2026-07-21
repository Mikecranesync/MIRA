# Recall-Gate the Production Print Path (PR-G follow-up #2)

**Date:** 2026-07-20
**Status:** Approved (build spec supplied by Mike, `implement this`), implementing
**Base:** `main` @ `24eb95b71` (VERSION 3.183.0) — PR G shipped the CLI-only recall gate.
**Branch:** `feat/printsense-prod-recall-gate`

This doc is the plan of record. It implements the uploaded build spec
(`printsense_production_recall_gate_claude_code_prompt.md`) and records the design
decisions where that spec left a choice. Build the PR, run the full relevant
suite, **stop before merge** with a review report.

## Context & goal

PR G recall-gated the paid `printsense.interpret.interpret_print` call on the
**CLI only** (`--recall`, default OFF). The gate is inert on the real product: the
production Telegram/Slack print path still re-pays the vision model for an
identical print every time.

**Goal:** an identical print turn on the production path is interpreted **once**
and recalled thereafter with **no model call** — **behavior-preserving**: the
technician's rendered reply is byte-for-byte identical whether the graph is fresh
or recalled.

**Non-goals (out of scope, deliberately):** the two-tier question-neutral prompt
(cross-question reuse), Neon backend, any user-facing change / "recalled" marker,
control writes, new model routing, new prompt behavior.

## The single production seam

Both prod paths converge on **`engine._interpret_print_anthropic_pages()`** (the
only place prod calls `interpret.interpret_print`):

- single-photo: `engine.process()` → `_interpret_print_anthropic()` → `_interpret_print_anthropic_pages()`
- album worker: `_try_multi_photo_printsense_reply()` → `_interpret_print_anthropic_pages()`

The gate is inserted there and nowhere else. `interpret_print` stays a stateless
paid primitive; recall **wraps** it (the fast-path-optimization rule).

## Behavior-preserving recall key (decided with Mike)

Today the paid graph is shaped by `question` + `package_context` (drawing type /
OCR). So the recall key covers **all** graph-affecting inputs: ordered page bytes
+ model + preprocess + schema version + producer/prompt version + **exact
question** + **canonical package context**. Implemented by folding
`canonical_json({question, package_context})` into `producer_extra`, a new optional
param on `interpret_print_with_recall`. `producer_extra=None` (the CLI default)
keeps the legacy page-only key byte-for-byte unchanged.

`canonical_json`: `sort_keys`, preserved list order, preserved unicode
(`ensure_ascii=False`), preserved `null`, compact separators, `allow_nan=False`.
The question is used verbatim — never normalized beyond the value sent to the
interpreter.

## Design decisions where the build spec left a choice

1. **Cross-process safety is required (not optional).** Verified: `mira-bot-telegram`
   and `mira-bot-slack` are separate containers that **both mount the same host dir**
   `/opt/mira/data:/mira-db`. So two processes can write the same registry snapshot.
   Chosen model:
   - **Per-key single-flight (in-process):** a keyed `threading.Lock` map (refcounted
     cleanup) so concurrent identical requests in one process make **exactly one**
     paid call: lookup → (miss) acquire key lock → re-lookup → paid once → persist.
   - **Cross-process registry safety:** the paid call happens **outside** any file
     lock; only the fast persist takes an **OS advisory file lock** (`fcntl.flock` on
     POSIX/containers; a `threading.Lock` fallback on Windows dev, which is
     single-process) around a **re-hydrate → register → atomic write** so a
     concurrent writer's entries are never clobbered.
   - **Fresh registry per operation** (not a long-lived in-memory singleton): the
     snapshot file is the source of truth, so each lookup reads fresh (atomic replace
     makes lockless reads safe) and each write re-hydrates under the file lock. CAS is
     a process singleton (content-addressed + atomic writes → inherently safe). This
     is the cleaner shape the spec invites over a stale in-memory singleton.
   - The file lock is held only for the millisecond-scale persist — **never across a
     paid interpretation**, so unrelated keys are never serialized behind one model
     call.
2. **Truthful environment metadata.** `EvidenceManifest.environment` is set from
   `PRINT_RECALL_ENV` (`dev|staging|prod`, default `dev`), set per Doppler config —
   never hardcoded `DEV` in prod. Tenant is the single constant `PRINT_RECALL_TENANT`
   (default `"printsense"`), defined in one place.
3. **Enablement:** `PRINT_RECALL_ENABLED` (default **false**). Import of
   `materialized_evidence` / `printsense.recall` is inside a safe boundary → a missing
   package disables recall (falls through to the plain paid call) and logs
   `PRINT_RECALL_UNAVAILABLE reason=import_error` **once per process**.
4. **Persistence:** `/mira-db/print_recall/registry.json` + `/mira-db/print_recall/cas/`
   (durable, on the mounted volume). Snapshot writes atomic (temp → flush → fsync →
   `os.replace`). Malformed registry JSON → quarantine the file, log
   `PRINT_RECALL_CORRUPT_REGISTRY`, treat as empty, continue. A registry entry whose
   CAS object is missing/unreadable → ordinary miss → recompute.

## Failure handling by phase (never a second paid call)

- **Before inference** (registry/CAS read, corrupt snapshot, missing object, import):
  treat as miss/unavailable → one normal paid call.
- **During inference** (paid interpreter raises): propagate per current behavior; **no**
  retry, **no** second model call.
- **After inference** (CAS/registry/snapshot write fails): return the already-produced
  graph, log `PRINT_RECALL_STORE_FAILED`; **never** re-invoke the interpreter.

## Files

- `printsense/recall.py` — add `producer_extra` + `canonical_json` (done).
- `mira-bots/shared/print_recall.py` — **new** bot-side gate (enablement, paths,
  per-key single-flight, cross-process file lock, fresh registry / singleton CAS,
  fall-through, structured logs).
- `mira-bots/shared/engine.py` — `_interpret_print_anthropic_pages` calls the gate when
  enabled, else the existing direct call (render path unchanged).
- `mira-bots/telegram/Dockerfile`, `mira-bots/slack/Dockerfile` — `COPY materialized_evidence/`.
- Tests: `tests/printsense/test_recall_producer_extra.py`, `mira-bots/tests/test_print_recall.py`,
  `mira-bots/tests/test_engine_print_recall.py`, packaging import test.
- `VERSION` bump + `docs/CHANGELOG.md`.

## Observability

Structured logs: `PRINT_RECALL_HIT` / `_MISS` / `_STORE_FAILED` / `_LOOKUP_FAILED` /
`_CORRUPT_REGISTRY` / `_UNAVAILABLE`. Hit carries `recall_key_prefix`,
`avoided_compute_ms`, `page_count`. **Never** log page bytes, OCR text, full question,
or package context.

## Rollout (later — not enabled in this PR)

Ship dark (`PRINT_RECALL_ENABLED=false`) → enable in `factorylm/stg` → phone-test the
same print twice (first `MISS`, second `HIT` with `avoided_compute_ms`, one paid call,
identical replies) → enable in `factorylm/prd`.

## Testing — $0, hermetic

Every test mocks the paid boundary; zero real model calls. Matrix per the build spec
(recall key, gate enablement/fall-through, per-key single-flight, failure-by-phase,
corrupt registry, missing CAS object, engine seam byte-identical render, packaging
import).
