# #6085 Confirm the Order Number — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the technician ticks the order number on the identity card, the thread that produced the card shows that machine's manual lookup status (fixes #6085 without any wording guess).

**Architecture:** The server works out the one typed number that would make the card's question the machine's own (asking `threadStatusScope` itself) and sends it on the card frame as `offeredNumber`. The card shows it beside an unticked box. A ticked confirm sends `confirmedNumber`, the confirm route saves it in a new `equipment_notebooks.confirmed_numbers` column, and the detail read adds saved numbers to the scope only when the scope would otherwise withhold. Catalog number, lookup key, search, matching and answers are untouched.

**Tech Stack:** Next.js route handlers (TypeScript), Vitest, PostgreSQL migration (Neon), React shared shell (`packages/factorylm-ui`, Bun tests), Capacitor mobile adapter (Vitest).

**Spec:** `docs/superpowers/specs/2026-11-27-6085-confirm-order-number-design.md` (approved with Option A; §4.1 amended at plan stage to the token method, §4.6 gained the lazy read and the module boundary).

## Global Constraints

- Worktree `/Users/bravonode/Mira-worktrees/6085-confirm-number`, branch `bravo/6085-confirm-number`, base `8571e1215c2ef41c9c136c76dc4058792d46d980`. Never commit on main, never force-push.
- Stage only files this plan names (`git add <path>`); never `git add -A`.
- Commit messages: Conventional Commits, scope `hub` / `mobile` / `ui`, `(#6085)` in the subject; end with the two attribution lines from the session (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01HZ4euLfAzfsgCQPsbPztC1`).
- Every new or changed test is seen red on a named mutation, with the test counts recorded both ways (`.claude/rules/prove-the-test-fails.md`). Record each in `scratchpad/6085/mutations.log`.
- The confirm checkbox starts **unticked**. Nothing is saved unless it is ticked.
- `catalogNumber`, `acquisitionKey`, `startManualAcquisition`, manual matching and retrieval are not changed by any task.
- `mira-hub/src/capabilities/confirmed-numbers.ts` imports nothing from `notebook-manual-acquisition.ts` (guarded tests replace that module with a partial mock). `manual-status-subject.ts` imports nothing new from `notebook-manual-acquisition.ts`.
- Guarded paths this plan edits (with the PR's lifecycle rationale): `mira-hub/package.json` and `mira-hub/src/components/equipment/notebook-chat-utils.ts` only. All new tests go in `mira-hub/src/capabilities/__tests__/` (open). Do not edit any `mira-hub/src/app/**/__tests__/**` file.
- Shared-core lane (`packages/factorylm-*`, `apps/factorylm-ui-lab`): no edit, stage or pre-build until both earlier #3626 queue requests are RELEASED/COMPLETE/withdrawn **and** a real `[WORK-CLAIM]` is posted and the claim namespace re-read (Task 8 gate). Tasks 8–9 depend on it; Tasks 0–7 do not.
- Migration 118 is immutable once pushed (`.claude/rules/mira-hub-migrations.md` §8): prove it on a throwaway Postgres before the first push.
- Body lint for anything posted to GitHub: no `~`, at most one `$`, no `[^`, no `@`. JSON `--input` for gh writes.
- Merge, the prod migration and the mobile OTA are Mike's.

## Review Focus

1. **A typed number in brackets or with Unicode hyphens** ("(order no. 6AV2124-0GC01-0AX0)", "6AV2124‑0GC01‑0AX0"): the card offers the number in the technician's own spelling, and confirming it makes the thread own. Pinned in Task 2.
2. **A pasted wall of text with many digit tokens:** no box, bounded work (more than 20 candidates offers nothing; 20 still works). Pinned in Task 2.
3. **Ticked, but the confirm is refused (409, stale card):** no number is saved. Pinned in Task 5.
4. **The notebook is later re-identified as a different machine (Settings edit):** numbers saved for the old identity no longer count. Pinned in Task 4 (filter) and Task 6 (detail read).
5. **Follow polling in an own thread:** a detail read whose scope is already own or undecided makes no extra database read. Pinned in Task 6.

---

### Task 0: Workspace, claim and baselines (no product code)

**Files:** none in the repo. Notes in `scratchpad/6085/`.

- [ ] **Step 1: Re-read live state before touching anything**

```bash
cd /Users/bravonode/Mira-worktrees/6085-confirm-number
git fetch -q origin
git symbolic-ref -q --short HEAD || echo DETACHED      # expect bravo/6085-confirm-number
git rev-parse origin/main                               # note it; base is 8571e1215
git status -s                                           # expect only this plan + spec edits
gh pr list --state open --search "6085 in:title,body" --json number,title,headRefName
gh pr list --state open --json number,files -q '.[] | select(any(.files[]; .path | test("db/migrations/118_"))) | .number'
gh issue view 6085 --comments --json comments -q '.comments[-3:][] | .author.login + " " + .createdAt'
```

Expected: no other PR touches a `118_` migration; no new claim on #6085 after ours (comment 7206432024). If either exists, stop and report.

- [ ] **Step 2: Replace the probe symlink with a real install**

The worktree's `mira-hub/node_modules` is a symlink to the old #6094 worktree (made for the plan-stage probe). Print and remove it, then install as CI does:

```bash
cd /Users/bravonode/Mira-worktrees/6085-confirm-number/mira-hub
ls -l node_modules        # must show: node_modules -> /Users/bravonode/Mira-worktrees/6085-own-order-number/mira-hub/node_modules
rm node_modules           # removes the symlink only (no -r)
bun install --frozen-lockfile
ln -sfn ../mira-hub/node_modules ../packages/node_modules
cd ../mira-mobile && bun install --frozen-lockfile
cd ../apps/factorylm-ui-lab && bun install --frozen-lockfile
```

- [ ] **Step 3: Record baselines at the base commit**

```bash
cd /Users/bravonode/Mira-worktrees/6085-confirm-number/mira-hub
bun run test 2>&1 | tail -5 > /private/tmp/claude-501/-Users-bravonode-Mira/0cd970a4-693a-4e67-8ece-67dd47a42ab3/scratchpad/6085/baseline-hub.txt
npx tsc --noEmit -p . 2>&1 | grep -c 'error TS' >> /private/tmp/claude-501/-Users-bravonode-Mira/0cd970a4-693a-4e67-8ece-67dd47a42ab3/scratchpad/6085/baseline-hub.txt
cd ../mira-mobile && bun run test 2>&1 | tail -5 > /private/tmp/claude-501/-Users-bravonode-Mira/0cd970a4-693a-4e67-8ece-67dd47a42ab3/scratchpad/6085/baseline-mobile.txt
```

Expected: Hub passes with 0 failed; the typecheck error count matches main's (75 at the last measurement; record the actual number). Any pre-existing failure is noted as main's, not ours.

- [ ] **Step 4: Update the #6085 claim's expected files**

Edit comment 7206432024 (PATCH as JSON, body lint first) so `Expected files/systems` lists: `notebook-manual-acquisition.ts`, `confirmed-numbers.ts` (new), `manual-status-subject.ts`, `identity-proposal.ts`, `notebook-chat-types.ts`, chat route, confirm route, detail route, `db/migrations/118_notebook_confirmed_numbers.sql` (new), `notebook-chat-utils.ts` (guarded, Option A), `package.json` (guarded), new tests under `src/capabilities/__tests__/`, Hub and mobile adapters, and — after the #3626 slot — `packages/factorylm-interaction/src/types.ts`, `packages/factorylm-ui/src/parts.tsx` and its test. Set `Last updated` to the current UTC time.

- [ ] **Step 5: Confirm the plan commit is on the branch**

The plan and the spec amendment were committed and pushed at the plan stage (before Mike's review). Check `git log --oneline -3 -- docs/superpowers/plans/2026-11-27-6085-confirm-order-number.md` shows it, and that the working tree holds no docs edits beyond any Mike asked for in review.

---

### Task 1: The scope counts confirmed numbers

**Files:**
- Modify: `mira-hub/src/capabilities/notebook-manual-acquisition.ts` (`threadStatusScope`, around lines 1329–1345)
- Test: `mira-hub/src/capabilities/__tests__/thread-model-scope.test.ts` (open; append a `describe`)

**Interfaces:**
- Produces: `threadStatusScope(questions, machine)` where `machine` gains `confirmedNumbers?: readonly string[]`. Each joins the own identifier set exactly as `model` and `catalogNumber` do.

- [ ] **Step 1: Write the failing tests** (append to `thread-model-scope.test.ts`)

```ts
// #6085 (staging tablet walk 2026-11-27): the technician ticked the order number on the
// identity card. The number is theirs, so the question that names it is the machine's own.
describe("threadStatusScope: a number the technician confirmed (#6085)", () => {
  const J2 = "Our Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0 will not power up. What is the rated supply voltage?";
  const TP700 = { manufacturer: "Siemens", model: "TP700", catalogNumber: "", recordCatalog: null };
  const ticked = { ...TP700, confirmedNumbers: ["6AV2124-0GC01-0AX0"] };

  it("is own for the walk question once its order number is confirmed", () => {
    expect(threadStatusScope([J2], ticked)).toBe("own");
  });

  it("control: with no confirmed number the walk question is other", () => {
    expect(threadStatusScope([J2], TP700)).toBe("other");
    expect(threadStatusScope([J2], { ...TP700, confirmedNumbers: [] })).toBe("other");
  });

  it("control: a TP900 or another order number later in the thread is other", () => {
    expect(threadStatusScope([J2, "Find the manual for Siemens TP900 Comfort 6AV2124-0JC01-0AX0"], ticked)).toBe("other");
    expect(threadStatusScope([J2, "What about the 6AV2124-0JC01-0AX0?"], ticked)).toBe("other");
  });

  it("control: another maker named with the confirmed number is other", () => {
    expect(threadStatusScope(["Find the manual for Schneider Electric 6AV2124-0GC01-0AX0"], ticked)).toBe("other");
  });
});
```

- [ ] **Step 2: Run to verify the first test fails**

Run: `cd mira-hub && npx vitest run src/capabilities/__tests__/thread-model-scope.test.ts`
Expected: exactly 1 failed ("is own for the walk question…", received `other`); all others pass. Record counts.

- [ ] **Step 3: Implement**

In `threadStatusScope`'s `machine` parameter type, after `recordCatalog: string | null;` add:

```ts
    /** Numbers the technician ticked on the identity card for this same machine (#6085). */
    confirmedNumbers?: readonly string[];
```

and change the identifier loop:

```ts
  for (const value of [machine.model, machine.catalogNumber, ...(machine.confirmedNumbers ?? [])]) {
```

Add one line to the function's doc comment above `ThreadStatusScope`: `- a number the technician confirmed on the identity card counts as one of the project's identifiers (#6085).`

- [ ] **Step 4: Run to verify all pass**

Run: `cd mira-hub && npx vitest run src/capabilities/__tests__/thread-model-scope.test.ts`
Expected: 0 failed.

- [ ] **Step 5: Mutation proof**

Temporarily change the loop back to `[machine.model, machine.catalogNumber]`; run the file; expect exactly the one "is own…" test red. Restore; expect green. Log both counts.

- [ ] **Step 6: Commit**

```bash
git add mira-hub/src/capabilities/notebook-manual-acquisition.ts mira-hub/src/capabilities/__tests__/thread-model-scope.test.ts
git commit -m "feat(hub): the thread status scope counts a number the technician confirmed (#6085)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01HZ4euLfAzfsgCQPsbPztC1"
```

---

### Task 2: `offeredOwnNumber` — the one typed number the scope accepts

**Files:**
- Modify: `mira-hub/src/capabilities/notebook-manual-acquisition.ts` (add after `threadStatusScope`)
- Create: `mira-hub/src/capabilities/__tests__/offered-own-number.test.ts`

**Interfaces:**
- Consumes: `threadStatusScope` with `confirmedNumbers` (Task 1).
- Produces: `export function offeredOwnNumber(question: string, identity: { manufacturer: string | null | undefined; model: string | null | undefined }): string | null`

- [ ] **Step 1: Write the failing tests** (`offered-own-number.test.ts`)

```ts
// #6085: the identity card offers the one number the technician typed that would make the
// card's question this machine's own. The scope itself decides, so the card and the scope
// cannot disagree. Every expectation below was checked against main's scope at plan stage.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/offered-own-number
import { describe, it, expect } from "vitest";
import { offeredOwnNumber, threadStatusScope } from "@/capabilities/notebook-manual-acquisition";

const TP700 = { manufacturer: "Siemens", model: "TP700" };
const J2 = "Our Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0 will not power up. What is the rated supply voltage?";

describe("offeredOwnNumber", () => {
  it("offers the walk question's order number", () => {
    expect(offeredOwnNumber(J2, TP700)).toBe("6AV2124-0GC01-0AX0");
  });

  it("the offered number is the one that makes the question own", () => {
    const n = offeredOwnNumber(J2, TP700)!;
    expect(threadStatusScope([J2], { ...TP700, catalogNumber: "", recordCatalog: null, confirmedNumbers: [n] })).toBe("own");
  });

  // #6094 r2 F7: a neighbour's number is still offered. The box starts unticked, so a
  // careless tap never saves it; ticking it is the technician's own statement.
  it("offers a neighbour's number when it is the only one typed (the unticked box protects)", () => {
    expect(offeredOwnNumber("Our Siemens TP700 Comfort sits next to a 6AV2124-0JC01-0AX0 that will not power up.", TP700))
      .toBe("6AV2124-0JC01-0AX0");
  });

  it("offers nothing when two numbers are typed", () => {
    expect(offeredOwnNumber("Our Siemens TP700 Comfort 6AV2124-0GC01-0AX0 sits next to a 6AV2124-0JC01-0AX0 that will not power up.", TP700)).toBeNull();
  });

  it("offers nothing when another maker is named", () => {
    expect(offeredOwnNumber("Our Schneider Electric TP700 6AV2124-0GC01-0AX0 will not power up.", TP700)).toBeNull();
  });

  it("offers nothing when the question is already own or names no number", () => {
    expect(offeredOwnNumber("Our Siemens TP700 Comfort will not power up.", TP700)).toBeNull();
    expect(offeredOwnNumber("Find me the AutomationDirect GS10 manual", { manufacturer: "AutomationDirect", model: "GS11N-20P2" })).toBeNull();
  });

  it("offers nothing without a model", () => {
    expect(offeredOwnNumber(J2, { manufacturer: "Siemens", model: "" })).toBeNull();
    expect(offeredOwnNumber(J2, { manufacturer: "Siemens", model: null })).toBeNull();
  });

  it("offers nothing when the same number is typed two ways", () => {
    expect(offeredOwnNumber("Siemens TP700 6AV2124-0GC01-0AX0 also written 6AV21240GC010AX0 will not power up", TP700)).toBeNull();
  });

  // Review Focus 1: the technician's own spelling, without surrounding punctuation.
  it("keeps the typed spelling, without brackets or trailing punctuation", () => {
    expect(offeredOwnNumber("Our Siemens TP700 Comfort (order no. 6AV2124-0GC01-0AX0) will not power up.", TP700)).toBe("6AV2124-0GC01-0AX0");
    expect(offeredOwnNumber("Our Siemens TP700 Comfort 6AV2124‑0GC01‑0AX0 will not power up.", TP700)).toBe("6AV2124‑0GC01‑0AX0");
    expect(offeredOwnNumber("The label reads SIEMENS TP700 Comfort 1P 6AV2124-0GC01-0AX0 and it will not power up", TP700)).toBe("6AV2124-0GC01-0AX0");
  });

  it("offers a drive's type code", () => {
    expect(offeredOwnNumber("Our ABB ACS355 ACS355-03E-07A3-4 shows fault 0001. What does it mean?", { manufacturer: "ABB", model: "ACS355" }))
      .toBe("ACS355-03E-07A3-4");
  });

  // Review Focus 2: bounded work on a pasted wall of text.
  it("offers nothing past 20 digit-bearing tokens, and still offers at 20", () => {
    const filler = (n: number) => Array.from({ length: n }, (_, i) => `x${i + 1}`).join(" ");
    // "TP700" and the number are two of the digit-bearing tokens.
    expect(offeredOwnNumber(`Siemens TP700 6AV2124-0GC01-0AX0 ${filler(18)}`, TP700)).toBe("6AV2124-0GC01-0AX0");
    expect(offeredOwnNumber(`Siemens TP700 6AV2124-0GC01-0AX0 ${filler(19)}`, TP700)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mira-hub && npx vitest run src/capabilities/__tests__/offered-own-number.test.ts`
Expected: FAIL — `offeredOwnNumber` is not exported (every test red). Record counts.

- [ ] **Step 3: Implement** (after `threadStatusScope` in `notebook-manual-acquisition.ts`)

```ts
/** Brackets around a typed number and punctuation after it are not part of it. */
const typedToken = (token: string) =>
  token.replace(/^[([{"'“‘]+/, "").replace(/[)\]}"'”’.,;:!?]+$/, "");
/** Past this many digit-bearing tokens nothing is offered: a bound on the work, never a guess. */
const MAX_OFFERED_CANDIDATES = 20;

/**
 * #6085: the one number the technician typed that would make this question the proposed
 * machine's own, for the identity card to offer beside an unticked box. The scope decides
 * (`threadStatusScope` with that number confirmed), so the card and the status scope read the
 * question the same way. Null when the question is not withheld today, when no single typed
 * token settles it (two numbers, another maker, the same number spelled two ways), or past
 * 20 digit-bearing tokens. The value is the token as typed, never a normalised string.
 */
export function offeredOwnNumber(
  question: string,
  identity: { manufacturer: string | null | undefined; model: string | null | undefined },
): string | null {
  if (!identity.model?.trim()) return null;
  const machine = { manufacturer: identity.manufacturer, model: identity.model, catalogNumber: null, recordCatalog: null };
  if (threadStatusScope([question], machine) !== "other") return null;
  const candidates = [
    ...new Set(question.split(/\s+/).map(typedToken).filter((t) => /\d/.test(t) && t.length <= 64)),
  ];
  if (candidates.length > MAX_OFFERED_CANDIDATES) return null;
  const fixes = candidates.filter((t) => threadStatusScope([question], { ...machine, confirmedNumbers: [t] }) === "own");
  return fixes.length === 1 ? fixes[0]! : null;
}
```

- [ ] **Step 4: Run to verify all pass**

Run: `cd mira-hub && npx vitest run src/capabilities/__tests__/offered-own-number.test.ts src/capabilities/__tests__/thread-model-scope.test.ts`
Expected: 0 failed.

- [ ] **Step 5: Mutation proofs** (one at a time, restore after each; log counts)

1. `return fixes.length >= 1 ? fixes[0]! : null;` → "two ways" red.
2. Delete the `!== "other"` early return → "offers nothing when the question is already own or names no number" red (plan-stage probe: "TP700" itself then counts as a fixing token for an already-own question and is offered).
3. `if (candidates.length > 200) return null;` → "past 20" red.
4. Drop `typedToken` (use raw tokens) → "keeps the typed spelling" red.

- [ ] **Step 6: Commit**

```bash
git add mira-hub/src/capabilities/notebook-manual-acquisition.ts mira-hub/src/capabilities/__tests__/offered-own-number.test.ts
git commit -m "feat(hub): work out the one typed number the scope accepts for the identity card (#6085)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01HZ4euLfAzfsgCQPsbPztC1"
```

---

### Task 3: The card frame carries `offeredNumber` (live, saved, and through the guarded parser)

**Files:**
- Modify: `mira-hub/src/capabilities/identity-proposal.ts:47` (frame type)
- Modify: `mira-hub/src/lib/notebook-chat-types.ts:468-473` (event type) and `:553-557` (validator)
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` (import; `proposalEntries` near line 3151; the two `proposalFrame` sites near lines 4219 and 6331)
- Modify (GUARDED, Option A): `mira-hub/src/components/equipment/notebook-chat-utils.ts:302-304`
- Create: `mira-hub/src/capabilities/__tests__/offered-number-route.test.ts`
- Test (open, append): `mira-hub/src/factorylm-ui/notebook-chat-progress.test.ts`

**Interfaces:**
- Consumes: `offeredOwnNumber` (Task 2).
- Produces: `NotebookIdentityProposalFrame = { kind: "identity_proposal"; offeredNumber?: string } & IdentityProposal`; `NotebookIdentityProposalEvent.offeredNumber?: string`; `StreamResult.identityProposal.offeredNumber?: string` (via `Omit<NotebookIdentityProposalEvent, "kind">`); the persisted evidence entry `{ kind: "identity_proposal", manufacturer, model, offeredNumber? }`.

- [ ] **Step 1: Write the failing route test** (`offered-number-route.test.ts`)

```ts
/**
 * #6085: the identity card frame offers the typed order number, live and in the saved turn.
 * Same stand-ins as synthetic-technician/typed-machine.route.test.ts: the route, the proposal
 * code, the model parser and the offered-number reader are real; the provider, database and
 * session are stand-ins. No network, $0.
 *
 * Run: cd mira-hub && npx vitest run src/capabilities/__tests__/offered-number-route
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseFrame } from "@/lib/notebook-chat-types";

const TENANT = "6085c000-0000-4000-8000-000000000011";
const NB = "6085c000-0000-4000-8000-000000000022";
const NODE = "6085c000-0000-4000-8000-000000000033";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })) }));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async (): Promise<Record<string, unknown>> => ({ state: "unbound" })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
  listTurns: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveManualChunks: vi.fn(async () => [] as unknown[]),
  corpusManufacturers: vi.fn(async () => [] as string[]),
}));
vi.mock("@/lib/manual-rag", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/manual-rag")>()),
  ...ragMock,
}));

const tenantQuery = vi.hoisted(() => vi.fn(async () => ({ rows: [], rowCount: 0 })));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: tenantQuery })),
}));
vi.mock("@/lib/db", () => ({
  default: {
    query: vi.fn(async () => ({ rows: [] })),
    connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })),
  },
}));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));
vi.mock("@/lib/inference/canonical-cascade", () => ({
  canonicalSeamEnabled: vi.fn(() => true),
  canonicalProviders: vi.fn(() => [{ name: "stand-in", url: "https://test.invalid/v1", key: "k", model: "m" }]),
  buildRequestBody: vi.fn((provider: { model: string }, messages: unknown) => ({ model: provider.model, messages, stream: true })),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage", provider: "stand-in" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
const acqMock = vi.hoisted(() => ({
  acquisitionEnabled: vi.fn(() => false),
  startManualAcquisition: vi.fn(async () => true),
  readAcquisition: vi.fn(async () => null as unknown),
  reconcileAcquisition: vi.fn(async (_t: string, _n: string, rec: unknown) => rec),
}));
vi.mock("@/capabilities/notebook-manual-acquisition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/notebook-manual-acquisition")>()),
  ...acqMock,
}));

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

function providerStream(text: string) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

async function ask(message: string): Promise<Record<string, unknown>[]> {
  const res = await POST(
    new NextRequest("http://test/api/equipment-notebooks/x/chat", {
      method: "POST",
      body: JSON.stringify({ message, mode: "general" }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: NB }) },
  );
  const out: Record<string, unknown>[] = [];
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ") || line.slice(6) === "[DONE]") continue;
    try { out.push(JSON.parse(line.slice(6))); } catch { /* partial frame */ }
  }
  return out;
}

