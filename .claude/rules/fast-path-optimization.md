# Supervisor Fast-Path Optimization Pattern

**Fast-path vs fork — when a feature is a lightweight answer path inside a bot adapter.**

A "fast-path" is a read-only, deterministic answer path that **lives inside a bot adapter or API endpoint** and answers a specific, narrow question WITHOUT invoking the heavy Supervisor engine. It recognizes a pattern (a drive nameplate, a wiring question, an electrical print explanation), retrieves grounded data, and replies — or gracefully falls through to the engine if the pattern doesn't match.

The pattern keeps the engine focused on general troubleshooting FSM while letting specialized Q&A paths be fast, deterministic, and easy to audit. But a fast-path is NOT a fork of the engine's core logic. This rule codifies when a feature qualifies as a fast-path vs when it must be a change to `engine.py` itself.

## Hard Rule

**A fast-path is a read-only, short-circuiting, gracefully-falling-through answer path.** All of these must be true:

1. **Read-only.** No writes to `wiring_connections`, `kg_entities`, `kg_relationships`, work orders, or any persistent layer. Data flows **inbound only** — the reply is computed from existing, immutable sources.
2. **Reuses existing seams verbatim.** Calls existing, already-tested helpers (`answer_question`, `answer_wiring_question`, `build_theory_messages`, etc.). Does not reinvent the extraction, normalization, or citation logic.
3. **Falls through on miss.** Returns `False` / `UNRESOLVED` / `None` / an empty result if the pattern doesn't match OR any error occurs. Control then passes to the engine.dispatch() or the next fallback (never crashes, never eats the turn).
4. **Never bypasses one-pipeline law.** Does not create its own tag-path normalizer, allowlist, batch shape, or enforcement path. Ingestion forks are forbidden per `.claude/rules/one-pipeline-ingest.md`.
5. **Never skips citation compliance.** Every claim is cited from a grounded source (drive pack, wiring diagram, verified knowledge, etc.) or the reply admits ignorance. No fabrication, no guesses.

## Real examples on main

### Drive-pack pre-check (`mira-bots/ask_api/drive_pack.py`)

```python
@router.post("/drive-pack/ask")
async def drive_pack_ask(req: DrivePackAskRequest, x_mira_key: str = Header(None)):
    """Answer a technician's question grounded ONLY in a drive pack.
    
    Separate HTTP endpoint, no Supervisor. Resolves pack-id (explicit, drive name,
    or question text), calls answer_question (existing helper), returns pack-grounded
    answer + citations or UNRESOLVED. Falls through gracefully on any error (HTTP 200,
    never 500). Does not write, does not persist.
    """
```

**Pattern:** explicit pack resolution → call existing helper → return citation or refusal → never invoke engine.

### Wiring Q&A intake (`mira-bots/shared/wiring_profile/ask.py`)

```python
def answer_wiring_question(profile: MachineWiringProfile, question: str) -> WiringAnswer:
    """Answer question grounded ONLY in profile's approved connections.
    
    Approval gate (trusted() filter). Extract wire/terminal token (regex).
    Find approved matches. Citation-or-refuse: answer has citations OR answer_source
    is "none". Never invents, never falls back to a generic LLM, never writes.
    """
```

**Pattern:** deterministic token extraction → scoped search (approved rows only) → build citation or refusal → no LLM, no fallback.

### Print translator (`mira-bots/telegram/bot.py::_try_print_translator_reply`)

```python
async def _try_print_translator_reply(vision_bytes, caption, update, context) -> bool:
    """Print Translator: electrical-print photo + theory caption → plain-English
    circuit explanation. Read-only LLM path (no DB writes, no control writes).
    
    Pattern match: caption is a theory request? Vision classifies as ELECTRICAL_PRINT?
    If yes: call engine.vision + router.complete (existing helpers). If no: return False.
    On error: return False (fall through to next path). Returns True only if it claims
    the turn; never eats a turn on failure.
    """
```

**Pattern:** cheap-reject on caption → vision classification → call existing inference seams → reply or fall through → no write, no persist.

## When this pattern applies (build a fast-path)

