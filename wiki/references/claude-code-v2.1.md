# Claude Code v2.1+ — What's New & How MIRA Uses It

Reference for the Code w/ Claude 2026 announcements (May 6) and how to wire them into the MIRA workflow. Treat this as the canonical "what should I be running" guide. Update when new versions ship.

## Defaults the team should adopt now

| Setting | Value | Why |
|---|---|---|
| Model | Claude Opus 4.7 | New default on Max/Team Premium; better at long diagnostic chains |
| Effort | `xhigh` | Recommended for all coding work; set via `/effort` or `CLAUDE_CODE_EFFORT_LEVEL=xhigh` |
| Permission mode | Auto Mode (research preview) | Classifier handles safe-action prompts; combine with `autonomous-run` skill for unattended runs |
| Plan | Max 20× ($200/mo) | 2× usage caps post-May-6; peak-hour throttling removed |

Set the effort default once per machine in your shell rc:

```bash
export CLAUDE_CODE_EFFORT_LEVEL=xhigh
```

## New slash commands (cheat sheet)

| Command | Use when |
|---|---|
| `/effort` | Tune effort interactively — `xhigh` for diagnostic engine work, `medium` for routine edits |
| `/usage` | Find the session that's eating your 5-hour budget |
| `/mcp` | Verify each MCP server is healthy (zero-tool servers are flagged) |
| `/color` | Visual separation when running parallel sessions across terminal tabs |
| `/team-onboarding` | Replayable setup guide — useful for onboarding contractors to MIRA |
| `/autofix-pr` | Native CI auto-fix on the current branch; alternative to `scripts/pr_self_fix.sh` |
| `/loop` (no interval) | Self-paced autonomous loops — replaces manual cron logic |
| `/powerup` | Built-in interactive tutorials |
| `/terminal-setup` | Re-run terminal config (Windows Terminal got new fixes) |

## Managed agent features

### Outcomes (public beta)
Set a success condition; Claude iterates until met. Pair with `autonomous-run` skill — the skill provides the discipline (PLAN.md, scope-lock, HANDOFF), Outcomes provides the convergence guarantee. Wire your overnight prompts as: "Outcome: all 7 pre-flight checks pass + PLAN.md scope items 1-N complete + gates green".

### Multi-agent orchestration (public beta)
You already do this via GSD workflow + `superpowers:dispatching-parallel-agents`. The new managed feature gives observability into fleet runs. Use it when you want to see *which* parallel agent stalled.

### Dreaming (research preview, Max-only)
Claude inspects past sessions and self-improves. Useful for the recurring MIRA bug patterns (asset_identified None crashes, citation URL fallbacks, WO-builder cleanup) — let Dreaming surface what previous fix attempts missed.

### Ultrareview (public research preview)
Already wired in this repo (you have `/ultrareview` in skills). Now backed by a managed agent fleet — use it on every meaningful PR, not just big ones.

### Ultraplan (early preview, Max)
Cloud-side plan drafting. Replaces the local PLAN.md ping-pong for cross-team plans. Local PLAN.md stays the source of truth for autonomous runs (the `autonomous-run` skill depends on it).

### Security Reviews (public beta)
Run from code.claude.com against the MIRA repo. Targets to scan first:
- `mira-web` JWT handling (`PLG_JWT_SECRET` flow)
- `mira-mcp` Bearer auth (`MCP_REST_API_KEY`)
- `mira-core/mira-ingest` PII sanitization paths
- `mira-cmms` (Atlas) SQL query construction
- `scripts/` directory (LLM-cascade self-fix and pr_self_fix paths)

### Computer Use (research preview)
Use for E2E testing without writing Playwright scripts:
- Telegram bot conversation flows
- mira-web /cmms funnel signup → Stripe checkout
- Atlas CMMS work-order creation UI

### Routines
Scheduled / event-triggered async work. See `wiki/references/routines.md` for the MIRA-specific list.

## New environment variables

```bash
CLAUDE_CODE_SESSION_ID                  # auto-injected into Bash subprocess env;
                                        # use in hooks to trace which session ran
CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1  # opt-out of fullscreen rendering
                                        # (only set if your terminal misbehaves)
CLAUDE_CODE_EFFORT_LEVEL=xhigh          # default effort if no /effort interaction
```

## MCP improvements relevant to MIRA

- **Plugin zip support** — `--plugin-dir foo.zip` works; useful for distributing the mira-mcp plugin bundle
- **MCP server reconnection** improved — no more zombie tools after Bravo↔Charlie network blips
- **Unbounded MCP memory growth** fixed — long diagnostic sessions no longer leak
- **Tool count visibility** — `/mcp` flags servers showing zero tools (catches a misconfig before you hit it)

## CI Auto-fix integration

Two paths now exist:
1. **Native** — `/autofix-pr` from terminal turns it on per-branch
2. **MIRA cascade** — `scripts/pr_self_fix.sh <PR>` (existing; uses Groq → Cerebras → Gemini)

Use the native option for speed; fall back to the cascade script if the native path is rate-limited or you want the LLM-provider trail in logs.

The GitHub Actions workflow (`.github/workflows/code-review.yml`) accepts an `auto-fix` label trigger — add the label on a PR to invoke the cascade self-fix automatically.

## What's NOT changed

- Inference cascade (Groq → Cerebras → Gemini) — still the production path for MIRA bot replies. Anthropic stays removed (PR #610). Claude Code is for *engineering*, not for production diagnostic responses.
- PLAN.md / HANDOFF.md discipline — still required for autonomous runs (see `autonomous-run` skill).
- Pre-commit gates (shellcheck, gitleaks, debug-artifact scan) — unchanged.

## Sources

- [What's new — Claude Code Docs](https://code.claude.com/docs/en/whats-new)
- [Changelog](https://code.claude.com/docs/en/changelog)
- [Live blog: Code w/ Claude 2026](https://simonwillison.net/2026/May/6/code-w-claude-2026/)