const proposalIn = (frames: Record<string, unknown>[]) => frames.find((f) => f.kind === "identity_proposal");
const savedProposal = () => {
  const turn = (nbMock.recordTurn.mock.calls as unknown as Array<[string, string, { evidence: unknown[] }]>)[0]?.[2];
  return (turn?.evidence ?? []).find((e) => (e as { kind?: string }).kind === "identity_proposal") as Record<string, unknown> | undefined;
};

const WALK = "Our Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0 will not power up. What is the rated supply voltage?";

beforeEach(() => {
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  process.env.NEON_DATABASE_URL = "postgres://test";
  delete process.env.NOTEBOOK_WORK_PACKET;
  vi.clearAllMocks();
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "New machine", nodeId: NODE, manufacturer: null, model: null });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
  ragMock.corpusManufacturers.mockResolvedValue(["Siemens", "Schneider Electric", "AutomationDirect"]);
  acqMock.acquisitionEnabled.mockReturnValue(false);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("A general reply."), { status: 200 })));
});

describe("the identity card offers the typed order number (#6085)", () => {
  it("precondition: the walk question gets a Siemens TP700 card", async () => {
    expect(proposalIn(await ask(WALK))).toMatchObject({ manufacturer: "Siemens", model: "TP700" });
  });

  it("the live card frame offers the order number", async () => {
    expect(proposalIn(await ask(WALK))).toMatchObject({ offeredNumber: "6AV2124-0GC01-0AX0" });
  });

  it("the saved turn's card offers the same number, so a reload shows the same box", async () => {
    await ask(WALK);
    expect(savedProposal()).toMatchObject({ kind: "identity_proposal", offeredNumber: "6AV2124-0GC01-0AX0" });
  });

  it("control: a card whose question names no number offers none", async () => {
    const card = proposalIn(await ask("Our Siemens TP700 Comfort panel will not power up."));
    expect(card).toMatchObject({ manufacturer: "Siemens", model: "TP700" });
    expect(card).not.toHaveProperty("offeredNumber");
  });
});

