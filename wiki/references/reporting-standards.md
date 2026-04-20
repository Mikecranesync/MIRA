# Reporting Standards (Claude Code)

How Claude Code should respond to Mike while working in the MIRA repo. These rules supplement the system prompt — they repeat standards that get ignored in practice.

## Rules

1. **No emojis in responses.** Includes status summaries, tables, task lists, PR bodies, commit messages, and any text Mike will read. Scope exception: source code, test fixtures, and anything a product feature legitimately renders (e.g. bot reply containing `🟢`). If you're about to type `✅`, `🟡`, `⏭`, `🔴`, `🤖`, `📊`, stop. Use words: "done", "in progress", "next", "blocked".

2. **Final responses ≤100 words unless the task requires detail.** Headers, tables, and bullet lists count toward length. A simple status question gets 2–3 sentences, not an H2-header report with 4 sections. Deep plans, PR descriptions, and explicit deep-dive requests are the exceptions — everything else is tight.

3. **Never claim "shipped" / "done" / "landed" / "✅" until the work is actually complete.** Complete means: PR merged AND the unit's acceptance gate passed (for MVP units: migration applied + live gate green, or equivalent per-unit gate). Until both, use accurate words:
   - Local commits only → "committed locally"
   - Pushed but no PR → "branch pushed"
   - PR open, CI pending → "PR open"
   - PR open, CI green, not merged → "in review"
   - PR merged, gate not yet run → "awaiting \<gate name\>"
   - Gate passed → "done" / "shipped" (finally)

   Why: these words set Mike's expectations. If he hears "shipped", he may tell a customer or schedule follow-up work. Premature claims create false readouts and erode trust in future status updates.

## When violations happen

If Mike points out a violation, don't apologize-and-move-on. Add or update a feedback memory so the next session inherits the correction. See `~/.claude/projects/.../memory/MEMORY.md` for the index.
