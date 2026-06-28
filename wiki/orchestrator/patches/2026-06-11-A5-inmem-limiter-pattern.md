# A5 staged note — in-memory per-instance rate-limiter pattern (pre-horizontal-scale hardening)

**Lens:** A (Hub security & auth) · **Run:** A5 (2026-06-11, audited `origin/main` @cde28770)
**Status:** NON-BLOCKING for beta (single-instance deploy). Founder-gated. No code edited in place.
**Verdict context:** Lens A 🟢 GREEN held. This note records the one residual that generalizes across BOTH Lens-A subjects.

## Finding

The same anti-pattern — an in-process `Map` used as a rate-limiter — appears on both Lens-A
subjects, and both are correct **only while each service runs a single instance**:

| Surface | Code | Limiter |
|---|---|---|
| `mira-hub` | `quickstart/ask` route | per-IP-hash in-memory 429 limiter (A4 residual #2) |
| `mira-web` | `src/lib/magic-link.ts` `checkMagicLinkRateLimit()` | `recentRequests` `Map<email, ts>` — code comment: *"in-memory; fine for single Bun instance"* |

Behind a multi-instance load balancer, requests spread across instances and **each instance keeps
its own counter**, so the effective limit multiplies by the instance count — i.e. the limit is
**bypassable at horizontal scale**. Not stranger-reachable today (single instance per service), so
it does not block beta — but it is a latent abuse vector (magic-link email flooding; quickstart
BM25 cost amplification) the moment either service scales out.

This is **not a new defect** — it is A4 residual #2 (`quickstart` limiter) re-confirmed and
generalized: the structural KG query *"rate-limiter nodes bypassable under `horizontal_scale`"*
returns exactly `[a5_inmem_magic_link, a4_quickstart_limiter]`.

## Remediation (apply BEFORE running >1 instance of mira-web or mira-hub)

Move both limiters to the existing DB-backed pattern already used by `public/report`
(NeonDB row with a windowed counter), so the counter is shared across instances.

1. **mira-web magic-link** — replace the `recentRequests` Map with a NeonDB upsert keyed by
   `(email_lower, window_start)`; reject when count in window ≥ threshold. Keep the in-memory
   path as a fast-fail pre-check (optional), authoritative decision in DB.
2. **mira-hub quickstart/ask** — same: port to the `public/report` DB limiter (per-IP-hash key).
3. **A4 residual #2b (unchanged, fold in here):** `uploads/folder` bearer compare is
   `token !== expected` (`route.ts:30`) — swap to `crypto.timingSafeEqual` while touching auth.

## Verify

```bash
# magic-link: two concurrent "instances" (separate processes) must SHARE the limit
cd mira-web && bun test src/lib/__tests__/magic-link.test.ts   # add a cross-instance case
# quickstart: hub limiter test asserts 429 persists across a simulated second instance
cd mira-hub && bun test  # extend the quickstart limiter spec
# constant-time: grep proves timingSafeEqual replaced the !== compare
git grep -n "timingSafeEqual" mira-hub/src/app/api/uploads
```

## Why no in-place patch

Audits are read-only on code (orchestrator hard rule). The change touches live auth surfaces on
the money path and is a *pre-scale* hardening item, not a beta blocker — it is founder-gated by
design, matching the B4/D4/E4 staged-note restraint.
