---
name: saas-activation
description: Zero-touch SaaS activation — Stripe webhook → async job queue → tenant provision → "Setup in progress" UX. Covers pg-boss queuing, idempotent 3-step pipeline (Atlas → seed → email), activation state machine, exponential backoff, and polling UX. Use whenever touching mira-web/src/lib/activation.ts or the Stripe webhook handler.
---

# Zero-Touch SaaS Activation

**Goal:** user pays → everything auto-provisions → product is usable, zero human intervention.

## State Machine

Tenant has explicit `activation_state` column on `plg_tenants`:
- `pending` → payment received, not yet processed
- `provisioning` → job running (Atlas, seed, email in progress)
- `active` → all steps completed
- `error` → at least one step failed, retry available

Never leave a tenant in `pending` or `provisioning` indefinitely — the worker must transition to `active` or `error`.

## Job Queue: pg-boss (NeonDB-native, no new infra)

```typescript
import PgBoss from "pg-boss";
const boss = new PgBoss({ connectionString: process.env.NEON_DATABASE_URL });
await boss.start();
await boss.createQueue("tenant-provisioning", {
  retryLimit: 5,
  retryDelay: 5,
  retryBackoff: true,
  deadLetter: "prov-dead",
});
```

## Webhook Pattern (return 202 immediately, enqueue job)

```typescript
// server.ts: checkout.session.completed handler
// 1. Idempotency check — skip if already processed
const alreadyProcessed = await checkStripeEventProcessed(event.id);
if (alreadyProcessed) return c.json({ received: true });

// 2. Atomic DB writes — stripe fields + state + event ID in one transaction
await db.transaction(async (tx) => {
  await tx.updateTenantStripe(tenantId, customerId, subscriptionId);
  await tx.updateTenantActivationState(tenantId, "pending");
  await tx.markStripeEventProcessed(event.id); // unique index prevents duplicate jobs
});

// 3. Enqueue async — never blocks webhook response
await provisioningQueue.send(
  "tenant-provisioning",
  { tenantId, email, firstName, company },
  { singletonKey: `prov_${tenantId}` } // idempotency: Stripe may deliver 3x
);

return c.json({ received: true }); // 200 to Stripe immediately
```

## Idempotency Rule

Every provisioning step must check its own completion status before running:

```typescript
// In activation-worker.ts
const tenant = await getTenant(tenantId);
if (tenant.atlas_provisioning_status === "ok") return { status: "cached" };
```

Safe to re-run if the job fires twice (Stripe retry, duplicate event, manual retry).

## Step Isolation

```typescript
// Atlas fails → throw (job retries with backoff) — FATAL step
// Demo seed fails → log + continue — NON-FATAL
// Email fails → log + continue — NON-FATAL

try {
  await provisionAtlas(tenant); // fatal
} catch (err) {
  logger.error("[activation] Atlas provision failed", { tenantId, err });
  throw err; // pg-boss will retry
}

try {
  await seedDemoData(tenant); // non-fatal
} catch (err) {
  logger.warn("[activation] Demo seed failed (non-fatal)", { tenantId, err });
}

try {
  await sendWelcomeEmail(tenant); // non-fatal
} catch (err) {
  logger.warn("[activation] Welcome email failed (non-fatal)", { tenantId, err });
}
```

## Activation Status Endpoint

`GET /api/activation/status` (requires standard JWT auth):

```json
{
  "state": "provisioning",
  "steps": { "atlas": "ok", "demo": "ok", "email": "pending" },
  "ready": false,
  "attempts": 1,
  "lastError": null
}
```

## Frontend Polling

Poll `/api/activation/status` every 3 seconds after Stripe redirect to `/setup`.
- Show **skeleton UI** (not a spinner) while provisioning
- On `ready: true` → redirect to `/dashboard`
- After 2+ minutes of `error` state → show retry button
- Never show a generic 500 page — always explain what's happening

## Auth Readiness Check

`/api/mira/chat` must return HTTP 503 (not 500) if `activation_state !== 'active'`:

```typescript
// middleware/auth.ts: requireActive
if (tenant.activation_state !== "active") {
  return c.json(
    { error: "Setup still in progress", state: tenant.activation_state },
    503
  );
}
```

## Safety Rules

- **Never** call `signupUser()` if `atlas_provisioning_status === 'ok'` — would 409 Atlas unique constraint
- **Always** use `singletonKey` in pg-boss to prevent duplicate provisioning jobs
- **Always** log `ERROR` (not `console.log`) when Atlas step fails — ops must see it in logs
- **Never** put Atlas signup synchronously inside the Stripe webhook handler
- Atlas connectivity check on startup — log `ERROR` if Atlas unreachable so ops know before first payment

## Key Files

| File | Role |
|------|------|
| `mira-web/src/server.ts:690-809` | Webhook handler — refactored to enqueue only |
| `mira-web/src/lib/activation.ts` | Sync finalizeActivation → enqueue wrapper |
| `mira-web/src/lib/activation-worker.ts` (new) | pg-boss worker, 3-step pipeline |
| `mira-web/src/lib/queue.ts` (new) | pg-boss singleton init |
| `mira-web/src/routes/setup.ts` (new) | `/setup` polling page |
| `mira-web/src/middleware/auth.ts:requireActive` | 503 if not active |

## DB Migration Required

```sql
ALTER TABLE plg_tenants
  ADD COLUMN activation_state text NOT NULL DEFAULT 'pending'
    CHECK (activation_state IN ('pending', 'provisioning', 'active', 'error')),
  ADD COLUMN provisioning_attempt_id uuid,
  ADD COLUMN stripe_event_id text;

CREATE UNIQUE INDEX ON plg_tenants (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

-- Backfill existing paid tenants to 'active'
UPDATE plg_tenants SET activation_state = 'active'
  WHERE stripe_customer_id IS NOT NULL;
```
