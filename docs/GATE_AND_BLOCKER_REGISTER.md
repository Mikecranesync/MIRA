# FactoryLM — Gate & Blocker Register

**One page. Every gate that must pass, every blocker in the way, what unblocks what.**
Compiled 2026-09-07, amended 2026-09-08, from three independent UX reports, the acceptance suite, CI config,
and branch protection. Every status below was read from the tree or the API, not recalled.

---

## 0. The only gate that matters

> **A stranger picks up the app and reaches a cited answer without being told how.**

Everything else in this document is a proxy for that sentence. Two forms of it exist and
they are the same test:

| Name | Where it's written | Form |
|---|---|---|
| **BETA GATE** | `CLAUDE.md` | stranger uploads *their own manual*, gets a cited answer, nobody fixes anything |
| **Z-1 five-minute stranger test** | recon bundle | hand a phone to a technician, say only *"find out what the grinding noise might be"*, say nothing for five minutes |

Two teams derived it independently without seeing each other's work. **Status: NOT MET on the
product surface** (corrected in `CLAUDE.md` 2026-09-07). It was declared MET for ~3 months
because a CI test proved the *retrieval path* returns rows — which says nothing about whether
a human can reach that answer.

**Z-1 has no owner. Until it does, it never runs, and nothing below can be declared done.**

---

## 1. Gates — what must pass

### 1a. Merge gates (mechanical, enforced today)

Required contexts on `main`, read from branch protection:

| Gate | What it proves | State |
|---|---|---|
| `CI Gate` | 15 jobs incl. test-unit, architecture-check, license-check, SAST | ✅ live |
| `staging-gate` | staging promotion | ✅ live |
| `Hub E2E (command-center + onboarding)` | Hub journeys | ✅ live |
| `mira-web pack tests` | pack tests | ✅ live |
| `Shared UI contract (bun 1.4.0)` | the shared UI lab | ✅ live |
| `hold-gate` | human hold | ✅ live |

⚠️ **Being in `needs` is not gating.** Only a `require_success` call gates, because `ci-gate`
is `if: always()`. `capability-closure` sat in `needs` for weeks and could not fail a PR.
`test-eval-offline` is still **not** gating — anything only covered there is uncovered.

### 1b. Product gates (what the app must do) — the 27 P0s

The acceptance suite is **71 tests + Z-1**, not the 74 it claims about itself (the legend line
was counted as a test; verified). **27 are P0.** They cluster in five areas; four have observed
failures, one is now tested-and-failing on mobile:

| Area | P0s | State |
|---|---|---|
| Composer is the home screen | A-1, A-2, B-1 | ❌ fails — no composer on home; mobile has no home at all |
| Speaker identity + rendering | B-2, B-3 | ❌ fails — alignment doesn't encode speaker; raw markdown leaks |
| Shell is never broken | C-2, I-1 | ❌ fails — `Scan` drops the shell and flips the theme |
| Answers actionable + attributable | B-8, E-1, E-2 | ❌ fails — no copy control; citation is a UUID; no groundedness signal |
| Errors humane + non-destructive | G-1…G-5 | ❌ fails — `Chat unavailable (412)`, permanent banner, no retry, message duplicated |

### 1c. Gates that exist on paper and are not yet enforced

| Gate | Where | Blocker |
|---|---|---|
| **Z-1 stranger walk** | recon | no owner |
| **UX acceptance detectors** | #3669 | wired but never proven to block; needs a deliberately-broken commit |
| **Golden Conversation release gate** | FLM-UI-4000 charter | needs V2 default; blocked behind the UI queue |
| **Phase 1 acceptance gate** (10 items) | FLM-UI-4000 charter | lab work, mostly done, not certified |

---

## 2. Product blockers — what is actually broken

### 2a. The single structural cause

> **We built an operations console that contains an AI feature. Every mature AI product is an
> AI surface that contains operations.**

Reproduced on web *and* mobile by independent authors. It is the information architecture, not
a theme. Almost every item below is downstream of it.

### 2b. The five unblockers (fix these and most P0s fall)

| # | Change | Kills |
|---|---|---|
| 1 | **Composer becomes the home screen** — greeting, focused input, 3 live suggestions. KPI tiles and the flywheel bar leave. On mobile this means *creating a landing surface that does not exist* and enabling `New chat`. | A-1, A-2, B-1, Z-1 step 1 |
| 2 | **Never break the shell** — no route removes the sidebar, flips the theme, or strands the user. | C-2, I-1 |
| 3 | **Fix the conversation** — render markdown; encode speaker; tappable suggestions; persistent action row with **copy** as non-negotiable. | B-2, B-3, B-8 |
| 4 | **Errors degrade to the nearest working state** — no status codes, no permanent banners, always a button. | G-1…G-5 |
| 5 | **Asset page becomes a project page** — scoped composer on top, 4 tabs below. Asking stops being a destination. | D-1, D-2, D-3 |

