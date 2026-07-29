# Teams: dormant for the PrintSense commercial program (2026-07-16)

**Decision:** Teams is NOT activated or expanded in this program.

**Reasons:** the adapter is marked dormant and is not part of the active
SaaS bot deployment; it carries only the generic image path (no commercial
PrintSense routing); identity/tenant behavior has never been validated
against the commercial tenancy rules; and customer-admin consent plus Azure
app setup add sales friction that contradicts the "first five technicians"
objective.

## Activation checklist (run when a real pilot customer requires Teams)

1. Customer commitment in writing (pilot signed or verbally agreed with a
   named champion) — Teams work starts only after that.
2. Azure app registration + admin consent obtained from the CUSTOMER tenant;
   record app id + permissions in Doppler (never in git).
3. Validate identity/tenant resolution in `mira-bots/teams/` against the
   commercial tenancy rules (tenant-scoped intake root; cross-tenant read
   must fail — reuse the existing tenant-isolation tests).
4. Port the PR-B concierge through `PrintSenseCommercialService` ONLY
   (adapters for delivery; no business logic in `teams/bot.py`).
5. Wire explicit intent (command or message action) — never classify every
   Teams image as a PrintSense request.
6. Consent prompt + review-gated delivery identical to Telegram; file
   delivery as an attachment card.
7. Funnel events (content-free) + smoke coverage mirroring the Telegram
   tests before any customer sees it.
8. Deployment: add the Teams service to the SaaS compose profile behind its
   own env gate; deploy via the normal promotion workflow.
