# PRD — FactoryLM UI/UX V1: the AI surface that contains operations

**Status:** DRAFT for Mike's decision. Authorizes no deploy, no merge, no production traffic.
**Date:** 2026-09-07
**Owner:** unassigned — see §9, this is decision 1.
**Supersedes nothing.** Extends `docs/initiatives/FLM-UI-4000.md` and
`docs/prd/factorylm-unified-interaction-v1/`; consumes `docs/prd/2026-08-03-cited-technician-turn.md`.

## 0. Provenance — three independent reports, one conclusion

| Report | Author | Surface | Authoritative for |
|---|---|---|---|
| **UX recon — "off base"** (#3666) + 2,322-line bundle (`docs/ux-recon-bundle-2026-09-07`) | Codex / Charlie Reviewer | `app.factorylm.com`, logged in, web | **The diagnosis and the grammar.** 5-product study, 74 outside-in tests, Z-1. |
| **Mobile recon companion** + **mobile UX teardown** (`docs/audits/2026-09-07-*`) | CHARLIE devops/gate session | Pixel 9a, production `1.1.0` | **The mobile evidence.** Closes three of the recon's named limits with photographs. |
| **ChatGPT-Class UX Acceptance gate** (#3665) | this session | the gate itself | **How a claim is proven.** Provenance, anti-vacuity, CI wiring. |

A fourth was expected from Bravo and **was not found**. No commit on any branch in the last two
days is authored from Bravo and no report file names it. I have asked Bravo directly. This PRD is
written from three, and that gap is recorded rather than papered over.

---

## 1. The finding all three reach independently

> **We built an operations console that contains an AI feature. Every mature AI product is an AI
> surface that contains operations.**

That inversion is the information architecture, not a theme. It reproduces on **web** (recon) and
on **mobile** (companion) with independent evidence and without amendment.

**The convergences are what make this trustworthy**, because the three reports had different
methods, surfaces and authors, and none saw the others' work first:

| Finding | Recon (web) | Companion (mobile) | Gate (#3665) |
|---|---|---|---|
| Citation renders as a raw identifier | predicted as the target (`📖 SKF 6205 · p.14`) | **observed**: `nameplate-12ac8c22-…​.txt` | proposed as a mechanical detector |
| Same identifier repeated in one viewport | `MODEL: 1`, duplicate asset names | **observed** ×4 in the top third | proposed as a mechanical detector |
| Backend-green ≠ product-works | beta gate "red in reality" | E-1/E-2 **tested and failing** | fixtures cannot catch what they don't contain |
| A11y tree cannot drive this UI | — | `[0,0]-[0,0]` bounds on most controls | Maestro rejected on that evidence |
| The stranger test is the only test that matters | **Z-1** | Z-1 fails at step one on mobile too | four automatic P0s |

Two teams independently derived the same top-level test. The recon's **Z-1** and this repo's
**BETA GATE** are the same sentence with an upload step in front of it, and my gate's four P0s are
a subset of its 28. That is convergent design, not duplication — and it settles what V1 is.

---

## 2. The conflict that outranks everything else

`CLAUDE.md` declares:

> **🚦 BETA GATE — A stranger can upload their own equipment manual and get a cited answer without
> Mike manually fixing anything.** … **Status: MET / PASSING on deploy truth.**

**Observed on the live product, today:** there is no composer on the home screen to ask anything,
and the first message sent returns `Chat unavailable (412)` in a permanent red banner with no
retry. On mobile, cold launch drops into the last thread and `New chat` is **disabled**.

The CI gate is not lying — `tests/beta/beta_ready_upload_retrieval_citation.py` genuinely proves
the backend returns rows. It says nothing about whether a human can reach that answer. **We have
been measuring the pipe and reporting it as the product.**

This is the same failure my gate spec names at a smaller scale — a fixture-driven check can only
catch defects its corpus contains — arriving here at full size: **an entire gate that is green in
CI and red in the hand.**

**PRD decision 1 (non-negotiable):** the declared beta-gate status is amended from
`MET / PASSING` to **`MET on the retrieval path; NOT MET on the product surface`**, until Z-1
passes on a real device. Nothing else in this document matters more than not shipping a false
green.

---

## 3. What is already right — protect it

All three reports agree the expensive part is sound. **The problem is presentation and navigation,
not the data model.**

- The object model — assets, work orders, documents, parts, activity, scans — is the correct set of
  nouns for maintenance.
- The `Asset-scoped` badge, the greeting naming asset + ID, the Assets index, and
  `Scan plate` / `Upload photo` as the two ranked entry paths.
- The chip mechanism for citations already exists **with a correct locator and page number**. Only
  the *name* is wrong. That is a resolver, not a redesign.
- `docs/prd/2026-08-03-cited-technician-turn.md` already specifies the answer unit, and a turn
  contract has already shipped. V1 renders that contract; it does not re-specify it.

The shell grammar is solved industry-wide. **There is nothing to invent there, and we should stop
spending design budget on it.**

---

## 4. Product decisions

### 4.1 The five unblockers (in leverage order)

1. **The composer is the home screen.** Greeting, focused input, three suggestions drawn from live
   equipment state. KPI tiles and the `L5 — Proposal flywheel` bar leave the home route. On mobile
   this means **creating a landing surface that does not exist** and enabling `New chat`.
2. **The shell is never broken.** No route removes the sidebar, flips the theme, or leaves the user
   without an in-app back. Kills the `Scan` trap — on the product's most important screen.
3. **Fix the conversation.** Render markdown. Encode the speaker (user right/bubble, assistant
   left/no-bubble). Tappable suggestion chips. A persistent action row under every answer with
   **copy** as non-negotiable — a technician who cannot paste a diagnosis into a work order cannot
   close the loop the product exists for.
4. **Errors degrade to the nearest working state.** No status codes, no permanent red banners.
   `Couldn't reach MIRA. Your message is saved.` `[Retry]` `[×]`.
5. **The asset page becomes a project page.** Scoped composer on top, four tabs below
   (`Chat · Details · History · Files`). The gradient CTA and the `Ask MIRA` tab both disappear,
   because asking stops being a destination.

Then the mechanical reductions: **13 nav items → 5 + `More ›`**; **8 asset tabs → 4**; every
invented noun → a word a technician already uses (`Command Board`→`Home`, `Knowledge`→`Manuals`,
`Namespace`→`Equipment map`). `Command Board` and `Command Center` differ by one word and must not
both survive.

### 4.2 Where we deliberately differ — the moat

Convention everywhere else; these are ours because maintenance requires them. The six that carry
the commercial claim:

1. **Inline citation chips naming manual and page** — `📖 SKF 6205 · p.14`, never `[3]`, never a
   UUID. *This is the entire product claim.*
2. **Unsourced claims visibly labelled** — a wrong torque spec has physical consequences, so
   "the manual says" and "generally speaking" must differ typographically.
3. **Offline is a first-class state** — cached manuals readable, composer usable, messages queue.
   No reference product offers a pattern here; our users stand in steel buildings next to VFDs.
4. **Camera promoted out of the `+` menu** — photo→nameplate is the spine.
5. **The waiting state names the step** — `Reading the nameplate…` → `Finding the manual…`,
   turning variable latency from "broken" into "diagnostic".
6. **A permanent, tappable scope badge naming the machine** — answering about the wrong machine is
   a safety problem. Today mobile spends that badge saying **"No machine"** and repeats
   **"No machine context"** four times on one screen: the affordance exists and is inverted.

⚠️ **Reconcile before building:** the grammar's summary says *"Fourteen deliberate departures"* and
then lists **nineteen**. A differentiator list is a scope commitment, so the count must be settled
before it is used to justify work.

### 4.3 The three defects with mechanical detectors — build these first

No taste required, so they can gate:

| Defect | Detector | Status |
|---|---|---|
| Citation label is a database key | no user-facing citation label matches `[0-9a-f]{8}-[0-9a-f]{4}-…​` | **observed failing**, photographed |
| Identifier repeated in one viewport | count distinct renderings of the same string per viewport; >1 is a finding | **observed failing** ×4 |
| Groundedness invisible | a cited answer and a general-knowledge answer must not be typographically identical | **observed failing** |

---

## 5. How this is proven — the gate model

Three layers, from #3665, now consuming the recon's tests rather than inventing its own:

| Layer | Content | Blocking |
|---|---|---|
| **Z-1 stranger walk** | the recon's five-minute test, on a real device | **human-gated; sits in front of CI** |
| **Outside-in acceptance** | the recon's **28 P0** tests, judged from what is on screen | blocks merge |
| **Presentation** | 12 capture points + the three mechanical detectors above; judged score advisory | mechanical floor blocks; judged advisory |

**Green retrieval plus failed Z-1 is exactly the false "MET / PASSING" we shipped.** The CI gate
stays; it is no longer allowed to be the *only* gate.

Four rules carry over from #3665 unchanged, each earned from a real failure here:

- **Provenance first.** 938 screenshots in `docs/promo-screenshots/`, none bound to a commit; a
  green 95/95 lab run was served from a stale `dist/`. Stamp the build SHA and fail closed.
- **Landing-state equality.** Assert the harness's landing state equals the product's, or you audit
  a screen the product never presents (42 phantom dead controls).
- **`needs` ≠ gating.** Only `require_success` gates; `capability-closure` sat in `needs` and could
  not fail a PR (`ci.yml:1453-1460`).
- **Fixtures must contain the defects.** The lab cannot reproduce the UUID citation because
  `fake-adapter.ts` has no UUIDs. **Every confirmed finding in these three reports becomes a
  fixture**, not a ticket.

**Mobile control-walking needs CDP against the WebView**, not an accessibility-tree driver —
`uiautomator` returns `[0,0]-[0,0]` for most controls, and Maestro inherits that. CDP needs a
debuggable build, which is a native change with its own gate. Unproven until someone measures it.

---

## 6. Scope and order

**V1 ships when Z-1 passes on a real device.** Nothing else is the definition of done.

| Increment | Contents | Proves |
|---|---|---|
| **0 — provenance** | build-SHA stamp + capture assertion + stale-`dist/` positive control | every later number is about a known build |
| **1 — the three detectors** | citation-UUID, identifier repetition, groundedness signal, each with the fixture that makes it fail | the gate can catch what we already photographed |
| **2 — unblockers 1–4** | home composer, unbroken shell, conversation, humane errors | Z-1 can be *attempted* |
| **3 — asset page + reductions** | project page, 13→5 nav, 8→4 tabs, noun rewrite | Z-1 can be *passed* |
| **4 — the moat** | citation naming, groundedness label, offline, camera, step-naming, scope badge | the claim is true on screen |

Increments 2–4 touch `packages/factorylm-*`, `apps/factorylm-ui-lab` and `mira-mobile`, all frozen
behind #3647 → Slice C → Slice D → #3661. **Nothing here jumps that queue.**

---

## 7. What these three reports cannot tell us

Carried forward so a green result is not over-read:

- **Grok and Perplexity were walked logged out.** No shell/history/answer-lifecycle rule reaches
  `n=5/5`.
- **Web citation and streaming were never observed** — generation never succeeded. Mobile closed
  this: E-1/E-2 are now *tested and failing*, not untested.
- **No stranger walk has been run on mobile.** Launch behaviour was inferred from an existing
  session; no fresh install, no empty state observed.
- **Branch fixes are lab-verified, not handset-verified**, because OTA cannot deliver them and
  sideloading a differently-signed build would wipe app data and sign the owner out. Owner decision.
- **No competitor mobile app was observed.** Mobile comparisons are against published Material 3 /
  Apple HIG, plus one accidental same-device capture — one product, not a convention.
- The teardown's own accounting: of 38 adversarial verifications, **13 confirmed, 22 overstated or
  already fixed, 3 killed**. Roughly half of a raw critique did not survive scrutiny, which is the
  argument for keeping the adversarial pass rather than acting on first drafts.

---

## 8. Stranded work found while assembling this

Codex is out of usage; its worktrees hold work that exists nowhere else:

- **`bc27c17ce` — `fix(deploy): use allowed migration driver`**, 5 files, 122 insertions including
  a new `tests/test_migration_drift.py`. **Unpushed**, on the branch behind #3647 — the PR every
  frozen UI slice is queued behind. Preserved as `refs/backup/codex-unpushed-bc27c17ce` and as a
  patch; **the PR head was deliberately not moved**, since it is the exact-SHA gate for reviewers.
- **Uncommitted edits** in the same worktree extending OTA handset evidence to `schemaVersion 2`
  with a `proofSequence`. Saved as a patch.
- `docs/prd/2026-08-03-cited-technician-turn.md` sat untracked in another Codex worktree but is
  **already committed** as `46d5d63bf` (#3624) — no action needed.

---

## 9. Decisions required from Mike

1. **Owner for this PRD, and owner for the Z-1 stranger walk.** Without a named owner Z-1 never
   runs, and it is the only test that matters.
2. **Amend the beta-gate status in `CLAUDE.md`** (§2). This is the one I would not wait on.
3. **Confirm the increment order** — provenance and detectors before any redesign.
4. **Settle the differentiator count** — fourteen or nineteen (§4.2).
5. **Sideload authority** for handset verification, which wipes app data and signs the owner out.
6. **Whether to land `bc27c17ce` onto #3647** while Codex is out of usage, given it moves the head
   reviewers are gating on.
