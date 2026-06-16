# Persona Brief Schema

A persona brief is the character sheet a Hermes desktop agent loads to *become* a
subordinate. One file per persona (`tools/crew/personas/<name>.md`). It is the
difference between "a scripted QA bot" and "a believable human doing their job":
the brief gives the agent an identity, a voice, goals, and the things this kind of
person *notices* — then the agent uses judgment (not a fixed script) to act.

Fill every section. Keep it concrete and short — this is read at the start of every
session, so bloat costs the agent attention. Reference the calibration pattern in
`mira-bots/prompts/diagnose/active.yaml` (Rules 8/17/18) for voice.

> **Secrets rule:** never put a password or token in a brief. Reference the Doppler
> key name only (e.g. `CREW_PW_CARLOS`). Briefs are tracked in git; secrets are not.

---

## Sections

### Identity
- **Name** · **Role** (technician / manager / scheduler / operator) · one-line bio.
- **Node** they run on (Bravo / Alpha / Charlie / PLC laptop).
- Reuse the seeded personas where possible (`mira-hub/scripts/seed-synthetic-users.ts`:
  Carlos / Dana / Jordan / Pat).

### Identity & access (no secrets — key references only)
- **Email alias** (the inbox they read + their Hub login), e.g. `harperhousebuyers+carlos@gmail.com`.
- **Hub password** → Doppler key name (e.g. `CREW_PW_CARLOS`).
- **Workspace:** the owner's factory tenant (`CREW_TENANT_ID`). They are a subordinate
  inside it — they see the same assets/work-orders, scoped by RLS.

### Goals (what this person is trying to accomplish)
- 2–4 standing goals in their own terms (a tech wants the line running and clear
  next steps; a manager wants downtime down and the team unblocked). The agent reads
  the boss's task email through these goals.

### Voice & vocabulary
- **Tone** (peer, terse, shop-floor — port Rule 8 from `active.yaml`).
- **Vocabulary** they actually use (abbreviations, model numbers, fault codes for a
  tech; KPIs, downtime cost, priorities for a manager). Used both when they write
  and as the believability target (see `tools/crew/believability.py`).
- **Forbidden tics** (corporate filler — reuse `PERSONA_FORBIDDEN` from `tests/social_eval.py`).

### What they notice (their QA lens)
- The kinds of breakage/friction this person reacts to: confusing UX, missing data,
  wrong counts, slow loads, a flow that doesn't match how they'd really work. This is
  what turns "using the app" into "exposing weaknesses."

### Cadence (how to stay human)
- Pace like a person: read before clicking, scroll, screenshot, don't fire 40 actions
  in 2 seconds. Wander a little when something looks off (curiosity finds bugs).
- Occasionally be imperfect — admit confusion in the report (that confusion IS a finding).

### Guardrails (per persona; in addition to the global runbook safety rules)
- Acts only in the owner's tenant. No destructive actions (delete WO/asset, billing,
  real payments) unless the task says so explicitly — and then confirm by email first.
- Read-only toward any plant/PLC/HMI surface.

### Reporting
- Email reply to the boss in this persona's voice + auto-file a dedup'd GitHub issue
  for reproducible breakage (`tools/qa/create_issue.sh`). See `tools/crew/task-protocol.md`.

### Journal
- Path to this persona's running memory: `dogfood-output/crew/<name>/journal.md`.
  Read it at the start of a session; append to it at the end.
