# Strategy Fork: Services-Led DT Enablement vs. Self-Serve SaaS

**Status:** Decision-needed (product-owner) — this doc states the fork and recommends; it does **not** change any price in code.
**Authored:** 2026-06-02
**Owner:** Mike Harper (product-owner decision required)
**Source finding:** `docs/research/2026-06-01-dt-alignment-analysis.md` §6 "The pricing contradiction (state it plainly)".

> **One-liner.** MIRA is running two inconsistent go-to-market motions at once. The public site sells a services-led DT-enablement journey ($500 → $2–5K/mo → $499/mo). The product code sells a self-serve SaaS subscription ($97/mo, with a $97/$297 ADR behind it). They imply different products. This doc lays the contradiction out with file references and recommends a primary motion. No code or price changes here.

> **⚠️ Definition correction (2026-06-02, per Mike).** "Self-serve" in this doc originally meant *self-serve billing* (swipe-a-card $97 funnel). That is **not** the priority. The intended meaning of "self-serve" is **self-install + self-configure**: a **downloadable Ignition Module** the company installs themselves, then **enters their own UNS structure** (and picks their tags) without a FactoryLM engineer in the room. That capability is the **product that makes the services-led motion scalable** — it cuts the human onboarding cost that ADR-0014 correctly flagged as unsustainable, *without* committing to a card-swipe SaaS funnel. The two senses are kept distinct below (§4.1). The build (`docs/plans/2026-06-02-ignition-module-self-serve-build.md`) is organized around the **self-install Module + self-UNS-entry** sense.

---

## 1. The two motions, exactly as they exist today

### Motion A — Services-led DT enablement (the public site + doctrine)

The customer-facing pricing page and the strategy docs describe an **assessment → pilot → operating layer** journey. This matches Walker's DT journey (assess current state, then connect one cell, then run it).

| Offer | Price | What it delivers | File |
|---|---|---|---|
| Assessment | **$500** one-time | Floor walk, Maintenance-AI-Readiness score, gap report + namespace blueprint | `mira-web/public/pricing.html`; `STRATEGY.md:40`; `NORTH_STAR.md:9` |
| Pilot | **$2K–5K/mo** (3-mo min) | Structure one line/cell: nameplates, manuals, PLC tags, PMs, fault history; MIRA live on that scope | `mira-web/public/pricing.html`; `STRATEGY.md:41`; `NORTH_STAR.md:10` |
| Operating Layer | **$499/mo** per plant | MIRA in production, CMMS integration, quarterly audits, continuous structuring | `mira-web/public/pricing.html`; `STRATEGY.md:42`; `NORTH_STAR.md:11` |

Verified prices in the live page (`grep '$' mira-web/public/pricing.html`): **$500 one-time / $2K / $499/mo**. The lead magnet that feeds it is `/assess` (`mira-web/public/assess.html`, `docs/specs/dt-scorecard-spec.md`), which explicitly converts to "$500/visit" (`dt-scorecard-spec.md:16`).

### Motion B — Self-serve SaaS subscription (the product code + ADR)

The Stripe integration and the most recent pricing ADR describe a **product-led, self-serve $97/mo** subscription with a $97/$297 two-tier intent.

| Surface | Price | Evidence |
|---|---|---|
| Stripe checkout | **$97/mo** beta subscription | `mira-web/src/lib/stripe.ts` (comments + `STRIPE_PRICE_ID` = "$97/mo beta subscription", lines 6, 26); `createDirectCheckoutSession()` is the "Buy Now" path |
| `mira-web` funnel doctrine | **$97/mo**, "no free tier, pricing hidden until Day 7" | `mira-web/CLAUDE.md` (Tenant Tiers; `active` = "paid $97/mo") |
| ADR-0014 | **product-led, $97/$297 tiers** | `docs/adr/0014-product-led-wedge.md` (Accepted 2026-05-20) — "MIRA is a product-led, self-serve maintenance copilot" |

ADR-0014 itself records the contradiction as an open wound (`0014-product-led-wedge.md:44`):

> "Pricing pages are mutually inconsistent ($20/$499 vs $97/$297)."

And its decision #7 ("Pricing is reconciled to a single source of truth") is **unfulfilled** — the reconciliation never happened; both motions are still live.

---

## 2. Why this is a real fork, not a rounding error

These are not two price points for the same product. They imply **different products, different buyers, different delivery**:

