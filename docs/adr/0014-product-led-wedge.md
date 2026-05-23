# ADR-0014: MIRA is product-led, not services-led

## Status
Accepted — 2026-05-20

**Follows:** ADR-0008 (sidecar deprecation) · ADR-0013 (UNS namespace builder schema)

---

## Context

For most of 2026 the MIRA go-to-market motion has been **services-led**: the
marketing site leads with "Book Your Assessment", every prospect runs through
a manual onboarding call, and the Hub has been built around the assumption
that a FactoryLM engineer is in the room when the customer first sees their
namespace. The wedge has been "us, building with you," not "you, trying it."

That motion is unsustainable at the price point MIRA targets ($97 / $297
tier) and it contradicts three structural decisions already made:

- **ADR-0007 / ADR-0008** moved the chat path off `mira-sidecar` (a
  services-installed RAG box) onto `mira-pipeline` (a tenant-shared SaaS
  service). The infrastructure is already self-serve; the funnel is not.
- **ADR-0013** committed the UNS Namespace Builder to a multi-tenant Hub
  schema (`mira-hub/db/migrations/`). Multi-tenant Hub + per-customer
  sales-led onboarding is a contradiction the org has been absorbing in
  ops time.
- The 83K KB chunks indexed in `knowledge_entries` (Rockwell, ABB,
  Siemens, Schneider, GS10, PowerFlex, Micro820, …) already cover the
  most common factory-floor questions. The value exists before the
  customer uploads anything — but today there is no way to *experience*
  that value without a signup + namespace + upload.

Today (2026-05-20):
- The Hub still ships ~7 mock pages with placeholder data
  (`/conversations`, `/alerts`, `/requests`, `/parts`, `/reports`,
  `/team`, partly `/documents`). These hurt credibility during demos
  and paid signups.
- The onboarding wizard exits at `/namespace` with no "now what" moment.
- `mira-sidecar` is still deployed in `docker-compose.saas.yml` despite
  ADR-0008 deprecating it 6 weeks ago — the SaaS bundle still carries
  legacy services-led infrastructure.
- Marketing homepage does not link to `/signup`.
- Pricing pages are mutually inconsistent ($20/$499 vs $97/$297).

## Decision

**MIRA is a product-led, self-serve maintenance copilot.** The wedge is the
Hub + `/quickstart` flow that lets a new user get a grounded, cited answer
in under 60 seconds, with no onboarding call, no assessment form, and no
upload required.

Concretely:

1. **`/quickstart` is the "Twilio moment."** Public page, no auth. User
   picks a manufacturer from the existing KB (83K chunks), enters a fault
   code or symptom, sees a grounded answer with citation chips. Source:
   `kg_entities` / `knowledge_entries` via the existing `mira-pipeline`
   cascade.

2. **Mock pages are gated behind a Labs flag** (`NEXT_PUBLIC_LABS_ENABLED`).
   New users see the surfaces MIRA can actually deliver today — the
   namespace, the proposals, the channels, the knowledge. They do not see
   fake work-order tables or invented alert feeds.

3. **The sidebar reflects the product-led IA.** Primary: Feed, Namespace,
   Channels, Knowledge, Proposals. Secondary: Assets, CMMS, Scan, Settings,
   Admin. Labs-gated: the seven mock surfaces above.

4. **Self-serve signup is the marketing site's primary CTA.** "Try MIRA
   Free" → `/signup` is the above-the-fold action. "Book a demo" survives
   as a secondary CTA for enterprise.

5. **Onboarding wizard ends at "Try MIRA now."** The 5th wizard step
   routes the user to `/quickstart` (or an inline ask-MIRA widget) so
   they leave onboarding with a real, cited answer about their own
   equipment.

6. **`mira-sidecar` is removed from the deployed SaaS bundle.** The
   `mira-sidecar/` directory stays in the repo until OEM migration
   cutover (issue #195), but the `docker-compose.saas.yml` service block
   is deleted. ADR-0008's deprecation is now operationally enforced.

7. **Pricing is reconciled to a single source of truth** across
   `/pricing` (marketing), `/upgrade` (Hub), and the Stripe products in
   Doppler `factorylm/prd`.

## Consequences

### What gets easier
- New users can demo MIRA's value before talking to anyone.
- The Hub stops shipping surfaces it can't back with real data.
- Pricing-page friction with prospects goes away.
- Ops drag of services-led onboarding drops; the FactoryLM team can
  focus on product, not enablement calls.
- The 83K-chunk KB stops being invisible to non-customers.

### What gets harder / must be watched
- `/quickstart` must handle adversarial inputs without grounding
  violations — the UNS Location-Confirmation Gate (`.claude/CLAUDE.md`
  §North Star) only fires for *technician* flow. For the quickstart
  flow, "grounding" means "cite a KB chunk or refuse." Cite-or-refuse
  is the contract.
- Labs-gated surfaces will accumulate fake-data debt unless we either
  promote them (with real data) or delete them. Quarterly review.
- Sales-led enterprise motion must still exist (Slack / Teams / on-prem
  asks); "Book a demo" CTA preserves it.

### Future feature criteria
Every feature work item from this point forward is judged against:
"Does this make self-serve onboarding faster, more credible, or
expose more of MIRA's existing value?" If the answer is *no*, it
ships behind Labs or doesn't ship.

## Implementation

Tracked under the `hub-overhaul` GitHub label. P0 (this ADR + saas.yml
+ sidebar + Labs gate + `/quickstart`) shipping in PR linked from issue
#1454. P1 / P2 items filed separately (#1459-#1465).
