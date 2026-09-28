# Salvage record — FACTORYLM-UNIFIED-UI-V2-SHELL-001

Phase 1 gate item 9: *"The PR lists exactly what was salvaged from prior work and what
was intentionally not reused."* This is that list.

Every disposition below was checked against the real diff at the named head, not against
the plan's summary of it. Where the evidence contradicted or extended the plan's one-line
description, the evidence wins and the difference is called out.

**Verified 2026-09-06 against `origin/main` = `128eda10f`.** All five open heads named in
`docs/superpowers/plans/2026-09-06-factorylm-unified-ui-v2-shell.md` § Task 8 Step 4 still
exist and still match the SHAs the plan pins. Nothing below was inferred from a moved head.

| Source | Head | State | Size |
|---|---|---|---|
| #3515 assistant-ui compatibility spike | `39c5424d` | open | 34 files, +2995/−16 |
| #3516 ChatV2 mobile conversation surface | `06f46e6c` | **merged** 2026-08-31 | 38 files, +2607/−23 |
| #3514 ChatGPT-class UI PRD + Phase 0 | `9cc9e366` | open | 6 files, +1045/−0 |
| #3587 sellable-app north star | `8e9e0e5c` | open draft | 17 files, +918/−591 |
| #3595 authority stack | `6f2c29b6` | open draft | 22 files, +717/−289 |
| #3596 convergence archaeology | `5ed5bf1d` | open draft | 2 files, +166/−0 |

---

## #3515 — assistant-ui compatibility spike (`39c5424d`)

### Reused

**The part-union shape and its `unknown` member — the single most direct inheritance in
the whole shell.** `mira-hub/src/lib/chat-adapter/contract.ts` defines a ten-member
`MessagePart` union (`TextPart`, `SourcePart`, `MachineEvidencePart`, `ObservationPart`,
`SafetyNoticePart`, `BasisPart`, `ErrorPart`, `UsagePart`, `FollowupsPart`, `UnknownPart`).
Every one of those ten concepts survives in `packages/factorylm-interaction/src/types.ts`
as a member of `InteractionPart`, two of them renamed for precision once Work mode needed
the shorter names:

| #3515 | shipped | note |
|---|---|---|
| `BasisPart` | `evidence_basis` | renamed; `basis` was ambiguous beside `source` |
| `ObservationPart` | `visual_observation` | renamed; `observation` was taken by `RunObservation` (Work mode) |
| `UnknownPart` | `unknown` | **carried verbatim, including the reason** |

`InteractionPart` then adds twelve members the spike had no reason to model —
`attachment`, `tool_call`, `tool_result`, `approval_request`, `plan`, `plan_step`,
`observation`, `hypothesis`, `finding`, `artifact`, `context_change`, `status`. The shape
is inherited; the coverage is new.

**The terminal-status lesson.** `MessageLifecycle` in the spike is six states — `queued`,
`running`, `stopping`, `completed`, `stopped`, `failed`. The shipped `Lifecycle` is a
strict **superset**: all six, plus `accepted`, `waiting`, `cancelled`. Nothing was dropped,
which is the point — the spike's finding was that the server owns terminal state and the
client must not invent one.

**The FactoryLM-owned-adapter proof.** `runtime.tsx:135` calls
`useExternalStoreRuntime<AdapterMessage>` — the spike proved a third-party runtime can be
driven from a FactoryLM-owned message type rather than the library's own thread state.
That proof is why `packages/factorylm-ui` renders from `InteractionPart` and takes
`PlatformAdapter` by injection. **The proof was reused; the library was not** — see below.

### Intentionally not reused

**`@assistant-ui/react` itself.** `git grep assistant-ui origin/main -- packages apps`
returns **nothing**. Phase 1 is a disconnected fixture lab whose job is to settle the
component tree and the interaction contract; adding a runtime library before the contract
is frozen would have coupled the shape to the library's assumptions. ADR-0039's ownership
boundary (below) is honoured — the library is simply deferred, not rejected.

**The Hub lab route** (`mira-hub/src/app/labs/chat-spike/{page.tsx,ChatSpike.tsx,stream/route.ts}`).
It is a Hub-mounted dev surface; the canonical lab is `apps/factorylm-ui-lab`, which has no
Next.js, no router, and no server route. Mounting a second lab inside Hub is precisely the
"two front doors" outcome the cutover charter exists to prevent.