| Dimension | Motion A — Services-led | Motion B — Self-serve SaaS |
|---|---|---|
| Buyer | Plant/maintenance manager with discretionary budget; one downtime event = $10K+ (`STRATEGY.md:24`) | Individual tech / small team swiping a card |
| First touch | Floor walk + human assessor in the room | `/quickstart`, no human, "Twilio moment" (`ADR-0014` §1) |
| What's sold | The **structured data + namespace + live current state** (Walker's commodity) | A **chat license** over the existing 83k-chunk KB |
| Delivery | Hands-on: nameplates scanned, tags mapped, manuals indexed, cell connected | Self-serve signup → cited answer in <60s, no upload required |
| Walker fit | Matches the DT journey (assess → connect → current state) | Horizontal SaaS; sidesteps current-state capture |
| Maps to | `docs/specs/dtma-to-mtr-bridge.md` (assess → pilot blueprint) | `ADR-0014` `/quickstart` + Labs-gated Hub |

The alignment analysis is blunt about it (`dt-alignment-analysis.md` §6):

> "This isn't a rounding error — it's an unresolved strategic fork (services-DT-firm vs self-serve-SaaS) that the codebase and the marketing site disagree on. ... They imply different products. Pick one as primary before scaling either."

---

## 3. The deeper reason the fork matters right now

The thing a customer pays the **Pilot** for — "structure one line, map PLC tags, capture current state" — is, per the analysis, **MIRA's least-built layer** (`dt-alignment-analysis.md` §5: live current state is "the exact wall the 11 hit," and the Pilot "*sells* PLC-tag reconciliation that is 'NOT BUILT'").

Meanwhile the thing the **$97 self-serve** motion sells — grounded answers over the 83k pre-indexed OEM chunks — **is** built and is a genuine moat (`ADR-0014` §Context: "the value exists before the customer uploads anything").

So the fork is also a **promise-vs-capability** mismatch:
- Motion A sells what MIRA is *becoming* (live current state via Phases 4/5/9 of the master plan) at a high-margin services price.
- Motion B sells what MIRA *already is* (grounded KB diagnosis) at a low self-serve price.

Picking a primary motion is therefore also picking which truth to lead with — and which build work the company commits to next.

---

## 4. Recommendation

### Primary (now): **Services-led DT enablement.**

For a DT-enablement positioning against a Walker-aware buyer, the services-led stack is the correct primary motion:

1. **It matches the journey we're selling.** Walker's framework *is* assess → connect → current state → historize → pattern. The $500 → $2–5K → $499 stack is that journey priced. The `docs/specs/dtma-to-mtr-bridge.md` blueprint is its on-ramp. The $97 self-serve motion is a horizontal SaaS that skips Walker's load-bearing step.
2. **It de-risks the layer we haven't finished.** The Pilot is human-delivered, so the parts that are still "NOT BUILT" (live PLC-tag reconciliation) are covered by a FactoryLM engineer in the room while Phases 4/5 land. A self-serve customer hits the gap alone and churns.
3. **The buyer is real and the wedge is proven.** `STRATEGY.md` positions MIRA precisely as the enabler for the 11-of-12 who fail — the firm that *creates* the structured data CMMS vendors assume you already have. That's a services sale.
4. **The 83k-chunk KB is the credibility asset inside the services motion**, not a separate product. It makes the assessment and pilot land ("we already know your Rockwell/ABB gear") without needing a self-serve funnel to monetize it directly.

### 4.1 Two senses of "self-serve" — keep them distinct

| Sense | What it is | Status in this strategy |
|---|---|---|
| **Self-install / self-configure** (the intended one) | Company **downloads the Ignition Module**, installs it themselves, and **enters their own UNS structure** + picks tags via a guided wizard — no engineer required to stand it up. | **Build priority NOW.** It is the product that makes services-led scale (less onboarding labor) and is the on-ramp for every motion. See `docs/plans/2026-06-01-mira-master-architecture-plan.md` Phase 4 + `docs/mira-ignition-secure-architecture.md` §7 (Module + tag-import wizard D8). |
| **Self-serve billing** (the $97 funnel) | Card-swipe subscription, no human touch on the sales side. | **Later / separate decision.** Gated on the readiness conditions in §4.2. This is the ADR-0014 motion; it is *not* what "self-serve" means in the build plan. |

The first sense is **not "secondary/later"** — it is the centerpiece of the build. A downloadable, self-configurable Module is what lets one FactoryLM engineer support many plants (services-led stays primary, but each engagement costs hours, not days). The second sense (card-swipe billing) is a downstream pricing decision that can wait.

### 4.2 When the card-swipe billing motion can turn on

The *billing* self-serve ($97 funnel) is a valid second motion, but only once the substrate is stable. Turn it on when:

