# PrintSense — Smallest Trustworthy Commercial Release (§12 plan)

**Date:** 2026-07-21
**Author:** Claude Code session (grounded against `origin/main`, not the stale `codex/dogfood-useful-work` checkout)
**Parent:** `docs/plans/2026-07-14-go-forward-after-printsense-benchmark.md` §12 ("produce a short
implementation plan for the smallest trustworthy PrintSense commercial release").
**Status:** DRAFT for Mike's approval. **No build, merge, or deploy without his go.** Nothing here
authorizes paid inference or Stripe/prod changes.

---

## 0. Why now / what is already proven

The PrintSense **evidence cycle is done**. The seven-round quality arc took production quality from
**1.9 → 8.21 mean** (9 pass / 0 fail on the final zeta run), the generate→verify architecture is
merged (`PRINT_THEORY_VERIFY`/`PRINT_THEORY_STYLE`/`PRINT_THEORY_FULL_RES` all on main), and staging
is already configured with the winning config (MiniMax-M3 free cascade + slim + full-res + verify)
for Mike's phone test. Per-case best-of-three is 9.1 — the capability is 9-class.

**Quality is no longer the blocker. The blocker is that there is no way to pay for it.** This plan is
the smallest trustworthy path from "an 8.21-quality tool that works on Telegram" to "a technician
pays us money and gets an unmistakable win."

**Ground-truth caveat:** two read-only discovery agents mapped the system, but from a checkout 249
commits behind `main`. Every reuse claim below was re-verified against `origin/main`. Claims marked
⚠️ need one more main-line confirmation at build time (line numbers especially — they drift).

---

## 1. What is the smallest trustworthy PrintSense release?

**One individual technician pays $29/mo, and PrintSense stops being a free demo and becomes a tool
they own — on the surface that already works (Telegram), with a free trial, saved answers, and a
public front door.**

Concretely, the smallest release is the intersection of:

1. **Delivery unchanged** — Telegram single-photo + album rungs, which are live and proven. No new
   client, no web app, no Hub print surface (all deferred — see §5).
2. **A free trial → paid unlock** — the technician gets **N free prints** (default 3), then a clear
   "you've used your free prints — unlock unlimited for $29/mo" with a checkout link.
3. **Reuse the individual license that already exists.** The **Drive Commander Pro $29/mo individual
   SKU is already wired** (§2). The smallest release folds PrintSense into that same individual
   license rather than minting a second SKU: **one $29/mo "Technician Pro" license unlocks both
   PrintSense (unlimited prints) and Drive Commander Pro.** This is the smallest because the
   checkout, webhook, and tier already exist — only *entitlement delivery* is missing, and that gap
   must be closed for DC anyway.
4. **Saved answers** — the technician can see their past print answers (not a full re-openable
   workspace yet — see §5; the minimal version is a list of prior turns already captured in
   `conversation_eval`).
5. **A public conversion surface** — reuse the pattern already live for Drive Commander
   (`/drive-commander/*` SEO pages) to give PrintSense one indexable "what does this print say" page
   with a free preview + "Unlock Technician Pro" CTA. (PR #2852 is already aligning the site around
   PrintSense + DC — this plan slots into it.)

**The unmistakable win (the go-forward plan's acceptance test):** a technician photographs a real
electrical print they can't read, and within ~1–2 minutes gets a cited, plain-English explanation
grounded in the sheet — for free the first few times, then $29/mo to keep going. "Save this to a
machine?" is the bridge to MIRA (deferred, §5).

---

## 2. What existing code already supports it? (reuse inventory)

This release is mostly **wiring existing parts**, not building new ones.

### Delivery (DONE — reuse verbatim)
- **Telegram single-photo rung** — `mira-bots/telegram/bot.py::_try_print_translator_reply` (⚠️ ~`bot.py:966`).
  Cheap caption reject → vision classify `ELECTRICAL_PRINT` → `engine._grounded_print_reply`.
- **Telegram album rung** — `_try_multi_photo_printsense_reply` → `engine._interpret_print_anthropic_pages`,
  driven by the durable `_photo_batch_worker`.
- **Paid vision call** — `printsense/interpret.py::interpret_print` (the one owner-authorized paid
  call site). On main: `PRINT_VISION_PROVIDER` default `openai` (gpt-5.5), Anthropic Opus a knob.
  The **8.21 production config uses the free MiniMax cascade + slim + verify + full-res**, so the
  paid provider can stay off by default and the paid path becomes a Pro-only quality upgrade later.

### Billing / entitlement (70% built — reuse, then close one gap)
- **Individual $29/mo SKU already wired** — `mira-web/src/lib/stripe.ts`:
  `STRIPE_DRIVE_COMMANDER_PRICE_ID` + `createDriveCommanderCheckoutSession` (metadata
  `product: "drive-commander-pro"`, `mode: "subscription"`). Gated only on the price-id env var
  being provisioned in Doppler.
- **Checkout endpoint** — `mira-web/src/server.ts` `GET /api/checkout/session?product=drive-commander-pro`
  → the DC checkout fn; unset price-id soft-redirects to `/pricing`.
- **Webhook branch** — `POST /api/stripe/webhook` has a dedicated `drive-commander-pro`
  `checkout.session.completed` branch that records the purchase + audit event
  `drive_commander_pro.purchased` and writes tier `drive_commander_pro` on `plg_tenants`.
- **Public free product pages** — `/drive-commander/:model[/faults/:code][/parameters/:pid]`
  (`server.ts`, `mira-web/src/lib/drive-commander-renderer.ts`) — unauth, free-tier, server-rendered
  from committed JSON packs. The SEO/preview pattern PrintSense reuses.

### Telemetry (DONE for print — reuse)
- **Per-turn print auto-eval** — `mira-bots/shared/print_autoeval.py` +
  `bot.py::_schedule_print_autoeval` / `_autoeval_print_turn` (⚠️ ~`bot.py:981–1125`): every print
  reply is auto-graded ($0, truth-free) and written to `conversation_eval` with
  `meta.surface="print_translator"` + versioned `meta.autoeval`. **This is the activation / useful-
  answer / repeat-usage substrate — it already fires.**
- **`conversation_eval` schema** (`mira-core/mira-ingest/db/migrations/012_conversation_eval.sql`,
  `013` adds `meta JSONB`) carries `chat_id, source, response_time_ms, has_citations, auto_score,
  human_score, human_verdict, correction, golden_case_added` — the full loop columns.

### Corrections loop (partial — one wiring gap)
- **Deterministic auto-grading** — `printsense/grader.py`, `grader_gate.py`, `gates.py` run in CI
  against golden truth (offline, $0).
- **Human-correction column** — `conversation_eval.correction` + `golden_case_added` harvest index
  already exist (used live for the drive-pack flywheel via the Telegram inline-review keyboard).
  Not yet wired to print turns.

### What does NOT exist (confirmed on main — this is the build list)
- ❌ No PrintSense SKU / price / product (grep-confirmed on main).
- ❌ No **entitlement delivery** — the `drive_commander_pro` tier is written but **grants nothing**:
  `requireActive` (`mira-web/src/lib/auth.ts`) only passes `tier === "active"`, and no code reads
  `drive_commander_pro` to unlock anything. No individual login/magic-link is wired to that tier.
- ❌ No individual-user table — entitlement is the `tier` column on `plg_tenants`; a buyer gets an
  auto-created tenant row but no login path or product surface.
- ❌ No free-trial quota for PrintSense (no per-user print counter).
- ❌ No re-openable saved-print workspace on the live path (the `visual_session` spine, mig 063,
  exists but the follow-up rung PR #2798 is `DO NOT MERGE`).
- ❌ No public PrintSense conversion page.
- ⚠️ Known bug to fix in passing: `public/buy.html`'s "$500 assessment" button posts `?plan=` but the
  endpoint reads `?product=`, so it silently starts the **$97/mo** subscription. Out of scope to
  fully fix, but flag so the PrintSense CTA doesn't inherit the same param mismatch.

---

## 3. Work required — billing, limits, saved results, phone UX

### 3a. Billing (smallest: extend the existing individual license, don't mint a new SKU)
- **Decision (Mike, §10):** does $29/mo unlock **both** PrintSense + DC (one "Technician Pro"
  license — recommended, smallest), or a **separate PrintSense-only** SKU? Recommended: reuse the
  existing DC Pro price/checkout/webhook and rename the *entitlement* concept to "Technician Pro."
- **Build:** close the **entitlement-delivery gap** (shared with DC): make the paid tier actually
  grant access. Smallest form — an `entitlement` check the bot can call: given a Telegram chat_id /
  linked identity, "is this technician Pro?" Requires (a) linking a Telegram user to a paid record,
  and (b) a read the bot rung consults before charging past the free trial.
- **Provision** `STRIPE_DRIVE_COMMANDER_PRICE_ID` in Doppler (Mike — human-only; the SKU is inert
  until then).

### 3b. Limits (free trial)
- Add a **per-technician free-print counter** (default 3) checked in the print rungs before the paid/
  cascade call. Over the limit → the "unlock" reply with the checkout link, no interpretation.
- Store the counter keyed to the Telegram identity (smallest: a lightweight table or reuse the
  quota mechanism `mira-web/src/lib/quota.ts` already implements for tenants — evaluate reuse vs a
  bot-side counter at build time).

### 3c. Saved results (smallest form)
- **Not** the full re-openable workspace (deferred, §5). The minimal "saved answers" = a
  `/printsense_history` command (or a link) that lists the technician's recent print answers, which
  are **already captured** per-turn in `conversation_eval` (`meta.surface="print_translator"`).
  Build = a read query + a formatted reply, no new persistence.

### 3d. Phone UX (unchanged surface, three additions)
- Keep Telegram. Add: (1) the free-trial-exhausted "unlock" message with a checkout deep link,
  (2) a Pro badge / "unlimited" acknowledgement once entitled, (3) `/printsense_history`.
- Honesty is already handled (calibrated "1–2 minutes" ack, uncertainty boundaries, citations) —
  do not regress it.

---

## 4. What must be shared with Drive Commander?

These are **shared rails** — build once, both tools use them (this is why folding PrintSense into
the existing individual license is the smallest path):

1. **The individual entitlement + delivery** (§3a) — the single biggest shared piece. DC Pro already
   takes money but delivers nothing; PrintSense needs the same delivery. Build it once as
   "Technician Pro."
2. **Individual login / identity linking** — mapping a paying individual (Stripe customer) to their
   product identity (Telegram user today; Hub account later). Shared.
3. **The public conversion-page pattern** — `drive-commander-renderer.ts` is the template;
   PrintSense gets an analogous renderer. Shared visual system (FactoryLM tokens).
4. **Telemetry / conversion funnel** — one `conversation_eval` + `meta.surface` convention already
   spans drive-pack and print. Keep one funnel.
5. **The "Save this to a machine?" → Machine Pack → MIRA bridge** — the shared upgrade path both
   tools point at (deferred to post-release, but design the CTA copy consistently).

---

## 5. Explicitly deferred (NOT in this release)

- Re-openable **print workspace** / "photograph once, chat until understood" (`visual_session` spine
  exists; PR #2798 is `DO NOT MERGE`). Saved *answers* (§3c) ship; saved *sessions* do not.
- **Web / Hub PrintSense surface.** Telegram only. (Visual Focus Workspace V0/V1, PRs #2843/#2846,
  are the eventual web viewer — not gating this release.)
- **Recall cost-gate in production** (`feat/printsense-prod-recall-gate`, #2853, default-off) — a
  cost optimization, not a prerequisite for charging. Ship the release; enable recall later.
- **Paid-provider quality upgrade** (gpt-5.5 / Opus as a Pro-tier lever) — the free MiniMax config is
  the 8.21 baseline; a paid Pro-quality tier is a later experiment, budget-gated.
- **Annual SKU ($197/yr)** — marketing copy references it but no SKU exists; start monthly only.
- Everything in the go-forward plan §13 non-goals (CMMS replacement, plant UNS, PLC writes, universal
  wire tracing, every drive/PLC, enterprise permissions, autonomous RCA, the full digital twin).

---

## 6. Objective release gates (evidence a technician can succeed)

Ship only when all pass, with evidence attached (no "trust me"):

1. **Quality gate (already met, re-confirm live):** Mike's phone test on staging with the 8.21 config
   returns a cited, correct, plain-English answer on ≥3 real prints. Evidence = the Telegram
   transcript + the `conversation_eval` autoeval rows (severity ok).
2. **Free-trial gate:** a fresh technician gets exactly N free prints, then the unlock message —
   proven by an integration test on the counter + a live run.
3. **Checkout gate:** clicking the unlock link reaches Stripe test-mode checkout for the $29/mo SKU
   and completes; the webhook records the purchase. Evidence = a test-mode `checkout.session.completed`
   + the audit event.
4. **Entitlement-delivery gate:** after a test-mode purchase, the same technician's next print is
   served **without** hitting the trial limit (they're now Pro). This is the gate that proves money →
   access, and the one most likely to expose the delivery gap. Integration test + live run.
5. **Saved-answers gate:** `/printsense_history` returns the technician's prior print answers.
6. **Telemetry gate:** activation, useful-answer, repeat-usage, and conversion are all queryable from
   `conversation_eval` (§8) — proven by the actual queries returning the test technician's funnel.
7. **No-regression gate:** the existing offline PrintSense grader gate + the 5-regime suite stay
   green; honesty/citation behavior unchanged.

---

## 7. Corrections → deterministic improvement loop

- **Wire the print rungs to the existing human-correction column.** The drive-pack flywheel already
  uses the Telegram inline-review keyboard → `conversation_eval.correction` → `golden_case_added`
  harvest. The smallest print addition = the same "was this right? [correct it]" affordance on print
  replies, writing to the same column with `meta.surface="print_translator"`.
- **Corrections become golden cases.** Harvested corrections feed the frozen PrintSense corpus /
  deterministic grader (offline, $0), which already gates CI — so a real technician's fix becomes a
  permanent regression test. No new loop; extend the proven one to print.
- **Deterministic-first stays the doctrine:** closed-form answers (contact class, xref, wire, state)
  are answered by the owning modules; corrections sharpen those, not a model prompt.

---

## 8. Telemetry — activation, useful answers, repeat usage, conversion

All four are derivable from `conversation_eval` (rows already written per print turn via
`print_autoeval`) + the Stripe webhook. Define these as the release's north-star queries:

- **Activation** = a technician's **first** print turn (`meta.surface="print_translator"`, earliest
  `created_at` per `chat_id`).
- **Useful answer** = autoeval severity `ok` **and** `has_citations` true (no state-claim/drift/
  degenerate-enumeration flag) — the truth-free proxy already computed.
- **Repeat usage** = ≥2 print turns by the same `chat_id` across distinct days.
- **Conversion** = a `chat_id` whose identity links to a `drive_commander_pro` / Technician-Pro
  purchase (Stripe webhook audit event `drive_commander_pro.purchased`).

**Build:** one small analytics query module / dashboard row over these — not new capture. The one new
field to add is the **identity link** (Telegram chat_id ↔ paid record) so conversion can be joined;
that link is the same one entitlement delivery (§3a) needs, so it is built once.

---

## 9. Build sequence (small PRs — scope · tests · gate)

Each PR: written scope, tests, evidence-backed gate, no merge/deploy without Mike. Ordered so the
riskiest shared rail (entitlement delivery) is proven early, and nothing charges money until it works.

1. **PR-1 — Free-trial counter (bot-side, no billing yet).** Per-technician print counter + the
   "unlock" reply after N. Tests: counter increments, resets, and blocks at N; existing rungs
   unaffected under the limit. Gate: integration test + local bench run. *No Stripe, no deploy.*
2. **PR-2 — Entitlement delivery ("Technician Pro" read).** Make the paid tier grant access: an
   entitlement check the bot consults, + the Telegram-identity ↔ paid-record link. Reuses the
   existing `drive_commander_pro` tier + webhook. Tests: entitled identity bypasses the trial limit;
   unentitled hits it. Gate: the §6.4 entitlement-delivery test green. *Shared with DC.*
3. **PR-3 — Unlock CTA + checkout deep link.** The free-trial-exhausted message links to
   `/api/checkout/session?product=drive-commander-pro` (or the renamed Technician-Pro product). Tests:
   link shape, param correctness (avoid the `plan` vs `product` bug). Gate: test-mode checkout
   completes end-to-end (§6.3). *Mike provisions the price-id in Doppler — human-only.*
4. **PR-4 — Saved answers (`/printsense_history`).** Read `conversation_eval` print turns for the
   technician, formatted reply. Tests: returns prior answers, tenant/identity-scoped, empty-state.
   Gate: §6.5.
5. **PR-5 — Corrections affordance on print replies.** The inline "correct this" keyboard →
   `conversation_eval.correction` with `meta.surface="print_translator"`. Tests: correction persists,
   harvest index picks it up. Gate: a correction becomes a golden-case candidate.
6. **PR-6 — Conversion telemetry queries.** The four §8 north-star queries as a small module /
   dashboard row. Tests: queries return the seeded test technician's funnel. Gate: §6.6.
7. **PR-7 — Public PrintSense conversion page.** Reuse the `drive-commander-renderer` pattern: one
   indexable page, free preview + "Unlock Technician Pro" CTA. Slots into #2852. Tests: renders, free
   preview only, CTA link correct. Gate: page 200s with cited preview; Pro content not leaked to DOM.

**Rollout after gates pass (human-gated, in order):** provision the Stripe price-id in `factorylm/stg`
→ phone-test the full free-trial→checkout→entitled loop on staging → `factorylm/prd`. No prod deploy
without the established approval.

---

## 10. Open decisions for Mike

1. **One license or two?** Recommended: **one $29/mo "Technician Pro"** unlocking PrintSense + DC
   (smallest — reuses the built SKU). Alternative: a separate PrintSense-only SKU (more surface, more
   billing config). *This choice shapes PR-2/PR-3.*
2. **Free-trial size** — default 3 prints. Confirm N.
3. **Monthly only, or add annual now?** Recommended monthly-only for the smallest release (no annual
   SKU exists). $197/yr is a fast-follow.
4. **Identity link** — Telegram user ↔ paid record: link via a one-time code in the checkout success
   page, or email match? (Affects PR-2.)
5. **Provisioning + spend** — Mike provisions `STRIPE_DRIVE_COMMANDER_PRICE_ID` (test then live) and
   decides if/when a paid-provider Pro-quality tier is worth a budget declaration (deferred by
   default; the free 8.21 config carries the release).

---

## 11. One-paragraph summary

PrintSense already produces 8.21-quality cited answers on Telegram; the only thing missing is a way
to pay. The smallest trustworthy release gives each technician a few free prints, then unlocks
unlimited for **$29/mo using the individual license scaffolding that already exists** (the Drive
Commander Pro SKU, checkout, and webhook are built — only *entitlement delivery* is missing, and DC
needs it too). Delivery stays on the working Telegram surface; saved answers and conversion telemetry
reuse the `conversation_eval` rows print turns already write; corrections extend the proven drive-pack
flywheel. Seven small PRs, entitlement-delivery proven first, nothing charges until money→access is
gated green. Deferred: web/Hub surface, re-openable workspaces, recall cost-gate, paid-quality tier,
annual pricing — none of them block the first dollar.
