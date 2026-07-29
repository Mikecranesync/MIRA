# Crew Day-Loop Runbook (for the Hermes desktop agent)

The loop a Hermes desktop agent runs to *be* a subordinate working day-to-day in the
Hub. This is the generalized successor to the single-persona QA plan in
`.hermes/plans/2026-06-12_…-maintenance-manager-outside-in-qa.md`: instead of one bot
following a fixed phase checklist, each node loads a **persona brief**
(`tools/crew/personas/<name>.md`) and works tasks the boss **emails** it.

> **Audience:** the Hermes agent on a node (Bravo→Carlos, Alpha→Dana, …) and any human
> driving it. Hermes's browser toolset does the Hub actions directly; the Playwright
> fallbacks in `tools/qa/` cover the two gaps (file upload, network capture).

## Bounded runner — `tools/crew/run_synthetic_workers.sh`

For **scripted, deterministic** dogfood tasks (as opposed to the open-ended Hermes day-loop
below), use the runner. It drives `*.scenario` files through the SAME verify-before-file
discipline and **fails safe**: it refuses to file unless a scenario reproduces, has a
verifier different from the finder, and clears `tools/qa/create_issue.sh`'s gate. Default is
`--dry-run`; nothing is filed without `--file-issues`.

```bash
tools/crew/run_synthetic_workers.sh --list                       # show scenarios
tools/crew/run_synthetic_workers.sh --dry-run                    # run ALL, file nothing (DEFAULT)
tools/crew/run_synthetic_workers.sh --scenario hub-dogfood --dry-run
tools/crew/run_synthetic_workers.sh --scenario hub-dogfood --file-issues   # actually file (gated)
tools/crew/run_synthetic_workers.sh --scenario <big> --file-issues --allow-p0  # P0 needs this flag
```

Behavior (all mechanically enforced, proven by `tools/crew/test_run_synthetic_workers.sh`):
- **Refuses** a scenario that does not reproduce (`REFUSED:no-repro`) — never reaches the gate.
- **Refuses** when finder == verifier (`REFUSED:self-verify`).
- **Refuses** a `P0` unless `--allow-p0` is passed (`REFUSED:p0-needs-flag`) — no autonomous P0 path.
- **Refuses** a scenario whose labels lack `dogfood`/`crew`.
- On a clean pass it builds a body with every gate field and hands it to `create_issue.sh`
  (which re-checks the gate and dedupes); `--dry-run` reports `WOULD-FILE`, `--file-issues`
  reports `FILED <url>` (or declines on a dedupe match). Artifacts + a summary land in
  `dogfood-output/qa-runs/synthetic-workers-<ts>/`.

