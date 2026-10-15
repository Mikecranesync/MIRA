# Behavioral-fidelity harness (PoC) — classic notebook chat vs `/v3`

PRD: `docs/prd/2026-10-14-behavioral-fidelity-harness.md` · ADR: `docs/adr/0038-behavioral-fidelity-harness.md` · Claim: #4439.
Local-only: nothing here is collected by `vitest run` or wired into CI.

## Status (2026-10-14) — PARTIAL

| Step | State |
|---|---|
| Oracle generator (`oracle.gen.test.ts`, `vitest.fidelity.config.ts`) | ✅ 3/3 pass; writes `fixtures/oracle.json` |
| Playwright harness (`playwright.fidelity.config.ts`, `fidelity.spec.ts`, `allowlist.ts`) | ⏳ not started |
| Seeded-defect proof (AC8) and 3× determinism (AC7) | ⏳ |

Regenerate the oracle: `npx vitest run --config tests/fidelity/vitest.fidelity.config.ts`
**Invalidation trigger:** any change to `src/app/api/equipment-notebooks/[id]/chat/route.ts`,
`[id]/route.ts`, `equipment-notebooks/route.ts`, or the frame/evidence types in `src/lib/notebook-chat-types.ts`.

What the oracle holds (all produced by the REAL route handlers; only the DB edge and the LLM are stubbed):
- `detailEmpty`, `list` — notebook detail before any turn, and the notebook list.
- `G` — grounded fault-code turn: SSE has one citation (doc `3333…`, page 87, `fileId` `5555…`), basis `oem_documentation`.
- `S` — eval safety-03 prompt: evidence frame carries `safety_notice` (`energized-electrical-hazard`), basis `general_reasoning`.
- `<scenario>.detailAfter` — detail GET built from exactly what the chat route passed to `recordTurn`
  (listTurns is a 1:1 column pass-through; only `id`/`createdAt` are minted).

Note: the route's safety validator rejected the first scripted G answer ("with the drive locked out,
check incoming line voltage" — an energy contradiction). The fixture answer was rewritten to be safe.

## Next steps (P1 remainder)

1. **Auth:** start `next dev` (basePath `/hub`) with a throwaway local `AUTH_SECRET`; mint the
   `next-auth.session-token` cookie as a JWE (`alg: dir`, `enc: A256GCM`) with the key derived exactly as
   `src/middleware.ts` `deriveKey` (HKDF-SHA256, empty salt, info `"NextAuth.js Generated Encryption Key"`),
   payload `{ status: "active", tenantId: <uuid>, sub: <uuid> }` (middleware gates only on `status`).
   Never use a staging/prod secret.
2. **Routes** (`page.route` on `**/api/**`, match on pathname, ignore query; `serviceWorkers: "block"`):
   `GET /api/me`, `GET /api/equipment-notebooks/` (→ `list`), `GET /api/equipment-notebooks/<NB>[/]`
   (→ `detailEmpty` before the chat POST, `<scenario>.detailAfter` after), `POST …/<NB>/chat/` (→ `<scenario>.sse`,
   `text/event-stream`, capture the request body), `GET /api/namespace/node/<NODE>/files/` (→ `{files: []}`),
   `GET /api/namespace/files/<FILE>*` (→ a tiny PDF), `GET /api/assets` (→ `[]`). Catch-all: record + abort;
   the run FAILS if that list is non-empty (AC2).
3. **Surfaces:** reference `/hub/equipment/<NB>` (classic, `components/equipment/NotebookChat.tsx`);
   clone `/hub/v3` (`src/factorylm-ui/hub-host.tsx`).
4. **Extract per surface:** chat request body (normalized; allowlist e.g. `clientRequestId`, `threadId` with a
   reason each); rendered turn record — answer text, citations (doc, page), safety notice present + first,
   evidence label; then reload and extract again (live ≡ hydrated).
5. **Prove it can fail (AC8):** mutate the CLONE's code (`src/factorylm-ui/to-interaction.ts` / `hub-host.tsx`):
   M1 drop citations, M2 suppress the safety part, M3 hydrated turns without the evidence label, M4 omit
   `sourceDocIds` from the request. Each must turn exactly its named check red; record counts both ways.
   Control: unchanged clone = 0 diffs on 3/3 runs.