**The middleware change.** `mira-hub/src/middleware.ts` adds `labs/chat-spike` to the
session-middleware exclusion list so the spike renders without Doppler auth secrets. That
is an **auth-path** edit in service of a dev page. The spike's own comment says "Remove
with the spike." It stays out.

---

## #3516 — ChatV2 mobile conversation surface (`06f46e6c`, merged)

This one is different in kind: it is **merged, live production code** at
`mira-mobile/src/chat-adapter/`. Nothing here was copied; it was read as the reference
semantics the shared vocabulary has to be able to express.

### Reused (as semantics, not as code)

**Presence-only safety and identity markers.** `turns-to-parts.ts:46-53`
(`hasIdentityDispute`) and its sibling `safetyNoticeEntry` are deliberately
*presence-only*: "the asset ids are audit data", never rendered. The shipped
`SafetyNotice` type follows the same rule — the shell renders that a hard stop happened,
not the server-side identifiers behind it.

**Live/hydrated parity.** `turns-to-parts.ts:11-15` states the invariant: "a live turn and
its rehydrated persisted row must project to the same semantic parts … so a reload cannot
turn a hard stop into ordinary answer chrome." The shared reducer inherits this as its
historical-context immutability rule — a past turn keeps the exact evidence scope it used.

**Vocabulary alignment.** Mobile's `MessagePart` members map onto the shipped union
one-for-one, with the same two renames as #3515.

### Intentionally not reused

**The production code itself.** Phase 1 moves nothing. `mira-mobile/src/chat-adapter/**`
is a preserved capability seam under the cutover charter §2.3, and mobile's own shell is a
*guarded* legacy path (§2.2) — it is frozen, not deleted, until the Golden Conversation is
proven on a real device.

### ⚠️ One divergence the plan's one-liner does not capture

Mobile's contract has a tenth member the shared vocabulary **does not model**:

```ts
/** The server WITHHELD the notebook's bound machine for this turn: the
 *  client's asset claim did not match the confirmed binding (086 §3) … */
export type IdentityDisputePart = { type: "identity_dispute" };
```

There is **no `identity_dispute` member in `InteractionPart`**, and no other member
carries its meaning: it is not a `safety_notice` (nothing unsafe happened), not an
`error` (the turn succeeded), and not a `context_change` (context did not change — a
claim was *refused*). Today it would fall to `unknown`, which preserves it for inspection
but renders nothing.

That is survivable in a fixture lab and **not survivable when the mobile adapter is
connected**, because the whole point of the marker is that the technician learns their
asset claim was rejected. Either `InteractionPart` gains the member, or the mobile adapter
maps it onto one that exists and the mapping is recorded. Flagged here rather than fixed:
the shared contract is Task 5's, and this record does not modify `packages/**`.

---

## #3514 — ChatGPT-class UI PRD + Phase 0 (`9cc9e366`)

Six documents, no code: ADR-0038, ADR-0039, the PRD, the spike plan, a conversation-
architecture inventory, and an ADR index entry. Both ADRs are still **Proposed**.

### Reused

**ADR-0039's ownership boundary**, which is the load-bearing decision the shell is built
on. It splits the world into *commodity* (thread viewport, stick-to-bottom, message list,
composer primitives, markdown, tool-part lifecycle rendering) and *domain* — "the
adapter's job is to keep the library away from these". `packages/factorylm-ui` implements
exactly that split: it owns the domain rendering and takes platform behaviour through
`PlatformAdapter`.

**ADR-0038's "no second protocol" ruling** (Option A — MIRA frames, custom transport).
The shell has no transport at all: it renders `InteractionPart[]` and leaves framing to
the adapter. That is the strongest possible form of "do not create a second protocol" —
there is nothing to create one with.

**Additive typed events.** `InteractionPart` is a discriminated union with a preserved
`unknown` arm and an `assertNever` exhaustiveness check in `parts.tsx`, so a new server
event is additive by construction.

### Intentionally not reused

**`ExternalStoreRuntime` as an implementation.** ADR-0039 selects it for the *production*
adapter. Phase 1 has no runtime — state is a pure reducer over fixtures. The decision is
recorded and deferred to the connection phase, not overturned.

**The ADRs are not ratified by this work.** They remain Proposed; the shell is consistent
with them but does not confer status on them.

---

## #3587 — sellable-app north star (`8e9e0e5c`)

### Reused

