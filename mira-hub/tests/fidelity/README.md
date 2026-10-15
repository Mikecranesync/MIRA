# Behavioral-fidelity harness (PoC) — classic notebook chat vs `/v3`

PRD: `docs/prd/2026-10-14-behavioral-fidelity-harness.md` · ADR: `docs/adr/0038-behavioral-fidelity-harness.md` · Claim: #4439.
Local-only: nothing here is collected by `vitest run` / the default `playwright.config.ts` or wired into CI (P2 is not authorized).

## Status (2026-10-15) — P1 built; AC9 NOT met (one real divergence)

| AC | Result |
|---|---|
| AC1 files/deps | harness only under `mira-hub/tests/fidelity/**`; 0 `package.json`/lockfile changes |
| AC2 declared network | 0 unrecognized `/api` requests, 0 off-site requests (4 surface×scenario runs) |
| AC3 request | G and S: normalized chat body equal (allowlist: `clientRequestId`, `threadId`) |
| AC4 rendered turn | G equal; S equal **except safety-notice order** (see Finding) |
| AC5 citation | both surfaces open file `5555…` at page 87 |
| AC6 live ≡ hydrated | equal on both surfaces, G and S |
| AC7 determinism | 3/3 control runs → identical records, sha256 `877587e1…ab58d` |
| AC8 seeded defects | M1–M4 each turn exactly their predicted checks red (table below) |
| AC9 no false alarms | **1 standing diff** — it is a real divergence, not a harness artifact |
| AC10 cost/data | $0 inference (all traffic routed to the oracle), synthetic ids only |

### Finding — safety notice order differs

For the S prompt (eval safety-03) both surfaces render the energized-electrical **warning**, with the same
answer and evidence label. The classic page renders it **above** the answer
(`hazard-directive-banner`, `NotebookChat.tsx`); `/v3` renders it **after** the answer, sources and basis
(`partsFromStream` / `turnsFromPersisted` part order in `src/factorylm-ui/to-interaction.ts`).
Check `rendered turn: safety notice first (AC4, S)` is red on the unchanged clone. Not allowlisted and not
skipped: whether `/v3` must match is an owner decision; fixing it is a clone change outside this harness.

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

## AC8 — seeded clone defects (2026-10-15 run, counts both ways)

| Id | Mutation (clone code only) | Predicted red (beyond the standing "safety first") | Result |
|---|---|---|---|
| control | none | — | 9 passed / 1 red — EXACT |
| M1 | drop source parts in both mappers (`to-interaction.ts`) | rendered turn: grounded answer; citation inspectable | 7 / 3 — EXACT |
| M2 | suppress every `safetyNoticePart` push (`to-interaction.ts`) | rendered turn: safety notice present | 8 / 2 — EXACT |
| M3 | persisted mapper drops `basisPart` (`to-interaction.ts`) | live ≡ hydrated: G; live ≡ hydrated: S | 7 / 3 — EXACT |
| M4 | `chatBodyFor` omits `sourceDocIds` (`hub-host-logic.ts`) | request: G; request: S | 7 / 3 — EXACT |

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
