# Slack Fast-Path Parity with Telegram (①–④) — Design

**Date:** 2026-07-18
**Status:** Approved (design); ready for implementation plan
**Owner:** MIRA maintainers
**Scope:** Bring the Slack adapter (`mira-bots/slack/`) to capability parity with the
Telegram adapter for the four grounded-diagnosis fast-paths. Voice, multi-photo burst,
QR deep-link, admin bypass, and the Telegram→shared-router migration are explicit
non-goals (see §7).

---

## 1. Problem & goal

MIRA's Telegram bot has four adapter-level "fast-paths" that answer grounded
maintenance turns **without** the full FSM/LLM engine round-trip — instant, cited,
read-only (or `proposed`-write) responses. Slack has the shared diagnostic engine,
PDF→Hub ingest, slash commands, safety escalation, and citation compliance, but
**none of these four fast-paths**. The goal: a technician on Slack gets the same
grounded-diagnosis behavior a technician on Telegram gets.

The four fast-paths (Telegram source of truth):

| # | Fast-path | Telegram fn | Behavior |
|---|-----------|-------------|----------|
| ① | Nameplate photo → cited drive-pack ID | `telegram/bot.py:_try_nameplate_drive_pack_reply` (767) | Extract nameplate → `resolve_service_pack` → answer from pack JSON (no LLM), set thread drive-context, emit Hub asset-identity |
| ② | Wiring photo → proposed rows | `telegram/bot.py:_try_wiring_intake_reply` (863) | Caption intent → `_extract_schematic` → `payload_to_proposed_rows` → write `approval_state='proposed'` → preview |
| ③ | Wiring text → verified-only Q&A | `telegram/bot.py:_try_wiring_question_reply` (620) | Parse wiring question → answer from **verified** rows only → refuse if undocumented (no LLM guess) |
| ④ | Drive-pack text continuity | `telegram/bot.py:_try_drive_pack_followup` (541) | Thread has a recent drive-context + text reads as a drive/param question → answer from that pack |

**Key finding:** the answer-logic already lives in shared modules
(`shared/drive_packs/*`, `shared/wiring_intake.py`). Only the *orchestration* and the
*drive-context store* are currently Telegram-local. So parity is mostly re-wiring, not
re-implementing.

---

## 2. Decisions (locked during brainstorming)

1. **Scope:** core fast-paths ①–④ only.
2. **Slack context scoping:** **per-thread** — keyed by `channel + thread_ts`, matching
   the Slack adapter's existing session key `slack:{channel}:{thread_ts}`. Two techs
   diagnosing different machines in the same channel (different threads) never collide.
3. **Architecture:** extract a **shared router** (`shared/chat/fast_paths.py`) that both
   adapters *can* use; **wire Slack onto it now**, leave Telegram on its working copy,
   and migrate Telegram in a **separate, test-guarded PR**. Net: Slack parity with zero
   new duplication; the live Telegram production bot is untouched this PR.

---

## 3. Architecture

```
Slack event ──► slack/bot.py handle_message
                     │  (PDF branch unchanged — returns early)
                     ▼
              adapter.normalize_incoming ──► NormalizedChatEvent
                     │  (photo bytes downloaded+resized onto attachment.data;
                     │   tenant resolved via shared identity path)
                     ▼
        resp = await try_fast_paths(event, engine)   ◄── NEW shared/chat/fast_paths.py
                     │
             ┌───────┴────────┐
        resp is not None    resp is None
             │                  │
        say(resp) + log     dispatcher.dispatch(event)   (existing path, unchanged)
```

The router is **adapter-agnostic**: it takes a `NormalizedChatEvent`
(`shared/chat/types.py`) with pre-downloaded photo bytes in `attachment.data`, and
returns a `NormalizedChatResponse` or `None`. It has no Slack/Telegram imports.

### 3.1 New module — `shared/chat/fast_paths.py`

```python
async def try_fast_paths(
    event: NormalizedChatEvent,
    engine: Supervisor,
) -> NormalizedChatResponse | None:
    """Return a normalized response if a grounded fast-path claims this turn,
    else None (caller falls through to the FSM/LLM dispatcher).

    Precedence mirrors the Telegram adapter exactly. Fast-paths are read-only or
    `proposed`-write, cited, and never invoke the LLM. Any turn classified as a
    safety turn is handed straight to the engine (SAFETY_ALERT) — a fast-path must
    never swallow a safety escalation.
    """
```

Internal helpers (private, one per fast-path) and precedence:

