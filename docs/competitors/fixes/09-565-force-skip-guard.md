# Fix #9 — #565 work orders: force-skip transitions must backfill timestamps

**Branch:** `agent/issue-565-wo-lifecycle-0405`
**Severity:** ⚠️ High (data integrity)
**Effort:** ~30 min

## What's broken

`mira-hub/src/lib/work-orders/state-machine.ts:127-148`:

```ts
export function timestampsForTransition(
  to: WOStatus,
  now: Date = new Date(),
): Partial<{ started_at: Date; completed_at: Date; closed_at: Date }> {
  switch (to) {
    case "in_progress":
      return { started_at: now };
    case "completed":
      return { completed_at: now };
    case "closed":
      return { closed_at: now };
    default:
      return {};
  }
}
```

`canForceTransition` allows admins to skip states (e.g. `assigned →
closed`). But `timestampsForTransition(to: "closed")` only returns
`closed_at: now`. After `assigned → closed` (force):
- `started_at` is NULL
- `completed_at` is NULL
- `closed_at` is now

Reports keyed off these (MTTR, downtime hours, "completed in week N")
will report inconsistent or 0 values for force-skipped WOs. Worse:
nothing in the DB tells you the WO was force-skipped — auditors see
"closed WO with no started_at" and report a control gap.

## The fix

When force-skipping, backfill any missing intermediate timestamps with
the same `now`. This makes the state-flow consistent (started_at ≤
completed_at ≤ closed_at) at the cost of granularity for the skipped
states. Also stamp `force_skipped: true` in the audit log so the
reasoning is preserved.

### Patch 9.1 — Update the timestamp helper

```ts
// mira-hub/src/lib/work-orders/state-machine.ts

/**
 * Side-effect timestamp computation for a transition. Returns the patch a
 * transition should apply on top of `status`.
 *
 * For NORMAL transitions (one step at a time per the FSM), only the new
 * column is touched.
 *
 * For FORCE-skip transitions (admin-only, e.g. assigned → closed),
 * intermediate timestamps are BACKFILLED with the same `now`. This keeps
 * the started_at ≤ completed_at ≤ closed_at invariant true for every WO
 * regardless of how it got to its final state. Reports stay coherent.
 *
 * The audit log records `force_skipped: true` so the analyst knows the
 * timestamp resolution was lost on this WO.
 */
export function timestampsForTransition(
  current: WOStatus,
  to: WOStatus,
  now: Date = new Date(),
): {
  patch: Partial<{ started_at: Date; completed_at: Date; closed_at: Date }>;
  forceSkip: boolean;
} {
  const isForceSkip = !canTransition(current, to);

  // Path computation: which set of timestamps is naturally crossed?
  const path: WOStatus[] = isForceSkip
    ? PATH_TO_CLOSED.slice(PATH_TO_CLOSED.indexOf(current) + 1, PATH_TO_CLOSED.indexOf(to) + 1)
    : [to];

  const patch: Partial<{ started_at: Date; completed_at: Date; closed_at: Date }> = {};
  for (const step of path) {
    if (step === "in_progress") patch.started_at = now;
    if (step === "completed") patch.completed_at = now;
    if (step === "closed") patch.closed_at = now;
  }

  return { patch, forceSkip: isForceSkip };
}

// Linear "happy path" used for force-skip backfill. Only timestamps along
// this path can be backfilled; sideways states (on_hold, reviewed) don't
// stamp anything new, so no backfill needed.
const PATH_TO_CLOSED: ReadonlyArray<WOStatus> = [
  "open",
  "assigned",
  "in_progress",
  "completed",
  "reviewed",
  "closed",
];
```

### Patch 9.2 — Update the queries layer

In `mira-hub/src/lib/work-orders/queries.ts` (search for the
`transitionStatus` function), pass the current status and consume the
new return shape:

```ts
export async function transitionStatus(
  client: PoolClient,
  woId: string,
  toStatus: WOStatus,
  actorUserId: string,
  reason: string | null,
  options: { force?: boolean; isAdmin?: boolean } = {},
): Promise<WorkOrder> {
  const wo = await getWorkOrderForUpdate(client, woId);
  if (!wo) throw new HttpError(404, "not_found");

  // ... existing transition + guard checks ...

  const { patch, forceSkip } = timestampsForTransition(wo.status, toStatus);

  const updates: string[] = ["status = $2"];
  const args: unknown[] = [woId, toStatus];
  let i = 3;
  for (const [col, val] of Object.entries(patch)) {
    // Only stamp the timestamp if it's not already set (preserve first-time invariant).
    updates.push(`${col} = COALESCE(${col}, $${i})`);
    args.push(val);
    i += 1;
  }
  updates.push(`updated_at = now()`);

  await client.query(
    `UPDATE work_orders SET ${updates.join(", ")} WHERE id = $1`,
    args,
  );

  await appendAudit(client, {
    woId,
    actorUserId,
    eventType: "status_changed",
    payload: { from: wo.status, to: toStatus, reason, force_skip: forceSkip },
  });

  return getWorkOrder(client, woId);
}
```

### Patch 9.3 — Reject pathological force-skips