describe("the frame validator (#6085)", () => {
  const base = { kind: "identity_proposal", manufacturer: "Siemens", model: "TP700" };
  it("keeps a string offeredNumber", () => {
    expect(parseFrame(JSON.stringify({ ...base, offeredNumber: "6AV2124-0GC01-0AX0" }))).toMatchObject({ offeredNumber: "6AV2124-0GC01-0AX0" });
  });
  it("rejects a non-string offeredNumber, the same way it rejects a non-string catalogNumber", () => {
    expect(parseFrame(JSON.stringify({ ...base, offeredNumber: 6 }))).toBeNull();
    expect(parseFrame(JSON.stringify({ ...base, catalogNumber: 6 }))).toBeNull();
  });
  it("control: a frame with no offeredNumber still parses", () => {
    expect(parseFrame(JSON.stringify(base))).toMatchObject(base);
  });
});
```

If the precondition test fails (the walk message gives no card in this harness), stop: the harness differs from the tablet path. Find which proposer the walk card came from (`exactManualRequestIdentity`, `proposeIdentityFromText`, `proposeFromLibraryModel` or the candidate path) and adjust the stand-ins (maker list, `acquisitionEnabled`) until the precondition holds, before going on. Record what was needed.

- [ ] **Step 2: Write the failing parser test** (append to `mira-hub/src/factorylm-ui/notebook-chat-progress.test.ts`, inside the existing `describe`)

```ts
  // #6085 (Option A): the live card keeps the offered number, so the box shows before reload.
  it("keeps the identity card's offered number on the live result", async () => {
    const proposal = { manufacturer: "Siemens", model: "TP700", offeredNumber: "6AV2124-0GC01-0AX0" };
    const result = await readNotebookStream(streamOf([
      frame({ kind: "status", status: "insufficient_evidence", message: "Confirm the equipment." }),
      frame({ kind: "identity_proposal", ...proposal }),
    ]), () => {});
    expect(result.identityProposal).toEqual(proposal);
    expect(partsFromStream(result, { turnId: "live" })).toContainEqual({ type: "identity_proposal", ...proposal });
  });
```

- [ ] **Step 3: Run both to verify they fail**

Run: `cd mira-hub && npx vitest run src/capabilities/__tests__/offered-number-route.test.ts src/factorylm-ui/notebook-chat-progress.test.ts`
Expected: the precondition, "no number offers none" and both validator controls PASS; "live card…", "saved turn…", "keeps a string offeredNumber" (the validator passes unknown fields, so this may already pass — record it), "rejects a non-string offeredNumber" and the parser test FAIL. Record counts.

- [ ] **Step 4: Implement**

`identity-proposal.ts` line 47:

```ts
/** The SSE frame the notebook chat emits next to the normal answer. `offeredNumber` (#6085) is
 *  the one typed number the card offers beside an unticked box (`offeredOwnNumber`). */
export type NotebookIdentityProposalFrame = { kind: "identity_proposal"; offeredNumber?: string } & IdentityProposal;
```

`notebook-chat-types.ts`, `NotebookIdentityProposalEvent` gains `offeredNumber?: string;` after `catalogNumber?: string;`, and the validator's `identity_proposal` clause gains one condition:

```ts
      (obj.catalogNumber !== undefined && typeof obj.catalogNumber !== "string") ||
      (obj.offeredNumber !== undefined && typeof obj.offeredNumber !== "string")
```

Chat route: add `offeredOwnNumber` to the existing `@/capabilities/notebook-manual-acquisition` import list. First confirm no reassignment after the final proposal: `grep -n "identityProposal = " "mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts"` must show only lines before 3151. Then replace the `proposalEntries` block (near line 3151) with:

```ts
  // #6085: the card offers the one typed number the status scope would accept for this
  // machine (`offeredOwnNumber`), so a technician who ticks it sees this thread's lookup status.
  const offeredNumber = identityProposal ? offeredOwnNumber(message, identityProposal) : null;
  const identityProposalFrame: NotebookIdentityProposalFrame | null = identityProposal
    ? { kind: "identity_proposal", ...identityProposal, ...(offeredNumber ? { offeredNumber } : {}) }
    : null;
  const proposalEntries: NotebookIdentityProposalFrame[] = identityProposalFrame ? [identityProposalFrame] : [];
```

At both emit sites (near lines 4219 and 6331) replace

```ts
        if (identityProposal) {
          const proposalFrame: NotebookIdentityProposalFrame = { kind: "identity_proposal", ...identityProposal };
          controller.enqueue(enc.encode(sse(proposalFrame)));
        }
```

with

```ts
        if (identityProposalFrame) controller.enqueue(enc.encode(sse(identityProposalFrame)));
```

(keep each site's own indentation). If `message` is not the in-scope name of the typed text at line 3151, use the same variable `proposeIdentityFromText` receives at line 3110.

GUARDED `notebook-chat-utils.ts` lines 302–304:

```ts
        } else if (frame.kind === "identity_proposal") {
          const { manufacturer, model, catalogNumber, offeredNumber } = frame;
          out.identityProposal = { manufacturer, model, ...(catalogNumber ? { catalogNumber } : {}), ...(offeredNumber ? { offeredNumber } : {}) };
```

- [ ] **Step 5: Run to verify all pass, plus the neighbouring suites**

Run: `cd mira-hub && npx vitest run src/capabilities/__tests__/offered-number-route.test.ts src/factorylm-ui/notebook-chat-progress.test.ts src/capabilities/__tests__/synthetic-technician src/capabilities/__tests__/library-model-proposal-route.test.ts "src/app/api/equipment-notebooks"`
Expected: 0 failed.

- [ ] **Step 6: Mutation proofs** (restore after each; log counts)

1. Chat route: `const offeredNumber = null;` → "live card" and "saved turn" red.
2. Emit sites: revert one site to `{ kind: "identity_proposal", ...identityProposal }` → "live card" red (if the answered path is the one the harness takes; if it is the abstained path, revert that one instead and record which).
3. Validator: delete the new condition → "rejects a non-string offeredNumber" red.
4. Parser: drop `...(offeredNumber ? { offeredNumber } : {})` → the parser test red.

- [ ] **Step 7: Commit**

```bash
git add mira-hub/src/capabilities/identity-proposal.ts mira-hub/src/lib/notebook-chat-types.ts "mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts" mira-hub/src/components/equipment/notebook-chat-utils.ts mira-hub/src/capabilities/__tests__/offered-number-route.test.ts mira-hub/src/factorylm-ui/notebook-chat-progress.test.ts
git commit -m "feat(hub): the identity card frame offers the typed order number (#6085)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01HZ4euLfAzfsgCQPsbPztC1"
```

---

### Task 4: Migration 118 and the `confirmed-numbers` storage module

**Files:**
- Create: `mira-hub/db/migrations/118_notebook_confirmed_numbers.sql`
- Create: `mira-hub/src/capabilities/confirmed-numbers.ts`
- Create: `mira-hub/src/capabilities/__tests__/confirmed-numbers.test.ts` (unit, mocked client)
- Create: `mira-hub/src/capabilities/__tests__/confirmed-numbers.integration.test.ts` (real Postgres)

**Interfaces:**
- Produces:
  - `export interface ConfirmedNumberEntry { number: string; manufacturer: string; model: string; confirmedAt: string }`
  - `export async function saveConfirmedNumber(tenantId: string, notebookId: string, entry: { number: string; manufacturer: string; model: string }): Promise<boolean>` — true when the entry is on the row afterwards (new or already there); false when no row matched. Throws on a database error (the route catches).
  - `export async function readConfirmedNumbers(tenantId: string, notebookId: string): Promise<ConfirmedNumberEntry[]>` — never throws; `[]` on any error.
  - `export function numbersForIdentity(entries: readonly ConfirmedNumberEntry[], identity: { manufacturer: string | null | undefined; model: string | null | undefined }): string[]`

- [ ] **Step 1: Draft the migration (not committed, not pushed yet)**

`mira-hub/db/migrations/118_notebook_confirmed_numbers.sql`:

```sql
-- #6085: numbers the technician ticked on the identity card ("6AV2124-0GC01-0AX0 is this
-- machine's number"). Read only by the thread status scope (manual-status-subject.ts); never by
-- the catalog number, the lookup key, the manual search, manual matching or retrieval.
-- Entries: {"number","manufacturer","model","confirmedAt"}; the identity is stored with the
-- number so entries for an identity the notebook no longer has are ignored on read.
-- Additive. Table-level grants on equipment_notebooks (073) cover the column. The revoke
-- trigger (101) fires only on UPDATE OF manufacturer, model, catalog_number, identity_status.
BEGIN;
ALTER TABLE equipment_notebooks
  ADD COLUMN IF NOT EXISTS confirmed_numbers JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMIT;
```

- [ ] **Step 2: Write the failing unit tests** (`confirmed-numbers.test.ts`)

```ts
// #6085: storage for the numbers the technician confirmed. Unit level: the SQL a call sends and
// the fail-closed read. The real behaviour (idempotent append, tenant isolation) is proven in
// confirmed-numbers.integration.test.ts.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/confirmed-numbers.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query })),
}));

