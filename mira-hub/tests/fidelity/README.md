# Behavioral-fidelity harness (PoC) — classic notebook chat vs `/v3`

PRD: `docs/prd/2026-10-14-behavioral-fidelity-harness.md` · ADR: `docs/adr/0038-behavioral-fidelity-harness.md` · Claim: #4439.
Not collected by `vitest run` or the default `playwright.config.ts`. P2: `.github/workflows/hub-fidelity.yml`
runs the checks **advisory** (not a required check) on PRs touching either surface, the shared shell, the chat
routes or this harness, and fails if the committed oracle is stale.

## Status (2026-10-15) — P1 met after one clone fix; P2 advisory job added

| AC | Result |
|---|---|
| AC1 files/deps | harness only under `mira-hub/tests/fidelity/**`; 0 `package.json`/lockfile changes |
| AC2 declared network | 0 unrecognized `/api` requests, 0 off-site browser requests (4 surface×scenario runs); proved red by deleting the `/api/auth/session` handler |
| AC3 request | exactly one chat POST per send; G and S: normalized chat body equal; `clientRequestId` a distinct v4 UUID per send; `threadId` absent on classic, `null` on the clone |
| AC4 rendered turn | G and S equal (after the safety-order fix, see Finding) |
| AC5 citation | both surfaces point the viewer at file `5555…` page 87 **and** fetch it |
| AC6 live ≡ hydrated | equal on both surfaces, G and S |
| AC7 determinism | 3/3 control runs → identical records, sha256 `09a0b0b1…a25143` |
| AC8 seeded defects | M1–M4 each turn exactly their predicted checks red (table below) |
| AC9 no false alarms | unchanged clone → 12/12 green on 3/3 runs |
| AC10 cost/data | $0 inference (all browser traffic routed to the oracle), synthetic ids only |

### Finding (fixed) — safety notice order differed

For the S prompt (eval safety-03) both surfaces render the energized-electrical **warning**, with the same
answer and evidence label. The classic page renders it **above** the answer
(`hazard-directive-banner`, `NotebookChat.tsx`); `/v3` renders it **after** the answer, sources and basis
(`partsFromStream` / `turnsFromPersisted` part order in `src/factorylm-ui/to-interaction.ts`).
Check `rendered turn: safety notice first (AC4, S)` was red on the clone. An inverse probe (safety parts
moved ahead of the answer in both mappers) turned all 10 checks green with nothing else moving, so the red
was the ordering itself. Owner decision (2026-10-15): `/v3` matches the classic order. Fixed in
`to-interaction.ts` (`safetyFirst`, both mappers), unit tests updated first and seen red; `M5` below keeps it.

Not measured (outside AC4 as written): the notice **copy** also differs — classic "Energized electrical
work — de-energize, lock out, and verify absence of voltage…", `/v3` "Warning · Energized electrical work:
this answer is framed by the NFPA 70E directive…". The record compares `kind`, not text.

## Run it

Prerequisites (once per checkout): `npm ci` in `mira-hub`, and the shared-shell link
`ln -sfn ../mira-hub/node_modules packages/node_modules` from the repo root (gitignored; without it `/v3`
fails to build with `Can't resolve '@assistant-ui/react'`).

```bash
cd mira-hub
npx playwright test --config tests/fidelity/playwright.fidelity.config.ts   # 10 checks, ~1 min incl. next dev boot
node tests/fidelity/mutations.mjs                                          # control + M1..M4 (AC8), ~5 min
```

The config boots `next dev -p 3999` (basePath `/hub`) with a **throwaway `AUTH_SECRET` minted per run**;
the spec mints a next-auth JWE cookie (`status: "active"`) against it. Never use a staging/prod secret.
Each run writes `tests/fidelity/.out/records.json` (gitignored) and prints its sha256 — the AC7 evidence.
`FIDELITY_SHOTS=<dir>` also saves each surface's live turn as a PNG (keep it outside the repo). While the
post-turn refetch is held the clone's composer still shows Stop; the turn itself is `data-lifecycle=completed`.
Side effect: `next dev` rewrites `mira-hub/AGENTS.md`; `git checkout -- mira-hub/AGENTS.md` after a run.

## How it works

- `harness.ts` — cookie + `page.route("**/api/**")` serving `fixtures/oracle.json`; catch-all records + aborts.
  Post-turn detail GETs are **held** until the live record is extracted: the clone swaps its streamed turn
  for the persisted row on that refetch, so without the hold "live" would silently be "hydrated". The
  `precondition:` check proves the hold (`data-turn-id` `live-…` then `turn-<S>-a`).
- `surfaces.ts` — per-surface selectors, one shared `TurnRecord`: answer text, citation chips
  (`n`, title, page from the `Open citation …` aria-label), safety `{present, kind, first}`, evidence label.
- `allowlist.ts` — request fields allowed to differ, each with a reason **and** a constraint it must still pass.
- `fidelity.spec.ts` — drives both surfaces × {G, S} in `beforeAll`, then one test per named check.
- `mutations.mjs` — AC8 runner; refuses a dirty target, restores with `git checkout` in `finally`,
  exits 1 on any red-set mismatch (proved with a deliberately wrong expectation → `MISMATCH`, exit 1).

