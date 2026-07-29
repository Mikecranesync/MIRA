# First-Dollar Execution Plan — Drive Commander Pro (2026-07-10)

**Source of authority:** issue #2577 (`wayfinder:map — First paying technician`), **MAP COMPLETE
2026-07-08** — all commercial decisions locked (#2579–#2584, #2590). This plan is the execution
half that map explicitly handed off: *"build the G120 pack + the public fault-lookup page +
checkout/waitlist."*

**Audit basis:** `origin/main` @ `d3109c2a` (v3.128.5), verified 2026-07-10 via freshness guard
(working tree was 87 behind — everything below was checked against `origin/main` and the live
site, not a stale branch).

---

## The one-screen answer

**Three builds + one flip stand between today and a complete, sellable end-to-end product:**

| # | Gap | What already exists (don't rebuild) |
|---|-----|-------------------------------------|
| 1 | **Siemens G120 drive pack** (the product atom) | Pack architecture (ADR-0025), 3 shipped packs (GS10, PF525, PF40) as templates, deterministic pack reliability gate (#2594), scientific grader, CU240B/E-2 manuals already staged (#2590 ✓) |
| 2 | **Checkout + entitlement** (the buying path) | Public fault-lookup surface is LIVE (`/drive-commander/powerflex-525` returns 200, free tier + Pro locked-teaser already rendered, no Pro data leaked to free DOM) — but the Pro CTA is a **mailto waitlist**. Stripe works but sells the wrong product ($97 CMMS). Durable Stripe→provisioning w/ retry+idempotency merged (#2477) — reuse the pattern |
| 3 | **The Pro surface** (what the payer gets) | All Pro content already lives in the pack JSON (full value tables, wiring/commissioning, reset workflow); renderer deliberately withholds it. Grounded ask path exists (`mira-bots/ask_api`, Telegram pack fast-path) for Ask-MIRA follow-ups |
| 4 | **Flip the checkout smoke gate back to blocking** | #2597 made checkout→Stripe smoke non-blocking *"until a sellable product exists."* Shipping #2 makes it exist — re-arm the gate |

Everything else (upload-RAG notebook, live-read, native app, prod-ingest/docling outage, $97 team
tier, enterprise motion, ProveIt platform) is **explicitly out of first-dollar scope** per
#2583/#2581/#2582. Resist scope creep; run `mira-saas-scope-guard` on any ticket that adds surface.

---

## Phase 0 — Decisions already made + half-day verifications

No open decisions. Operator-owed items before/alongside Phase 1:

- **P0-a (operator, physical):** confirm the exact G120 Control Unit from the dogfood drive's
  nameplate (CU240B/E-2 assumed; manuals for that set are staged in scratchpad `g120_manuals/`).
  The pack targets whatever the nameplate says.
- **P0-b (operator, Stripe dashboard or API):** create the Stripe products/prices —
  `Drive Commander Pro` at **$197/yr (lead)** and **$29/mo** (#2582). Test mode first.
- **P0-c (cheap fix, ride along with Phase 2):** `GET /drive-commander` 404s on prod — add an
  index page listing available packs (SEO + navigation).

## Phase 1 — Siemens G120 pack (the product) — ~1–2 days

1. Author `mira-bots/shared/drive_packs/packs/sinamics_g120/pack.json` from the staged
   CU240B/E-2 List Manual + Operating Instructions, using `powerflex_525` as the structural
   template. Every fault: meaning, likely causes, first checks, related parameters, reset —
   **each field cited to manual page/section** (pack doctrine: pure pointer file; honest
   abstention where the manual doesn't support a claim).
2. Author a **G120 gold set** (mirror #2516's GS10 gold-set approach) and run the
   **scientific grader** + the **deterministic pack reliability gate** (#2594) — the pack ships
   only when the gate passes. This is the per-answer groundedness proof the NORTH_STAR calls the
   sharpest knife.
3. `mira-web/scripts/vendor-drive-packs.mjs` the pack into `mira-web/src/data/drive-packs/`,
   register the model slug, and let the existing renderer publish
   `/drive-commander/siemens-g120` + `/faults/<code>` free tier.
4. **Verify:** gate green, vitest green, staging render of 3 representative fault pages,
   screenshots to `docs/promo-screenshots/`.

*Fallback per #2579: PowerFlex is the backup/resale pack and its page is already live — Phase 2
and 3 do NOT block on Phase 1. Build them in parallel against PF525.*

## Phase 2 — Checkout + entitlement (the buying path) — ~1–2 days

1. **Entitlement atom:** `dc_licenses` table (mira-web's DB space; individual-tech license keyed
   to email, per #2582 — the pack is the engineering atom, the license is the billing unit).
   Fields: email, stripe_customer/subscription ids, status, created/expires.
2. **Checkout:** replace the waitlist `mailto:` CTA in `drive-commander-renderer.ts` with a real
   Stripe Checkout session (`$197/yr` lead, `$29/mo` secondary). Success → webhook.
3. **Webhook → provisioning:** on `checkout.session.completed`, write the license row using the
   **retry + idempotency pattern from #2477** (never a fire-and-forget insert). Send a
   magic-link email that sets the session cookie (mira-web already has `PLG_JWT_SECRET` JWT
   infrastructure — reuse it; **deliberately avoid** the Hub NextAuth identity unification
   (#2437) for v1: the map says Hub = later account/team workspace).
4. **Verify:** Stripe test-mode end-to-end (checkout → webhook → license row → session →
   Pro page renders), idempotent webhook replay, declined-card path.

## Phase 3 — Pro surface (what the payer gets) — ~1–2 days

1. **Gated rendering:** when the session carries an active license, the renderer emits the Pro
   sections it currently withholds — full parameter value tables, wiring/commissioning,
   reset/recovery workflow. Server-side entitlement check; no Pro data in the free DOM (keep the
   existing discipline).
2. **Ask-MIRA follow-ups (Pro):** a question box on fault/parameter pages calling the existing
   grounded ask path (`mira-bots/ask_api`) with the pack context — cited, read-only, honest
   refusal on out-of-pack questions. Deploy note: `mira-ask` is NOT in default deploy targets —
   dispatch `services="mira-ask"` explicitly (kiosk runbook).
3. **Saved history (minimal):** per-license Q&A log rendered on a `/drive-commander/account`
   page. No team features, no CMMS.
4. **Verify:** paid session sees Pro + gets a cited answer; free session sees teaser only;
   logged-out sees free tier; Playwright spec for the three states.

*Sequencing valve: if Ask-MIRA drags, first dollar does not block on it — full-cited-pack access
alone matches the core of the #2582 Pro offer; ship it and fast-follow Ask-MIRA within the week.*

## Phase 4 — Arm the gates + live proof — ~half-day

1. **Re-arm the checkout→Stripe smoke gate** (#2597 made it non-blocking pending a sellable
   product — it now exists; the gate protects it).
2. Sitemap + meta/schema.org for the DC pages (they're the SEO front door, #2584).
3. **Stranger walk-through (the real gate):** incognito → Google-style entry on a fault page →
   free content → checkout (test mode, then live mode with a real card) → Pro access → cited
   answer. Record it; screenshots to `docs/promo-screenshots/`.
4. **Then the human step the map ends on:** Mike makes the $197/yr offer to the named
   Siemens-transition technician (#2579), backup = PowerFlex tech.

---

## Explicitly NOT in this plan (scope guard)

- Fixing prod docling/ingest (#2581 ruled it off the critical path — pack build is offline,
  serve is frozen JSON).
- Hub identity unification (#2437), per-role Hub authz (#2360) — Pro v1 lives in mira-web with
  its own license session, not the Hub tenant model. These stay open as platform debt.
- Upload-and-ask notebook, controls translator, live drive reads, native app (#2583: roadmap,
  not first dollar).
- Telegram as the paid client (map: Telegram = later client; free bot stays free).

## Sequencing summary

```
Phase 1 (G120 pack)      ──┐            (parallel-safe: Phases 2–3 build against live PF525)
Phase 2 (checkout)       ──┼──► Phase 4 (arm gates + live proof) ──► THE OFFER (human)
Phase 3 (Pro surface)    ──┘
```

~4–6 working days of build across the three lanes, each lane an independently shippable PR
through the normal gates (version bump, staging gate, `services="mira-web"` explicit deploy,
screenshot rule for every visible page).