import { numbersForIdentity, readConfirmedNumbers, saveConfirmedNumber, type ConfirmedNumberEntry } from "@/capabilities/confirmed-numbers";

const TENANT = "6085c000-0000-4000-8000-0000000000a1";
const NB = "6085c000-0000-4000-8000-0000000000a2";
const entry = (number: string, manufacturer = "Siemens", model = "TP700"): ConfirmedNumberEntry =>
  ({ number, manufacturer, model, confirmedAt: "2026-11-27T00:00:00.000Z" });

beforeEach(() => { query.mockReset(); vi.spyOn(console, "warn").mockImplementation(() => {}); });

describe("numbersForIdentity", () => {
  it("returns numbers saved for this maker and model", () => {
    expect(numbersForIdentity([entry("6AV2124-0GC01-0AX0")], { manufacturer: "Siemens", model: "TP700" })).toEqual(["6AV2124-0GC01-0AX0"]);
  });
  it("matches the maker through its vendor group and the model in any spacing", () => {
    expect(numbersForIdentity([entry("6AV2124-0GC01-0AX0", "SIEMENS", "tp 700")], { manufacturer: "Siemens", model: "TP700" })).toEqual(["6AV2124-0GC01-0AX0"]);
  });
  // Review Focus 4: the notebook was re-identified; the old number no longer counts.
  it("ignores numbers saved for another identity", () => {
    expect(numbersForIdentity([entry("6AV2124-0GC01-0AX0", "Siemens", "TP700")], { manufacturer: "Siemens", model: "TP900" })).toEqual([]);
    expect(numbersForIdentity([entry("6AV2124-0GC01-0AX0", "ABB", "TP700")], { manufacturer: "Siemens", model: "TP700" })).toEqual([]);
  });
  it("returns nothing without a maker or a model", () => {
    expect(numbersForIdentity([entry("6AV2124-0GC01-0AX0")], { manufacturer: null, model: "TP700" })).toEqual([]);
    expect(numbersForIdentity([entry("6AV2124-0GC01-0AX0")], { manufacturer: "Siemens", model: "" })).toEqual([]);
  });
});

