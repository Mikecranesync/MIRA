# Drive Commander — Siemens G120 Execution Backlog

**Source:** Wayfinder map [#2577](https://github.com/Mikecranesync/MIRA/issues/2577) — *planning complete*. This is the **execution** backlog that turns the locked first-customer plan into buildable, tracer-bullet tickets. Do **not** reopen strategy; if a ticket hits a hard blocker, surface it, don't re-plan.

**Created:** 2026-07-09 · grounded against the repo (paths verified this date; see per-ticket "Repo areas").

---

## Glossary — do not conflate (rule 7)

| Term | Meaning | Scope in this backlog |
|---|---|---|
| **FactoryLM** | The company / platform vision (context layer on any UNS) | Not built here; the notebook vision stays roadmap. |
| **MIRA** | The grounded assistant / knowledge layer (packs, engine, citations) | Powers the answers; not the product name shown to the buyer. |
| **Drive Commander** | The technician-facing **first product** | What we sell ($197/yr). |
| **Siemens G120 pack** | The first **value atom** (a `manual_cited` drive pack) | What we build first. |

Copy on public pages says **Drive Commander** (product), grounded by **MIRA**, from **FactoryLM** (company). Keep them distinct.

## Locked plan (from #2577 — context only, not for re-litigation)

First customer = individual technician (AB-native forced onto Siemens) · Product = Drive Commander Pro · Wedge = Siemens G120 pack · Free hook = public cited fault-code lookup · Offer = **$197/yr primary, $29/mo secondary** · Entitlement = **individual-technician license** (split: $29 individual / $97 team-CMMS / services=enterprise) · Surface = public indexable `/drive-commander/siemens-g120/faults/<code>` · Buying path = **DC-specific Stripe SKU + individual entitlement** (do NOT reuse the $97 CMMS path).

---

## ⚠️ Blockers & constraints (read before starting)

1. **STALE BRANCH — hard blocker.** The drive-pack tooling (`tools/drive-pack-extract/`) and committed packs (`mira-bots/shared/drive_packs/packs/{durapulse_gs10,powerflex_525}`) exist on **`origin/main`** but are **absent on the current branch `feat/hub-live-signal-polish`**. **Branch every execution ticket off `origin/main`.** This backlog doc is the only thing safe to author on the current branch.
2. **Manuals are in an ephemeral scratchpad** (`…/scratchpad/g120_manuals/`, from #2590). DC-A must give them a durable home. **Do not commit manual PDFs to git** (binaries) — the registry records a `sha256`, not the file.
3. **Exact Control Unit unknown.** The pack's fault/param set is per-CU (CU240B/E-2 vs CU250S-2 vs G120C). CU240B/E-2 is the **provisional default**; confirm from the real nameplate before promoting (DC-A). Wrong CU ⇒ *confidently-wrong* answers — the cardinal sin (ADR-0025 §4).
4. **Grading requires a hand-built `gold.json`** ground-truth (precision/recall reference). Without it the grader caps at `internal_only`. Building it is human labor nested in DC-C.
5. **Extractor is tuned to PowerFlex manual dialects** (520/525/40). The Siemens G120 table layout differs → DC-B likely needs page-hint tuning and possibly a Siemens dialect branch. Mark uncertain extractions; never fabricate.
6. **`manual_cited` trust ceiling = `beta`.** No bench hardware for G120 ⇒ the pack can reach **`beta`** at best (not `trusted`). That is the acceptable v1 target — provenance must be surfaced honestly on the public pages.
7. **No pack CI gate found.** Grading is invoked by generator scripts, not a workflow. DC-D/DC-L should consider adding a CI check; not blocking.
8. **No production deploy in this pass.** Stripe = **test mode**; entitlement schema = dev→staging. Prod only in a later, explicit pass with the normal gate.

---

## Backlog (tracer-bullet tickets)

Order = the plan spine (pack) then the surface then the money. Each ticket names whether it can ship independently.

### DC-A · Confirm staged G120 manuals, lock CU identity, register the source
- **Why:** everything downstream cites these PDFs; the pack identity is per-CU; registry is fail-closed on `NEW_MANUAL`.
- **Repo areas:** `tools/drive-pack-extract/registry/sources.json`; a durable manuals dir (documented local path, **not** git); `.claude/rules/*` (provenance discipline).
- **Acceptance:** (a) exact CU confirmed from the real nameplate — or an explicit, documented decision to proceed on CU240B/E-2 as provisional; (b) manuals moved out of scratchpad to a durable location with recorded `sha256`; (c) a `sources.json` entry created (`pack_id=siemens_g120`, vendor=Siemens, family=SINAMICS G120, doc ids for List Manual + Operating Instructions), classified `registered`.
- **Tests/checks:** `registry.classify()` returns a registered (non-`NEW_MANUAL`) state; sha256 recorded; no PDF staged into git.
- **Risk:** wrong CU → wrong citations. Mitigate with the nameplate step; CU240B/E-2 is provisional only.
- **Ships independently:** yes (prep).

### DC-B · Generate first Siemens G120 pack candidate (offline)
- **Why:** turn the manual into a candidate pack (fragment → full `pack.json`).
- **Repo areas:** `tools/drive-pack-extract/extractor.py` (`extract(pdf, doc=, fault_pages=, param_pages=)` → fragment dict); **new** `tools/drive-pack-extract/generate_siemens_pack.py` (mirror `generate_pf525_pack.py`, merge fragment → `pack.json`); `tools/drive-pack-extract/candidates/siemens_g120/pack.json`; `mira-bots/shared/drive_packs/schema.py` (v2).
- **Acceptance:** extractor run on the List Manual with page hints → `fragment.json` (`fault_codes`, `fault_citations`, `parameters`, `keypad_navigation`); generator merges to `candidates/siemens_g120/pack.json`; `loader.load_pack("siemens_g120")` loads without error; provenance items are all `manual_cited`; `keypad_navigation.view_only_warning` non-empty. **No** `live_decode`/`envelope` (no bench).
- **Tests/checks:** loader validation passes; fault-code keys numeric; add a `tools/drive-pack-extract/tests/` case for the Siemens extraction like `test_extract.py`.
- **Risk:** extractor dialect mismatch (see blocker 5) — may need a Siemens branch/tuning. Mark low-confidence extractions; cap at `internal_only` rather than guess.
- **Ships independently:** candidate only (not in live tree) — yes.

### DC-C · Grade the pack against the manual + a gold set
- **Why:** the trust gate. No ungraded/hallucinated pack ships.
- **Repo areas:** **new** `tools/drive-pack-extract/gold/siemens_g120/gold.json` (hand-curated diagnostic-critical faults + key params, verified against manual pages); `tools/drive-pack-extract/grading/grade.py`.
- **Acceptance:** `grade.py --pack siemens_g120 --gold …/gold.json --manual <List Manual pdf> --out grading_out` runs; trust status **≥ `beta`** (schema + domain + cite-integrity pass, diagnostic-critical precision 100%, overall fault recall ≥90%, residuals declared); `grading_report.{json,md}` produced.
- **Tests/checks:** `grade.py` exits 0 (status ≠ rejected); cite-integrity verifies every excerpt on its page; zero domain-rule violations. If < beta → loop back to DC-B.
- **Risk:** gold.json is real labor and the gate; `manual_cited` ceiling is `beta` (acceptable). Fabrication vs gold = auto-reject.
- **Ships independently:** no (gates DC-D).

### DC-D · Promote & commit the frozen pack (only if gates pass)
- **Why:** only a `beta`+ pack enters the live tree.
- **Repo areas:** `mira-bots/shared/drive_packs/packs/siemens_g120/{pack.json,PROVENANCE.md,grading_report.*}`; `registry/sources.json` (`pdf_sha256`, `pack_trust_status=beta`); recorded human sign-off (`runbook-pr-b-acceptance.md` pattern).
- **Acceptance:** pack committed on a fresh branch off `origin/main`; `loader.list_packs()` includes `siemens_g120`; `resolve_pack("Siemens G120")` resolves; existing `durapulse_gs10`/`powerflex_525` pack tests stay green; `PROVENANCE.md` records `manual_cited` + CU + sources.
- **Tests/checks:** pack loads; full pack test suite green; provable-read-only assertion N/A (no live connection in this pack).
- **Risk:** commit `pack.json` (JSON) — never the PDF. This is the "make it real" milestone.
- **Ships independently:** yes — the pack is a self-contained data unit.

### DC-E · Public Siemens G120 landing page
- **Why:** the freemium SEO front door (#2584 surface).
- **Repo areas:** `mira-web/src/server.ts` (add `app.get("/drive-commander/:model", …)`); **new** `mira-web/src/lib/drive-commander-renderer.ts` (mirror `src/lib/feature-renderer.ts`); data = committed `pack.json`.
- **Acceptance:** `GET /drive-commander/siemens-g120` → public, indexable HTML (technician voice, not SaaS-buyer); links into fault lookup; SEO meta (title/description/canonical, indexable); no auth.
- **Tests/checks:** route 200 + valid HTML; SEO basics present; `factorylm-ui-style` tokens (no hardcoded hex); copy review.
- **Risk:** branding separation (rule 7). Read-only page.
- **Ships independently:** yes.

### DC-F · 5–10 public fault-code pages with free cited previews
- **Why:** the search-intent surface — one indexable page per fault code.
- **Repo areas:** `mira-web/src/server.ts` (`/drive-commander/:model/faults/:code`); `drive-commander-renderer.ts` (`renderFaultPage`); data = `pack.json` fault cards.
- **Acceptance:** 5–10 real G120 fault codes each render at `/drive-commander/siemens-g120/faults/<code>`; free tier shows plain-English meaning, likely causes, first checks, and a **basic cited preview with visible grounding proof** (the manual-page citation from the pack); unknown codes → graceful, clearly-marked placeholder/404. Per-page SEO.
- **Tests/checks:** each page 200 + **assert every fault answer carries a citation from the pack** (no uncited/generic text — rule 6); citation matches `pack.json`; technician-voice copy.
- **Risk:** **cardinal rule** — no generic AI answers; cited or clearly-marked placeholder. *Confidently-wrong is worse than no answer.*
- **Ships independently:** yes (incremental — ship 5, add more).

### DC-G · Pro-preview locked sections (no checkout required yet)
- **Why:** show the locked value to drive conversion, before payment is wired.
- **Repo areas:** `drive-commander-renderer.ts` (locked-section component); `pack.json` (Pro-tier content); CTA placeholder.
- **Acceptance:** landing + fault pages show locked Pro teasers (full param refs, wiring/commissioning, reset/recovery workflow, Ask-MIRA follow-ups, saved history, updates) with CTA **"Unlock Drive Commander Pro — $197/year"** ($29/mo secondary); entitlement copy = "individual technician license".
- **Tests/checks:** locked sections render; CTA copy + pricing correct; **Pro content is NOT present in the free HTML/DOM** (server-side gated — no SEO-leak of paid content).
- **Risk:** leaking Pro content into page source. Gate server-side.
- **Ships independently:** yes (works with a waitlist CTA before Stripe).

### DC-H · Drive Commander Pro Stripe products/SKUs (test mode)
- **Why:** the buying path — a **DC-specific** SKU, not the $97 CMMS.
- **Repo areas:** `mira-web/src/lib/stripe.ts` (add `product` param; new `STRIPE_PRICE_ID_DRIVE_COMMANDER_{MONTHLY,ANNUAL}` env vars — env-driven, no hardcode); `mira-web/src/server.ts` checkout routes (`product` param + metadata); Doppler `factorylm/stg` (create Stripe **test-mode** products $29/mo + $197/yr).
- **Acceptance:** test-mode products/prices created; `createCheckoutSession(tenant, email, product="drive-commander")` yields a checkout for the correct price; the $97 CMMS price is untouched.
- **Tests/checks:** checkout session created with the right price in Stripe **test mode**; unit test for `product→priceId` mapping; **no prod**.
- **Risk:** do not reuse the $97 price. Distinct products.
- **Ships independently:** yes (config, decoupled from UI).

### DC-I · Individual-technician entitlement (separate from $97 CMMS/team)
- **Why:** the entitlement shape from #2582 — a person, not a plant.
- **Repo areas:** `mira-web/src/lib/quota.ts` (`ensureSchema()` → new `plg_users` table + `entitlements TEXT[]`); `mira-web/src/lib/auth.ts` (`MiraTokenPayload` += `userId`,`entitlements`; new `requireFeature(feature)` middleware alongside `requireActive`); `mira-web/src/lib/activation.ts` (sign `entitlements` on activation); backfill existing active tenants with `entitlements=["cmms"]`.
- **Acceptance:** `plg_users` + `entitlements[]` created (idempotent, dev→staging); JWT carries `entitlements`; `requireFeature("drive-commander")` gates Pro; existing `requireActive`/CMMS path unbroken; a DC purchase grants the individual `entitlements=["drive-commander"]`.
- **Tests/checks:** unit tests for `requireFeature` (has/lacks → 200/403); existing CMMS tenant still active; migration idempotent + backfilled; old tokens still work (non-breaking).
- **Risk:** schema change (~200–300 lines) — dev→staging, idempotent, backfill first. Do not break the CMMS tier.
- **Ships independently:** mostly (can land before the CTA is wired).

### DC-J · Wire CTA → checkout or waitlist (by readiness)
- **Why:** connect the public pages to the money.
- **Repo areas:** `drive-commander-renderer.ts` CTA → `/api/checkout/start?product=drive-commander` (if DC-H+DC-I are in) **or** a waitlist email capture; `mira-web/src/server.ts` (route + webhook → grant individual entitlement on `product=drive-commander`).
- **Acceptance:** if DC-H+DC-I merged → CTA → DC Pro **test-mode** checkout → webhook → individual `entitlements=["drive-commander"]` → Pro unlocks; else → waitlist form captures email (PostHog event + stored). Success/cancel handled.
- **Tests/checks:** E2E on **staging** — CTA → test-card checkout → webhook → entitlement → Pro unlocked; or waitlist → email captured. No prod.
- **Risk:** readiness-gated; waitlist is the always-available fallback so the funnel is never blocked.
- **Ships independently:** yes (waitlist variant ships without DC-H/I).

### DC-K · Analytics / conversion instrumentation
- **Why:** measure search → free → CTA → pay.
- **Repo areas:** `mira-web/src/lib/posthog-server.ts` + `src/server.ts` events (add `product` property; new events `fault_page_view`, `pro_preview_view`, `cta_clicked`, `waitlist_joined`); client `public/posthog-init.js` `[data-cta]` on DC CTAs.
- **Acceptance:** DC funnel events fire with `product="drive-commander"`; existing 5 funnel events carry `product`; no-op safe when `PLG_POSTHOG_KEY` unset.
- **Tests/checks:** events captured in a PostHog test project; no PII; no-op when unset.
- **Risk:** low (PostHog already wired).
- **Ships independently:** yes.

### DC-L · Runbook — repeat this for the next pack
- **Why:** the pack-authoring flywheel (ADR-0025 expansion model) must be repeatable.
- **Repo areas:** **new** `docs/runbooks/drive-pack-authoring.md`; reference `tools/drive-pack-extract/README.md` + `runbook-pr-b-acceptance.md`.
- **Acceptance:** documents the full loop (register → extract → generate → grade → gold → promote → publish pages → SKU/entitlement) with the G120 run as the worked example + a "next drive" checklist.
- **Tests/checks:** doc review; a second engineer can follow it end-to-end.
- **Risk:** low.
- **Ships independently:** yes.

---

## Dependency spine

```
DC-A → DC-B → DC-C → DC-D ──┐  (the pack — "make it real")
                            ├─→ DC-E → DC-F → DC-G ──┐  (the public surface)
DC-H ─┐                     │                        ├─→ DC-J → DC-K   (money + measure)
DC-I ─┴─────────────────────┘                        │
                                              DC-L (runbook, anytime after DC-D)
```
DC-E…DC-K can start against a **placeholder** pack in parallel with DC-B/C, but must switch to the **real committed pack (DC-D)** before any page ships publicly (rule 6 — no uncited content live).

## Recommended first ticket

**DC-A** — branch off `origin/main`, give the manuals a durable home, confirm the CU (or document CU240B/E-2 as provisional), and register the source. It's the smallest step that unblocks the whole pack spine, and it forces the CU-identity decision before any citation is written (avoiding confidently-wrong content).

## Blockers found (surfaced, not resolved)

1. **Stale working branch** — execution must start from `origin/main` (tooling/packs absent on `feat/hub-live-signal-polish`).
2. **Manuals ephemeral** — need a durable, git-excluded home; registry stores sha256.
3. **CU unknown** — needs the real nameplate; CU240B/E-2 provisional.
4. **gold.json required** for grading (human labor in DC-C).
5. **Extractor tuned to PowerFlex dialects** — Siemens layout may need a dialect branch (DC-B).
6. **No pack CI gate** — consider adding one (DC-D/DC-L).
7. **`manual_cited` ⇒ `beta` ceiling** — acceptable v1; surface provenance honestly.

## Turning this into GitHub issues

The repo tracks work as GitHub issues (the wayfinder map used them). These 12 tickets can be filed as issues (labels e.g. `drive-commander`, `pack`, `web`, `payments`) with DC-A…DC-D as a "pack" milestone and DC-E…DC-L as "surface/money". Ask and I'll create them via `gh` mirroring this doc.
