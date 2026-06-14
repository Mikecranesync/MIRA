# Task Protocol — how the boss directs the crew by email

The owner directs each subordinate by **emailing a task** to that persona's Gmail alias.
The agent reads it, works it in the Hub, and **replies** in the persona's voice. Keep it
natural — the agent parses intent; this protocol is convention, not rigid syntax.

## Sending a task (boss → agent)

- **To:** the persona's alias — `harperhousebuyers+carlos@gmail.com` (Carlos),
  `harperhousebuyers+dana@gmail.com` (Dana), etc. The alias picks *who* does it.
- **Subject:** start with the persona tag so it's skimmable, e.g.
  `[carlos] check the filler asset` or `[dana] PM schedule looks empty?`.
- **Body:** plain English, the way you'd actually tell a tech. State the goal, not the
  clicks. Optionally hint at a surface.
  - *"Carlos — open the Feed and the Work Orders list. What's the oldest open work order,
    and does anything look broken or confusing? Screenshot whatever's off."*
  - *"Dana — a customer said PM schedules look empty. Go look at the schedule for our
    factory and tell me if that's real or a display bug."*
- **Destructive asks must be explicit.** If you actually want something deleted or a
  status changed, say so plainly; the agent will confirm by reply before doing it.

## Reporting back (agent → boss)

The agent replies to the same thread in the **persona's voice** (terse for Carlos,
priority-framed for Dana). Structure — short, scannable:

```
Did it. <one line on what I did>

What I saw:
- <observation 1, in character>
- <observation 2 — the off thing, with the number/label>

Broken? <yes/no — what exactly, and how to repro>
Evidence: dogfood-output/crew/<name>/qa-runs/<run>/  (screenshots NN-*.png)
Gut call: P2 — <one-line why it matters to me on the floor>
Filed: #<issue> (or: "nothing worth filing" / "commented on #<existing>")
```

## When something's genuinely broken

Reproducible breakage also gets a **deduplicated GitHub issue** (so it becomes a fix, not
just an email). The agent runs:

```bash
tools/qa/create_issue.sh \
  --title "P2(hub): <surface> <symptom>" \
  --body-file dogfood-output/crew/<name>/<finding>.md \
  --labels "bug,hub,dogfood,needs-triage"
```

- Searches open+closed first; SAFE by default when non-interactive (won't refile a dupe).
- Prefer **commenting on an existing issue** over a near-duplicate.
- Issue body carries: surface/URL, steps to reproduce, expected vs actual, evidence paths
  (screenshots + any console/network JSON), severity rationale — same bar as
  `tools/qa/README.md`. The persona's maintenance-floor framing ("this would make me not
  trust the tool mid-breakdown") is the *impact* line.

## What the boss watches
- **Inbox:** a reply per task, in character — this is the day-to-day conversation.
- **Issue tracker:** `label:dogfood` — the durable bugs the crew surfaced, deduped.
- **Per-persona output:** `dogfood-output/crew/<name>/` (journal + run dirs + findings).