- A bot adapter needs to answer **one specific narrow question** (a pack question, a wiring lookup, a print explanation).
- The answer is **deterministic** — no FSM, no multi-turn, no proposal/approval cycle.
- The answer is **already grounded** — it cites an existing artifact (pack, diagram, KB, verified row).
- The adapter **already has** the data it needs to recognize the question (a photo classification, caption keyword, asset context).
- The path is **read-only** — no side effects, no DB writes, no control writes.

## When this pattern does NOT apply (edit engine.py instead)

- The feature needs **FSM state** (multi-turn, context memory, approval workflows).
- The feature **writes** to any persistent layer (proposals, work orders, PLC state).
- The feature needs to **normalize or enrich** the incoming question (only the engine's UNS resolver and intent classifier should do this).
- The feature is a **core troubleshooting capability** that should be audited together with the engine's other reasoning (not isolated in a bot adapter).
- The feature **reinterprets** the engine's grounding or citation logic (fast-paths reuse the engine's helpers; they don't reinvent them).

## Implementation checklist

- [ ] **Read-only only:** `grep -n "INSERT\|UPDATE\|DELETE\|persist\|write" <file>` returns nothing for data writes (logging is OK).
- [ ] **Reuses helpers:** calls existing functions from `shared/` (e.g., `answer_question`, `answer_wiring_question`) — never copies logic.
- [ ] **Falls through on error:** returns `False` / `None` / `UNRESOLVED` on any exception; never raises or crashes.
- [ ] **Cheap reject first:** if possible, pattern-match on caption/metadata before calling vision/inference (line 938 in print_translator).
- [ ] **Citations or refusal:** every answer either has `citations` or `answer_source="none"` (never fabricates).
- [ ] **Gated by recognition:** the path is claimed ONLY if it recognizes the pattern (returns `False` otherwise, letting other paths try).

## Anti-patterns to avoid

- ❌ **A second UNS resolver.** Only `mira-bots/shared/uns_resolver.py` extracts vendor/model/fault. Fast-paths receive resolved context or work within a single asset.
- ❌ **A second citation logic.** Only `mira-bots/shared/citation_compliance.py` judges what is citable. Fast-paths either use existing citations or admit they have none.
- ❌ **A second ingestion path.** No tag normalizers, allowlists, or batch shapes. The one pipeline is `mira-relay/ingest_contract.py`.
- ❌ **A hidden engine fork.** A "fast version of the FSM" is not a fast-path — it's a hidden fork that bypasses auditing. The engine or nothing.
- ❌ **Graceful degradation that invents.** "If we can't cite it, guess anyway" is not graceful. Admit ignorance (answer_source="none") and fall through.
- ❌ **Catching all exceptions silently.** Log the error before returning False — a silent swallow hides bugs (lines 945–946 in print_translator log the failure).

## Code review gate

When reviewing a PR that adds a new fast-path:
1. Verify it is read-only (no writes, no control, no persistence).
2. Verify it calls existing helpers, not copied logic.
3. Verify it falls through gracefully on error (the test should show a False return, not an exception).
4. Verify it gates itself by pattern recognition and does NOT claim unrelated turns.
5. Verify citation compliance: answers cite a source or `answer_source="none"`.

## When this applies

- Any new Q&A endpoint, bot adapter reply path, or vision-triggered feature under `mira-bots/`.
- Proposed feature PRs that claim to be "fast-paths" for performance.

## When this does NOT apply

- Internal refactors of the Supervisor engine (`mira-bots/shared/engine.py`).
- Pure documentation or test changes.
- Features that explicitly need FSM / multi-turn / proposals / writes.

## Cross-references

- `mira-bots/ask_api/drive_pack.py` — canonical drive-pack fast-path (PR #2527).
- `mira-bots/shared/wiring_profile/ask.py` — canonical wiring Q&A fast-path.
- `mira-bots/telegram/bot.py` — print-translator fast-path (lines 924–967) + nameplate fast-path.
- `.claude/rules/one-pipeline-ingest.md` — why fast-paths cannot fork ingestion.
- `mira-bots/shared/citation_compliance.py` — the single citation-logic module.
- `mira-bots/shared/engine.py` — the Supervisor engine (where features go when they need FSM/writes).
- `.claude/CLAUDE.md` § "Do not do" — no engine forks, no second resolvers, no generic fallback.
