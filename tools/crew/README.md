# Crew — human-like subordinate agents dogfooding the Hub

A **crew of believable human subordinates** that work day-to-day inside the owner's
factory workspace on `app.factorylm.com`, directed by **email**, to expose weaknesses
and bugs far faster than one scripted QA bot. Each persona = one Gmail alias + one Hub
account in the owner's tenant + one Hermes desktop agent on a node.

This is the next step beyond the single outside-in QA bot in `tools/qa/` (whose
Playwright fallbacks + `create_issue.sh` this crew reuses). Plan of record:
`~/.claude/plans/how-can-i-enable-valiant-bumblebee.md`.

```
boss ──email task──▶ +carlos@…  ──▶ Hermes (Bravo)  ──▶ logs into Hub as Carlos
                     +dana@…    ──▶ Hermes (Alpha)  ──▶ does the work like a human
                     +pat@…     ──▶ Hermes (Charlie)──▶ replies by email + files bugs
```

## Files

| File | What it is |
|---|---|
| `personas/SCHEMA.md` | The persona-brief template (fill it to add a crew member). |
| `personas/carlos.md` | Carlos Mendez — technician, on Bravo. |
| `personas/dana.md` | Dana Reyes — manager, on the manager-agent node. |
| `runbook.md` | The day-loop each node's Hermes agent runs (become persona → read inbox → act in Hub → report → journal). |
| `task-protocol.md` | How the boss phrases task emails + how agents reply / file issues. |
| `provision_subordinate.mjs` | Human-run script: add one subordinate `hub_users` row to the owner's tenant. |
| `believability.py` | Scores how human a persona's output reads (reuses `tests/social_eval.py`). |
| **reused:** `tools/qa/lib.mjs`, `tools/qa/create_issue.sh`, `tools/qa/upload_manual_smoke.mjs` | Playwright helpers, dedup issue filing, saved-auth-state login. |

## Phase 0 — owner setup (do this once, before the first agent)

1. **No tenant-id hunting needed.** The provisioning script resolves your tenant from
   your Hub login email (`--owner-email`). (If you'd rather keep your primary workspace
   clean, make a dedicated "Hermes Test Factory" workspace you own and pass *its* owner
   email / `--tenant <uuid>` instead — same mechanism.)
2. **Gmail aliases need no setup** — `harperhousebuyers+carlos@gmail.com` already routes
   to your inbox. Give each node-agent **read access to that one inbox** (a Gmail
   **IMAP app-password** is simplest for a headless node; or the Gmail API). Store the
   credential in Doppler. Each agent filters to mail whose `To:` is *its* alias.
3. **Provision a subordinate** — **as yourself**, via Doppler. The preflight prints the
   resolved tenant + owner before writing and refuses on a mismatch:
   ```bash
   doppler run --project factorylm --config prd -- \
     node tools/crew/provision_subordinate.mjs \
       --owner-email 'harperhousebuyers@gmail.com' \
       --email 'harperhousebuyers+carlos@gmail.com' --name 'Carlos Mendez' --role technician
   # save the printed generated password to Doppler (CREW_PW_CARLOS), then log in to verify.
   # Manager seat: --email harperhousebuyers+dana@gmail.com --name 'Dana Reyes' --role manager
   ```
   This is the only prod write; it's human-run via Doppler, never `psql` from a session.

## Phase 1 — prove one agent (Carlos on Bravo)

Point the Hermes desktop agent on Bravo at `personas/carlos.md` + `runbook.md`. Email
Carlos one real task (see `task-protocol.md`), e.g. *"Carlos — open the Feed and the Work
Orders list; what's the oldest open WO, and does anything look broken?"* Success = one
human-paced email round-trip with real Hub actions, screenshots, a reply in Carlos's
voice, a journal entry, and (if a real bug) a deduped `label:dogfood` issue.

Score the reply: `python3 tools/crew/believability.py --persona carlos --text-file reply.txt`.

## Phase 3 — scale to the team

Add `personas/dana.md` (manager, Alpha), another technician (Charlie), one on the PLC
laptop — each a filled `SCHEMA.md`, a provisioned account, an alias, the same `runbook.md`.
Run them in parallel; collect findings under `dogfood-output/crew/<name>/` + a shared
`CREW_LEDGER.md`.

## Secrets & safety
- **Never commit secrets.** Briefs reference Doppler key names only. Passwords, the Gmail
  app-password, and saved Hub sessions (`dogfood-output/.auth/<name>-state.json`) stay out
  of git (gitignored).
- **Own tenant only**, **no destructive actions without an explicit task + email confirm**,
  **read-only toward any plant/PLC/HMI**, **evidence-only findings**. Full list:
  `runbook.md` "Safety rules" (inherits `tools/qa/README.md`).

## Product gaps this surfaces (worth filing / building)
- **Team invite API + role assignment** (`POST /api/team`; the disabled "Invite" button) —
  the durable replacement for `provision_subordinate.mjs`.
- **Role → session wiring** (`requireSession` hardcodes `role:"member"`, TODO #578) — until
  it lands, technician vs manager powers aren't enforced.
- **In-app work-order assignment** (`assigned_to`) — so a manager can direct a tech inside
  the Hub, not only by email.
