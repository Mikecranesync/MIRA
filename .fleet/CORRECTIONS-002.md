# FLEET-002 — Correction required (Charlie independent review)

Verdict: PASS WITH KNOWN LIMITATION. 7 PASS, 2 IMPORTANT, 1 MINOR, **zero BLOCKING**.

## IMPORTANT #1 — FIX THIS (one-line hardening)
"Machine-replay and visual-observation cards are NOT gated by `!turn.safetyNotice`."

In `mira-hub/src/components/equipment/NotebookChat.tsx`, the safety turn already
suppresses citation chips, the basis caption and follow-up chips — but the
machine-replay card and the visual-observation card are still rendered
unconditionally. Charlie judged this unreachable in production today (a safety stop
short-circuits before retrieval, so those arrays are empty), hence IMPORTANT not
BLOCKING — but it is a cheap, high-value hardening and the `Bubble` component is
likely to be copied to other chat surfaces later.

**Fix:** gate the machine-evidence and visual-observation card rendering on
`!turn.safetyNotice`, exactly the way the citation chips / basis / follow-ups are
already gated. Add a test asserting a safety turn with (hypothetically) non-empty
machineEvidence/visualEvidence renders NEITHER card.

## IMPORTANT #2 — DO NOT "FIX" IN CODE
"Mobile is not covered." Charlie confirmed this is a legitimate scope boundary:
mira-mobile ChatV2 lives in HELD PR #3516, which is not on this branch. Do NOT try
to change mira-mobile here. Instead, record it explicitly in HANDOFF.md under
"Known limitations" as: mobile safety rendering remains an OPEN gap, deferred to
PR #3516 which is HELD — so it may sit unresolved indefinitely and needs Mike's
attention as an epic-level item.

## MINOR — no action
Safety-stop text stays in model history: pre-existing, not introduced here.

## Required
1. Apply IMPORTANT #1 + its test.
2. Run and paste REAL output (this machine has NO bun — use npx):
   cd mira-hub && npx vitest run src/components/equipment src/app/api/equipment-notebooks
   cd mira-hub && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "NotebookChat|notebook-chat-utils"
   (the tsc grep MUST be empty; project total must stay 32)
3. git add -A mira-hub .fleet && git commit (do NOT push, do NOT commit package-lock.json).
4. Update .fleet/HANDOFF.md with a "Corrections applied" section + the mobile limitation.
5. Report the commit SHA.