**MIRA-first information architecture**, where it agrees with the merged #3622 PRD: the
assistant is the product surface and navigation is subordinate to the conversation. The
shipped shell puts the thread in the centre with the project tree and inspector flanking
it, and `New chat` sits at the top of the sidebar.

### Intentionally not reused

**Every authority-file rewrite in it.** The diff rewrites `NORTH_STAR.md` (−462 lines),
`STRATEGY.md` (−131), `CLAUDE.md`, `.claude/CLAUDE.md`, `AGENTS.md`, `README.md`,
`docs/context/PROJECT_BRIEF.md`, and `wiki/hot.md`. Those files are the repository's
instruction hierarchy. #3622 is the merged design authority for this initiative; taking a
competing, unmerged rewrite of the top-level authority files as input would put two
answers in the tree for the same question. Its *product-direction* content is usable; its
authority-file edits are not this initiative's to land.

---

## #3595 — FactoryLM/MIRA authority stack (`6f2c29b6`)

### Followed

Its authority, safety, and tenant rules are honoured throughout Phase 1, and they are the
same rules already binding from the merged tree: no production network from the lab,
read-only OT, tenant-scoped and fail-closed records, no provider calls. The lab enforces
the first of these structurally — a Playwright assertion that no request leaves
`127.0.0.1` is Task 8 Step 1.

### Intentionally not duplicated

**Its documentation stack.** It adds `docs/PRODUCT_CONSTITUTION.md` (+175) and
`docs/ENGINEERING_GUARDRAILS.md` (+183) and rewrites `AGENTS.md` (237 lines changed). This
initiative writes no governance documents: the cutover charter
(`docs/architecture/convergence/UNIFIED_UI_CUTOVER.md`, unit
FACTORYLM-UNIFIED-UI-CUTOVER-001) is the one governance surface for the UI program, and it
is owned by a separate claim. Restating those rules in `apps/factorylm-ui-lab/docs/` would
create a third copy of a rule set that already has two candidate homes.

---

## #3596 — product-convergence archaeology (`5ed5bf1d`)

Two files. It **appends** a "2026-09-05 product-convergence re-audit" section to
`docs/architecture/convergence/GATE0_SUMMARY.md`; the original Gate 0 discovery in that
file is already on `main` (blob `cda07ff7e`), so only the re-audit section is unlanded.

### Reused

**Its primary verdict, verbatim in intent:**

> **CONNECT** the existing customer path, **REPAIR** its proven trust gaps, and
> **CONSOLIDATE** its competing edges. Do not build a replacement MIRA, conversation
> store, stream protocol, evaluator, or customer chat surface.

The shared shell is a *presentation* layer with no store, no protocol, and no evaluator.

**The canonical Notebook seam it observed** — `POST /api/equipment-notebooks/{id}/chat/`
persisting to `equipment_notebook_turns`, one Notebook identifier throughout. That is
capability #2 in the charter's attachment model and the first seam the interaction adapter
will connect to. Nothing in Phase 1 competes with it.

### Superseded

**Its caution against a shared package for visual sameness.** #3622 supersedes it, which
the plan already records. Worth stating why the supersession is coherent rather than
merely asserted: the caution is against sharing a package to make surfaces *look* alike,
which couples unrelated products. #3622's claim is different — the surfaces share one
*interaction model*, and identical appearance is a consequence of shared meaning rather
than the goal. `packages/factorylm-interaction` is the model; `packages/factorylm-theme`
carries only tokens.

---

## What no source supplied

Stated so the boundary of this record is honest. These were built from the #3622 PRD and
the prototype, with no prior implementation to salvage:

- **Work mode and the Diagnostic Run vocabulary** — `DiagnosticPlan`, `PlanStep`,
  `RunObservation`, `Hypothesis`, `Finding`, `Artifact`, `InteractionRun`. No prior head
  modelled a structured investigation; every earlier surface was Ask-only.
- **Projects, folders, and canonical machine links** — `Project`, `ProjectFolder`,
  `MachineLink`, `ProjectItem`, and the reference-not-copy rule.
- **The four surface profiles** — `PROFILES` and `SurfaceProfile`. Prior work had a Hub
  surface and a mobile surface as separate implementations, not one profile-parameterised
  shell.
- **`PlatformAdapter`** — the five-method injection boundary. #3515 proved a
  FactoryLM-owned *message* type; the *capability* boundary is new.
