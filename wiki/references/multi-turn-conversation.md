# Multi-Turn Conversation: Findings & Recommendations

**Filed:** 2026-04-22 | **Context:** Post-mortem on Mike's MultiSmart session breaking after 3 turns

---

## Root Causes Found (Session Breakage After 3-4 Turns)

### 1. Option Selection Off-By-One (FIXED in this commit)
`last_options` was saved from raw `parsed["options"]` before `_format_reply` applied
its filter. Padding options ("Other", "Not visible", etc.) that were _dropped from the
displayed list_ were still in `last_options`. A user typing "2" could therefore land on
`last_options[1]` which was NOT what was shown as "2." on screen.

**Fix:** `_clean_option_list()` now applies the same filter as `_format_reply` before saving.

### 2. Selection Context Too Weak (FIXED in this commit)
When "2" was expanded to "Voltage Phase AB", the engine replaced `message = "Voltage Phase AB"`.
The LLM received bare option text with no explicit statement of which option was chosen.
With a history containing "Pump 2 Not In Auto" as the first alarm, the LLM could confuse
the bare text with content already in the conversation.

**Fix:** Now injects `[User selected option N: {text}]` — unambiguous to any LLM.

### 3. History Stores Raw Reply, Not Formatted Reply (NOT YET FIXED)
`history` is saved with `parsed["reply"]` (the raw LLM text). But what the user actually
*sees* is `_format_reply(parsed)`, which appends the numbered option block. So the LLM's
history context is missing the numbered list it displayed. The LLM can't tell from history
exactly which options were shown.

**Recommendation:** Move `_format_reply` call before the history append. Store the formatted
text (minus the `--- Sources ---` footer) as the assistant turn in history.

### 4. Auto-Diagnose Message Injection Pollutes History
When a photo arrives, `message` is replaced with a synthetic
`"[Equipment photo: {asset}] Visible indicators: ..., OCR labels: ..., Analyze..."` string.
This gets stored in history as if the USER said it. On subsequent turns, the LLM sees a
confusing "user" message it can't correlate with anything the tech actually typed. The primary
alarms appear in a list inside a system-generated string, not as conversational context.

**Recommendation:** Store the synthetic message under `role: "system"` not `role: "user"`,
or use a short human-readable summary like `"[Photo: MultiSmart — 3 active alarms]"`.

### 5. No Active Alarm Anchor in State
After option selection, the engine has no `active_alarm` field. Every subsequent LLM call
must infer the current diagnostic focus from history. With 5+ turns of history, this inference
can fail if early history entries are trimmed or if the LLM misreads the context.

**Recommendation:** Add `session_context["active_alarm"] = expanded` when an option is
selected. Inject it prominently in `_build_prompt` system content:
```python
if sc.get("active_alarm"):
    system_content += f"CURRENT FOCUS: Investigating alarm → {sc['active_alarm']}\n"
    system_content += "Do NOT discuss other alarms unless the user explicitly changes focus.\n"
```

---

## Industry Standard Comparison

| Practice | MIRA Current | Industry Standard |
|---|---|---|
| Option selection | Expands to bare text | Expands to `"User selected option N: {text}"` ✓ (now fixed) |
| History stored | Raw LLM reply | Formatted reply user actually saw |
| Context window use | ~2000 token history budget | Reserve 4000–6000 tokens for 10–20 turn session |
| Active topic tracking | Inferred from history | Explicit `active_alarm` / `current_topic` field |
| Truncation strategy | Fixed HISTORY_LIMIT=20 | Token-aware windowing + summarization of older turns |
| Padding in options | Filtered at render time only | Filter before storing `last_options` ✓ (now fixed) |

### What ChatGPT/Claude/Grok do differently
- **Hybrid memory**: keep last 10–15 turns verbatim, summarize older turns into a
  structured "session summary" injected at the top of the context.
- **Explicit state binding**: selected choices are stored as structured facts, not just
  messages in the transcript.
- **Prompt caching**: static system prompt is cached (~10% token cost); only new turns
  are charged full price. MIRA reloads `active.yaml` on every call but doesn't benefit
  from provider-level caching.

---

## Immediate Recommendations (Priority Order)

1. **Add `active_alarm` to session_context** — 10-line change, high impact
2. **Store formatted reply in history** — prevents history drift after option selection
3. **Change auto-diagnose history role** — store as `system` or condensed `user`
4. **Raise `_HISTORY_TOKEN_BUDGET`** from 2000 → 4000 (one env var change)
5. **Summarize older turns** — implement `_summarize_old_turns()` for sessions > 10 turns

---

## Token Budget Analysis

For a typical 10-turn MultiSmart diagnostic session:
- System prompt: ~600 tokens
- Retrieved chunks (2 chunks avg): ~800 tokens
- History (10 turns × 80 tokens avg): ~800 tokens
- User message: ~30 tokens
- **Total input: ~2230 tokens**
- Response budget at `max_tokens=2048`: ample for complete answers

Current `_HISTORY_TOKEN_BUDGET=2000` trims history to ~500 words. For a 5-turn session
with detailed MIRA responses, this may cut turns 1-2 from context — losing the initial
photo analysis and alarm listing that anchors everything.

**Recommended: `MIRA_HISTORY_TOKEN_BUDGET=4000`**