Then the mechanical reductions: 13 nav items → 5 + `More ›`; 8 asset tabs → 4; every invented
noun → a word a technician uses (`Command Board`→`Home`, `Knowledge`→`Manuals`,
`Namespace`→`Equipment map`). `Command Board` and `Command Center` must not both survive.

### 2c. The three defects with mechanical detectors (built, #3669)

| Defect | Observed | Detector |
|---|---|---|
| Citation label is a database key | `nameplate-12ac8c22-…​.txt` under *"Serial number 49849 is listed on the nameplate [1]"* | no user-facing citation label matches a UUID |
| One identifier rendered four times | `Sensor v0 overnight 2026-08-28` ×4 in the top third | no identifier rendered by >1 component per viewport |
| Groundedness invisible | cited and general-knowledge answers typographically identical | every answer declares a visible evidence basis |

**Citation fix is server-side.** `sourceTitle` is a pure passthrough on the client; the UUID
arrives in the sources frame. The renderer is already faithful — what's missing is artifact-id
→ human title resolution. **The `evidence_basis` part already exists** in the shell; mobile
simply doesn't emit it. Both are cheaper than they look.

### 2d. What is already RIGHT — protect it

The object model is correct. The citation chip already carries the right locator and page —
**only the name is wrong.** `Asset-scoped` badge, greeting naming the asset, Assets index, and
`Scan plate`/`Upload photo` as the two ranked entry paths are all sound.
**The problem is presentation, not data.** The expensive part is built.

---

## 3. Work queue — ordered by what unblocks what

| # | Work | Owner | Blocked by |
|---|---|---|---|
| 0 | **Name an owner for Z-1** | Mike | — |
| 1 | **Provenance** — stamp build SHA into the bundle, assert at capture | unassigned | nothing |
| 2 | **Unblocker 1** (home composer, web + mobile) | unassigned | UI freeze |
| 3 | **Unblocker 2** (never break the shell) | unassigned | UI freeze |
| 4 | **Unblocker 3** (conversation + copy) | unassigned | UI freeze |
| 5 | **Unblocker 4** (humane errors) — *and the 412 itself* | unassigned | needs root-cause; may be backend |
| 6 | **Citation title resolution** (server-side) | unassigned | nothing — independent of the UI freeze |
| 7 | **Emit `evidence_basis` on mobile** | unassigned | UI freeze |
| 8 | **Unblocker 5** (asset → project page) | unassigned | UI freeze |
| 9 | Nav/noun reductions | unassigned | UI freeze |
| 10 | **Run Z-1 on a handset** | Z-1 owner | 1-9 |

**Items 1 and 6 are startable right now** — neither touches a frozen path.

---

## 4. Why work was blocked — the reasons, not the states

