# PRD — Install Microsoft Webwright Plugin In Claude Code

**Created:** 2026-06-06
**Owner:** Mike (travel laptop, MIRA workspace)
**Status:** Approved install path verified against both vendor docs (see § Verification Sources).

---

## Background

Webwright is Microsoft's terminal-native web-agent framework. Instead of an AI predicting one click at a time, the host agent (Claude Code) writes Playwright scripts, executes them, reads the logs, and iterates. The persistent artifact is a reusable script on disk, not a one-shot browser session.

Ships with native plugin manifests for Claude Code and OpenAI Codex (`microsoft/Webwright/.codex-plugin/plugin.json`, skills at `skills/webwright/`).

Repo: `https://github.com/microsoft/Webwright`. License: MIT (verified on repo landing page; aligns with MIRA Hard Constraint #1).

## Why Now

Open AskMira deploy goal (`docs/wip/2026-06-06-askmira-ignition-deploy/GOAL.md`) requires re-running ten regression questions in a real browser against `http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive/...` once the Gateway-side WebDev module lands. Webwright lets the agent author a single Playwright spec that replays the 10 questions, captures screenshots, and asserts against the regression signals (R1-R6 in GOAL.md) — instead of click-by-click by hand.

Pairs naturally with the existing Playwright MCP entries already present in the Claude Code tool registry.

## Goal

Install and verify Microsoft Webwright as a Claude Code plugin in Mike's user-scope plugin set on the travel laptop. Confirm:

1. Plugin appears in `claude plugin list` with status `enabled`.
2. The skill auto-activates from plain English (Microsoft README claim).
3. `/webwright:run` and `/webwright:craft` slash commands are resolvable.
4. A trivial smoke task ("open example.com and screenshot the headline") completes.

## Non-Goals

- Rewriting any AskMira re-test script in Webwright before basic install verification passes.
- Adding Webwright to the MIRA repo's `.claude/plugins/` or marketplaces config (this is a user-scope install, not project-scope).
- Configuring backend API keys beyond what Mike already uses for Claude Code.
- Installing Webwright on the PLC laptop or VPS — only the travel laptop where Mike is currently operating.

## Approved Install Path (Verified)

Both vendor docs agree on the exact slash-command sequence. Run inside the Claude Code chat input (not the OS shell):

```
/plugin marketplace add microsoft/Webwright
```

Wait for the marketplace-add confirmation, then:

```
/plugin install webwright@webwright
```

Restart Claude Code. Plugins load at session start; the new commands and skills do not appear until a fresh session.

## Functional Requirements

| ID | Requirement | Validation |
|---|---|---|
| F1 | Marketplace `microsoft/Webwright` registers as a marketplace source in Claude Code | `claude plugin marketplace list` shows it among "Configured marketplaces". |
| F2 | Plugin `webwright@webwright` installs into user scope | `claude plugin list` shows `webwright@webwright`, scope `user`, status `enabled`. |
| F3 | Slash commands resolve | Typing `/webwright:` in chat shows autocomplete entries `/webwright:run` and `/webwright:craft`. |
| F4 | Skill auto-activates on plain English | A request like "open example.com in a browser and screenshot the headline" triggers Webwright without naming it. |
| F5 | One-shot task end-to-end | `/webwright:run open https://example.com and screenshot the H1` completes, produces a saved screenshot in cwd or a documented output dir. |
| F6 | Reusable artifact emitted | A successful `/webwright:craft` run leaves a Playwright script on disk that can be re-executed with `node` or `npx playwright test`. |

## Non-Functional Requirements

| ID | Requirement | Validation |
|---|---|---|
| N1 | Installed under MIT / Apache 2.0 license per MIRA Hard Constraint #1 | Repo `LICENSE` file inspected (MIT confirmed). |
| N2 | No new prod secrets introduced | Webwright reuses the existing Claude Code subscription. No backend API key beyond what Claude Code already manages. No Doppler change. |
| N3 | Cleanly uninstallable | `claude plugin uninstall webwright@webwright` returns the workspace to the prior state with no residual files outside `~/.claude/plugins/webwright/`. |
| N4 | Browser binaries quarantined to Playwright cache | `playwright install chromium` writes to the standard Playwright cache directory (~700 MB). No system-wide Chromium install required. |

## Prerequisites

Confirmed against Microsoft's README:

1. **Python 3.10+** present on PATH.
2. **Playwright Chromium binaries** installed. One-time: `playwright install chromium` (~700 MB).
3. **Backend LLM key** — Microsoft README lists OpenAI, Anthropic, or OpenRouter as valid backends. The Claude Code subscription Mike already uses satisfies this; no separate key required.
4. **Claude Code session that can restart cleanly** — verify no pinned `/goal` or `/loop` is mid-run that would lose state on restart.

**MIRA-specific caveats (carried from project memory):**

- Windows Defender on the travel laptop has previously blocked Playwright CDP-pipe handshake (memory `feedback_playwright_windows_chrome_screenshot.md`) and the CDP WebSocket-upgrade path (memory `feedback_playwright_windows_cdp_websocket_blocked.md`). Webwright spawns a child Playwright process; the same wall may apply. Documented workaround: fall back to `chrome --headless=new --screenshot=path URL` for local snapshots when Playwright's CDP path stalls.
- The travel laptop's 7.7 GB RAM ceiling (memory `reference_travel_laptop_baseline.md`) — Webwright + a Chromium instance + Claude Code + existing tooling should fit, but watch for swap pressure on the first full re-test run.

## Install Sequence (Operator Checklist)

```
1. Confirm prereqs:
     python --version                          # >= 3.10
     where playwright || pip install playwright
     playwright install chromium               # ~700 MB, one-time

2. In Claude Code chat input:
     /plugin marketplace add microsoft/Webwright
     # wait for green "marketplace added" message
     /plugin install webwright@webwright
     # wait for green "installed" message

3. Exit and relaunch Claude Code:
     # close terminal or run /quit, then start a new session

4. Verify (in OS shell):
     claude plugin list | grep -i webwright    # status: enabled, scope: user

5. Verify (in chat input):
     type "/webwright:" and confirm autocomplete shows /webwright:run + /webwright:craft

6. Smoke task (in chat input):
     /webwright:run open https://example.com and screenshot the H1 to ./webwright-smoke.png
     # expect a saved PNG; reply confirms what was found and where it landed
```

## Verification Sources

Both consulted 2026-06-06. Quotes verbatim where exact wording matters.

| Source | URL | What it confirms |
|---|---|---|
| Microsoft Webwright README | https://github.com/microsoft/Webwright | Exact install commands, prereqs (Python 3.10+, Chromium via Playwright, backend API key), the "Start a new Claude Code session after installing — plugins are loaded at session start and won't appear until you restart." quote, the `/webwright:run` and `/webwright:craft` command names, and the auto-activation claim. |
| Claude Code Plugins docs | https://code.claude.com/docs/en/plugins | Confirms `/plugin marketplace add <owner>/<repo>` and `/plugin install <plugin>@<marketplace>` are the approved slash-command syntax. Confirms `claude plugin list` is the approved verification command. Plugin namespacing (`/plugin-name:skill-name`) matches Webwright's `/webwright:run` form. |
| Claude Plugin Hub listing | https://www.claudepluginhub.com/plugins/anthropics-playwright-external-plugins-playwright | Third-party confirmation of plugin install conventions (independent agreement with above two). |

Both Microsoft and Anthropic docs agree on the install route. No discrepancy.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Windows Defender blocks Webwright's Playwright CDP/WebSocket handshake | Medium (priors exist on this exact laptop) | Documented workaround: `chrome --headless=new` mode for local snapshots; Webwright supports passing custom browser launch options. If chronic, run from WSL2 or skip Webwright for now and use the existing Playwright MCP. |
| Plugin pulls in a backend that bills separately from Claude Code subscription | Low (Microsoft README says no extra key needed) | Verify during F5 smoke; if it does, switch backend env var to use the Claude subscription path. |
| `microsoft/Webwright` repo identity collision (typosquatting) | Very low (org-owned GitHub repo) | `git remote -v` on the cloned skill dir; confirm the GitHub origin really is `microsoft/Webwright`. |
| Plugin clashes with existing Playwright MCP tool registry | Low (different scopes — MCP is per-server, plugin is per-skill) | Both can coexist; the plugin invokes its own embedded Playwright. If both try to drive the same Chromium profile concurrently, fall back to separate user-data dirs. |
| Webwright's auto-activation hijacks unrelated browser tasks | Low | Test plain-English trigger sensitivity in F4 with a non-browser prompt as the control. If over-eager, disable auto-activation via plugin settings or use slash-command form only. |

## Rollback

Single command to uninstall, no state side effects:

```
/plugin uninstall webwright@webwright
/plugin marketplace remove microsoft/Webwright
```

Playwright Chromium binaries remain in the Playwright cache (~700 MB). Optional cleanup:

```
playwright uninstall chromium
```

User config in `~/.claude/plugins/webwright/` can be deleted manually if uninstall left residue.

## Out Of Scope

- Adding Webwright to the MIRA repo `.claude/plugins/` (project scope is intentionally untouched).
- Authoring the AskMira re-test spec in Webwright (separate deliverable — gated on AskMira deploy completing).
- Installing on Bravo / Charlie / VPS or any non-travel-laptop node.
- Updating MIRA's `tests/regime6_sidecar/` or `tests/eval/` to use Webwright — those are MIRA test infra and have their own governance.
- Anthropic billing reconciliation if Webwright spikes Claude subscription usage during heavy crafting sessions (monitor `/v1/debug/spend` post-install).

## Definition Of Done

- F1 + F2 verified by `claude plugin list` and `claude plugin marketplace list`.
- F3 + F4 + F5 verified by an interactive chat session producing the smoke screenshot.
- F6 verified by re-running the saved script standalone (`node ./webwright-smoke.spec.ts` or equivalent — check the README for the exact rerun command since the framework may have shifted between 2026-05 release and now).
- N1-N4 visually inspected against the install state — no Doppler change, no new project files, MIT license confirmed.
- A one-paragraph note appended to `docs/wip/2026-06-06-askmira-ignition-deploy/GOAL.md` under "Findings" recording that Webwright is now available for the re-test step.