Some force-skips don't make sense even with backfill: `closed → anything`
isn't allowed (already terminal — use `/reopen`), and skipping into a
side-state (`on_hold`, `reviewed`) from an unrelated state is suspicious.

Tighten `canForceTransition` to reject these:

```ts
export function canForceTransition(from: WOStatus, to: WOStatus): boolean {
  if (from === to) return false;
  if (from === "closed") return false;  // already there

  // Side-states must come from their natural source.
  if (to === "on_hold" && from !== "in_progress") return false;
  if (to === "reviewed" && from !== "completed") return false;

  // Linear forward progression along PATH_TO_CLOSED only.
  const fromIdx = PATH_TO_CLOSED.indexOf(from);
  const toIdx = PATH_TO_CLOSED.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return false;
  return toIdx > fromIdx;
}
```

## Test

`mira-hub/src/lib/work-orders/__tests__/state-machine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  canTransition,
  canForceTransition,
  timestampsForTransition,
} from "../state-machine";

describe("normal transitions stamp only the new state", () => {
  it("open → assigned stamps nothing", () => {
    const { patch } = timestampsForTransition("open", "assigned");
    expect(Object.keys(patch)).toEqual([]);
  });

  it("assigned → in_progress stamps started_at", () => {
    const { patch, forceSkip } = timestampsForTransition("assigned", "in_progress");
    expect(patch.started_at).toBeInstanceOf(Date);
    expect(patch.completed_at).toBeUndefined();
    expect(forceSkip).toBe(false);
  });

  it("in_progress → completed stamps completed_at only", () => {
    const { patch } = timestampsForTransition("in_progress", "completed");
    expect(patch.completed_at).toBeInstanceOf(Date);
    expect(patch.started_at).toBeUndefined();
  });

  it("reviewed → closed stamps closed_at only", () => {
    const { patch } = timestampsForTransition("reviewed", "closed");
    expect(patch.closed_at).toBeInstanceOf(Date);
  });
});

describe("force-skip transitions backfill missing timestamps", () => {
  it("assigned → closed (skip 4 states) stamps started_at + completed_at + closed_at", () => {
    const { patch, forceSkip } = timestampsForTransition("assigned", "closed");
    expect(forceSkip).toBe(true);
    expect(patch.started_at).toBeInstanceOf(Date);
    expect(patch.completed_at).toBeInstanceOf(Date);
    expect(patch.closed_at).toBeInstanceOf(Date);
  });

  it("open → in_progress (skip assigned) stamps started_at", () => {
    const { patch, forceSkip } = timestampsForTransition("open", "in_progress");
    expect(forceSkip).toBe(true);
    expect(patch.started_at).toBeInstanceOf(Date);
  });

  it("in_progress → closed (skip completed + reviewed) stamps completed_at + closed_at", () => {
    const { patch, forceSkip } = timestampsForTransition("in_progress", "closed");
    expect(forceSkip).toBe(true);
    expect(patch.started_at).toBeUndefined(); // already set, won't be re-stamped via COALESCE
    expect(patch.completed_at).toBeInstanceOf(Date);
    expect(patch.closed_at).toBeInstanceOf(Date);
  });

  it("force-skip stamps are equal — invariant started_at ≤ completed_at ≤ closed_at holds", () => {
    const { patch } = timestampsForTransition("assigned", "closed");
    expect(patch.started_at!.getTime()).toBe(patch.completed_at!.getTime());
    expect(patch.completed_at!.getTime()).toBe(patch.closed_at!.getTime());
  });
});

describe("canForceTransition rejects nonsense skips", () => {
  it("rejects closed → anything", () => {
    expect(canForceTransition("closed", "open")).toBe(false);
    expect(canForceTransition("closed", "in_progress")).toBe(false);
  });

  it("rejects skips into on_hold from non-in_progress", () => {
    expect(canForceTransition("open", "on_hold")).toBe(false);
    expect(canForceTransition("assigned", "on_hold")).toBe(false);
  });

  it("rejects skips into reviewed from non-completed", () => {
    expect(canForceTransition("in_progress", "reviewed")).toBe(false);
  });

  it("rejects backwards skips", () => {
    expect(canForceTransition("completed", "open")).toBe(false);
    expect(canForceTransition("closed", "in_progress")).toBe(false);
  });

  it("allows linear forward skips", () => {
    expect(canForceTransition("open", "in_progress")).toBe(true);
    expect(canForceTransition("assigned", "completed")).toBe(true);
    expect(canForceTransition("in_progress", "closed")).toBe(true);
  });
});
```

## Verification

```bash
cd mira-hub
npx tsc --noEmit -p .
npx vitest run src/lib/work-orders/__tests__/state-machine.test.ts
```

13 tests pass. Force-skipped WOs now have coherent timestamps and the audit log preserves "this happened via force-skip."

## Reporting impact

Reports that compute MTTR (`completed_at - started_at`) will return 0
for force-skipped WOs (timestamps equal). That's accurate — we don't
KNOW the duration, the admin force-skipped. To filter these out of
performance reports, add a `WHERE NOT (status_changed.payload->>'force_skip' = 'true')`
filter, or check `started_at = completed_at` as a proxy.
