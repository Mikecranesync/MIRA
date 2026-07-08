# Telegram nameplate-photo → drive-pack answer (read-only)

A maintenance technician on Telegram sends a **photo of a VFD nameplate with a question caption**
(e.g., "what does CE10 mean?") and MIRA resolves the correct **approved** service pack and answers
with grounded citations — read-only, no LLM fallback, no guessing.

## The workflow — one message, no UNS confirmation needed

1. **Technician snaps a photo** of a drive nameplate and adds a caption with a question
   (e.g., "GS10 CE10 fault — what should I check?", or just "what does CE10 mean?").
2. **Bot extracts drive identity** from the photo via vision (`engine.nameplate.extract()`) —
   yields structured fields: `manufacturer`, `model`, `serial`, optionally `series` /
   `description` / `component`.
3. **Fast-path resolver** (`resolve_service_pack()` from `mira-bots/shared/drive_packs/resolver.py`)
   matches the extracted identity to exactly one **LIVE** approved pack
   (e.g., `durapulse_gs10`, `powerflex_525`). **Candidate packs are structurally unreachable.**
4. **Answer the question** from the pack using `shared.drive_packs.answer_question()` — same
   deterministic, cited path as the Hub asset-chat and Ignition Ask-MIRA surfaces. If the pack
   covers the fault/parameter, cite it; if not, refuse honestly ("the pack doesn't document that").
5. **Format and send** the reply with source footer: `source: drive_pack · fallback_used: false · read_only: true`.

## Three surfaces, one contract

All three surfaces use the **same pack-resolution contract** and **same answer generation**:

| Surface | UNS identity | Start point |
|---|---|---|
| **Hub asset-chat** | Bound to an asset (e.g., `enterprise.garage.demo_cell.cv_101`) | Technician types a question in an asset's chat panel; engine resolves context, then calls `resolve_service_pack()` |
| **Ignition "Ask MIRA" panel** | Bound to an asset tag in the Perspective view | Technician clicks "Ask MIRA" bound to a GS10 tag; engine knows the asset, resolves the pack, answers without a confirmation step |
| **Telegram nameplate photo** (this path) | Extracted from a photo, no pre-bound asset | Technician sends a nameplate photo + caption; vision extracts identity, resolver matches to pack, answers immediately |

**No engine FSM, no UNS confirmation, no multi-turn flow.** The nameplate itself IS the context.

## Approved vs. candidate packs (live only)

Only LIVE packs under `mira-bots/shared/drive_packs/packs/` are served at runtime:

- **`durapulse_gs10/`** — the gold reference (manual-cited + bench-verified, ship-ready).
- **`powerflex_525/`** — live, manual-cited.
- Future families as they onboard and pass grading/promotion.

**Candidates** under `tools/drive-pack-extract/candidates/` (currently `powerflex_40/`) are
structurally unreachable — the loader and resolver **only see the live served tree**. An explicit
attempt to answer from a candidate pack id is refused with `confidence: "none"`.

## Test the flow (GS10 CE10)

Three examples without typing "GS10" or "CE10" — the context comes from **nameplate photo + caption**:

### Telegram (the subject of this runbook)

```
1. Send a photo of a GS10 nameplate + caption: "what does CE10 mean?"
2. MIRA responds with the CE10 explanation drawn verbatim from the durapulse_gs10
   pack (exact wording, citations, and any keypad-parameter references come from
   the pack JSON — not invented here), followed by the metadata footer:

   [Source: <manual> p.<n>]
   source: drive_pack · pack: durapulse_gs10 · fallback_used: false · read_only: true
```

### Hub asset-chat

```
1. Open a GS10 asset in the Command Center
2. Click "Ask MIRA", type "what does CE10 mean?"
3. Same cited answer from the pack (no need to upload a photo)
```

### Ignition Perspective Ask-MIRA panel

```
1. Dashboard shows a bound GS10 asset tag
2. Click "Ask MIRA" button on the panel, type "what does CE10 mean?"
3. Same answer, same citations
```

All three emit `source: drive_pack · fallback_used: false · read_only: true`.

## Why the engine-level UNS backstop was NOT shipped

PR #2551 considered an engine-level backstop: "if a photo extracts a known drive + fault code,
auto-fill the UNS context and bypass the confirmation gate." It was **rejected** for three reasons:

1. **`uns_context` clobber:** when a fault code (e.g., `CE10`) is extracted as part of the free-text
   question, the current UNS resolver interprets it as a potential model name. The `model` field on
   `uns_context` then holds the fault code, not the drive model — a data-shape collision.