describe("readConfirmedNumbers", () => {
  it("returns well-formed entries from the row", async () => {
    query.mockResolvedValue({ rows: [{ confirmed_numbers: [entry("6AV2124-0GC01-0AX0"), { number: 7 }, "x"] }] });
    expect(await readConfirmedNumbers(TENANT, NB)).toEqual([entry("6AV2124-0GC01-0AX0")]);
    expect(String(query.mock.calls[0]![0])).toMatch(/SELECT confirmed_numbers FROM equipment_notebooks WHERE tenant_id = \$1::uuid AND id = \$2::uuid/);
  });
  it("returns nothing for a missing row or a non-array value", async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await readConfirmedNumbers(TENANT, NB)).toEqual([]);
    query.mockResolvedValue({ rows: [{ confirmed_numbers: { number: "x" } }] });
    expect(await readConfirmedNumbers(TENANT, NB)).toEqual([]);
  });
  // A Hub deployed before the prod migration: the column does not exist yet.
  it("returns nothing, and logs, when the read fails", async () => {
    query.mockRejectedValue(new Error('column "confirmed_numbers" does not exist'));
    expect(await readConfirmedNumbers(TENANT, NB)).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe("saveConfirmedNumber", () => {
  it("sends one tenant-scoped append that skips a duplicate", async () => {
    query.mockResolvedValue({ rows: [{ id: NB }], rowCount: 1 });
    expect(await saveConfirmedNumber(TENANT, NB, { number: "6AV2124-0GC01-0AX0", manufacturer: "Siemens", model: "TP700" })).toBe(true);
    const [sql, values] = query.mock.calls[0]! as [string, unknown[]];
    expect(sql).toMatch(/UPDATE equipment_notebooks/);
    expect(sql).toMatch(/WHERE n\.tenant_id = \$1::uuid AND n\.id = \$2::uuid/);
    expect(sql).toMatch(/NOT EXISTS|WHEN EXISTS/);
    expect(sql).not.toMatch(/catalog_number|identity_status|manufacturer =|model =/);
    expect(values.slice(0, 6)).toEqual([TENANT, NB, "6AV2124-0GC01-0AX0", "Siemens", "TP700", "6AV21240GC010AX0"]);
  });
  it("is false when no row matched", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await saveConfirmedNumber(TENANT, NB, { number: "6AV2124-0GC01-0AX0", manufacturer: "Siemens", model: "TP700" })).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd mira-hub && npx vitest run src/capabilities/__tests__/confirmed-numbers.test.ts`
Expected: FAIL — module not found. Record counts.

- [ ] **Step 4: Implement** (`mira-hub/src/capabilities/confirmed-numbers.ts`)

```ts
/**
 * #6085: numbers the technician ticked on the identity card ("6AV2124-0GC01-0AX0 is this
 * machine's number"), stored in `equipment_notebooks.confirmed_numbers` (migration 118).
 *
 * Only the thread status scope reads them (manual-status-subject.ts). The catalog number, the
 * lookup key, the manual search, manual matching and retrieval never do.
 *
 * Deliberately imports nothing from notebook-manual-acquisition.ts: route tests replace that
 * module with a partial mock.
 */
import { withTenantContext } from "@/lib/tenant-context";
import { normalizeManufacturer } from "@/lib/manufacturerNormalize";

export interface ConfirmedNumberEntry {
  number: string;
  manufacturer: string;
  model: string;
  confirmedAt: string;
}

const key = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const makerKey = (s: string | null | undefined) => key(normalizeManufacturer(s).canonical);

function isEntry(v: unknown): v is ConfirmedNumberEntry {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.number === "string" && typeof r.manufacturer === "string" && typeof r.model === "string" && typeof r.confirmedAt === "string";
}

/** The saved numbers that belong to this identity: same maker (vendor group) and model. */
export function numbersForIdentity(
  entries: readonly ConfirmedNumberEntry[],
  identity: { manufacturer: string | null | undefined; model: string | null | undefined },
): string[] {
  const maker = makerKey(identity.manufacturer);
  const model = key(identity.model);
  if (!maker || !model) return [];
  return entries.filter((e) => makerKey(e.manufacturer) === maker && key(e.model) === model).map((e) => e.number);
}

/** The notebook's saved numbers. Never throws: any error (including a missing column before the
 *  prod migration) gives none, which is today's behaviour. */
export async function readConfirmedNumbers(tenantId: string, notebookId: string): Promise<ConfirmedNumberEntry[]> {
  try {
    const res = await withTenantContext(tenantId, (c) =>
      c.query<{ confirmed_numbers: unknown }>(
        `SELECT confirmed_numbers FROM equipment_notebooks WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, notebookId],
      ),
    );
    const value = res.rows[0]?.confirmed_numbers;
    return Array.isArray(value) ? value.filter(isEntry) : [];
  } catch (err) {
    console.warn(`[confirmed-numbers] read failed notebook=${notebookId}: ${(err as Error).message}`);
    return [];
  }
}

/** Appends one confirmed number unless the same number (any spelling) is already saved for the
 *  same maker and model. True when the entry is on the row afterwards; false when no row matched.
 *  Touches only `confirmed_numbers`, so migration 101's trigger never fires. */
export async function saveConfirmedNumber(
  tenantId: string,
  notebookId: string,
  entry: { number: string; manufacturer: string; model: string },
): Promise<boolean> {
  const written = await withTenantContext(tenantId, (c) =>
    c.query<{ id: string }>(
      `UPDATE equipment_notebooks AS n
          SET confirmed_numbers = CASE
                WHEN EXISTS (
                  SELECT 1 FROM jsonb_array_elements(n.confirmed_numbers) AS e
                   WHERE upper(regexp_replace(e->>'number', '[^A-Za-z0-9]', '', 'g')) = $6
                     AND e->>'manufacturer' = $4 AND e->>'model' = $5)
                THEN n.confirmed_numbers
                ELSE n.confirmed_numbers || jsonb_build_array(jsonb_build_object(
                  'number', $3::text, 'manufacturer', $4::text, 'model', $5::text, 'confirmedAt', $7::text))
              END
        WHERE n.tenant_id = $1::uuid AND n.id = $2::uuid
        RETURNING n.id`,
      [tenantId, notebookId, entry.number, entry.manufacturer, entry.model, key(entry.number), new Date().toISOString()],
    ),
  );
  return (written.rowCount ?? 0) > 0;
}
```

Note on the unit test's SQL regex: the `WHERE` is on one line in the implementation so the assertion matches; keep it that way.

- [ ] **Step 5: Run unit tests to verify they pass**

Run: `cd mira-hub && npx vitest run src/capabilities/__tests__/confirmed-numbers.test.ts`
Expected: 0 failed.

- [ ] **Step 6: Write the real-Postgres test** (`confirmed-numbers.integration.test.ts`)

```ts
// #6085: migration 118 and the confirmed-number write, against a real, disposable Postgres:
// re-apply is a no-op, a repeated confirm does not duplicate, another tenant can neither read
// nor write, and the write never fires migration 101's revoke trigger.
//
// From mira-hub/ (throwaway database only):
//   docker run -d --name mira6085-pg -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=mira_test -p 55685:5432 postgres:16
//   export TEST_DATABASE_URL=postgres://postgres:testpw@127.0.0.1:55685/mira_test MIRA_TEST_DB_CONFIRM=DISPOSABLE
//   export MIRA_INTEGRATION_EXTRA_MIGRATIONS=100_notebook_manual_acquisition.sql,101_notebook_manual_acquisition_revoke_trigger.sql,102_notebook_manual_acquisition_revoke_spares_confirmed.sql,104_notebook_manual_acquisition_confirm_promotes.sql,118_notebook_confirmed_numbers.sql
//   node scripts/setup-integration-db.mjs
//   npx vitest run --config vitest.integration.config.ts src/capabilities/__tests__/confirmed-numbers.integration.test.ts
// Not wired into CI (same status as notebook-identity-confirm.integration.test.ts).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { readConfirmedNumbers, saveConfirmedNumber } from "@/capabilities/confirmed-numbers";

const TENANT = "6085beef-0000-4000-8000-000000000001";
const OTHER = "6085beef-0000-4000-8000-000000000009";
const NODE_ID = "6085beef-0000-4000-8000-000000000002";
const ENTRY = { number: "6AV2124-0GC01-0AX0", manufacturer: "Siemens", model: "TP700" };

async function makeNotebook(): Promise<string> {
  const res = await testPool.query<{ id: string }>(
    `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name, manufacturer, model, identity_status)
     VALUES ($1::uuid, $2::uuid, 'number bench', 'Siemens', 'TP700', 'user_confirmed') RETURNING id::text AS id`,
    [TENANT, NODE_ID],
  );
  return res.rows[0]!.id;
}
const wipe = () => testPool.query(`DELETE FROM equipment_notebooks WHERE tenant_id IN ($1::uuid, $2::uuid)`, [TENANT, OTHER]);

beforeAll(wipe);
afterAll(async () => { await wipe(); await testPool.end(); });

describe("migration 118 + saveConfirmedNumber (real Postgres)", () => {
  it("re-applying the migration is a no-op", async () => {
    const sql = readFileSync(join(__dirname, "../../../db/migrations/118_notebook_confirmed_numbers.sql"), "utf8");
    await expect(testPool.query(sql)).resolves.toBeDefined();
    const col = await testPool.query(
      `SELECT data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'equipment_notebooks' AND column_name = 'confirmed_numbers'`,
    );
    expect(col.rows[0]).toMatchObject({ data_type: "jsonb", is_nullable: "NO" });
  });

  it("saves once; a repeated confirm in another spelling does not duplicate", async () => {
    const nb = await makeNotebook();
    expect(await saveConfirmedNumber(TENANT, nb, ENTRY)).toBe(true);
    expect(await saveConfirmedNumber(TENANT, nb, { ...ENTRY, number: "6AV21240GC010AX0" })).toBe(true);
    const saved = await readConfirmedNumbers(TENANT, nb);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject(ENTRY);
  });

  it("another tenant can neither read nor write it", async () => {
    const nb = await makeNotebook();
    expect(await saveConfirmedNumber(OTHER, nb, ENTRY)).toBe(false);
    expect(await readConfirmedNumbers(TENANT, nb)).toEqual([]);
    await saveConfirmedNumber(TENANT, nb, ENTRY);
    expect(await readConfirmedNumbers(OTHER, nb)).toEqual([]);
  });

  it("the write leaves the identity and updated_at untouched", async () => {
    const nb = await makeNotebook();
    const before = await testPool.query(`SELECT manufacturer, model, catalog_number, identity_status, updated_at FROM equipment_notebooks WHERE id = $1::uuid`, [nb]);
    await saveConfirmedNumber(TENANT, nb, ENTRY);
    const after = await testPool.query(`SELECT manufacturer, model, catalog_number, identity_status, updated_at FROM equipment_notebooks WHERE id = $1::uuid`, [nb]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
```

If `equipment_notebooks` needs other NOT NULL columns on insert, copy the `INSERT` column list from `notebook-identity-confirm.integration.test.ts` `makeNotebook()` and add `manufacturer, model, identity_status`.

- [ ] **Step 7: Run on a throwaway Postgres, twice**

Run the header's commands. Expected: 4 passed. Run `node scripts/setup-integration-db.mjs` a second time and the test again: 4 passed (re-apply safe). Then mutate: change `WHEN EXISTS` to `WHEN false` → "does not duplicate" red; restore. Remove the container: `docker rm -f mira6085-pg` (print the name first).

- [ ] **Step 8: Commit** (migration now proven; this is its first push-able form)

```bash
git add mira-hub/db/migrations/118_notebook_confirmed_numbers.sql mira-hub/src/capabilities/confirmed-numbers.ts mira-hub/src/capabilities/__tests__/confirmed-numbers.test.ts mira-hub/src/capabilities/__tests__/confirmed-numbers.integration.test.ts
git commit -m "feat(hub): store numbers the technician confirmed on the identity card (migration 118) (#6085)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01HZ4euLfAzfsgCQPsbPztC1"
```

---

### Task 5: The confirm route saves a ticked number

**Files:**
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/identity/confirm/route.ts` (import; after `catalogNumber` at line 98; after the `confirmResult` block at line 160; the response at line 231)
- Create: `mira-hub/src/capabilities/__tests__/confirm-number-route.test.ts`

**Interfaces:**
- Consumes: `saveConfirmedNumber` (Task 4).
- Produces: request field `confirmedNumber?: string`; response field `numberSaved?: boolean` (present only when a well-formed number was sent).

- [ ] **Step 1: Write the failing tests** (`confirm-number-route.test.ts`)

```ts
// #6085: "Use its manuals" with the order number ticked saves the number for the status scope.
// The identity confirm itself is unchanged: same catalog number, same lookup key, same search.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/confirm-number-route
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({ getNotebook: vi.fn(), listSources: vi.fn() }));

const acqMock = vi.hoisted(() => ({
  acquisitionEnabled: vi.fn(() => true),
  startManualAcquisition: vi.fn(async () => true),
  readAcquisition: vi.fn(async () => null as unknown),
  confirmNotebookIdentity: vi.fn(async () => ({ ok: true }) as unknown),
}));
vi.mock("@/capabilities/notebook-manual-acquisition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/notebook-manual-acquisition")>()),
  ...acqMock,
}));
const numbersMock = vi.hoisted(() => ({ saveConfirmedNumber: vi.fn(async () => true) }));
vi.mock("@/capabilities/confirmed-numbers", () => numbersMock);

import { POST } from "@/app/api/equipment-notebooks/[id]/identity/confirm/route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, listSources } from "@/lib/equipment-notebooks";

const NB = "11111111-2222-3333-4444-555555555555";
const TENANT = "00000000-0000-0000-0000-0000000000d1";
const params = { params: Promise.resolve({ id: NB }) };
const req = (body: unknown) => ({ url: `http://test/api/equipment-notebooks/${NB}/identity/confirm/`, json: async () => body }) as unknown as NextRequest;
const CARD = { manufacturer: "Siemens", model: "TP700" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(sessionOr401).mockResolvedValue({ userId: "u_1", tenantId: TENANT, email: "tech@example.com", status: "trial", trialExpiresAt: null, role: "owner" } as never);
  vi.mocked(getNotebook).mockResolvedValue({ id: NB, nodeId: "node-1", asset: null } as never);
  vi.mocked(listSources).mockResolvedValue([] as never);
  acqMock.confirmNotebookIdentity.mockResolvedValue({ ok: true });
  numbersMock.saveConfirmedNumber.mockResolvedValue(true);
});

describe("POST identity/confirm with a ticked number (#6085)", () => {
  it("saves the ticked number for the confirmed maker and model", async () => {
    const res = await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(res.status).toBe(200);
    expect(numbersMock.saveConfirmedNumber).toHaveBeenCalledWith(TENANT, NB, { number: "6AV2124-0GC01-0AX0", manufacturer: "Siemens", model: "TP700" });
    expect((await res.json()).numberSaved).toBe(true);
  });

  it("the identity write is unchanged: no catalog number, same fields as an unticked confirm", async () => {
    await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(acqMock.confirmNotebookIdentity).toHaveBeenCalledWith(TENANT, NB, { manufacturer: "Siemens", model: "TP700", catalogNumber: "" });
  });

  it("an unticked confirm saves nothing and adds no numberSaved", async () => {
    const res = await POST(req(CARD), params);
    expect(numbersMock.saveConfirmedNumber).not.toHaveBeenCalled();
    expect(await res.json()).not.toHaveProperty("numberSaved");
  });

  it.each([["blank", "   "], ["no digit", "TPCOMFORT"], ["whitespace", "6AV2124 0GC01"], ["too long", `6${"A".repeat(64)}`], ["not a string", 6]])(
    "ignores a %s number and still confirms",
    async (_label, confirmedNumber) => {
      const res = await POST(req({ ...CARD, confirmedNumber }), params);
      expect(res.status).toBe(200);
      expect(numbersMock.saveConfirmedNumber).not.toHaveBeenCalled();
      expect(acqMock.confirmNotebookIdentity).toHaveBeenCalled();
    },
  );

  it("control: a 64-character number is accepted", async () => {
    await POST(req({ ...CARD, confirmedNumber: `6${"A".repeat(63)}` }), params);
    expect(numbersMock.saveConfirmedNumber).toHaveBeenCalled();
  });

  // Review Focus 3: a stale card's 409 saves nothing.
  it("a refused confirm (409) saves nothing", async () => {
    acqMock.confirmNotebookIdentity.mockResolvedValue({ ok: false, error: "identity_already_confirmed", manufacturer: "Siemens", model: "TP900" });
    const res = await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(res.status).toBe(409);
    expect(numbersMock.saveConfirmedNumber).not.toHaveBeenCalled();
  });

  it("a failed confirm (500) saves nothing", async () => {
    acqMock.confirmNotebookIdentity.mockResolvedValue({ ok: false, error: "confirm_failed" });
    const res = await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(res.status).toBe(500);
    expect(numbersMock.saveConfirmedNumber).not.toHaveBeenCalled();
  });

  it("a failed save is logged and the confirm still succeeds", async () => {
    numbersMock.saveConfirmedNumber.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).numberSaved).toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mira-hub && npx vitest run src/capabilities/__tests__/confirm-number-route.test.ts`
Expected: "saves the ticked number", "64-character…", "failed save…" FAIL; the rest pass (nothing is saved today). Record counts.

- [ ] **Step 3: Implement**

Import: `import { saveConfirmedNumber } from "@/capabilities/confirmed-numbers";`

After `readString` add:

```ts
/** #6085: the number the technician ticked on the identity card. Accepted only when it is 1 to
 *  64 characters, has a digit and no whitespace; anything else is ignored, never an error. */
function readConfirmedNumber(body: Record<string, unknown>): string | null {
  const value = readString(body, "confirmedNumber");
  return value.length >= 1 && value.length <= 64 && /\d/.test(value) && !/\s/.test(value) ? value : null;
}
```

After `const catalogNumber = readString(body, "catalogNumber");`:

```ts
  const confirmedNumber = readConfirmedNumber(body);
```

After the `if (!confirmResult.ok) { … }` block:

```ts
  // #6085: a ticked number is saved for the thread status scope only. A failed save never
  // fails the confirm that already succeeded; the response says whether it was saved.
  let numberSaved: boolean | undefined;
  if (confirmedNumber) {
    try {
      numberSaved = await saveConfirmedNumber(ctx.tenantId, notebookId, { number: confirmedNumber, manufacturer, model });
    } catch (err) {
      numberSaved = false;
      console.warn(`[identity-confirm] saveConfirmedNumber failed notebook=${notebookId}: ${(err as Error).message}`);
    }
  }
```

In the success response object, after `manualReady,` add `...(numberSaved !== undefined ? { numberSaved } : {}),`. Add a line to the route header comment: `#6085: a ticked "confirmedNumber" is saved for the thread status scope after the confirm succeeds; it never changes the identity write.`

- [ ] **Step 4: Run new and existing confirm suites**

Run: `cd mira-hub && npx vitest run src/capabilities/__tests__/confirm-number-route.test.ts "src/app/api/equipment-notebooks/[id]/identity" src/capabilities/__tests__/synthetic-technician`
Expected: 0 failed; the guarded confirm route test's count is unchanged from baseline.

- [ ] **Step 5: Mutation proofs** (restore after each; log counts)

1. Move the save block above the `confirmResult.ok` check → "409 saves nothing" and "500 saves nothing" red.
2. Change `<= 64` to `<= 65` → "too long" red. Change to `<= 63` → "64-character" control red.
3. Remove the `try/catch` (await directly) → "failed save…" red.

- [ ] **Step 6: Commit**

```bash
git add "mira-hub/src/app/api/equipment-notebooks/[id]/identity/confirm/route.ts" mira-hub/src/capabilities/__tests__/confirm-number-route.test.ts
git commit -m "feat(hub): the identity confirm saves a number the technician ticked (#6085)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01HZ4euLfAzfsgCQPsbPztC1"
```

---

### Task 6: The detail read uses saved numbers, only when the scope would withhold

**Files:**
- Modify: `mira-hub/src/capabilities/manual-status-subject.ts` (`subjectReader`; add `numbersForMachine`)
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/route.ts:100-102`
- Create: `mira-hub/src/capabilities/__tests__/confirmed-number-subject.test.ts`

**Interfaces:**
- Consumes: `readConfirmedNumbers`, `numbersForIdentity`, `ConfirmedNumberEntry` (Task 4); `threadStatusScope` with `confirmedNumbers` (Task 1).
- Produces:
  - `export function numbersApply(status: ManualSearchStatus | null, notebook: EquipmentNotebook): boolean` — true only for a settled identity whose status names the notebook's own model.
  - `export function numbersForMachine(entries: readonly ConfirmedNumberEntry[], status: ManualSearchStatus | null, notebook: EquipmentNotebook): string[]`
  - `subjectReader` input gains `confirmedNumbers?: () => Promise<readonly string[]>`, read at most once per `shown()` call and only when the scope without numbers is `other`. A reader that throws counts as no numbers.
- Note (plan-stage finding): the guarded `[id]/__tests__/manual-search-status.test.ts` mocks no database seam, and Bravo has a Postgres on localhost:5432. The route therefore passes no reader at all unless `numbersApply` holds, and Step 5 proves the guarded file's result does not depend on whether a database is reachable. The guarded file is not edited.

- [ ] **Step 1: Write the failing tests** (`confirmed-number-subject.test.ts`)

```ts
// #6085: a thread-scoped detail read counts the numbers the technician confirmed, for a settled
// identity and the notebook's own model only, and reads them only when the thread would
// otherwise be withheld.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/confirmed-number-subject
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({
  deleteNotebook: vi.fn(), getNotebook: vi.fn(), listSources: vi.fn(), listTurns: vi.fn(),
  listThreads: vi.fn(async () => []), updateNotebook: vi.fn(), normalizeNotebookThreadId: vi.fn((v: string) => v),
}));
vi.mock("@/lib/workspace-files", () => ({ listFilesForTarget: vi.fn(async () => []) }));
const currentManualSearchStatus = vi.hoisted(() => vi.fn());
vi.mock("@/capabilities/notebook-manual-acquisition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/capabilities/notebook-manual-acquisition")>();
  return { currentManualSearchStatus, threadStatusScope: actual.threadStatusScope };
});
const readConfirmedNumbers = vi.hoisted(() => vi.fn());
vi.mock("@/capabilities/confirmed-numbers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/confirmed-numbers")>()),
  readConfirmedNumbers,
}));