- **Self-install Module is real** (Phase 4 shipped — downloadable, customer-deployable tag collector + self-UNS-entry, not bench-only). This is the same Phase 4 the services motion needs; it must land first either way.
- **Upload→retrieval gap is closed** (ADR-0020 / `project_upload_retrieval_gap`). Until then a self-install user who uploads a manual can't cite it — the loop is broken.
- **Command Center is stable in production** (PR #1593/#1603 hardened past the gated-deploy blockers). It's the surface a self-install user would live in.

When those hold, the `/quickstart` "Twilio moment" from ADR-0014 becomes a credible top-of-funnel that *feeds* the services motion (self-install trial → assessment → pilot), rather than competing with it.

### The shape of the resolved fork

```
                 LATER (gated on collector + upload-retrieval + command-center)
                 ┌─────────────────────────────────────────────┐
  /quickstart ──▶│  Self-serve trial ($97-ish) — the 83k-KB     │──┐
  (no auth)      │  "Twilio moment", grounded answer in <60s    │  │ qualifies up into
                 └─────────────────────────────────────────────┘  ▼
  NOW (primary):                                            ┌──────────────────┐
  /assess (DTMA lead magnet) ──▶ $500 Assessment ──▶ $2–5K  │  Services-led DT  │
                                  (floor walk +     /mo Pilot│  enablement       │
                                   MTR blueprint)   ──▶ $499 │  (Walker journey) │
                                                     /mo Op  └──────────────────┘
```

---

## 5. What needs a product-owner decision (and where it lives)

This doc recommends; it does not act. The following require Mike's call, and each points at the file that would change **after** the decision — none are changed here:

| Decision | Today's state | File(s) that would change after sign-off |
|---|---|---|
| **Which motion is primary** | Both live, contradictory | Strategy: this doc → ratify; then `STRATEGY.md` / `NORTH_STAR.md` confirm A primary |
| **Reconcile the price set** (fulfil ADR-0014 decision #7) | $500/$2K/$499 (page) vs $97 (Stripe) vs $97/$297 (ADR) | `mira-web/public/pricing.html`; `mira-web/src/lib/stripe.ts` (`STRIPE_PRICE_ID`); Stripe products in Doppler `factorylm/prd`; `mira-web/CLAUDE.md` tiers; `docs/adr/0014-product-led-wedge.md` (supersede or amend) |
| **Re-status ADR-0014** | "Accepted" but its decision #7 is unfulfilled and contradicts the public site | `docs/adr/0014-product-led-wedge.md` — needs a follow-up ADR if A becomes primary (ADR-0014 declared B primary) |
| **When to flip self-serve on** | $97 Stripe path is live now (`createDirectCheckoutSession`) | Gate behind the three readiness conditions in §4; product decision, not a code default |

**Important:** ADR-0014 (Accepted 2026-05-20) currently declares the *opposite* of this doc's recommendation — it names self-serve product-led as the wedge. If Mike accepts "services-led primary," ADR-0014 must be **superseded or amended by a new ADR**, not silently contradicted. That is the single most important follow-up: two "Accepted" strategy records cannot point in opposite directions.

---

## 6. Explicitly out of scope for this doc

- ❌ No price changed in `pricing.html`, `stripe.ts`, Doppler, or any ADR.
- ❌ No Stripe product created/edited.
- ❌ No marketing copy rewritten.
- ❌ No ADR re-statused (only flagged that ADR-0014 needs it).

This is a fork-statement + recommendation. The product-owner decision unblocks the reconciliation work; the work itself is a separate, tracked change.

## 7. Cross-references

- `docs/research/2026-06-01-dt-alignment-analysis.md` §6 — the contradiction, stated plainly.
- `docs/specs/dtma-to-mtr-bridge.md` — the services-led on-ramp (assess → pilot blueprint) this motion assumes.
- `docs/adr/0014-product-led-wedge.md` — the Accepted ADR that currently declares the *opposite* (must be reconciled).
- `mira-web/public/pricing.html` — services-led prices ($500/$2K/$499).
- `mira-web/src/lib/stripe.ts` — product-led price ($97/mo, `STRIPE_PRICE_ID`).
- `mira-web/CLAUDE.md` — funnel doctrine ($97/mo, no free tier).
- `STRATEGY.md` / `NORTH_STAR.md` — services-led offer stack + ICP.
- `docs/specs/dt-scorecard-spec.md` — `/assess` lead magnet feeding the $500 assessment.
- `docs/plans/2026-06-01-mira-master-architecture-plan.md` — Phases 4/5 (collector) and the upload→retrieval fix that gate the self-serve flip.
