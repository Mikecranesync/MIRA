# Crew Day-Loop Runbook (for the Hermes desktop agent)

The loop a Hermes desktop agent runs to *be* a subordinate working day-to-day in the
Hub. This is the generalized successor to the single-persona QA plan in
`.hermes/plans/2026-06-12_…-maintenance-manager-outside-in-qa.md`: instead of one bot
following a fixed phase checklist, each node loads a **persona brief**
(`tools/crew/personas/<name>.md`) and works tasks the boss **emails** it.

> **Audience:** the Hermes agent on a node (Bravo→Carlos, Alpha→Dana, …) and any human
> driving it. Hermes's browser toolset does the Hub actions directly; the Playwright
> fallbacks in `tools/qa/` cover the two gaps (file upload, network capture).

## The loop

For each session, the agent works through this — using **judgment**, grounded by the
persona brief. The brief says *who* and *what they notice*; the task email says *what to
do today*; the agent decides *how*.

1. **Become the persona.** Load `tools/crew/personas/<name>.md`. Adopt its voice,
   goals, QA lens, cadence, and guardrails for the whole session.
2. **Read the journal.** `dogfood-output/crew/<name>/journal.md` — recall what this
   persona ran into before (open threads, recurring annoyances). Continuity is what
   makes them feel real.
3. **Check the inbox.** Read mail addressed **to this persona's alias** (e.g.
   `harperhousebuyers+carlos@gmail.com`) **from the boss**. Ignore mail for other
   aliases in the shared inbox. Pick the oldest unactioned task. (Inbox access on a
   node is via Gmail IMAP/app-password or the Gmail API — see `tools/crew/README.md`.)
   - No task waiting? Either stop, or — if the persona's goals call for it — do a short
     self-directed pass of their normal surfaces (a tech glances at the Feed and open
     work orders) and report anything off. Wandering finds bugs.
4. **Interpret the task** through the persona's goals. Restate to yourself what "done"
   looks like before touching the Hub.
5. **Log into the Hub.** `https://app.factorylm.com` with the alias + the Doppler
   password. Reuse a saved Playwright storage-state so re-login is rare (the
   `--login` pattern in `tools/qa/upload_manual_smoke.mjs`; state in
   `dogfood-output/.auth/<name>-state.json`, gitignored).
6. **Do the work like a human.** Human cadence — read, scroll, screenshot each step
   (save under a run dir via `newRunDir` in `tools/qa/lib.mjs`). Narrate what you see.
   Watch for this persona's QA-lens triggers (wrong counts, missing fields, slow loads,
   uncited answers). Investigate anything off instead of clicking past it.
7. **Report back.** Email the boss a reply in the persona's voice (what I did / what I
   noticed / evidence paths / severity hunch). For **reproducible** breakage, also file a
   deduplicated GitHub issue:
   ```bash
   tools/qa/create_issue.sh \
     --title "P2(hub): <surface> <symptom>" \
     --body-file dogfood-output/crew/<name>/<finding>.md \
     --labels "bug,hub,dogfood,needs-triage"   # add --dry-run to preview
   ```
   `create_issue.sh` searches open+closed first and is SAFE by default when
   non-interactive (won't refile a dupe; `FORCE=1` to override). Prefer commenting on an
   existing issue. Format + examples: `tools/crew/task-protocol.md`.
8. **Journal it.** Append to `dogfood-output/crew/<name>/journal.md`: the task, what
   happened, findings filed, anything to follow up. This is tomorrow's memory.

## Evidence (every finding, no exceptions)
A finding carries a screenshot + (where the fallback was used) console/network JSON +
repro steps. No "trust me" findings — same bar as `tools/qa/README.md` and Cluster Law 1.

## Safety rules (inherit ALL of `tools/qa/README.md` "Safety rules", plus)
- **Own tenant only.** Act only in the owner's workspace (`CREW_TENANT_ID`). RLS keeps
  you there; never attempt to reach another tenant's data.
- **No destructive actions** (delete WO/asset, change billing, real checkout) unless the
  task says so explicitly — then **confirm by email and wait** before doing it.
- **Creating** test work orders / assets in the owner's own workspace is allowed (that's
  the point — a lived-in factory), but say so in the report so the boss can prune noise.
- **Read-only** toward any plant/PLC/HMI surface (MIRA is read-only in beta).
- **Leave Hermes config alone** — no `doctor --fix` / `setup` / approvals changes.
- **Stay in character, but never fake evidence.** Human-like ≠ making things up. Screenshots
  are real or the finding doesn't exist.

## Why email is the command channel
The owner directs the crew by **emailing tasks** to each persona's alias. This is
deliberate: in-app work-order *assignment* doesn't exist yet (the Requests/Team pages are
mock data; there's no `assigned_to` field), so email is how "the boss directs the
technician" today. When in-app assignment ships, the loop gains a step (check my assigned
work orders) — it doesn't replace the email channel.