Scenario format: `tools/crew/scenarios/README.md`. The runner does NOT patch product code,
does not escalate, and does not file anything in `--dry-run`.

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
7. **Report back — but PROPOSE findings; do not file them yet.** Email the boss a reply
   in the persona's voice (what I did / what I noticed / evidence paths / severity hunch).
   Write each candidate finding to `dogfood-output/crew/<name>/findings/<slug>.md`. A
   worker (the finder) **never files a GitHub issue directly** — every candidate must
   first clear the **Verify-before-file gate** below. Workers are good at *noticing* and
   bad at *severity + scope* (see the gate's worked examples), so finding and filing are
   deliberately separated.

   Only **after** a finding passes the gate is it filed (by the verifier, not the finder):
   ```bash
   tools/qa/create_issue.sh \
     --title "P2(hub): <surface> <symptom>" \
     --body-file dogfood-output/crew/<name>/findings/<slug>.md \
     --labels "bug,hub,dogfood,needs-triage"   # add --dry-run to preview
   ```
   **The gate is now MECHANICALLY ENFORCED — not just doctrine.** `create_issue.sh`
   turns the gate ON automatically whenever `--labels` contains `dogfood` or `crew` (or
   you pass `--require-verification`), and **fails closed** (`exit 3`,
   "Refusing to file dogfood issue: missing adversarial verification gate") unless the
   **body file** contains all five fields answered `yes` plus a `Found by:` and a
   *different* `Verified by:`:
   ```
   Reproduces: yes — <how verified>
   Not expected shared/public data: yes — <reasoning>
   Severity justified: yes — <final severity>
   Deduped: yes — <search terms / issue #s checked>
   Evidence sufficient: yes — <HTTP/log/code evidence reference>
   Found by: <persona/worker>
   Verified by: <different name/persona/human>     # self-verification is rejected
   ```
   So a worker physically cannot file a dogfood/crew issue without a recorded adversarial
   pass. (Human/manual filing of **non**-dogfood issues is unchanged — no gate.) The gate
   is covered by `tools/qa/test_create_issue_gate.sh` (hermetic, `gh`-shimmed).
   `create_issue.sh` also searches open+closed first and is SAFE by default when
   non-interactive (won't refile a dupe; `FORCE=1` to override). Prefer commenting on an
   existing issue. Format + examples: `tools/crew/task-protocol.md`.
8. **Journal it.** Append to `dogfood-output/crew/<name>/journal.md`: the task, what
   happened, findings filed, anything to follow up. This is tomorrow's memory.

## Verify-before-file gate (MANDATORY — mechanically enforced in `create_issue.sh`)

A worker may **propose** any finding. **No issue is filed until an adversarial verification
pass confirms ALL of the following.** This is no longer just doctrine: `create_issue.sh`
**enforces it in code** for any `dogfood`/`crew`-labelled (or `--require-verification`)
filing — it fails closed unless the body records each check as `yes` plus a `Found by:` and
a *different* `Verified by:` (see step 7 for the exact field block; tests in
`tools/qa/test_create_issue_gate.sh`). Run the gate as a *skeptic trying to kill the
finding*, as a separate reviewer (a different agent/node, or a human) — NOT the finder
rationalizing their own catch (the script rejects self-verification). If any check fails,
the finding does not get filed (downgrade, rescope, or drop it); record the outcome in the
journal either way.

The five checks (a candidate must pass every one):

1. **It reproduces.** Re-run the exact call independently and get the same result. A
   one-off / flaky observation is not a finding. Capture the repro command + status.
2. **It is not expected public/shared data.** Confirm the "leak"/"exposure" isn't data the
   caller is *entitled* to — most importantly the **shared OEM corpus** in
   `knowledge_entries` (`is_private = false`), which every tenant legitimately sees
   (`.claude/rules/knowledge-entries-tenant-scoping.md`). A cross-tenant claim must show a
   **private** field actually crossing tenants, not shared manuals.
3. **Severity is justified.** Re-derive the severity from impact, don't inherit the
   worker's hunch. A P0/P1 claim must survive a skeptic. Reproduce as a privileged user to
   prove a "broken feature" isn't just an RBAC/permission artifact of the persona.
4. **It is not already filed.** Dedupe `gh issue list --repo Mikecranesync/MIRA --state all
   --search "<keywords>"` (open + closed) before filing; prefer commenting on the existing
   issue.
5. **It has enough HTTP/log evidence.** Exact route + method, HTTP status, response/body
   snippet, and the server log line where relevant — enough that a reader can reproduce and
   audit it. No "trust me." (Cluster Law 1, evidence-only completion.)

**Why this gate exists — worked examples from the 2026-06-29 dry run** (4 workers, then a
verification pass):
- A worker reported a **"P0 cross-tenant data LEAK"** on `POST /api/assets/[id]/chat/`.
  Verification (checks 2 + 3): the "leaked sources" were the **shared public OEM corpus**
  (ABB/PowerFlex, `is_private=false`); the answer described *"an ABB drive"* while the real
  asset was a *PowerFlex 755*, proving no private row was loaded. **Downgraded P0 → P2**
  (a real ownership-check gap — `GET` 404s, `chat` 200s — but no data leak). Filed at P2.
- A worker reported **"asset create silently drops type/department."** Verification (check
  1 + 3): those aren't schema fields (UNS uses manufacturer/model); the API correctly
  ignores them and requires `manufacturer`. **False positive — not filed.**
- Two findings **passed** the gate and were filed: `enrich → 500` (server log named
  `permission denied for table asset_enrichment_reports`; reproduced as owner) and
  `reports/generate` narrating a **non-existent asset** (absent from the live asset list,
  stable across 5 generations).

Net: the crew is good at *noticing* and unreliable at *severity + scope*. The gate is the
difference between "useful issues" and "a queue full of false P0s."

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