## AC8 — seeded clone defects (2026-10-15, after the fix; counts both ways)

Hub default suite with the fix: `npx vitest run` → 382 files passed / 4 skipped; 6088 tests passed / 53 skipped / 0 failed.

| Id | Mutation (clone code only) | Predicted red | Result |
|---|---|---|---|
| control | none | — | 12 passed / 0 red — EXACT |
| M1 | drop source parts in both mappers (`to-interaction.ts`) | rendered turn: grounded answer; citation inspectable | 10 / 2 — EXACT |
| M2 | suppress every `safetyNoticePart` push (`to-interaction.ts`) | safety notice present; safety notice first ¹ | 10 / 2 — EXACT |
| M3 | persisted mapper drops `basisPart` (`to-interaction.ts`) | live ≡ hydrated: G; live ≡ hydrated: S | 10 / 2 — EXACT |
| M4 | `chatBodyFor` omits `sourceDocIds` (`hub-host-logic.ts`) | request: G; request: S | 10 / 2 — EXACT |
| M5 | `safetyFirst` returns parts unchanged (the pre-fix order) | safety notice first | 11 / 1 — EXACT |
| M6 ² | BOTH surfaces put the notice after the answer (clone + classic `NotebookChat.tsx`) | safety notice first | 11 / 1 — EXACT |
| M7 ² | shared `buildChatBody` reuses one fixed `clientRequestId` | clientRequestId is unique per send | 11 / 1 — EXACT |
| M8 ² | `chatBodyFor` omits `threadId` (`hub-host-logic.ts`) | request: G; request: S | 10 / 2 — EXACT |
| M9 ³ | clone fires a second, fire-and-forget chat POST per send (`hub-host.tsx`) | exactly one chat POST per send | 11 / 1 — EXACT |
| M10 ⁴ | clone drops the finished answer's follow-ups when the persisted row replaces the live turn (`hub-host.tsx`) | settle: follow-ups survive the post-turn refetch | 12 / 1 — EXACT |
| M11 ⁵ | clone declares a capability beyond `grounding_status_v1` in `clientCapabilities` (`hub-host-logic.ts`) | request: G; request: S | 11 / 2 — EXACT |

¹ M2 was first predicted as "present" only and came back MISMATCH: an absent notice is not first either.
The cascade had been masked while "first" was a standing red. Prediction corrected, then re-run EXACT.
² Added for Codex review #4441 round 1 (F1, F2). Each was first run against the old checks and came back
MISMATCH with 10/10 green — parity-only "first", syntax-only `clientRequestId`, and a `threadId` rule that
allowed absence on the clone. M6/M7 touch the reference or a shared module on purpose: they prove the checks
that must hold absolutely cannot pass when both surfaces regress together.
³ Added for Codex review #4441 round 2 (F1): first run against the old checks → MISMATCH, 11/11 green.
⁴ Added for #4454 with the `settle` check, which makes 13 checks: control 13 / 0, M10 12 / 1, both EXACT
(2026-10-15). The check also goes red, alone, against main's unfixed `hub-host.tsx` + `to-interaction.ts`.
⁵ Added for #4303 (2026-10-17): `clientCapabilities` is allowlisted for exactly `["grounding_status_v1"]` on the
clone and must be absent on the reference (the frozen classic page is not edited). Control 13 / 0 and M11 11 / 2,
both EXACT, on the #4303 branch; before the allowlist entry the control itself was 11 / 2 (both AC3 checks red).

M1 also reddens AC5 by construction (no citation left to open). Named first-red test
`rendered turn: grounded answer` fails under M1 as the PRD requires.

**Blind spot by design:** a defect in a module BOTH surfaces import (`notebook-chat-utils.ts`,
`notebook-markdown.tsx`, `parseFrame`) changes reference and clone identically, so a differential harness
cannot see it. Those modules need their own unit tests.

## Oracle

Regenerate: `npx vitest run --config tests/fidelity/vitest.fidelity.config.ts`
**Invalidation trigger:** any change to `src/app/api/equipment-notebooks/[id]/chat/route.ts`,
`[id]/route.ts`, `equipment-notebooks/route.ts`, or the frame/evidence types in `src/lib/notebook-chat-types.ts`.

What it holds (produced by the REAL route handlers; only the DB edge and the LLM are stubbed):
- `detailEmpty`, `list` — notebook detail before any turn, and the notebook list.
- `G` — grounded fault-code turn: one citation (doc `3333…`, page 87, `fileId` `5555…`), basis `oem_documentation`.
- `S` — eval safety-03 prompt: evidence frame carries `safety_notice` (`energized-electrical-hazard`), basis `general_reasoning`.
- `<scenario>.detailAfter` — detail GET built from exactly what the chat route passed to `recordTurn`.

Note: the route's safety validator rejected the first scripted G answer ("with the drive locked out,
check incoming line voltage" — an energy contradiction). The fixture answer was rewritten to be safe.