2. **`product_family` is unset:** the UNS resolver has no notion of "drive model → product family"
   (that's a pack concept, not a UNS one). Without it, `manufacturer` alone is ambiguous
   (AutomationDirect makes GS10, GS1, GS2, GS20; ACS580 is ABB; etc.). The resolver cannot
   safely narrow.

3. **Telegram has no pre-bound asset:** unlike Ignition (panel is already bound) or the Hub
   (session carries asset context), Telegram is a free-form chat. Its only reliable context IS
   the nameplate photo. Weak UNS inference from nameplate + caption (both lossy) is lower
   signal-to-noise than the pack resolver's direct match on nameplate fields.

**Doctrine:** Telegram's dedicated **nameplate + pack resolver** (this path) is faster, more
direct, and requires no controversial UNS clobbering. The engine-level backstop remains
deferred; a future session may explore it for Slack/email chats, but not for Telegram.

## Deferred: multi-turn "scan nameplate, ask later"

A natural follow-up is a two-turn flow: scan nameplate (turn 1, stash result), ask a question
(turn 2, retrieve stashed pack). It was deferred because:

- The only per-chat state today is the engine's private SQLite `conversation_state` table,
  keyed by `chat_id`. Adding a `pack_id` column to that table requires a migration, but more
  importantly requires **stashing state inside `engine.py`** — modifying the engine's FSM to
  remember a pack choice across turns, which is forbidden by `train-before-deploy.md`
  (the engine is the troubleshooting **reasoner**, not a dumb state bag).

- The **correct architecture:** a dedicated, per-chat non-engine KV store, keyed by `chat_id`,
  separate from the engine's conversation state. Something like `per_chat_context.py` or
  a simple Redis cache. No engine changes needed.

**Today (shipped slice):** single-message flow only. Nameplate photo **must** have a caption
with a question; confirmation+later-answer is not yet wired. A later session should implement
the dedicated per-chat KV and wire it into `bot.py`'s photo handler without touching `engine.py`.

## Next service-pack onboarding checklist

When you're ready to add a new drive family (PowerFlex 40, PowerFlex 53, Yaskawa GA500, etc.):

1. **Extract** — generate a candidate pack from the real OEM manual.
   See [`workflow-generate-drive-pack.md`](workflow-generate-drive-pack.md).

2. **Grade** — independently verify the extracted JSON against the source PDF using the grading
   harness. See [`workflow-grade-drive-pack.md`](workflow-grade-drive-pack.md).

3. **Accept & promote** — sign off on the grading results, then promote the candidate into the live
   `packs/` tree. See [`runbook-pr-b-acceptance.md`](runbook-pr-b-acceptance.md).

4. **Update the nameplate keywords** — the new family's pack must include reliable nameplate
   `match_keywords` (e.g., `["PowerFlex 40", "PF40", "22F-D..."]`) so a photo's vision output can
   resolve to it. These are baked into the pack JSON at generation time (see
   [`workflow-generate-drive-pack.md`](workflow-generate-drive-pack.md) §
   "Expected outputs").

5. **Test nameplate resolution** — once the pack is live, send a photo of the new drive's nameplate
   + a question caption. Verify the resolver matches correctly and the answer is cited.

Reuse the existing workflows rather than inventing new ones — the tooling is generic
(the extractor, grader, and resolver all work for any drive family).

## Cross-references

- `mira-bots/shared/drive_packs/resolver.py` — the `resolve_service_pack()` contract
- `mira-bots/shared/drive_packs/ask.py` — the `answer_question()` contract
- `mira-bots/telegram/bot.py` — `_try_nameplate_drive_pack_reply()` (the Telegram fast path)
- `mira-bots/tests/test_telegram_nameplate_ask.py` — the test harness for this feature
- `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md` — the product decision
- `docs/drive-commander/drive-pack-trust-doctrine.md` — the grading doctrine ("trust is verified, not assumed")
- `docs/drive-commander/runbook-adding-a-drive-family.md` — onboarding a new family
- `docs/drive-commander/workflow-generate-drive-pack.md` — extracting from a manual
- `docs/drive-commander/workflow-grade-drive-pack.md` — grading the extraction
- `docs/drive-commander/runbook-pr-b-acceptance.md` — full accept+promote+deploy flow
- `.claude/rules/train-before-deploy.md` — why the engine is a reasoner, not a state bag
- `.claude/rules/direct-connection-uns-certified.md` — Ignition/Hub are direct-connection (UNS-certified by construction); Telegram is a **chat** surface where the gate normally applies, but a **nameplate photo** supplies the drive identity directly, so this path resolves a pack without a chat-gate confirmation
- `.claude/rules/uns-confirmation-gate.md` — the chat-gate this nameplate path satisfies via the photo