⚠️ **This section previously held a live-state table** (`draft, CLEAN`, `DIRTY`, "queued behind
#3647") **stamped with a compile date.** Peer review found six of its seven rows stale — one of
them *before the PR had even merged* — and the #3647 row wrong in the direction that costs someone
a day: it named a discharged blocker as live and called landed work stranded.

A mergeability table in a committed file is wrong the moment anyone pushes. **The reasons are the
durable half; the states are not.** So the states are gone and the command to compute them is here
instead.

### Live state — compute it, don't read it

```bash
gh pr list --state open --json number,title,isDraft,mergeStateStatus,baseRefName   --jq '.[] | "#\(.number) \(if .isDraft then "draft" else "OPEN" end) \(.mergeStateStatus) base=\(.baseRefName)"'
```

Two traps this register has hit and you will too:

- **`mergeStateStatus` returns `UNKNOWN` on the first read.** A bulk `gh pr list` never computes
  mergeability; a direct `gh pr view` triggers it, so the *second* read is the real one. Never
  resolve an uncomputed status to CLEAN.
- **`BLOCKED` is a catch-all and it lags.** Run `tools/pr-merge-blocker.sh <n>`, which intersects
  reported checks with the branch's *required* contexts — a required context that never reported is
  **pending and invisible** to any scan of reported checks alone.

### The reasons (durable)

| Cause | What it actually was | Status |
|---|---|---|
| **Reviewer unavailable** | The adversarial-review lane named a reviewer who could not run, so PRs sat with no path to a verdict rather than a failing one. | Discharged — time-boxed carve-out (#3686), expires 2026-09-13. |
| **A guard that failed every clean PR** | The Legacy UI Lifecycle Guard errored on every non-`labeled` run, so a red check meant nothing about the change. | **Fixed and merged (#3689).** Confirmed only post-merge: it runs on `pull_request_target` against `base.sha`, so its own PR could never show the fix working. |
| **Stacked PRs run almost no CI** | `ci.yml` is `pull_request: branches: [main]`; a PR based on a feature branch runs **2 of main's 6 required contexts**. Green there means *unmeasured*. | Open — see #3652. Fix is: land the parent, retarget the child to `main`, rebase. |
| **Serialised on a false dependency** | Work was queued behind a PR believed blocked that had in fact merged. | Discharged. The lesson is below. |

### The lesson that outlived the table

**A blocker has to be re-verified before it is acted on, not just recorded.** #3647 was listed as
blocked on an unavailable author with a commit "stranded locally". By the time anyone read that row
it had merged (`2182205ea`), and the supposedly stranded commit's content was in `main` — its three
new tests are present today, and the object is simply not an ancestor because the PR was
squash-merged.

Both halves of that row were wrong, and each was wrong in the expensive direction: it told a reader
to wait for something already done, and to rescue work already landed.

⚠️ **A caution on how to check it.** The obvious test — "are the files identical to `main`?" — gives
the wrong answer here. Three of the five files differ, because `main` moved on afterwards (the
workflow actions were SHA-pinned; #3689 changed the guard's test file). File equality measures
*whether main has changed since*, not *whether the work landed*. **Ask instead whether the commit's
own additions are present** — the test names, the function, the specific hunks. That question
survives later commits; byte equality does not.

⚠️ **And that method has its own gap, which peer review found in this very paragraph.** It is sound
for an **added** function: the name did not exist before, so a hit proves the commit landed. It is a
**false positive for a MODIFIED one** — the name existed already and exists in `main` whether or not
the change landed. `bc27c17ce` contains three such cases
(`test_prod_migration_driver_is_exactly_pinned_and_hash_locked`, `test_render_clean`,
`test_render_lists_missing`); all three predate the commit, so grepping their names answers a
different question than the one asked.

That is the *same shape* as the trap this paragraph replaces — a check whose answer is "yes" for an
unrelated reason. The one-clause fix: **for a modified function, grep a token the commit
INTRODUCED** (a new assertion, a changed constant, a renamed symbol), **never the function name.**
Distinguish the two cases before choosing the token, because the method is only sound for one of
them.

---

## 5. Peer network + Grokbot — what it takes

**Foreman is not reachable over any network path.** Not Remote Control, Tailscale, the peers
broker, LAN, CAO, or any port. The only durable route is a comment on a **draft PR** beginning
`[PEER→FOREMAN]`; a PR-comment listener wakes on the tag. **Issue comments do not wake anyone.**

To connect Grokbot to the peer network, three things are needed:

1. **Contact cards from each live session.** Asked via relay; **three sessions declined** and
   were right to — a peer relaying Mike's direction is not their user's direction, and this is
   an outward-facing trust decision. **Mike must ask each session directly.** One line each;
   they've said they'll comply immediately. Alpha already published (its user asked directly).
2. **A route into the network.** Alpha's model works: CAO on loopback, reached through a
   persistent tunnel. ⚠️ **No auth token — "loopback + SSH is the auth"** — so anything running
   on the tunnel host inherits that node's authority. Worth being a decision, not a side effect.
3. **A gap in the contract:** it assumes every peer owns a draft PR to comment on. At least one
   live session has no git/gh tooling, so the prescribed channel does not exist for it.

---

## 6. Honest limits of this register

- **Grok/Perplexity were walked logged out**; no shell/history rule reaches n=5/5.
- **Web citation behaviour was never observed** — generation never succeeded. E-1/E-2 are
  proven failing on *mobile* only.
- **No stranger walk has been run on mobile.** Launch behaviour was inferred from an existing
  session; no fresh install, no empty state observed.
- **Of the teardown's 38 adversarial verifications, 13 confirmed** — 22 overstated or already
  fixed, 3 killed. Roughly half a raw critique did not survive scrutiny.
- The grammar says "fourteen deliberate departures" and lists **nineteen**. Unreconciled.
- The presentation-scorecard survey (what it grades *against*) **failed to return** and must be
  re-run before that scorecard is built.
- **This document was wrong about live PR state within 24 hours of being written**, and wrong
  *before* it merged. §4's mergeability table has been replaced with the durable reasons plus the
  command to compute state. Treat any remaining state-shaped claim here as a snapshot, and
  re-derive it before acting. The failure was structural, not clerical: a committed file cannot
  hold a value that changes on every push.