import { GET } from "@/app/api/equipment-notebooks/[id]/route";
import { numbersForMachine } from "@/capabilities/manual-status-subject";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, listSources, listTurns } from "@/lib/equipment-notebooks";
import type { EquipmentNotebook } from "@/lib/equipment-notebooks";

const NB = "11111111-2222-3333-4444-555555555555";
const TENANT = "00000000-0000-0000-0000-0000000000d1";
const THREAD = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const threadReq = { nextUrl: { searchParams: new URLSearchParams({ threadId: THREAD }) } } as unknown as NextRequest;
const params = { params: Promise.resolve({ id: NB }) };
const J2 = "Our Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0 will not power up. What is the rated supply voltage?";
const NOTEBOOK = { id: NB, displayName: "Panel", identityStatus: "user_confirmed", manufacturer: "Siemens", model: "TP700", catalogNumber: "" };
const READY = { manufacturer: "Siemens", model: "TP700", running: false, message: "SIMATIC HMI Comfort Panels manual is ready in Sources." };
const saved = (number: string, manufacturer = "Siemens", model = "TP700") => ({ number, manufacturer, model, confirmedAt: "2026-11-27T00:00:00.000Z" });
const ask = (question: string) => ({ id: "t", question, evidence: [] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue({ userId: "u_1", tenantId: TENANT, email: "x@y", status: "trial", trialExpiresAt: null, role: "owner" } as never);
  vi.mocked(getNotebook).mockResolvedValue(NOTEBOOK as never);
  vi.mocked(listSources).mockResolvedValue([] as never);
  vi.mocked(listTurns).mockResolvedValue([ask(J2)] as never);
  currentManualSearchStatus.mockResolvedValue(READY);
  readConfirmedNumbers.mockResolvedValue([saved("6AV2124-0GC01-0AX0")]);
});

describe("GET notebook detail: a confirmed number (#6085)", () => {
  it("shows the status in the walk thread once the number is confirmed", async () => {
    const body = await (await GET(threadReq, params)).json();
    expect(body.manualSearch).toEqual(READY);
    expect(body).not.toHaveProperty("manualSearchScope");
    expect(readConfirmedNumbers).toHaveBeenCalledWith(TENANT, NB);
  });

  it("control: with no saved number the walk thread is withheld as today", async () => {
    readConfirmedNumbers.mockResolvedValue([]);
    const body = await (await GET(threadReq, params)).json();
    expect(body.manualSearch).toBeNull();
    expect(body.manualSearchScope).toBe("other_model");
  });

  it("control: a TP900 thread stays withheld whatever is saved", async () => {
    vi.mocked(listTurns).mockResolvedValue([ask(J2), ask("Find the manual for Siemens TP900 Comfort 6AV2124-0JC01-0AX0")] as never);
    const body = await (await GET(threadReq, params)).json();
    expect(body.manualSearchScope).toBe("other_model");
  });

  // Review Focus 4.
  it("a number saved for the notebook's earlier identity does not count", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ ...NOTEBOOK, model: "TP900" } as never);
    currentManualSearchStatus.mockResolvedValue({ ...READY, model: "TP900" });
    const body = await (await GET(threadReq, params)).json();
    expect(body.manualSearchScope).toBe("other_model");
  });

  // Review Focus 5: follow polling in an own thread adds no query.
  it("an own thread never reads the saved numbers", async () => {
    vi.mocked(listTurns).mockResolvedValue([ask("Find the manual for Siemens TP700")] as never);
    const body = await (await GET(threadReq, params)).json();
    expect(body.manualSearch).toEqual(READY);
    expect(readConfirmedNumbers).not.toHaveBeenCalled();
  });

  it("a whole-notebook read never reads the saved numbers", async () => {
    await GET({ nextUrl: { searchParams: new URLSearchParams() } } as unknown as NextRequest, params);
    expect(readConfirmedNumbers).not.toHaveBeenCalled();
  });

  it("an unsettled identity never reads the saved numbers", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ ...NOTEBOOK, identityStatus: "unconfirmed" } as never);
    const body = await (await GET(threadReq, params)).json();
    expect(body.manualSearchScope).toBe("other_model");
    expect(readConfirmedNumbers).not.toHaveBeenCalled();
  });

  it("a reader that fails keeps today's withheld status, with its scope", async () => {
    readConfirmedNumbers.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = await (await GET(threadReq, params)).json();
    expect(body.manualSearch).toBeNull();
    expect(body.manualSearchScope).toBe("other_model");
  });
});