- **Guard — safety first.** `if classify_intent(event.text) == "safety": return None`.
  The engine owns `SAFETY_ALERT`. (Mirrors the existing "engine hook yields to
  SAFETY_KEYWORDS" doctrine.)
- **Photo event** (`event` has an `image` attachment with non-empty `.data`):
  1. `_try_nameplate_drive_pack(event, engine)` — `engine.nameplate.extract(...)` →
     `resolve_service_pack(...)`; on a resolved pack: `set_drive_context(source,
     session_key, pack_id)`, fire-and-forget Hub asset-identity submit
     (`build_asset_identity` + shared Hub submit, §3.3), return a cited
     `NormalizedChatResponse` ("Identified: <make> <model> — ask me about it" + the
     answer if the caption was a question).
  2. `_try_wiring_intake(event, engine)` — `wiring_intake.parse_wiring_intent(caption)`;
     on intake intent: `engine._extract_schematic(...)` →
     `wiring_intake.payload_to_proposed_rows(...)` → `write_proposed_rows(cur,
     tenant_id, rows)` (`approval_state='proposed'`) → `build_intake_preview(...)`.
  3. else `None` (→ engine multi-photo/vision).
- **Text event:**
  1. `_try_drive_pack_followup(event)` — `pack_id = get_drive_context(source,
     session_key)`; if set and (`answer_question(pack_id, text).matched` OR text
     matches the drive/param regex), return the cited pack answer and refresh the
     context TTL.
  2. `_try_wiring_question(event)` — `wiring_intake.parse_wiring_intent(text)`; on a
     question intent: load **verified** rows and `format_wiring_answer(...)` (refuses
     with `wiring_intake.MISSING_ASSET_REPLY` / undocumented message — never guesses).
  3. else `None` (→ engine).

**Return shape:** every fast-path builds a `NormalizedChatResponse(text=…,
thread_id=event.external_thread_id)`. Blocks are optional (a `citation`/`warning`
block MAY be added later); the plain-text `text` is always populated so both adapters
render correctly today.

**Sync-DB glue:** wiring reads/writes and drive-pack answers touch psycopg2/sqlite
(sync). The router wraps them in `asyncio.to_thread(...)`, exactly as Telegram does
(`telegram/bot.py:_write_rows_blocking`, `_answer_wiring_blocking`,
`asyncio.to_thread(answer_question, …)`).

### 3.2 New module — `shared/chat/drive_context.py`

Adapter-agnostic generalization of Telegram's `telegram_drive_context`:

```sql
CREATE TABLE IF NOT EXISTS chat_drive_context (
  source      TEXT NOT NULL,   -- "slack" | "telegram" | …
  session_key TEXT NOT NULL,   -- adapter session key (Slack: slack:{ch}:{thread_ts})
  pack_id     TEXT NOT NULL,
  updated_at  REAL NOT NULL,
  PRIMARY KEY (source, session_key)
);
```

```python
_DRIVE_CONTEXT_TTL_S = 1800  # 30 min, module-level, read at call time (overridable)

def set_drive_context(source: str, session_key: str, pack_id: str) -> None: ...
def get_drive_context(source: str, session_key: str, max_age_s: int | None = None) -> str | None: ...
```

- SQLite at `MIRA_DB_PATH` (default `/data/mira.db`), `PRAGMA journal_mode=WAL`.
- Failures are swallowed with a warning — a context write must never break the turn
  (mirrors Telegram's `_set_drive_context`).
- `source` isolation means the Slack bot container and Telegram bot container never
  read each other's rows even if they ever shared a DB file (they don't today —
  separate containers).
- **Telegram is not migrated in this PR.** Its `telegram_drive_context` table and
  `_set/_get_drive_context` helpers stay. A later PR moves Telegram onto this module
  and drops the old table (with its ~2300 LOC of tests as the safety net).

### 3.3 Photo → Hub asset-identity submit

Telegram fires the identified asset to the Hub in the background
(`telegram/bot.py:_submit_photo_to_hub` + `build_asset_identity`). For ① parity the
router does the same as a fire-and-forget task. The submit is small and adapter-
agnostic (HTTP POST with bearer + tenant header); it is **extracted to a shared
helper** (`shared/chat/hub_submit.py::submit_asset_identity(...)`, or a function inside
`fast_paths.py` if it stays under ~30 lines) so Slack and the future Telegram
migration share one implementation. Failure is non-fatal (logged, never blocks the
reply).

### 3.4 Slack adapter wiring — `slack/bot.py`

In `handle_message`, after the existing PDF early-return and before the dispatcher
dispatch:

1. Build/receive the `NormalizedChatEvent` via `adapter.normalize_incoming(event)`.
2. Ensure any image attachment has `.data` populated (download via
   `_download_slack_file` + `_resize_for_vision`, as today) and `tenant_id` resolved
   via the same shared identity/`chat_tenant` path the dispatcher uses.
3. `resp = await try_fast_paths(normalized, engine)`.
4. If `resp is not None`: `await say(text=resp.text, thread_ts=thread)` (Block Kit
   blocks optional), then `log_turn(..., source="slack")`, and **return**.
5. Else: the existing `dispatcher.dispatch(normalized)` path runs unchanged.

No engine change. No change to the PDF path, commands, or dedup.

---

## 4. Data flow (worked examples)

- **Nameplate photo (thread T):** photo → `_try_nameplate_drive_pack` resolves
  `gs10` → reply "Identified: TECO GS10 …", `set_drive_context("slack", "slack:C:T",
  "gs10")`, Hub asset-identity submitted. Follow-up **text in T** "what is P09.03?" →
  `_try_drive_pack_followup` finds `gs10` for T → cited pack answer. Same question in a
  **different thread T2** → no context → falls to engine.
- **Wiring photo captioned "CV-101 add this wiring":** `_try_wiring_intake` extracts
  the schematic, writes N `proposed` rows, replies with the insert/skip preview.
- **Text "where does W200 land on CV-101?":** `_try_wiring_question` answers from
  verified rows, or refuses ("not documented") — never an LLM guess.
- **Text "the panel is arcing":** safety guard → `None` → engine `SAFETY_ALERT`.

---

## 5. Error handling

- Every fast-path is wrapped so an internal failure returns `None` (fall through to the
  engine) rather than erroring the turn — a broken fast-path degrades to the normal
  path, never to a stack trace at the technician.
- DB writes (wiring `proposed` rows) are transactional via the existing
  `wiring_intake.write_proposed_rows`; a failure logs and falls through.
- Hub submit failure is non-fatal (logged).
- Context store failure is swallowed with a warning.

---

## 6. Testing (TDD — tests written before implementation)

| Test file | Layer | Asserts |
|-----------|-------|---------|
| `mira-bots/tests/test_chat_drive_context.py` | unit | set/get round-trip; TTL expiry; `source` isolation; corrupt-DB swallow |
| `mira-bots/tests/test_fast_paths_router.py` | unit (fake engine) | nameplate resolves → cited response + context set; wiring caption → `proposed` rows written; wiring question → verified-only / refusal; drive-followup with/without context; **safety text → returns None**; non-matching text/photo → returns None |
| `mira-bots/tests/test_slack_fast_paths.py` | Slack integration | photo event → nameplate response via `say(thread_ts=…)`; same-thread text follow-up answers from pack; different thread independent; PDF/commands/dispatch paths untouched |

The router is pure-ish (normalized in, normalized out, injected engine) so the unit
suite needs no Slack/Telegram runtime. Mirrors the existing Telegram fast-path tests
(`test_telegram_nameplate_ask.py`, `test_telegram_wiring_hooks.py`,
`test_telegram_drive_followup.py`).

---

## 7. Non-goals (explicitly deferred)

- ⑤ Multi-photo burst queue (Slack processes one photo/turn for now).
- ⑥ Voice-in transcription, ⑦ voice-out TTS — Slack Socket Mode does not surface voice
  files to bots.
- ⑧ QR-scan asset deep-link, ⑨ `ADMIN_SLACK_IDS` bypass.
- **Telegram migration onto `shared/chat/fast_paths.py` + `drive_context.py`** — its own
  test-guarded PR, to avoid touching the live Telegram production bot here.
- Button/suggestion-chip callback handling — a *shared* gap (neither adapter wires it
  today), out of scope.

---

## 8. Blast radius & safety

- **Touched:** `shared/chat/fast_paths.py` (new), `shared/chat/drive_context.py` (new),
  optional `shared/chat/hub_submit.py` (new), `slack/bot.py` (wiring), new tests.
- **Untouched:** Telegram adapter, `shared/engine.py`, the FSM, the dispatcher, PDF
  ingest, commands.
- Fast-paths are read-only or `proposed`-write — they honor the KG "never auto-verify"
  rule (`.claude/rules` / ADR-0017) and the read-only-first product doctrine.
- Safety escalation is preserved: the router yields any safety turn to the engine.
- UNS/direct-connection rules unaffected — Slack is a chat surface; the fast-paths do
  not begin *asset-specific troubleshooting* beyond cited pack/wiring lookups, and the
  engine's UNS gate still governs the fall-through path.

---

## 9. Open questions (none blocking)

- Whether to render a `citation` Block Kit block for the pack answer now or in a
  follow-up — deferred; plain-text `text` ships first (parity with Telegram, which
  replies plain text).
- Exact shared home for the Hub submit helper (`hub_submit.py` vs inline) — decided at
  implementation time based on final LOC.
