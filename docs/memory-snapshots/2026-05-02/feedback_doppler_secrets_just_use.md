---
name: Doppler-managed secrets — just use them
description: When secrets are in Doppler factorylm/prd and Mike has authorized their purpose, pull and apply them directly. Don't re-ask for confirmation.
type: feedback
originSessionId: 1b80c5dd-c1ba-4ec1-8c4f-23b78f8db490
---
When the user authorizes an LLM/integration use case and the required secrets are already in Doppler `factorylm/prd`, **just pull and apply them**. Don't ask "want me to set them via `gh secret set`?" — that's already implied. Mike's words: *"why did we wait forever?"*

**Why:** Mike runs FactoryLM single-handedly with strict velocity expectations. Doppler `factorylm/prd` is the single source of truth for all secrets — that's the standing pattern documented in CLAUDE.md. Asking "should I use them?" after he's already directed the work re-litigates a settled decision and burns turns. Confirmation is for actions whose consequences he hasn't already authorized; for "use the keys you have access to," he has.

**How to apply:**
- Trigger: any task where the user has set a clear goal that requires a secret already in Doppler. Example: "build the cascade" + "GROQ_API_KEY in Doppler" → set it as a GitHub repo secret without asking. Same for `gh variable set`, `op write`, `kubectl create secret`, etc.
- Safe pattern (keeps secret out of shell history and process list):
  ```bash
  doppler secrets get NAME -p factorylm -c prd --plain | gh secret set NAME -R Mikecranesync/MIRA
  ```
- **Do NOT use `--no-file` with `--plain`** — that flag suppresses stdout entirely and silently writes empty strings to the destination. Burned by this 2026-04-25: piped 3 keys to GitHub secrets, all stored as empty, workflow ran with `key=""` and skipped every provider before anyone noticed. Always verify with `wc -c` after fetching:
  ```bash
  doppler secrets get NAME -p factorylm -c prd --plain | wc -c   # should be > 0
  ```
- Multiple secrets: shell loop. Don't print values. Don't echo to terminal. Don't store in intermediate variables.
- After setting: tell Mike what you did (one line per secret) and trigger whatever uses them (empty commit for a workflow, restart for a service).
- **Still ask for confirmation when:** the secret destination is a third-party service Mike hasn't named (Slack, public webhook, customer-facing site), the action is destructive (rotating a live key without a rollback plan), or the secret is sensitive in a way the destination can leak (e.g., posting an API key into an issue body).

**Anti-pattern:** "Required for X to work: add `FOO_API_KEY` to GitHub repo secrets. Want me to add them via `gh secret set`?" → No. Just do it. Tell him after.