describe("numbersForMachine", () => {
  const nb = (over: Partial<EquipmentNotebook> = {}) => ({ ...NOTEBOOK, ...over }) as unknown as EquipmentNotebook;
  const entries = [saved("6AV2124-0GC01-0AX0")];

  it("counts numbers for a settled identity naming the notebook's own model", () => {
    expect(numbersForMachine(entries, READY as never, nb())).toEqual(["6AV2124-0GC01-0AX0"]);
    expect(numbersForMachine(entries, READY as never, nb({ identityStatus: "verified" } as never))).toEqual(["6AV2124-0GC01-0AX0"]);
  });
  it("counts none for an unsettled identity", () => {
    expect(numbersForMachine(entries, READY as never, nb({ identityStatus: "unconfirmed" } as never))).toEqual([]);
  });
  it("counts none when the status names a proposed model, not the notebook's", () => {
    expect(numbersForMachine(entries, { ...READY, model: "TP900" } as never, nb())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mira-hub && npx vitest run src/capabilities/__tests__/confirmed-number-subject.test.ts`
Expected: FAIL — `numbersForMachine` not exported; "shows the status…" red. Record counts.

- [ ] **Step 3: Implement `manual-status-subject.ts`**

Add imports:

```ts
import { numbersForIdentity, type ConfirmedNumberEntry } from "@/capabilities/confirmed-numbers";
```

Add after `subjectMachine`:

```ts
/**
 * #6085: whether confirmed numbers can count at all: a settled identity, and a status that
 * names the notebook's own model (the rule `catalogNumber` follows above). When false, the
 * detail read never reads them.
 */
export function numbersApply(status: ManualSearchStatus | null, notebook: EquipmentNotebook): boolean {
  if (notebook.identityStatus !== "user_confirmed" && notebook.identityStatus !== "verified") return false;
  const model = status?.model ?? notebook.model;
  return Boolean(model) && model === notebook.model;
}

/** #6085: the confirmed numbers that count for the machine the status names: only entries
 *  saved for the notebook's current maker and model, and only when `numbersApply` holds. */
export function numbersForMachine(
  entries: readonly ConfirmedNumberEntry[],
  status: ManualSearchStatus | null,
  notebook: EquipmentNotebook,
): string[] {
  if (!numbersApply(status, notebook)) return [];
  return numbersForIdentity(entries, { manufacturer: notebook.manufacturer, model: notebook.model });
}
```

Change `subjectReader`:

```ts
export function subjectReader(input: {
  tenantId: string;
  notebookId: string;
  viewerUserId: string;
  threadId: string;
  turns: Turn[];
  machine: Machine;
  /** #6085: numbers the technician confirmed; read only when the scope without them is "other". */
  confirmedNumbers?: () => Promise<readonly string[]>;
}) {
  const { tenantId, notebookId, viewerUserId, threadId, turns, machine, confirmedNumbers } = input;
  let numbers: Promise<readonly string[]> | null = null;
  const scopeOf = async (questions: string[]): Promise<ReturnType<typeof threadStatusScope>> => {
    const scope = threadStatusScope(questions, machine);
    if (scope !== "other" || !confirmedNumbers) return scope;
    numbers ??= confirmedNumbers().catch((err: unknown) => {
      console.warn(`[manual-status-subject] confirmed numbers unavailable notebook=${notebookId}: ${(err as Error).message}`);
      return [];
    });
    const confirmed = await numbers;
    return confirmed.length ? threadStatusScope(questions, { ...machine, confirmedNumbers: confirmed }) : scope;
  };
  return {
    /** Every saved question: what the shown status follows. */
    shown: async (): Promise<SubjectScope> => {
      const scope = await scopeOf(turns.map((t) => t.question));
      if (scope !== "undecided" || turns.length < TURN_WINDOW) return scope;
      const rows = await listTurns(tenantId, notebookId, WIDEST_SUBJECT_READ, { viewerUserId, threadId });
      const widest = await scopeOf(rows.map((t) => t.question));
      return widest === "undecided" && rows.length >= WIDEST_SUBJECT_READ ? "out_of_reach" : widest;
    },
  };
}
```

- [ ] **Step 4: Implement the detail route** (`[id]/route.ts`)

Add `numbersApply` and `numbersForMachine` to the `@/capabilities/manual-status-subject` import and `import { readConfirmedNumbers } from "@/capabilities/confirmed-numbers";`. Replace the `subjectReader(...)` call at line 102 (`manualSearch` is reassigned further down, so the status is captured first):

```ts
    const statusForSubject = manualSearch;
    const subject = subjectReader({
      tenantId: ctx.tenantId, notebookId: id, viewerUserId: ctx.userId, threadId, turns, machine,
      // #6085: no reader unless confirmed numbers can count; the reader itself runs only
      // when this thread would otherwise be withheld.
      confirmedNumbers: numbersApply(statusForSubject, notebook)
        ? async () => numbersForMachine(await readConfirmedNumbers(ctx.tenantId, id), statusForSubject, notebook)
        : undefined,
    });
```

- [ ] **Step 5: Run new and existing suites**

Run: `cd mira-hub && npx vitest run src/capabilities/__tests__/confirmed-number-subject.test.ts "src/app/api/equipment-notebooks/[id]/__tests__" src/capabilities/__tests__/thread-model-scope.test.ts src/capabilities/__tests__/notebook-get-grounded-footer.test.ts`
Expected: 0 failed.

Then prove the guarded `manual-search-status.test.ts` (unchanged) does not depend on a reachable database. Run it twice and record both counts:

```bash
cd mira-hub
F="src/app/api/equipment-notebooks/[id]/__tests__/manual-search-status.test.ts"
npx vitest run "$F" 2>&1 | grep -E 'Tests |Duration|confirmed-numbers\] read failed' | sort | uniq -c   # as on Bravo (local Postgres on 5432)
PGHOST=127.0.0.1 PGPORT=9 npx vitest run "$F" 2>&1 | grep -E 'Tests |Duration|confirmed-numbers\] read failed' | sort | uniq -c   # as a DB-less CI runner
```

Expected: both runs pass with the baseline count. Each `read failed` line is a withheld case whose reader ran and failed closed. If the counts differ between the runs, or any test takes over 1 s, stop and report rather than editing that guarded file.

- [ ] **Step 6: Mutation proofs** (restore after each; log counts)

1. In `scopeOf`, remove the `scope !== "other" ||` condition → "an own thread never reads" red.
2. In `numbersApply`, remove the `identityStatus` check → "counts none for an unsettled identity" and "an unsettled identity never reads" red.
3. In `numbersApply`, remove `model === notebook.model` → "counts none when the status names a proposed model" red.
4. In the route, drop `confirmedNumbers:` → "shows the status in the walk thread" red.
5. In `scopeOf`, remove the `.catch(...)` → "a reader that fails keeps today's withheld status" red.

- [ ] **Step 7: Commit, then push as a checkpoint**

```bash
git add mira-hub/src/capabilities/manual-status-subject.ts "mira-hub/src/app/api/equipment-notebooks/[id]/route.ts" mira-hub/src/capabilities/__tests__/confirmed-number-subject.test.ts
git commit -m "feat(hub): a thread's status counts numbers the technician confirmed (#6085)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01HZ4euLfAzfsgCQPsbPztC1"
git push origin "bravo/6085-confirm-number:refs/heads/bravo/6085-confirm-number"   # plain push, no force
git ls-remote origin bravo/6085-confirm-number; git rev-parse HEAD                   # must match
```

Pushing migration 118 here is the first push of that file. Task 4 Step 7 must have passed first. No PR is opened yet, so `migration-verify.yml` has not run; it runs when the PR opens in Task 10.

---

### Task 7: Hub version bump and full Hub verification (server half done)

**Files:**
- Modify (GUARDED): `mira-hub/package.json` (version `2.66.12` → `2.67.0`, minor: a feature)

- [ ] **Step 1: Re-check main's Hub version first**

```bash
git fetch -q origin && git show origin/main:mira-hub/package.json | grep '"version"'
```

If main has moved past `2.66.12`, merge `origin/main` (no rebase, no force), re-run Tasks 1–6 suites, and bump from main's version to the next minor.

- [ ] **Step 2: Bump and run the full Hub suite and typecheck**

```bash
cd mira-hub
bun run test 2>&1 | tail -5
npx tsc --noEmit -p . 2>&1 | grep -c 'error TS'
```

Expected: 0 failed, total = baseline + new tests; typecheck count equals the Task 0 baseline (no new errors; list any new error and fix it).

- [ ] **Step 3: Commit and push**

```bash
git add mira-hub/package.json
git commit -m "chore(hub): 2.67.0 for the confirmed order number (#6085)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01HZ4euLfAzfsgCQPsbPztC1"
git push origin "bravo/6085-confirm-number:refs/heads/bravo/6085-confirm-number"
git ls-remote origin bravo/6085-confirm-number; git rev-parse HEAD
```

At this point no surface shows a tick box, so no number can be saved: shipped alone, the server half changes nothing a technician sees.

---

### Task 8: Shared card — the unticked box (WAITS for the #3626 slot)

**Gate (must hold before any edit, stage or pre-build here):**
- Re-read #3626 comments: both requests ahead of comment 7208915318 are RELEASED, COMPLETE or withdrawn.
- Post a real `[WORK-CLAIM]` on #3626 for lane shared-core (files below), then re-read every open PR, #3626 and any issue with the marker; ours must be the earliest ACTIVE overlapping claim. Otherwise set ours RELEASED and stop.

**Files:**
- Modify: `packages/factorylm-interaction/src/types.ts:302-330` (`IdentityProposal`)
- Modify: `packages/factorylm-ui/src/parts.tsx:365-436` (`IdentityProposalPart`)
- Test: `packages/factorylm-ui/src/__tests__/identity-proposal.test.tsx` (append)

**Interfaces:**
- Produces: `IdentityProposal.offeredNumber?: string` (set by host adapters from the server frame) and `IdentityProposal.confirmedNumber?: string` (set by the card only when ticked); `onConfirmIdentity(proposal)` receives `confirmedNumber` only when ticked.

- [ ] **Step 1: Write the failing tests** (append to `identity-proposal.test.tsx`)

```tsx
function withOfferedNumber(offeredNumber: string, outcome?: "confirmed" | "superseded") {
  return (f: ShellFixture): ShellFixture => ({
    ...f,
    thread: {
      ...f.thread,
      turns: f.thread.turns.map((t) => ({
        ...t,
        parts: t.parts.map((p) => (p.type === "identity_proposal" ? { ...p, offeredNumber, ...(outcome ? { priorOutcome: outcome } : {}) } : p)),
      })),
    },
  });
}
const box = (view: HarnessView) => view.container.querySelector<HTMLInputElement>('input[type="checkbox"]');

describe("identity_proposal — the offered order number (#6085)", () => {
  it("shows the offered number beside a box that starts unticked", () => {
    const view = render({ onConfirmIdentity: async () => ({ manualReady: false }) }, withOfferedNumber("SS5Y3-DUW01302-A"));
    expect(view.container.textContent).toContain("SS5Y3-DUW01302-A is this machine's number");
    expect(box(view)).not.toBeNull();
    expect(box(view)!.checked).toBe(false);
  });

  it("an unticked confirm sends no number", async () => {
    const calls: IdentityProposal[] = [];
    const view = render({ onConfirmIdentity: async (p: IdentityProposal) => { calls.push(p); return { manualReady: false }; } }, withOfferedNumber("SS5Y3-DUW01302-A"));
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    expect(calls).toEqual([{ manufacturer: "SMC", model: "SS5Y3-DUW01302" }]);
  });

  it("a ticked confirm sends the number", async () => {
    const calls: IdentityProposal[] = [];
    const view = render({ onConfirmIdentity: async (p: IdentityProposal) => { calls.push(p); return { manualReady: false }; } }, withOfferedNumber("SS5Y3-DUW01302-A"));
    view.click(box(view)!);
    await view.flush();
    expect(box(view)!.checked).toBe(true);
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    expect(calls).toEqual([{ manufacturer: "SMC", model: "SS5Y3-DUW01302", confirmedNumber: "SS5Y3-DUW01302-A" }]);
  });

  it("a settled card shows no box", () => {
    const view = render({}, withOfferedNumber("SS5Y3-DUW01302-A", "confirmed"));
    expect(box(view)).toBeNull();
    expect(view.container.textContent).not.toContain("is this machine's number");
  });

  it("control: a card without an offered number renders exactly as before", () => {
    const view = render({ onConfirmIdentity: async () => ({ manualReady: false }) });
    expect(box(view)).toBeNull();
    expect(view.container.textContent).not.toContain("is this machine's number");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/identity-proposal.test.tsx`
Expected: the first, third and fourth new tests FAIL (no box, no number); "unticked…" and the control pass. Record counts.

- [ ] **Step 3: Implement**

`types.ts`, inside `IdentityProposal` after `catalogNumber`:

```ts
  /**
   * #6085: the one typed number the server offers beside an unticked box on the card
   * ("<number> is this machine's number"). Set by the host adapter from the server frame.
   */
  readonly offeredNumber?: string;
  /**
   * #6085: set by the card, only when the technician ticked the offered number; the host sends
   * it to the confirm route. Never set by an adapter.
   */
  readonly confirmedNumber?: string;
```

`parts.tsx`, in `IdentityProposalPart`, after the `refusal` state:

```tsx
  // #6085: the offered order number starts unticked; only a ticked box is sent.
  const [numberTicked, setNumberTicked] = useState(false);
```

Change `confirm`'s call to:

```tsx
      .onConfirmIdentity(part.offeredNumber && numberTicked ? { ...proposal, confirmedNumber: part.offeredNumber } : proposal)
```

Inside the `!settled` branch, before the `fl-card__actions` div:

```tsx
      {part.offeredNumber ? <label className="fl-card__meta">
        <input
          type="checkbox"
          checked={numberTicked}
          disabled={busy}
          onChange={(e) => setNumberTicked(e.currentTarget.checked)}
        />{" "}
        {part.offeredNumber} is this machine&apos;s number
      </label> : null}
```

Leave `proposal` (also passed to `onRejectIdentity`) without the number.

- [ ] **Step 4: Run, then the full shared-UI verify**

Run: `cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/identity-proposal.test.tsx && bun run verify`
Expected: 0 failed; verify passes (tests, build, budget, licenses). Record counts.

- [ ] **Step 5: Mutation proofs** (restore after each; log counts)

1. `useState(true)` → "starts unticked" and "unticked confirm sends no number" red.
2. Send `confirmedNumber: part.offeredNumber` regardless of `numberTicked` → "unticked confirm sends no number" red.
3. Render the label outside the `!settled` branch → "a settled card shows no box" red.

- [ ] **Step 6: Commit, then mark the shared-core claim COMPLETE after push**

```bash
git add packages/factorylm-interaction/src/types.ts packages/factorylm-ui/src/parts.tsx packages/factorylm-ui/src/__tests__/identity-proposal.test.tsx
git commit -m "feat(ui): the identity card offers the order number beside an unticked box (#6085)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01HZ4euLfAzfsgCQPsbPztC1"
git push origin "bravo/6085-confirm-number:refs/heads/bravo/6085-confirm-number"
git ls-remote origin bravo/6085-confirm-number; git rev-parse HEAD
```

Then update the #3626 `[WORK-CLAIM]` to `Status: COMPLETE` with the pushed SHA.

---

### Task 9: Hub and mobile adapters carry and send the number

**Files:**
- Modify: `mira-hub/src/factorylm-ui/to-interaction.ts:353-366` (`identityProposalOf`)
- Modify: `mira-hub/src/factorylm-ui/hub-host-logic.ts` (add `identityConfirmBody`)
- Modify: `mira-hub/src/factorylm-ui/hub-host.tsx:1561-1562` (use it)
- Modify: `mira-mobile/src/unified/to-interaction.ts:250-256`
- Modify: `mira-mobile/src/api/identity-confirm.ts:21-22`
- Test (append): `mira-hub/src/factorylm-ui/to-interaction.test.ts`, `mira-hub/src/factorylm-ui/hub-host-logic.test.ts`, `mira-mobile/src/unified/__tests__/to-interaction.test.ts`, `mira-mobile/src/api/__tests__/identity-confirm.test.ts`

**Interfaces:**
- Consumes: `IdentityProposal.offeredNumber` / `.confirmedNumber` (Task 8); the persisted frame's `offeredNumber` (Task 3).
- Produces: `export function identityConfirmBody(proposal: IdentityProposal): Record<string, string>` in `hub-host-logic.ts`.

- [ ] **Step 1: Write the failing tests**

`mira-hub/src/factorylm-ui/to-interaction.test.ts`, next to the existing `identityProposalOf` tests (around line 425):

```ts
  it("#6085: carries the offered order number from the saved card", () => {
    expect(identityProposalOf([{ kind: "identity_proposal", manufacturer: "Siemens", model: "TP700", offeredNumber: "6AV2124-0GC01-0AX0" }]))
      .toEqual({ manufacturer: "Siemens", model: "TP700", offeredNumber: "6AV2124-0GC01-0AX0" });
    expect(identityProposalOf([{ kind: "identity_proposal", manufacturer: "Siemens", model: "TP700", offeredNumber: 6 }]))
      .toEqual({ manufacturer: "Siemens", model: "TP700" });
  });
```

`mira-hub/src/factorylm-ui/hub-host-logic.test.ts` (add `identityConfirmBody` to its import from `./hub-host-logic`):

```ts
describe("identityConfirmBody (#6085)", () => {
  it("sends the ticked number", () => {
    expect(identityConfirmBody({ manufacturer: "Siemens", model: "TP700", offeredNumber: "6AV2124-0GC01-0AX0", confirmedNumber: "6AV2124-0GC01-0AX0" }))
      .toEqual({ manufacturer: "Siemens", model: "TP700", confirmedNumber: "6AV2124-0GC01-0AX0" });
  });
  it("never sends a number that was only offered", () => {
    expect(identityConfirmBody({ manufacturer: "Siemens", model: "TP700", offeredNumber: "6AV2124-0GC01-0AX0" }))
      .toEqual({ manufacturer: "Siemens", model: "TP700" });
  });
  it("control: keeps the catalog number as before", () => {
    expect(identityConfirmBody({ manufacturer: "SMC", model: "SS5Y3", catalogNumber: "DUW01302" }))
      .toEqual({ manufacturer: "SMC", model: "SS5Y3", catalogNumber: "DUW01302" });
  });
});
```

`mira-mobile/src/unified/__tests__/to-interaction.test.ts`, next to the `identity_proposal` cases (around line 161):

```ts
  it("#6085: carries the offered order number through", () => {
    expect(toInteractionPart({ type: "unknown", raw: { kind: "identity_proposal", manufacturer: "Siemens", model: "TP700", offeredNumber: "6AV2124-0GC01-0AX0" } }))
      .toEqual({ type: "identity_proposal", manufacturer: "Siemens", model: "TP700", offeredNumber: "6AV2124-0GC01-0AX0" });
  });
```

`mira-mobile/src/api/__tests__/identity-confirm.test.ts`:

```ts
  it("#6085: sends a ticked number, never an offered one", async () => {
    request.mockResolvedValue({ status: 200, data: { ok: true, manualReady: false }, text: "" });
    await confirmIdentityProposal("nb-1", { manufacturer: "Siemens", model: "TP700", offeredNumber: "6AV2124-0GC01-0AX0", confirmedNumber: "6AV2124-0GC01-0AX0" });
    expect(request).toHaveBeenLastCalledWith("/api/equipment-notebooks/nb-1/identity/confirm/", {
      method: "POST", json: { manufacturer: "Siemens", model: "TP700", confirmedNumber: "6AV2124-0GC01-0AX0" }, acceptStatuses: [409],
    });
    await confirmIdentityProposal("nb-1", { manufacturer: "Siemens", model: "TP700", offeredNumber: "6AV2124-0GC01-0AX0" });
    expect(request).toHaveBeenLastCalledWith("/api/equipment-notebooks/nb-1/identity/confirm/", {
      method: "POST", json: { manufacturer: "Siemens", model: "TP700" }, acceptStatuses: [409],
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd mira-hub && npx vitest run src/factorylm-ui/to-interaction.test.ts src/factorylm-ui/hub-host-logic.test.ts` and `cd mira-mobile && npx vitest run src/unified/__tests__/to-interaction.test.ts src/api/__tests__/identity-confirm.test.ts`
Expected: the four new tests FAIL (the Hub body test fails on the missing export); existing tests pass. Record counts.

- [ ] **Step 3: Implement**

Hub `identityProposalOf`, after the `catalogNumber` spread:

```ts
      ...(typeof r.offeredNumber === "string" && r.offeredNumber ? { offeredNumber: r.offeredNumber } : {}),
```

Hub `hub-host-logic.ts` (add `IdentityProposal` to its existing `../../../packages/factorylm-interaction/src` type import):

```ts
/** The identity confirm request body (#6085: a ticked number rides as `confirmedNumber`; an
 *  offered but unticked one is never sent). */
export function identityConfirmBody(proposal: IdentityProposal): Record<string, string> {
  const body: Record<string, string> = { manufacturer: proposal.manufacturer, model: proposal.model };
  if (proposal.catalogNumber) body.catalogNumber = proposal.catalogNumber;
  if (proposal.confirmedNumber) body.confirmedNumber = proposal.confirmedNumber;
  return body;
}
```

Hub `hub-host.tsx` lines 1561–1562 become `const body = identityConfirmBody(proposal);`, with `identityConfirmBody` added to the existing `./hub-host-logic` import.

Mobile `to-interaction.ts`, in the `identity_proposal` branch:

```ts
        const catalogNumber = rawString(r, "catalogNumber");
        const offeredNumber = rawString(r, "offeredNumber");
        return {
          type: "identity_proposal", manufacturer, model,
          ...(catalogNumber ? { catalogNumber } : {}),
          ...(offeredNumber ? { offeredNumber } : {}),
        };
```

Mobile `identity-confirm.ts`, after the `catalogNumber` line:

```ts
  if (proposal.confirmedNumber) body.confirmedNumber = proposal.confirmedNumber;
```

- [ ] **Step 4: Run all four suites, then full Hub and mobile suites**

Run: `cd mira-hub && bun run test 2>&1 | tail -5` and `cd mira-mobile && bun run test 2>&1 | tail -5`
Expected: 0 failed; counts equal baselines plus the new tests.

- [ ] **Step 5: Mutation proofs** (restore after each; log counts)

1. Hub `identityConfirmBody`: send `proposal.offeredNumber` as `confirmedNumber` → "never sends a number that was only offered" red.
2. Mobile `identity-confirm.ts`: same mutation → the mobile test red.
3. Drop the Hub `offeredNumber` spread → the Hub adapter test red. Drop the mobile spread → the mobile adapter test red.

- [ ] **Step 6: Commit and push**

```bash
git add mira-hub/src/factorylm-ui/to-interaction.ts mira-hub/src/factorylm-ui/to-interaction.test.ts mira-hub/src/factorylm-ui/hub-host-logic.ts mira-hub/src/factorylm-ui/hub-host-logic.test.ts mira-hub/src/factorylm-ui/hub-host.tsx mira-mobile/src/unified/to-interaction.ts mira-mobile/src/unified/__tests__/to-interaction.test.ts mira-mobile/src/api/identity-confirm.ts mira-mobile/src/api/__tests__/identity-confirm.test.ts
git commit -m "feat(hub,mobile): the identity card's offered number reaches the card and a ticked one is sent (#6085)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01HZ4euLfAzfsgCQPsbPztC1"
git push origin "bravo/6085-confirm-number:refs/heads/bravo/6085-confirm-number"
git ls-remote origin bravo/6085-confirm-number; git rev-parse HEAD
```

---

### Task 10: Whole-branch proof, guard preflight, PR, CI, one Codex round

**Files:** PR body at `scratchpad/6085/body.md` (not in the repo).

- [ ] **Step 1: Merge main if it moved; re-run everything**

```bash
git fetch -q origin && git merge-base --is-ancestor origin/main HEAD || git merge --no-edit origin/main
```

Then: Hub `bun run test`, Hub typecheck count vs baseline, mobile `bun run test`, `apps/factorylm-ui-lab` `bun run verify`, the Task 4 real-Postgres test on a fresh throwaway container, and every mutation row from Tasks 1–9 re-run in one `#!/bin/bash` script that prints the test count each row and treats a missing count as a failed row (`scratchpad/6085/mutations-final.sh`, log `mutations-final.log`).

- [ ] **Step 2: Write the PR body** with: summary; the Siemens TP700 walk before/after; what does not change (catalog number, lookup key, search, matching, answers); the costs from spec §5 (an unticked box keeps today's withheld status; first card only; legacy surfaces show no box); the `## Lifecycle guard rationale` section with `Reason:`, `Canonical replacement impact:` and `Rollback:` covering `mira-hub/package.json` (minor version for a feature, per `mira-hub/AGENTS.md`) and the one-line decoder copy in `notebook-chat-utils.ts` (feeds the canonical shell's live card; the legacy chat page never renders the field; same frame loop and precedent as #6056); migration 118's prod apply being Mike's; the session footer. Run the body lint (no `~`, at most one `$`, no `[^`, no `@`).

- [ ] **Step 3: Guard preflight from origin/main, three ways**

Use `~/.factorylm/hair-on-fire-1031/goal/pr_preflight.sh` with `--registry` pointing at origin/main's `REGISTRY.yaml`:
1. the real body → rc 1 with `Missing:` listing only `review:exact-head and exact-body Codex GREEN`;
2. the body without its rationale section → fails with the rationale missing;
3. a docs-only tree → rc 0.

- [ ] **Step 4: Open the PR (draft first), check CI**

```bash
gh pr create --draft --base main --head bravo/6085-confirm-number --title "feat(hub): the technician confirms the order number on the identity card (#6085)" --body-file /private/tmp/claude-501/-Users-bravonode-Mira/0cd970a4-693a-4e67-8ece-67dd47a42ab3/scratchpad/6085/body.md
~/.claude/skills/ci-wait.sh <PR>
```

`migration-verify.yml` applies 118 to the persistent staging branch on this first PR run (expected). Verify the posted body's sha256 equals the file's.

- [ ] **Step 5: One Codex round on the exact head and body**

Codex rounds always use `--review-only`. GREEN or CONVERGED (MEDIUMs only): file one issue per MEDIUM, post the strict `[REVIEW-FOLLOWUPS]` record, dispatch `ui-lifecycle-guard.yml`, and hand the merge to Mike. Any HIGH or BLOCKER: stop, post the findings, and bring the options to Mike. No second round without his go.

- [ ] **Step 6: Housekeeping**

Lesson log in `/Users/Shared/cluster/betterclaw/logs/` (the #6094 two-round lesson and the plan-stage probe that changed §4.1). Update the memory file `project_takeover_5746.md`. Session closeout (12 bullets or fewer).

After merge (Mike's): staging deploy with mira-hub after checking staging users, the tablet walk from spec §7.5, prod only after a passed walk, the prod migration via `apply-migrations.yml` (dry-run then apply) with Mike's go, and the mobile OTA as Mike's dispatch.
