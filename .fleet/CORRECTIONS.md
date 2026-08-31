# FLEET-001 — Corrections required (from Charlie's independent review)

Charlie reviewed commit e0baa6e1e and returned **PASS WITH KNOWN LIMITATION** with one
BLOCKING and one IMPORTANT finding. Fix BOTH. Do not expand scope beyond them.

## BLOCKING — the branch does not type-check; Hub E2E (`next build`) would FAIL
`bun run vitest` uses esbuild and never type-checks. `npx tsc --noEmit -p tsconfig.json`
shows 6 NEW errors introduced by this diff (32 others are pre-existing on origin/main in
files this diff never touches — ignore those, do NOT try to fix them):

1. src/components/equipment/notebook-chat-utils.test.ts(271,3) TS2300 Duplicate identifier 'splitEvidence'
2. src/components/equipment/notebook-chat-utils.test.ts(453,10) TS2300 Duplicate identifier 'splitEvidence'
   -> `splitEvidence` is ALREADY imported near line 266. DELETE the duplicate import you added ~line 453.
3. src/components/equipment/notebook-chat-utils.test.ts(476,34) TS2345
4. src/components/equipment/notebook-chat-utils.test.ts(495,34) TS2345
   -> your two new round-trip tests build `rows` as a bare literal, so TS widens `kind` to
      `string` and it no longer satisfies the discriminated union. Annotate
      `const rows: PersistedTurn[] = [...]` (or use `as const` on the kind literals).
5. src/app/api/equipment-notebooks/__tests__/chat-safety-stop.test.ts(148,54) TS2493
6. src/app/api/equipment-notebooks/__tests__/chat-safety-stop.test.ts(149,19) TS18048
   -> `domainMock.recordTurn` is `vi.fn(async () => undefined)` so its call-args tuple infers
      as `[]`; `.mock.calls[0][2]` is out of range and `.calls[0]` is possibly undefined.
      Type or cast the mock call args.

These are ALL in test files. Do NOT change the production route/type code.

## IMPORTANT — the commit message overstates the technician-visible effect
Nothing renders `safetyNotice` yet (NotebookChat.tsx has no such field; mobile sse.ts has no
reader). This slice is **data-layer only**. Amend the commit message (or add a body line) to
say plainly: "data-layer only; no visible client change yet — rendering lands in a later slice."

## Required
1. Apply both fixes.
2. Run BOTH gates and paste REAL output:
   cd mira-hub && bun run vitest run src/components/equipment/notebook-chat-utils.test.ts src/app/api/equipment-notebooks/__tests__/chat-safety-stop.test.ts
   cd mira-hub && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "notebook-chat-utils.test|chat-safety-stop.test" ; echo "exit-marker done"
   The second command MUST print no errors for those two files.
3. Commit the corrections (do NOT push).
4. Update .fleet/HANDOFF.md with a "Corrections applied" section incl. the real tsc output.
5. Report the new commit SHA.
